import assert from "node:assert/strict";
import test from "node:test";

import type { CustomerContext } from "../customer-context/index.ts";
import type { HandoffStore } from "../handoff/types.ts";
import type { WhatsAppProvider } from "../whatsapp/provider.ts";
import { EmptyTurnInvariantError, processConversationTurn } from "./process-conversation-turn.ts";
import type { ConversationIdentity, ConversationMessage, ConversationTurnRepository,
  CustomerProfile, OutboundReservation, TurnAcquisition, TurnCompletionState } from "./types.ts";

class TurnRepository implements ConversationTurnRepository, HandoffStore {
  identity: ConversationIdentity = { contactId: "contact", conversationId: "conversation", relationshipStatus: "unknown" };
  messages: ConversationMessage[];
  status: "active" | "human_requested" | "human_active" | "closed" = "active";
  revision: number;
  processedRevision = 0;
  token?: string;
  sentKeys = new Set<string>();
  handoffRequested = false;
  releasedState?: "failed" | "stale";
  completedStates: TurnCompletionState[] = [];

  constructor(contents: string[]) {
    this.revision = contents.length;
    this.messages = contents.map((content, index) => ({ id: String(index), conversationId: "conversation",
      providerMessageId: `provider-${index}`, direction: "inbound", role: "user", content,
      inputRevision: index + 1, createdAt: new Date(index * 1000) }));
  }

  async recordInbound() { return { identity: this.identity, inserted: true, revision: this.revision,
    conversationStatus: this.status }; }
  async recordOutbound(input: { conversationId: string; content: string }) {
    this.messages.push({ id: `out-${this.messages.length}`, conversationId: input.conversationId,
      direction: "outbound", role: "assistant", content: input.content, createdAt: new Date() });
  }
  async getRecentMessages(_conversationId: string, limit: number) { return this.messages.slice(-limit); }
  async getCustomerProfile(): Promise<CustomerProfile | undefined> { return undefined; }
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
  async reserveOutbound(input: { revision: number; token: string; idempotencyKey: string }): Promise<OutboundReservation> {
    if (this.status !== "active" || this.revision !== input.revision || this.token !== input.token) return "stale";
    return this.sentKeys.has(input.idempotencyKey) ? "already_sent" : "reserved";
  }
  async markOutboundSent(input: { idempotencyKey: string }) { this.sentKeys.add(input.idempotencyKey); }
  async markOutboundFailed() {}
  async completeTurn(input: { revision: number; token: string; state: TurnCompletionState }) {
    if (this.revision !== input.revision || this.token !== input.token || this.status !== "active") return false;
    this.completedStates.push(input.state);
    this.processedRevision = input.revision; this.token = undefined; return true;
  }
  async releaseTurn(input: { state?: "failed" | "stale" }) {
    this.releasedState = input.state; this.token = undefined;
  }
  async getConversationState() { return { status: this.status }; }
  async requestHandoff() { this.handoffRequested = true; this.status = "human_requested"; this.processedRevision = this.revision; }
  async listHandoffs() { return []; }
  async takeHandoff() { this.status = "human_active"; }
  async touchHandoff() {}
  async closeHandoff() { this.status = "closed"; }
  async markHandoffViewed() {}
  async recordHandoffEvent() {}
}

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
  assert.deepEqual(provider.sent, ["Oi! Tudo bem? Como posso ajudar?"]);
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
    repository, provider, generateReply: async () => { generated = true; return reply()(); } });
  assert.equal(result, "handoff_requested");
  assert.equal(repository.handoffRequested, true);
  assert.equal(generated, false);
  assert.match(provider.sent[0] ?? "", /Bia continuar[aá]/i);
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

test("a locally validated partial fallback opens handoff after preserving the known answer", async () => {
  const repository = new TurnRepository(["Quero massagem e tenho outra dúvida sobre meu contrato"]);
  const provider = new TurnProvider();

  const result = await processConversationTurn({ conversationId: "conversation", observedRevision: 1,
    repository, provider, generateReply: async () => ({
      messages: ["A massagem custa R$ 270.",
        "Também registrei a dúvida do contrato para nossa equipe continuar sem você repetir."],
      answeredTopics: ["massagem"],
      needsClarification: false,
      handoffRecommended: true,
      handoffValidated: true,
    }) });

  assert.equal(result, "handoff_requested");
  assert.equal(repository.handoffRequested, true);
  assert.equal(provider.sent.length, 2);
});
