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
  async sendText(input: { text: string }) { this.sent.push(input.text); this.onSend?.(input.text); }
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
  const result = await processConversationTurn({ conversationId: "conversation", observedRevision: 5,
    repository, provider, enrichCustomer: async ({ identity }) => { enriched += 1; return identity; },
    generateReply: async (input) => { generated += 1; consolidated = input.message; return reply()(input); } });
  assert.equal(result, "replied");
  assert.equal(enriched, 1); assert.equal(generated, 1); assert.equal(provider.sent.length, 1);
  assert.match(consolidated, /Lomi-Lomi/); assert.match(consolidated, /Quanto custa/);
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
