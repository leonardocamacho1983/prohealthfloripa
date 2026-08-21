import assert from "node:assert/strict";
import test from "node:test";

import type { CustomerContext } from "../customer-context/index.ts";
import type { HandoffStore } from "../handoff/types.ts";
import { initialJourneyState, type ConversationJourneyState } from "../journey/types.ts";
import type { WhatsAppProvider } from "../whatsapp/provider.ts";
import { EmptyTurnInvariantError, prepareReplyMessages,
  processConversationTurn } from "./process-conversation-turn.ts";
import type { ConversationIdentity, ConversationMessage, ConversationTurnRepository,
  CompleteJourneyHandoffInput, CustomerProfile, OutboundReservation, TurnAcquisition,
  TurnCompletionState } from "./types.ts";

class TurnRepository implements ConversationTurnRepository, HandoffStore {
  identity: ConversationIdentity = { contactId: "contact", conversationId: "conversation", relationshipStatus: "unknown" };
  messages: ConversationMessage[];
  status: "active" | "human_requested" | "human_active" | "closed" = "active";
  revision: number;
  processedRevision = 0;
  token?: string;
  sentKeys = new Set<string>();
  pendingOutbounds = new Map<string, { content: string; revision: number }>();
  handoffRequested = false;
  automaticClosureReason?: string;
  handoffSource?: "customer" | "safety_rule" | "system_failure";
  releasedState?: "failed" | "stale";
  completedStates: TurnCompletionState[] = [];
  recentMessageReads = 0;
  profileReads = 0;

  constructor(contents: string[]) {
    this.revision = contents.length;
    this.messages = contents.map((content, index) => ({ id: String(index), conversationId: "conversation",
      providerMessageId: `provider-${index}`, direction: "inbound", role: "user", content,
      inputRevision: index + 1, createdAt: new Date(index * 1000) }));
  }

  addInbound(content: string) {
    this.revision += 1;
    this.messages.push({
      id: String(this.messages.length),
      conversationId: "conversation",
      providerMessageId: `provider-${this.messages.length}`,
      direction: "inbound",
      role: "user",
      content,
      inputRevision: this.revision,
      createdAt: new Date(this.revision * 1_000),
    });
  }

  async recordInbound() { return { identity: this.identity, inserted: true, revision: this.revision,
    conversationStatus: this.status }; }
  async recordOutbound(input: { conversationId: string; content: string }) {
    this.messages.push({ id: `out-${this.messages.length}`, conversationId: input.conversationId,
      direction: "outbound", role: "assistant", content: input.content, createdAt: new Date() });
  }
  async getRecentMessages(_conversationId: string, limit: number) {
    this.recentMessageReads += 1;
    return this.messages.slice(-limit);
  }
  async getCustomerProfile(): Promise<CustomerProfile | undefined> {
    this.profileReads += 1;
    return undefined;
  }
  async acquireTurn(input: { observedRevision: number; token: string }): Promise<TurnAcquisition> {
    if (this.status !== "active") return { kind: "human" };
    if (input.observedRevision !== this.revision) return { kind: "stale" };
    if (this.processedRevision >= this.revision) return { kind: "complete" };
    this.token = input.token;
    return { kind: "acquired", turn: { conversationId: "conversation", revision: this.revision,
      processedRevision: this.processedRevision, phoneNumber: "+5548999999999", accountId: "account",
      providerConversationId: "provider-conversation", identity: this.identity,
      messages: this.messages.filter((message) => message.direction === "inbound"
        && (message.inputRevision ?? 0) > this.processedRevision) } };
  }
  async reserveOutbound(input: { revision: number; token: string; idempotencyKey: string;
    content: string }): Promise<OutboundReservation> {
    if (this.status !== "active" || this.revision !== input.revision || this.token !== input.token) return "stale";
    if (this.sentKeys.has(input.idempotencyKey)) return "already_sent";
    this.pendingOutbounds.set(input.idempotencyKey, {
      content: input.content,
      revision: input.revision,
    });
    return "reserved";
  }
  async markOutboundSent(input: { idempotencyKey: string }) {
    if (this.sentKeys.has(input.idempotencyKey)) return;
    this.sentKeys.add(input.idempotencyKey);
    const pending = this.pendingOutbounds.get(input.idempotencyKey);
    if (pending) {
      this.messages.push({
        id: `out-${this.messages.length}`,
        conversationId: "conversation",
        direction: "outbound",
        role: "assistant",
        content: pending.content,
        responseRevision: pending.revision,
        createdAt: new Date((this.messages.length + 1) * 1_000),
      });
    }
  }
  async markOutboundFailed(input: { idempotencyKey: string }) {
    this.pendingOutbounds.delete(input.idempotencyKey);
  }
  async completeTurn(input: { revision: number; token: string; state: TurnCompletionState }) {
    if (this.revision !== input.revision || this.token !== input.token || this.status !== "active") return false;
    this.completedStates.push(input.state);
    this.processedRevision = input.revision; this.token = undefined; return true;
  }
  async completeAutomaticClosure(input: { revision: number; token: string; reasonId: "customer_satisfied" }) {
    if (this.revision !== input.revision || this.token !== input.token || this.status !== "active") return false;
    this.completedStates.push("replied");
    this.automaticClosureReason = input.reasonId;
    this.processedRevision = input.revision;
    this.status = "closed";
    this.token = undefined;
    return true;
  }
  async releaseTurn(input: { state?: "failed" | "stale" }) {
    this.releasedState = input.state; this.token = undefined;
  }
  async getConversationState() { return { status: this.status }; }
  async requestHandoff(input?: { source: "customer" | "safety_rule" | "system_failure" }) {
    this.handoffRequested = true;
    this.handoffSource = input?.source;
    this.status = "human_requested";
    this.processedRevision = this.revision;
  }
  async listHandoffs() { return []; }
  async takeHandoff() { this.status = "human_active"; }
  async touchHandoff() {}
  async closeHandoff() { this.status = "closed"; }
  async markHandoffViewed() {}
  async recordHandoffEvent() {}
}

class JourneyTurnRepository extends TurnRepository {
  journeyState?: ConversationJourneyState;
  profile?: CustomerProfile;
  savedJourneyStates: ConversationJourneyState[] = [];
  completeJourneyHandoffAttempts = 0;
  failNextJourneyHandoff = false;

  async getCustomerProfile(): Promise<CustomerProfile | undefined> { return this.profile; }
  async getJourneyState() { return this.journeyState ? structuredClone(this.journeyState) : undefined; }
  async saveJourneyState(input: { state: ConversationJourneyState }) {
    if (input.state.updatedFromRevision !== this.revision) return "stale" as const;
    this.journeyState = structuredClone(input.state);
    this.savedJourneyStates.push(structuredClone(input.state));
    return "saved" as const;
  }
  async completeTurnWithJourneyState(input: {
    revision: number;
    token: string;
    journeyState: ConversationJourneyState;
  }) {
    if (input.revision !== this.revision || input.token !== this.token || this.status !== "active") return false;
    this.journeyState = structuredClone(input.journeyState);
    this.savedJourneyStates.push(structuredClone(input.journeyState));
    this.completedStates.push("replied");
    this.processedRevision = input.revision;
    this.token = undefined;
    return true;
  }
  async completeJourneyHandoff(input: CompleteJourneyHandoffInput) {
    this.completeJourneyHandoffAttempts += 1;
    if (this.failNextJourneyHandoff) {
      this.failNextJourneyHandoff = false;
      throw new Error("temporary journey handoff failure");
    }
    const currentLease = input.revision === this.revision && input.token === this.token;
    const sentEvidence = this.sentKeys.has(input.outboundIdempotencyKey);
    if ((!currentLease && !sentEvidence) || this.status !== "active") return false;
    this.journeyState = structuredClone(input.journeyState);
    this.savedJourneyStates.push(structuredClone(input.journeyState));
    this.handoffRequested = true;
    this.handoffSource = input.source;
    this.status = "human_requested";
    this.processedRevision = this.revision;
    this.token = undefined;
    this.completedStates.push("handoff");
    return true;
  }
}

test("reply preparation removes equivalent duplicate bubbles before applying the limit", () => {
  assert.deepEqual(prepareReplyMessages([
    "  Oi, bom dia!  Tudo ótimo por aqui. ",
    "oi,  BOM DIA! Tudo ótimo por aqui .",
    "Qual dia funciona melhor para você?",
  ]), {
    messages: [
      "Oi, bom dia! Tudo ótimo por aqui.",
      "Qual dia funciona melhor para você?",
    ],
    duplicateCount: 1,
  });
});

test("a duplicated AI bubble is sent only once", async () => {
  const repository = new TurnRepository(["Quero marcar uma massagem relaxante"]);
  const provider = new TurnProvider();
  const repeated = "A Relaxante dura uma hora e custa R$ 270. Você quer incluir a banheira?";

  const result = await processConversationTurn({
    conversationId: "conversation",
    observedRevision: 1,
    repository,
    provider,
    generateReply: async () => ({
      messages: [repeated, `  ${repeated.toLocaleLowerCase("pt-BR")}  `],
      answeredTopics: ["massagem"],
      needsClarification: false,
      handoffRecommended: false,
    }),
  });

  assert.equal(result, "replied");
  assert.deepEqual(provider.sent, [repeated]);
});

test("two distinct AI bubbles remain separate", async () => {
  const repository = new TurnRepository(["Quero marcar uma massagem relaxante"]);
  const provider = new TurnProvider();

  const result = await processConversationTurn({
    conversationId: "conversation",
    observedRevision: 1,
    repository,
    provider,
    generateReply: async () => ({
      messages: ["A Relaxante dura uma hora.", "O valor avulso é R$ 270."],
      answeredTopics: ["massagem"],
      needsClarification: false,
      handoffRecommended: false,
    }),
  });

  assert.equal(result, "replied");
  assert.deepEqual(provider.sent, ["A Relaxante dura uma hora.", "O valor avulso é R$ 270."]);
});

class TurnProvider implements WhatsAppProvider {
  sent: string[] = [];
  typing = 0;
  onSend?: (text: string) => void;
  failNextSend = false;
  async sendText(input: { text: string }) {
    if (this.failNextSend) {
      this.failNextSend = false;
      throw new Error("temporary provider failure");
    }
    this.sent.push(input.text); this.onSend?.(input.text);
  }
  async sendTypingIndicator() { this.typing += 1; }
}

function reply(text = "Resposta consolidada") {
  return async (input?: { message: string; context: CustomerContext }) => {
    void input;
    return { messages: [text], answeredTopics: ["teste"], needsClarification: false,
      handoffRecommended: false };
  };
}

function readyRelaxanteScheduleState(revision = 2): ConversationJourneyState {
  return {
    ...initialJourneyState(revision),
    stage: "ready_for_handoff",
    goals: ["relaxation"],
    serviceFamily: "massage",
    recommendedServices: ["Relaxante"],
    selectedService: "Relaxante",
    factsSent: ["service_price", "service_duration", "hot_bath_amenities"],
    offers: { hot_bath: "declined" },
    scheduling: { status: "complete", dayText: "amanhã", time: "15:30" },
  };
}

test("five rapid messages use one enrichment, one generation and one outbound send", async () => {
  const repository = new TurnRepository(["Quero saber do meu plano", "e da Lomi-Lomi", "Quanto custa", "Ah", "oi"]);
  const provider = new TurnProvider(); let enriched = 0; let generated = 0; let consolidated = "";
  let currentTurnMessageIds: readonly string[] = [];
  const result = await processConversationTurn({ conversationId: "conversation", observedRevision: 5,
    repository, provider, enrichCustomer: async ({ identity }) => { enriched += 1; return identity; },
    generateReply: async (input) => { generated += 1; consolidated = input.message;
      currentTurnMessageIds = input.currentTurnMessageIds ?? []; return reply()(input); } });
  assert.equal(result, "replied");
  assert.equal(enriched, 1); assert.equal(generated, 1); assert.equal(provider.sent.length, 1);
  assert.equal(currentTurnMessageIds.length, 5);
  assert.match(consolidated, /Lomi-Lomi/); assert.match(consolidated, /Quanto custa/);
});

test("closes automatically only after the customer authorizes the agent prompt", async () => {
  const repository = new TurnRepository(["Estou satisfeito, era isso"]);
  const provider = new TurnProvider();
  let generated = 0;
  const generateReply = async () => { generated += 1; return reply()(); };

  const promptResult = await processConversationTurn({ conversationId: "conversation", observedRevision: 1,
    repository, provider, generateReply });
  assert.equal(promptResult, "replied");
  assert.match(provider.sent[0] ?? "", /Posso encerrar este atendimento/);
  assert.equal(repository.status, "active");

  repository.addInbound("sim, pode encerrar");
  const closeResult = await processConversationTurn({ conversationId: "conversation", observedRevision: 2,
    repository, provider, generateReply });
  assert.equal(closeResult, "replied");
  assert.match(provider.sent[1] ?? "", /Vou encerrar este atendimento/);
  assert.equal(repository.status, "closed");
  assert.equal(repository.automaticClosureReason, "customer_satisfied");
  assert.equal(generated, 0);
});

test("a stalled typing indicator never delays generation or the customer reply", async () => {
  const repository = new TurnRepository(["Quero massagem relaxante"]);
  const sent: string[] = [];
  let typingSignal: AbortSignal | undefined;
  const provider: WhatsAppProvider = {
    async sendText(input) { sent.push(input.text); },
    async sendTypingIndicator({ signal }) {
      typingSignal = signal;
      await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
    },
  };

  const result = await processConversationTurn({ conversationId: "conversation", observedRevision: 1,
    repository, provider, generateReply: reply("A Relaxante custa R$ 270.") });

  assert.equal(result, "replied");
  assert.deepEqual(sent, ["A Relaxante custa R$ 270."]);
  assert.equal(typingSignal?.aborted, true);
});

test("a greeting-only burst never invokes AI or revives an old topic", async () => {
  const repository = new TurnRepository(["Oi bom dia", "Tudo bem?"]);
  repository.messages.unshift({ id: "old-topic", conversationId: "conversation",
    direction: "inbound", role: "user", content: "Dor antiga na cervical",
    createdAt: new Date(-11 * 60 * 60 * 1000) });
  const provider = new TurnProvider();
  let generated = false;

  const result = await processConversationTurn({ conversationId: "conversation", observedRevision: 2,
    repository, provider, generateReply: async () => {
      generated = true;
      return reply()(undefined as never);
    } });

  assert.equal(result, "replied");
  assert.equal(generated, false);
  assert.deepEqual(provider.sent,
    ["Oi, bom dia! Tudo ótimo por aqui 😊 E com você? Como podemos te ajudar hoje?"]);
  assert.equal(repository.recentMessageReads, 0);
  assert.equal(repository.profileReads, 0);
});

test("the new agent owns a social and substantive burst without automatic closure", async () => {
  const repository = new TurnRepository([
    "Tudo bem tbm obrigado.",
    "Eu queria saber sobre liberação miofascial",
  ]);
  const provider = new TurnProvider();
  let generated = 0;
  let receivedMessage = "";

  const result = await processConversationTurn({
    conversationId: "conversation",
    observedRevision: 2,
    repository,
    provider,
    agentOwnsConversation: true,
    journeyMode: "off",
    semanticPlannerMode: "off",
    generateReply: async (input) => {
      generated += 1;
      receivedMessage = input.message;
      return {
        messages: ["A Miofascial é uma massagem direcionada a regiões de tensão. O atendimento dura uma hora e custa R$ 270."],
        answeredTopics: ["miofascial"],
        needsClarification: false,
        handoffRecommended: false,
      };
    },
  });

  assert.equal(result, "replied");
  assert.equal(generated, 1);
  assert.match(receivedMessage, /obrigado[\s\S]*liberação miofascial/i);
  assert.equal(provider.sent.length, 1);
  assert.doesNotMatch(provider.sent[0] ?? "", /encerrar/i);
});

test("the new agent receives a greeting-only turn instead of a canned social reply", async () => {
  const repository = new TurnRepository(["Oi bom dia!", "tudo bem?"]);
  const provider = new TurnProvider();
  let generated = false;

  await processConversationTurn({
    conversationId: "conversation",
    observedRevision: 2,
    repository,
    provider,
    agentOwnsConversation: true,
    journeyMode: "off",
    semanticPlannerMode: "off",
    generateReply: async () => {
      generated = true;
      return {
        messages: ["Oi, bom dia! Tudo bem por aqui 😊 Como posso te ajudar?"],
        answeredTopics: ["greeting"], needsClarification: true, handoffRecommended: false,
      };
    },
  });

  assert.equal(generated, true);
  assert.deepEqual(provider.sent, ["Oi, bom dia! Tudo bem por aqui 😊 Como posso te ajudar?"]);
});

test("a greeting after inactivity starts an episode that excludes the old symptom", async () => {
  const repository = new TurnRepository(["Oi bom dia", "Quero massagem de liberação", "Dor no ombro"]);
  repository.messages.unshift(
    { id: "old-user", conversationId: "conversation", direction: "inbound", role: "user",
      content: "Dor antiga na cervical", createdAt: new Date(-11 * 60 * 60 * 1000) },
    { id: "old-assistant", conversationId: "conversation", direction: "outbound", role: "assistant",
      content: "Vou considerar sua cervical.", createdAt: new Date(-11 * 60 * 60 * 1000 + 1_000) },
  );
  const provider = new TurnProvider();
  let visibleHistory = "";

  await processConversationTurn({ conversationId: "conversation", observedRevision: 3,
    repository, provider, generateReply: async ({ context }) => {
      visibleHistory = context.conversation.recentMessages.map((message) => message.content).join(" | ");
      return reply("Resposta do episódio atual")();
    } });

  assert.doesNotMatch(visibleHistory, /cervical/i);
  assert.match(visibleHistory, /massagem de liberação/i);
});

test("different topics may be delivered as two short WhatsApp bubbles", async () => {
  const repository = new TurnRepository(["Quero o preço da massagem", "E também o endereço"]);
  const provider = new TurnProvider();
  const result = await processConversationTurn({ conversationId: "conversation", observedRevision: 2,
    repository, provider, generateReply: async () => ({ messages: ["A massagem custa R$ 270.",
      "O endereço é Rua Vera Linhares de Andrade, 2063."], answeredTopics: ["preço", "endereço"],
      needsClarification: false, handoffRecommended: false }) });
  assert.equal(result, "replied");
  assert.deepEqual(provider.sent, ["A massagem custa R$ 270.",
    "O endereço é Rua Vera Linhares de Andrade, 2063."]);
});

test("a new inbound between topical bubbles suppresses the remaining old bubble", async () => {
  const repository = new TurnRepository(["Quero o preço da massagem", "E também o endereço"]);
  const provider = new TurnProvider();
  provider.onSend = () => {
    provider.onSend = undefined;
    repository.revision += 1;
    repository.token = undefined;
    repository.messages.push({ id: "late-between-bubbles", conversationId: "conversation",
      direction: "inbound", role: "user", content: "Na verdade, quero Pilates", inputRevision: 3,
      createdAt: new Date() });
  };
  const result = await processConversationTurn({ conversationId: "conversation", observedRevision: 2,
    repository, provider, generateReply: async () => ({ messages: ["A massagem custa R$ 270.",
      "O endereço é Rua Vera Linhares de Andrade, 2063."], answeredTopics: ["preço", "endereço"],
      needsClarification: false, handoffRecommended: false }) });
  assert.equal(result, "stale");
  assert.deepEqual(provider.sent, ["A massagem custa R$ 270."]);
});

test("a new inbound revision invalidates a draft before provider send", async () => {
  const repository = new TurnRepository(["Qual o preço?"]); const provider = new TurnProvider();
  const result = await processConversationTurn({ conversationId: "conversation", observedRevision: 1,
    repository, provider, generateReply: async () => {
      repository.revision += 1;
      repository.messages.push({ id: "new", conversationId: "conversation", direction: "inbound", role: "user",
        content: "E o endereço?", inputRevision: 2, createdAt: new Date() });
      return reply()(undefined as never);
    } });
  assert.equal(result, "stale"); assert.equal(provider.sent.length, 0);
});

test("a message arriving during the final grace window invalidates the old reply", async () => {
  const repository = new TurnRepository(["Quero massagem hoje"]); const provider = new TurnProvider();
  setTimeout(() => {
    repository.revision += 1;
    repository.token = undefined;
    repository.messages.push({ id: "late", conversationId: "conversation", direction: "inbound", role: "user",
      content: "Também estou com dor no ombro", inputRevision: 2, createdAt: new Date() });
  }, 5);
  const result = await processConversationTurn({ conversationId: "conversation", observedRevision: 1,
    repository, provider, generateReply: reply("Resposta antiga"), preSendGraceMs: 20 });
  assert.equal(result, "stale");
  assert.equal(provider.sent.length, 0);
});

test("complete cancellation before processing emits no reply", async () => {
  const repository = new TurnRepository(["Qual o telefone?", "Não precisa responder"]); const provider = new TurnProvider();
  let generated = false;
  const result = await processConversationTurn({ conversationId: "conversation", observedRevision: 2,
    repository, provider, generateReply: async () => { generated = true; return reply()(undefined as never); } });
  assert.equal(result, "suppressed"); assert.equal(generated, false); assert.equal(provider.sent.length, 0);
  assert.deepEqual(repository.completedStates, ["suppressed"]);
  assert.equal(repository.releasedState, undefined);
});

test("an acquired revision without messages fails closed and remains unprocessed", async () => {
  const repository = new TurnRepository(["Mensagem persistida"]); const provider = new TurnProvider();
  repository.messages = [];
  await assert.rejects(
    processConversationTurn({ conversationId: "conversation", observedRevision: 1,
      repository, provider, generateReply: reply() }),
    (error) => error instanceof EmptyTurnInvariantError
      && error.revision === 1 && error.processedRevision === 0,
  );
  assert.equal(repository.processedRevision, 0);
  assert.equal(repository.releasedState, "failed");
  assert.deepEqual(repository.completedStates, []);
  assert.equal(provider.sent.length, 0);
});

test("corrections remain ordered in the consolidated turn", async () => {
  const repository = new TurnRepository(["Quero Thai", "Na verdade Lomi-Lomi", "Quanto custa?"]);
  const provider = new TurnProvider(); let consolidated = "";
  await processConversationTurn({ conversationId: "conversation", observedRevision: 3, repository, provider,
    generateReply: async (input) => { consolidated = input.message; return reply("Lomi-Lomi custa R$ 270.")(input); } });
  assert.match(consolidated, /Thai[\s\S]*Na verdade Lomi-Lomi[\s\S]*Quanto custa/);
  assert.deepEqual(provider.sent, ["Lomi-Lomi custa R$ 270."]);
});

test("active human ownership keeps the agent silent", async () => {
  const repository = new TurnRepository(["Oi"]); repository.status = "human_active";
  const provider = new TurnProvider();
  const result = await processConversationTurn({ conversationId: "conversation", observedRevision: 1,
    repository, provider, generateReply: reply() });
  assert.equal(result, "human_silent"); assert.equal(provider.sent.length, 0);
});

test("a split human request opens only one handoff", async () => {
  const repository = new TurnRepository(["Quero falar", "com uma pessoa"]); const provider = new TurnProvider();
  const result = await processConversationTurn({ conversationId: "conversation", observedRevision: 2,
    repository, provider, generateReply: reply() });
  assert.equal(result, "handoff_requested"); assert.equal(repository.handoffRequested, true);
  assert.equal(provider.sent.length, 1);
});

test("a short acceptance after an assistant offer opens handoff without invoking AI", async () => {
  const repository = new TurnRepository(["Sim"]);
  repository.messages.unshift({ id: "offer", conversationId: "conversation",
    direction: "outbound", role: "assistant",
    content: "Posso encaminhar seu pedido para nossa equipe verificar e continuar por aqui?",
    createdAt: new Date(-1_000) });
  const provider = new TurnProvider();
  let generated = false;
  const result = await processConversationTurn({ conversationId: "conversation", observedRevision: 1,
    repository, provider, agentOwnsConversation: true,
    generateReply: async () => { generated = true; return reply()(); } });
  assert.equal(result, "handoff_requested");
  assert.equal(repository.handoffRequested, true);
  assert.equal(generated, false);
  assert.match(provider.sent[0] ?? "", /atendimento humano/i);
  assert.match(provider.sent[0] ?? "", /segunda a sexta, das 14h às 20h/i);
});

test("an explicit scheduling authorization uses service, day and exact hour from prior turns", async () => {
  const repository = new TurnRepository([
    "Quero ver a massagem relaxante",
    "amanhã às 14?",
    "ok pode agendar",
  ]);
  repository.processedRevision = 2;
  const provider = new TurnProvider();
  let generated = false;

  const result = await processConversationTurn({
    conversationId: "conversation",
    observedRevision: 3,
    repository,
    provider,
    generateReply: async () => { generated = true; return reply()(); },
  });

  assert.equal(result, "handoff_requested");
  assert.equal(repository.handoffRequested, true);
  assert.equal(generated, false);
  assert.match(provider.sent[0] ?? "", /atendimento humano/i);
});

test("a short acceptance cannot revive an old or non-adjacent handoff offer", async () => {
  const repository = new TurnRepository(["Sim"]);
  repository.messages.unshift(
    { id: "old-offer", conversationId: "conversation", direction: "outbound", role: "assistant",
      content: "Posso encaminhar para nossa equipe?", createdAt: new Date(-31 * 60_000) },
    { id: "intervening-user", conversationId: "conversation", direction: "inbound", role: "user",
      content: "Qual é o endereço?", createdAt: new Date(-30_000) },
  );
  const provider = new TurnProvider();
  let generated = false;
  const result = await processConversationTurn({ conversationId: "conversation", observedRevision: 1,
    repository, provider, generateReply: async () => { generated = true; return reply("Certo.")(); } });
  assert.equal(result, "replied");
  assert.equal(repository.handoffRequested, false);
  assert.equal(generated, true);
});

test("failed handoff acknowledgement keeps the conversation active and retries idempotently", async () => {
  const repository = new TurnRepository(["Quero falar com uma pessoa"]);
  const provider = new TurnProvider();
  provider.failNextSend = true;

  await assert.rejects(processConversationTurn({ conversationId: "conversation", observedRevision: 1,
    repository, provider, generateReply: reply() }), /temporary provider failure/);
  assert.equal(repository.status, "active");
  assert.equal(repository.handoffRequested, false);
  assert.equal(repository.releasedState, "failed");

  const result = await processConversationTurn({ conversationId: "conversation", observedRevision: 1,
    repository, provider, generateReply: reply() });
  assert.equal(result, "handoff_requested");
  assert.equal(repository.handoffRequested, true);
  assert.equal(provider.sent.length, 1);
});

test("handoff notification failure cannot block acknowledgement or human ownership", async () => {
  const repository = new TurnRepository(["Quero falar com uma pessoa"]);
  const provider = new TurnProvider();
  let notificationAttempts = 0;
  const notifyHandoff = async () => { notificationAttempts += 1; throw new Error("notification unavailable"); };

  const result = await processConversationTurn({ conversationId: "conversation", observedRevision: 1,
    repository, provider, generateReply: reply(), notifyHandoff });
  assert.equal(result, "handoff_requested");
  assert.equal(repository.status, "human_requested");
  assert.equal(notificationAttempts, 1);
  assert.equal(provider.sent.length, 1);
});

test("a short personal follow-up reuses only a recent explicit account request", async () => {
  const repository = new TurnRepository(["E quando vence?"]);
  repository.messages.unshift({ id: "previous-account", conversationId: "conversation",
    direction: "inbound", role: "user", content: "Quero saber do meu plano",
    createdAt: new Date(-60_000) });
  const provider = new TurnProvider();
  let enriched = 0;
  await processConversationTurn({ conversationId: "conversation", observedRevision: 1,
    repository, provider, enrichCustomer: async ({ identity }) => { enriched += 1; return identity; },
    generateReply: reply() });
  assert.equal(enriched, 1);

  const oldRepository = new TurnRepository(["E quando vence?"]);
  oldRepository.messages.unshift({ id: "old-account", conversationId: "conversation",
    direction: "inbound", role: "user", content: "Quero saber do meu plano",
    createdAt: new Date(-31 * 60_000) });
  await processConversationTurn({ conversationId: "conversation", observedRevision: 1,
    repository: oldRepository, provider: new TurnProvider(),
    enrichCustomer: async ({ identity }) => { enriched += 1; return identity; }, generateReply: reply() });
  assert.equal(enriched, 1);
});

test("exhausted AI generation sends a visible fallback and opens handoff instead of going silent", async () => {
  const repository = new TurnRepository(["Quero saber quais massagens vocês têm"]);
  const provider = new TurnProvider();

  const result = await processConversationTurn({ conversationId: "conversation", observedRevision: 1,
    repository, provider, generateReply: async () => {
      const error = new Error("provider payload with private customer content");
      error.name = "WhatsAppReplyGenerationError";
      throw error;
    } });

  assert.equal(result, "handoff_requested");
  assert.equal(repository.handoffRequested, true);
  assert.equal(provider.sent.length, 1);
  assert.match(provider.sent[0] ?? "", /sem você precisar repetir/i);
  assert.equal(repository.releasedState, undefined);
});

test("an unvalidated model handoff recommendation cannot interrupt an ordinary conversation", async () => {
  const repository = new TurnRepository(["Quero massagem relaxante para dor no ombro"]);
  const provider = new TurnProvider();

  const result = await processConversationTurn({ conversationId: "conversation", observedRevision: 1,
    repository, provider, generateReply: async () => ({
      messages: ["A relaxante custa R$ 270; o profissional avalia e ajusta a técnica no início."],
      answeredTopics: ["massagem"],
      needsClarification: false,
      handoffRecommended: true,
    }) });

  assert.equal(result, "replied");
  assert.equal(repository.handoffRequested, false);
  assert.equal(provider.sent.length, 1);
});

test("journey-assisted replies are blocked when the model invents a booking confirmation", async () => {
  const repository = new JourneyTurnRepository(["Quanto custa a massagem Relaxante?"]);
  const provider = new TurnProvider();

  const result = await processConversationTurn({
    conversationId: "conversation",
    observedRevision: 1,
    repository,
    provider,
    journeyMode: "active",
    generateReply: async () => ({
      messages: ["Já deixei marcado amanhã às 14h."],
      answeredTopics: ["preço"],
      needsClarification: false,
      handoffRecommended: false,
    }),
  });

  assert.equal(result, "handoff_requested");
  assert.equal(repository.handoffSource, "safety_rule");
  assert.equal(provider.sent.length, 1);
  assert.match(provider.sent[0] ?? "", /responder com precisão/i);
  assert.doesNotMatch(provider.sent[0] ?? "", /marcado|agendado/i);
});

test("a structured schedule request opens handoff only after explicit authorization and complete details", async () => {
  const repository = new TurnRepository(["Quero massagem Relaxante amanhã às 14h. Pode encaminhar."]);
  const provider = new TurnProvider();

  const result = await processConversationTurn({ conversationId: "conversation", observedRevision: 1,
    repository, provider, generateReply: async () => ({
      messages: ["Boa! Estou passando sua conversa para nosso atendimento humano, que dará continuidade por aqui dentro do nosso horário de atendimento: de segunda a sexta, das 14h às 20h."],
      answeredTopics: ["agendamento"],
      needsClarification: false,
      handoffRecommended: true,
      handoffValidated: true,
      operationalAction: { type: "request_schedule_confirmation", service: "Relaxante",
        day: "amanhã", time: "14h", customerAuthorized: true },
    }) });

  assert.equal(result, "handoff_requested");
  assert.equal(repository.handoffRequested, true);
  assert.equal(repository.handoffSource, "customer");
  assert.equal(provider.sent.length, 1);
});

test("active journey presents Relaxante facts and the post-Pilates bath without invoking the model", async () => {
  const repository = new JourneyTurnRepository(["quero sim"]);
  repository.journeyState = {
    ...initialJourneyState(),
    stage: "recommendation",
    goals: ["relaxation"],
    latestGoals: ["relaxation"],
    serviceFamily: "massage",
    recommendedServices: ["Relaxante"],
  };
  repository.profile = { activeContracts: [{ name: "Pilates 2x" }] };
  const provider = new TurnProvider();
  let generated = false;

  const result = await processConversationTurn({
    conversationId: "conversation",
    observedRevision: 1,
    repository,
    provider,
    journeyMode: "active",
    generateReply: async () => { generated = true; return reply()(); },
  });

  assert.equal(result, "replied");
  assert.equal(generated, false);
  assert.equal(provider.sent.length, 1);
  assert.match(provider.sent[0] ?? "", /R\$ 270/i);
  assert.match(provider.sent[0] ?? "", /uma hora completa/i);
  assert.match(provider.sent[0] ?? "", /banheira quente depois de uma das suas aulas/i);
  assert.match(provider.sent[0] ?? "", /roupa de banho/i);
  assert.deepEqual(repository.journeyState?.factsSent.sort(), [
    "hot_bath_amenities",
    "service_duration",
    "service_price",
  ]);
  assert.equal(repository.journeyState?.offers.hot_bath, "offered");
});

test("active semantic planner owns a Pilates burst and preserves the exact 14h request", async () => {
  const repository = new JourneyTurnRepository([
    "Oi bom dia tudo bem?",
    "Vcs tem aula experimental de pilates?",
    "pode ser hj às 14?",
  ]);
  const provider = new TurnProvider();
  let receivedPlan: import("../ai/semantic-turn-plan.ts").SemanticTurnPlan | undefined;

  const semanticPlan: import("../ai/semantic-turn-plan.ts").SemanticTurnPlan = {
    primaryIntent: "scheduling",
    conversationAct: "new_request",
    requestedService: { family: "pilates", name: "aula experimental", explicit: true },
    scheduling: { requested: true, dayText: "hoje", period: "afternoon", time: "14:00" },
    factsAlreadyProvided: ["service", "day", "time"],
    factsNeeded: [],
    unresolvedQuestions: [],
    nextAction: "check_availability",
    acknowledgeGreeting: true,
    confidence: "high",
  };

  const result = await processConversationTurn({
    conversationId: "conversation",
    observedRevision: 3,
    repository,
    provider,
    journeyMode: "active",
    semanticPlannerMode: "active",
    planSemanticTurn: async () => semanticPlan,
    generateReply: async (input) => {
      receivedPlan = input.semanticPlan;
      return {
        messages: ["Oi, bom dia! Temos aula experimental de Pilates gratuita. Vou encaminhar seu pedido de hoje às 14h para a equipe confirmar a disponibilidade."],
        answeredTopics: ["pilates", "scheduling"],
        needsClarification: false,
        handoffRecommended: false,
      };
    },
  });

  assert.equal(result, "replied");
  assert.deepEqual(receivedPlan, semanticPlan);
  assert.equal(provider.sent.length, 1);
  assert.doesNotMatch(provider.sent[0] ?? "", /qual per[ií]odo|recovery|banheira/i);
  assert.match(provider.sent[0] ?? "", /confirmar a disponibilidade/i);
});

test("the original sandbox Relaxante request advances commercially without robotic repetition", async () => {
  const repository = new JourneyTurnRepository([
    "Eu estou me sentindo tenso, com dificuldade de relaxar. Quero ver a massagem relaxante",
  ]);
  const provider = new TurnProvider();
  let generated = false;

  const result = await processConversationTurn({
    conversationId: "conversation",
    observedRevision: 1,
    repository,
    provider,
    journeyMode: "active",
    generateReply: async () => { generated = true; return reply()(); },
  });

  assert.equal(result, "replied");
  assert.equal(generated, false);
  const text = provider.sent.join("\n");
  assert.match(text, /R\$ 270/);
  assert.match(text, /uma hora completa/i);
  assert.match(text, /banheira quente/i);
  assert.match(text, /quer incluir/i);
  assert.equal((text.match(/\?/g) ?? []).length, 1);
  assert.doesNotMatch(text, /categoria tradicional|percepção de relaxamento|categoria do serviço e o período/i);
});

test("a general localized complaint recommends integrated paths in two bubbles without invoking the model", async () => {
  const repository = new JourneyTurnRepository([
    "Estou com muita tensão na lombar, como podem me ajudar?",
  ]);
  const provider = new TurnProvider();
  let generated = false;

  const result = await processConversationTurn({
    conversationId: "conversation",
    observedRevision: 1,
    repository,
    provider,
    journeyMode: "active",
    generateReply: async () => { generated = true; return reply()(); },
  });

  assert.equal(result, "replied");
  assert.equal(generated, false);
  assert.equal(provider.sent.length, 2);
  assert.match(provider.sent[0] ?? "", /massagens que podem ajudar bastante/i);
  assert.match(provider.sent[0] ?? "", /banheira quente, fria ou contraste/i);
  assert.match(provider.sent[0] ?? "", /Rua Vera Linhares de Andrade, 2063/i);
  assert.match(provider.sent[1] ?? "", /Qual caminho parece melhor/i);
  assert.doesNotMatch(provider.sent.join("\n"), /se (?:você )?quiser/i);
  assert.equal(repository.journeyState?.dialogue.thermotherapyMentioned, true);
  assert.equal(repository.journeyState?.offers.hot_bath, undefined);
});

test("semantic understanding routes free-form pain and a greeting into the integrated journey", async () => {
  const repository = new JourneyTurnRepository([
    "Oi boa tarde, tudo bem?",
    "Estou com dor na lombar",
  ]);
  const provider = new TurnProvider();
  let generated = false;
  let interpreted = 0;
  let enriched = 0;

  const result = await processConversationTurn({
    conversationId: "conversation",
    observedRevision: 2,
    repository,
    provider,
    journeyMode: "active",
    interpretTurn: async () => {
      interpreted += 1;
      return {
        intent: "symptom_or_goal",
        goals: ["localized_tension"],
        confidence: "high",
      };
    },
    enrichCustomer: async ({ identity }) => {
      enriched += 1;
      return identity;
    },
    generateReply: async () => { generated = true; return reply()(); },
  });

  assert.equal(result, "replied");
  assert.equal(interpreted, 1);
  assert.equal(enriched, 1);
  assert.equal(generated, false);
  assert.equal(provider.sent.length, 2);
  assert.match(provider.sent[0] ?? "", /^Oi, boa tarde! Tudo ótimo por aqui 😊 Perfeito\./);
  assert.match(provider.sent[0] ?? "", /massagens que podem ajudar bastante/i);
  assert.match(provider.sent[0] ?? "", /Rua Vera Linhares de Andrade, 2063/i);
  assert.match(provider.sent[1] ?? "", /Qual caminho parece melhor/i);
});

test("a cervical conversation progresses from complaint to concrete choice without repeating the pitch", async () => {
  const repository = new JourneyTurnRepository([
    "Oi bom dia",
    "tudo bem?",
    "Tô ruim da cervical.",
  ]);
  const provider = new TurnProvider();
  let generated = 0;
  const run = () => processConversationTurn({
    conversationId: "conversation",
    observedRevision: repository.revision,
    repository,
    provider,
    journeyMode: "active" as const,
    interpretTurn: async ({ message }) => ({
      intent: /o que|quais servi/i.test(message) ? "service_discovery" : "symptom_or_goal",
      goals: ["localized_tension"],
      confidence: "high",
    }),
    enrichCustomer: async ({ identity }) => identity,
    generateReply: async () => {
      generated += 1;
      return reply("A Miofascial é uma técnica manual mais direcionada à região de tensão, com pressão ajustada ao seu conforto.")();
    },
  });

  assert.equal(await run(), "replied");
  assert.match(provider.sent[0] ?? "", /^Oi, bom dia! Tudo ótimo por aqui 😊 Perfeito\./);
  assert.match(provider.sent[0] ?? "", /Miofascial/);
  assert.match(provider.sent[0] ?? "", /Relaxante/);
  assert.match(provider.sent[1] ?? "", /massagem, termoterapia ou combinar as duas/i);

  repository.addInbound("É um mal-estar mesmo, talvez só um mal jeito. O que vocês poderiam fazer para me ajudar?");
  assert.equal(await run(), "replied");
  assert.match(provider.sent.at(-1) ?? "", /Miofascial/);
  assert.match(provider.sent.at(-1) ?? "", /Relaxante/);

  repository.addInbound("quero sim");
  assert.equal(await run(), "replied");
  assert.match(provider.sent.at(-1) ?? "", /Você prefere a Miofascial/);
  assert.equal((provider.sent.at(-1)?.match(/\?/g) ?? []).length, 1);

  repository.addInbound("a mais direcionada");
  assert.equal(await run(), "replied");
  assert.match(provider.sent.at(-1) ?? "", /Podemos seguir com a Miofascial/);

  repository.addInbound("Como seria a liberação?");
  assert.equal(await run(), "replied");
  assert.equal(generated, 1);
  assert.match(provider.sent.at(-1) ?? "", /técnica manual mais direcionada/i);
  assert.doesNotMatch(provider.sent.join("\n"), /avaliação comercial|site oficial|Instagram/i);
});

test("a greeting already answered in the episode is not repeated before the complaint", async () => {
  const repository = new JourneyTurnRepository(["Oi"]);
  const provider = new TurnProvider();
  const run = () => processConversationTurn({
    conversationId: "conversation",
    observedRevision: repository.revision,
    repository,
    provider,
    journeyMode: "active" as const,
    generateReply: reply(),
  });

  assert.equal(await run(), "replied");
  repository.addInbound("boa noite");
  repository.addInbound("tudo bem?");
  repository.addInbound("Tô com o músculo do peitoral bem tenso. Como podem me ajudar?");
  assert.equal(await run(), "replied");

  assert.equal((provider.sent.join("\n").match(/Tudo ótimo por aqui/gi) ?? []).length, 1);
  assert.match(provider.sent.at(-2) ?? "", /^Perfeito\. Para tensão localizada/i);
  assert.match(provider.sent.at(-1) ?? "", /massagem, termoterapia ou combinar as duas/i);
});

test("the current peitoral flow preserves the new episode and hands off massage plus accepted bath", async () => {
  const repository = new JourneyTurnRepository(["Quero Relaxante amanhã às 14:30"]);
  repository.processedRevision = 1;
  repository.journeyState = readyRelaxanteScheduleState(1);
  repository.messages[0]!.createdAt = new Date(0);
  repository.messages.push({
    id: "old-answer",
    conversationId: "conversation",
    direction: "outbound",
    role: "assistant",
    content: "Vou encaminhar o pedido antigo.",
    responseRevision: 1,
    createdAt: new Date(1_000),
  });
  repository.addInbound("Oi boa noite");
  repository.messages.at(-1)!.createdAt = new Date(31 * 60_000);
  repository.addInbound("Tô com o músculo do peitoral bem tenso. Como podem me ajudar?");
  repository.messages.at(-1)!.createdAt = new Date(31 * 60_000 + 1_000);
  repository.profile = { activeContracts: [{ name: "Pilates 2x" }] };
  const provider = new TurnProvider();
  let generated = 0;
  const run = () => processConversationTurn({
    conversationId: "conversation",
    observedRevision: repository.revision,
    repository,
    provider,
    journeyMode: "active" as const,
    generateReply: async () => { generated += 1; return reply()(); },
  });

  assert.equal(await run(), "replied");
  assert.equal(repository.journeyState?.scheduling.dayText, undefined);
  assert.equal(repository.journeyState?.scheduling.time, undefined);
  assert.match(provider.sent[0] ?? "", /tensão localizada/i);

  repository.addInbound("Massagem relaxante me parece bom");
  assert.equal(await run(), "replied");
  assert.equal(repository.journeyState?.selectedService, "Relaxante");
  assert.match(provider.sent.at(-1) ?? "", /Você quer incluir essa experiência/i);

  repository.addInbound("opa quero sim");
  assert.equal(await run(), "replied");
  assert.equal(repository.journeyState?.offers.hot_bath, "accepted");
  assert.match(provider.sent.at(-1) ?? "", /Qual dia funciona melhor/i);
  assert.equal(repository.handoffRequested, false);

  repository.addInbound("amanhã");
  assert.equal(await run(), "replied");
  assert.match(provider.sent.at(-1) ?? "", /Qual horário funciona melhor/i);

  repository.addInbound("14:30");
  assert.equal(await run(), "handoff_requested");
  assert.equal(repository.handoffRequested, true);
  assert.equal(repository.completeJourneyHandoffAttempts, 1);
  assert.match(provider.sent.at(-1) ?? "", /Relaxante \+ banheira quente, amanhã, às 14:30/i);
  assert.match(provider.sent.at(-1) ?? "", /só fica reservado depois/i);
  assert.equal(generated, 0);
});

test("old journey meaning cannot block semantic understanding of the current complaint", async () => {
  const repository = new JourneyTurnRepository([
    "Quero conhecer massagens",
    "Oi boa tarde",
    "Tô com a lombar zoada",
  ]);
  repository.processedRevision = 2;
  repository.messages[0]!.createdAt = new Date(0);
  repository.messages[1]!.createdAt = new Date(31 * 60_000);
  repository.messages[2]!.createdAt = new Date(32 * 60_000);
  repository.messages.splice(1, 0, {
    id: "old-assistant",
    conversationId: "conversation",
    direction: "outbound",
    role: "assistant",
    content: "Temos massagens tradicionais e especiais.",
    responseRevision: 1,
    createdAt: new Date(10_000),
  });
  repository.journeyState = {
    ...initialJourneyState(1),
    goals: ["relaxation"],
    serviceFamily: "massage",
    lastAction: "assisted",
  };
  const provider = new TurnProvider();
  let interpreted = 0;
  let generated = false;

  const result = await processConversationTurn({
    conversationId: "conversation",
    observedRevision: 3,
    repository,
    provider,
    journeyMode: "active",
    interpretTurn: async () => {
      interpreted += 1;
      return { intent: "symptom_or_goal", goals: ["localized_tension"], confidence: "high" };
    },
    enrichCustomer: async ({ identity }) => identity,
    generateReply: async () => { generated = true; return reply()(); },
  });

  assert.equal(result, "replied");
  assert.equal(interpreted, 1);
  assert.equal(generated, false);
  assert.equal(provider.sent.length, 2);
  assert.match(provider.sent[0] ?? "", /massagens que podem ajudar bastante/i);
  assert.match(provider.sent[0] ?? "", /banheira quente, fria ou contraste/i);
  assert.match(provider.sent[1] ?? "", /Qual caminho parece melhor/i);
  assert.doesNotMatch(provider.sent.join("\n"), /comercial|site oficial|instagram/i);
});

test("an explicit reset gets a natural deterministic reply instead of an institutional manifesto", async () => {
  const repository = new JourneyTurnRepository(["Vamos começar do zero"]);
  repository.identity = { ...repository.identity, firstName: "Leonardo" };
  repository.journeyState = {
    ...initialJourneyState(),
    goals: ["relaxation"],
    serviceFamily: "massage",
    selectedService: "Relaxante",
  };
  const provider = new TurnProvider();
  let generated = false;
  let interpreted = false;

  const result = await processConversationTurn({
    conversationId: "conversation",
    observedRevision: 1,
    repository,
    provider,
    journeyMode: "active",
    interpretTurn: async () => {
      interpreted = true;
      return { intent: "other", goals: [], confidence: "low" };
    },
    generateReply: async () => { generated = true; return reply()(); },
  });

  assert.equal(result, "replied");
  assert.equal(generated, false);
  assert.equal(interpreted, false);
  assert.deepEqual(provider.sent, [
    "Fechado, Leonardo. Vamos do zero: o que está te incomodando ou o que você busca hoje?",
  ]);
  assert.deepEqual(repository.journeyState?.goals, []);
  assert.equal(repository.journeyState?.selectedService, undefined);
});

test("a reset followed by a free-form complaint is understood in the same turn", async () => {
  const repository = new JourneyTurnRepository([
    "Vamos começar do zero",
    "Meu ombro está uma desgraça hoje",
  ]);
  repository.journeyState = {
    ...initialJourneyState(),
    goals: ["relaxation"],
    serviceFamily: "massage",
    selectedService: "Relaxante",
  };
  const provider = new TurnProvider();
  let semanticMessage = "";

  const result = await processConversationTurn({
    conversationId: "conversation",
    observedRevision: 2,
    repository,
    provider,
    journeyMode: "active",
    interpretTurn: async ({ message }) => {
      semanticMessage = message;
      return { intent: "symptom_or_goal", goals: ["localized_tension"], confidence: "high" };
    },
    enrichCustomer: async ({ identity }) => identity,
    generateReply: async () => reply()(),
  });

  assert.equal(result, "replied");
  assert.doesNotMatch(semanticMessage, /começar do zero/i);
  assert.match(semanticMessage, /ombro está uma desgraça/i);
  assert.equal(provider.sent.length, 2);
  assert.match(provider.sent[0] ?? "", /massagens que podem ajudar bastante/i);
});

test("internal operational language from the model is blocked before delivery", async () => {
  const repository = new JourneyTurnRepository(["Quero entender melhor como vocês atendem"]);
  const provider = new TurnProvider();
  const result = await processConversationTurn({
    conversationId: "conversation",
    observedRevision: 1,
    repository,
    provider,
    journeyMode: "active",
    generateReply: reply("Isso não impede uma avaliação comercial."),
  });

  assert.equal(result, "handoff_requested");
  assert.equal(repository.handoffRequested, true);
  assert.doesNotMatch(provider.sent.join("\n"), /avaliação comercial/i);
  assert.match(provider.sent.join("\n"), /responder com precisão/i);
});

test("semantic interpretation fails open to the grounded reply generator", async () => {
  const repository = new JourneyTurnRepository(["Sinto algo estranho no corpo"]);
  const provider = new TurnProvider();
  let generated = 0;
  const result = await processConversationTurn({
    conversationId: "conversation",
    observedRevision: 1,
    repository,
    provider,
    journeyMode: "active",
    interpretTurn: async () => { throw new Error("semantic timeout"); },
    generateReply: async () => { generated += 1; return reply("Como podemos entender melhor?")(); },
  });
  assert.equal(result, "replied");
  assert.equal(generated, 1);
  assert.deepEqual(provider.sent, ["Como podemos entender melhor?"]);
});

test("a Nextfit customer receives the integrated recommendation without a redundant address", async () => {
  const repository = new JourneyTurnRepository([
    "Estou com muita tensão na lombar, como podem me ajudar?",
  ]);
  const provider = new TurnProvider();
  let enrichmentCalls = 0;

  const result = await processConversationTurn({
    conversationId: "conversation",
    observedRevision: 1,
    repository,
    provider,
    journeyMode: "active",
    enrichCustomer: async ({ identity }) => {
      enrichmentCalls += 1;
      return { ...identity, relationshipStatus: "customer" };
    },
    generateReply: async () => reply()(),
  });

  assert.equal(result, "replied");
  assert.equal(enrichmentCalls, 1);
  assert.match(provider.sent[0] ?? "", /massagens que podem ajudar bastante/i);
  assert.doesNotMatch(provider.sent.join("\n"), /Rua Vera Linhares de Andrade/i);
});

test("the complete Leonardo journey keeps state across short turns and hands off only once", async () => {
  const repository = new JourneyTurnRepository([
    "Tô com torcicolo, qual seria a melhor massagem pra mim?",
  ]);
  repository.profile = { activeContracts: [{ name: "Pilates 2x" }] };
  const provider = new TurnProvider();
  let generated = 0;
  const run = () => processConversationTurn({
    conversationId: "conversation",
    observedRevision: repository.revision,
    repository,
    provider,
    journeyMode: "active" as const,
    generateReply: async () => { generated += 1; return reply()(); },
  });

  assert.equal(await run(), "replied");
  assert.deepEqual(repository.journeyState?.recommendedServices, ["Miofascial", "Relaxante"]);

  repository.addInbound("Legal. Eu também tô com dificuldade de relaxar");
  assert.equal(await run(), "replied");
  assert.deepEqual(repository.journeyState?.recommendedServices, ["Relaxante"]);

  repository.addInbound("Quero sim");
  assert.equal(await run(), "replied");
  assert.equal(repository.journeyState?.selectedService, "Relaxante");

  repository.addInbound("Que tal às 15:30?");
  assert.equal(await run(), "replied");
  assert.equal(repository.journeyState?.scheduling.time, "15:30");

  repository.addInbound("Amanhã");
  assert.equal(await run(), "handoff_requested");

  const transcript = provider.sent.join("\n");
  assert.equal(generated, 0);
  assert.equal((transcript.match(/R\$ 270/g) ?? []).length, 1);
  assert.equal((transcript.match(/banheira quente/gi) ?? []).length, 1);
  assert.match(provider.sent.at(-1) ?? "", /Relaxante, amanhã, às 15:30/i);
  assert.match(provider.sent.at(-1) ?? "", /só fica reservado depois/i);
  assert.equal(repository.completeJourneyHandoffAttempts, 1);
});

test("shadow journey evaluates the candidate but preserves the legacy model reply and its actual facts", async () => {
  const repository = new JourneyTurnRepository(["quero sim"]);
  repository.journeyState = {
    ...initialJourneyState(),
    stage: "recommendation",
    goals: ["relaxation"],
    latestGoals: ["relaxation"],
    serviceFamily: "massage",
    recommendedServices: ["Relaxante"],
  };
  const provider = new TurnProvider();
  let generated = 0;

  const result = await processConversationTurn({
    conversationId: "conversation",
    observedRevision: 1,
    repository,
    provider,
    journeyMode: "shadow",
    generateReply: async () => {
      generated += 1;
      return reply("Resposta legada preservada.")();
    },
  });

  assert.equal(result, "replied");
  assert.equal(generated, 1);
  assert.deepEqual(provider.sent, ["Resposta legada preservada."]);
  assert.deepEqual(repository.journeyState?.factsSent, []);
  assert.equal(repository.journeyState?.offers.hot_bath, undefined);
});

test("active journey offers the bath before summarizing a split schedule and never claims a booking", async () => {
  const repository = new JourneyTurnRepository([
    "Quero ver a massagem relaxante",
    "amanhã às 15:30?",
    "ok pode agendar",
  ]);
  repository.processedRevision = 2;
  const provider = new TurnProvider();
  let generated = false;

  const firstResult = await processConversationTurn({
    conversationId: "conversation",
    observedRevision: 3,
    repository,
    provider,
    journeyMode: "active",
    generateReply: async () => { generated = true; return reply()(); },
  });

  assert.equal(firstResult, "replied");
  assert.equal(generated, false);
  assert.equal(repository.handoffRequested, false);
  assert.match(provider.sent[0] ?? "", /banheira quente/i);
  assert.match(provider.sent[0] ?? "", /quer incluir/i);

  repository.addInbound("Não, só a massagem");
  const result = await processConversationTurn({
    conversationId: "conversation",
    observedRevision: 4,
    repository,
    provider,
    journeyMode: "active",
    generateReply: async () => { generated = true; return reply()(); },
  });

  assert.equal(result, "handoff_requested");
  assert.equal(repository.handoffRequested, true);
  assert.equal(repository.handoffSource, "customer");
  assert.equal(repository.completeJourneyHandoffAttempts, 1);
  assert.deepEqual(repository.completedStates, ["replied", "handoff"]);
  assert.equal(provider.sent.length, 2);
  assert.match(provider.sent[1] ?? "", /Relaxante, amanhã, às 15:30/i);
  assert.match(provider.sent[1] ?? "", /confirmar a disponibilidade/i);
  assert.match(provider.sent[1] ?? "", /só fica reservado depois/i);
  assert.doesNotMatch(provider.sent[1] ?? "", /(?:agendei|está agendado|horário garantido)/i);
  assert.equal(repository.journeyState?.stage, "human_handoff");
  assert.equal(repository.journeyState?.scheduling.status, "handed_off");
});

test("explicit scheduling authorization uses the selected service persisted by a short acceptance", async () => {
  const repository = new JourneyTurnRepository([
    "Quero seguir com a recomendação",
    "amanhã às 15:30",
    "pode agendar",
  ]);
  repository.processedRevision = 2;
  repository.journeyState = {
    ...initialJourneyState(2),
    stage: "ready_for_handoff",
    goals: ["relaxation"],
    serviceFamily: "massage",
    recommendedServices: ["Relaxante"],
    selectedService: "Relaxante",
    factsSent: ["service_price", "service_duration", "hot_bath_amenities"],
    offers: { hot_bath: "declined" },
    scheduling: { status: "complete", dayText: "amanhã", time: "15:30" },
  };
  const provider = new TurnProvider();
  let generated = false;

  const result = await processConversationTurn({
    conversationId: "conversation",
    observedRevision: 3,
    repository,
    provider,
    journeyMode: "active",
    generateReply: async () => { generated = true; return reply()(); },
  });

  assert.equal(result, "handoff_requested");
  assert.equal(generated, false);
  assert.match(provider.sent[0] ?? "", /Relaxante, amanhã, às 15:30/i);
  assert.doesNotMatch(provider.sent[0] ?? "", /Bia continuar/i);
});

test("shadow mode evaluates explicit scheduling authorization before preserving the legacy handoff", async () => {
  const repository = new JourneyTurnRepository([
    "Quero a massagem Relaxante",
    "amanhã às 15:30",
    "pode agendar",
  ]);
  repository.processedRevision = 2;
  repository.journeyState = {
    ...initialJourneyState(2),
    stage: "ready_for_handoff",
    goals: ["relaxation"],
    serviceFamily: "massage",
    recommendedServices: ["Relaxante"],
    selectedService: "Relaxante",
    factsSent: ["service_price", "service_duration", "hot_bath_amenities"],
    offers: { hot_bath: "declined" },
    scheduling: { status: "complete", dayText: "amanhã", time: "15:30" },
  };
  const provider = new TurnProvider();
  const observations: Array<{ candidateAction: string; replySource: string }> = [];

  const result = await processConversationTurn({
    conversationId: "conversation",
    observedRevision: 3,
    repository,
    provider,
    journeyMode: "shadow",
    generateReply: reply(),
    observeJourney: (observation) => {
      observations.push({
        candidateAction: observation.candidateAction,
        replySource: observation.replySource,
      });
    },
  });

  assert.equal(result, "handoff_requested");
  assert.match(provider.sent[0] ?? "", /atendimento humano/i);
  assert.deepEqual(observations, [{
    candidateAction: "schedule_handoff",
    replySource: "legacy_handoff",
  }]);
});

test("provider failure cannot persist planned journey facts or open handoff", async () => {
  const repository = new JourneyTurnRepository(["Quero a massagem Relaxante"]);
  const provider = new TurnProvider();
  provider.failNextSend = true;

  await assert.rejects(processConversationTurn({
    conversationId: "conversation",
    observedRevision: 1,
    repository,
    provider,
    journeyMode: "active",
    generateReply: reply(),
  }), /temporary provider failure/);

  assert.equal(repository.savedJourneyStates.length, 0);
  assert.equal(repository.handoffRequested, false);
  assert.equal(repository.status, "active");
});

test("a transient handoff failure retries ownership without sending the schedule summary twice", async () => {
  const repository = new JourneyTurnRepository([
    "Quero a massagem relaxante",
    "amanhã às 15:30",
    "pode agendar",
  ]);
  repository.processedRevision = 2;
  repository.journeyState = readyRelaxanteScheduleState();
  repository.failNextJourneyHandoff = true;
  const provider = new TurnProvider();

  await assert.rejects(processConversationTurn({
    conversationId: "conversation",
    observedRevision: 3,
    repository,
    provider,
    journeyMode: "active",
    generateReply: reply(),
  }), /temporary journey handoff failure/);
  assert.equal(provider.sent.length, 1);
  assert.equal(repository.handoffRequested, false);
  assert.equal(repository.savedJourneyStates.length, 0);

  const result = await processConversationTurn({
    conversationId: "conversation",
    observedRevision: 3,
    repository,
    provider,
    journeyMode: "active",
    generateReply: reply(),
  });
  assert.equal(result, "handoff_requested");
  assert.equal(provider.sent.length, 1);
  assert.equal(repository.handoffRequested, true);
  assert.equal(repository.completeJourneyHandoffAttempts, 2);
});

test("a newer inbound after the schedule summary cannot cancel the promised human handoff", async () => {
  const repository = new JourneyTurnRepository([
    "Quero a massagem relaxante",
    "amanhã às 15:30",
    "pode agendar",
  ]);
  repository.processedRevision = 2;
  repository.journeyState = readyRelaxanteScheduleState();
  const provider = new TurnProvider();
  provider.onSend = () => {
    provider.onSend = undefined;
    repository.addInbound("Só confirmando");
    repository.token = undefined;
  };

  const result = await processConversationTurn({
    conversationId: "conversation",
    observedRevision: 3,
    repository,
    provider,
    journeyMode: "active",
    generateReply: reply(),
  });

  assert.equal(result, "handoff_requested");
  assert.equal(provider.sent.length, 1);
  assert.equal(repository.status, "human_requested");
  assert.equal(repository.processedRevision, 4);
  assert.equal(repository.completeJourneyHandoffAttempts, 1);
});

test("a retry on a newer revision reuses a delivered schedule summary instead of sending it again", async () => {
  const repository = new JourneyTurnRepository([
    "Quero a massagem relaxante",
    "amanhã às 15:30",
    "pode agendar",
  ]);
  repository.processedRevision = 2;
  repository.journeyState = readyRelaxanteScheduleState();
  repository.failNextJourneyHandoff = true;
  const provider = new TurnProvider();

  await assert.rejects(processConversationTurn({
    conversationId: "conversation",
    observedRevision: 3,
    repository,
    provider,
    journeyMode: "active",
    generateReply: reply(),
  }), /temporary journey handoff failure/);
  repository.addInbound("Só confirmando");

  const result = await processConversationTurn({
    conversationId: "conversation",
    observedRevision: 4,
    repository,
    provider,
    journeyMode: "active",
    generateReply: reply(),
  });

  assert.equal(result, "handoff_requested");
  assert.equal(provider.sent.length, 1);
  assert.equal(repository.status, "human_requested");
  assert.equal(repository.completeJourneyHandoffAttempts, 2);
});

test("off journey mode keeps the existing generator behavior even on a journey-capable repository", async () => {
  const repository = new JourneyTurnRepository(["Quero a massagem Relaxante"]);
  const provider = new TurnProvider();
  let generated = 0;

  const result = await processConversationTurn({
    conversationId: "conversation",
    observedRevision: 1,
    repository,
    provider,
    journeyMode: "off",
    generateReply: async () => { generated += 1; return reply("Fluxo existente.")(); },
  });

  assert.equal(result, "replied");
  assert.equal(generated, 1);
  assert.deepEqual(provider.sent, ["Fluxo existente."]);
  assert.equal(repository.savedJourneyStates.length, 0);
});

test("a new episode discards an old selected service and schedule before deciding the next action", async () => {
  const repository = new JourneyTurnRepository(["Oi bom dia", "Qual é o endereço?"]);
  repository.messages.unshift(
    { id: "old-user", conversationId: "conversation", direction: "inbound", role: "user",
      content: "Quero a Relaxante amanhã às 15:30", createdAt: new Date(-11 * 60 * 60_000) },
    { id: "old-assistant", conversationId: "conversation", direction: "outbound", role: "assistant",
      content: "Vou considerar esse pedido.", createdAt: new Date(-11 * 60 * 60_000 + 1_000) },
  );
  repository.journeyState = {
    ...initialJourneyState(),
    stage: "ready_for_handoff",
    goals: ["relaxation"],
    latestGoals: ["relaxation"],
    serviceFamily: "massage",
    recommendedServices: ["Relaxante"],
    selectedService: "Relaxante",
    scheduling: { status: "complete", dayText: "amanhã", time: "15:30" },
  };
  const provider = new TurnProvider();
  let generated = 0;

  const result = await processConversationTurn({
    conversationId: "conversation",
    observedRevision: 2,
    repository,
    provider,
    journeyMode: "active",
    generateReply: async () => {
      generated += 1;
      return reply("A PRO HEALTH fica na Rua Vera Linhares de Andrade, 2063.")();
    },
  });

  assert.equal(result, "replied");
  assert.equal(generated, 1);
  assert.equal(repository.handoffRequested, false);
  assert.equal(repository.journeyState?.selectedService, undefined);
  assert.deepEqual(repository.journeyState?.scheduling, { status: "not_started" });
});

test("a newer inbound revision prevents a deterministic draft from persisting journey effects", async () => {
  const repository = new JourneyTurnRepository(["Quero a massagem Relaxante"]);
  const provider = new TurnProvider();
  setTimeout(() => {
    repository.revision += 1;
    repository.token = undefined;
    repository.messages.push({ id: "newer-journey-message", conversationId: "conversation",
      direction: "inbound", role: "user", content: "E tenho outra dúvida", inputRevision: 2,
      createdAt: new Date() });
  }, 5);

  const result = await processConversationTurn({
    conversationId: "conversation",
    observedRevision: 1,
    repository,
    provider,
    journeyMode: "active",
    preSendGraceMs: 20,
    generateReply: reply(),
  });

  assert.equal(result, "stale");
  assert.equal(provider.sent.length, 0);
  assert.equal(repository.savedJourneyStates.length, 0);
});

test("delivered commercial facts are not repeated while collecting the remaining schedule", async () => {
  const repository = new JourneyTurnRepository(["amanhã"]);
  repository.journeyState = {
    ...initialJourneyState(),
    stage: "collecting_schedule",
    goals: ["relaxation"],
    latestGoals: [],
    serviceFamily: "massage",
    recommendedServices: ["Relaxante"],
    selectedService: "Relaxante",
    factsSent: ["service_price", "service_duration", "hot_bath_amenities"],
    offers: { hot_bath: "offered" },
    scheduling: { status: "collecting" },
  };
  const provider = new TurnProvider();

  const result = await processConversationTurn({
    conversationId: "conversation",
    observedRevision: 1,
    repository,
    provider,
    journeyMode: "active",
    generateReply: reply(),
  });

  assert.equal(result, "replied");
  assert.equal(provider.sent.length, 1);
  assert.match(provider.sent[0] ?? "", /Qual horário/i);
  assert.doesNotMatch(provider.sent[0] ?? "", /R\$ 270|banheira|uma hora/i);
});
