import assert from "node:assert/strict";
import test from "node:test";

import { buildCustomerContext } from "../customer-context/index.ts";
import { logProcessingEvent } from "../observability/safe-log.ts";
import type { WhatsAppProvider } from "../whatsapp/provider.ts";
import { handleIncomingMessage } from "./handle-incoming-message.ts";
import type { ConversationIdentity, ConversationMessage, ConversationRepository, CustomerProfile } from "./types.ts";

class MemoryRepository implements ConversationRepository {
  contacts = new Map<string, ConversationIdentity>();
  messages: ConversationMessage[] = [];
  providerIds = new Set<string>();
  profiles = new Map<string, CustomerProfile>();
  sequence = 0;

  async recordInbound(input: { phoneNumber: string; providerMessageId: string; content: string }) {
    let identity = this.contacts.get(input.phoneNumber);
    if (!identity) {
      const number = ++this.sequence;
      identity = { contactId: `contact-${number}`, conversationId: `conversation-${number}`, relationshipStatus: "unknown" };
      this.contacts.set(input.phoneNumber, identity);
    }
    if (this.providerIds.has(input.providerMessageId)) return { identity, inserted: false };
    this.providerIds.add(input.providerMessageId);
    this.messages.push({ id: `message-${++this.sequence}`, conversationId: identity.conversationId,
      providerMessageId: input.providerMessageId, direction: "inbound", role: "user", content: input.content,
      createdAt: new Date(this.sequence * 1000) });
    return { identity, inserted: true };
  }
  async recordOutbound(input: { conversationId: string; content: string }) {
    this.messages.push({ id: `message-${++this.sequence}`, conversationId: input.conversationId,
      direction: "outbound", role: "assistant", content: input.content, createdAt: new Date(this.sequence * 1000) });
  }
  async getRecentMessages(conversationId: string, limit: number) {
    return this.messages.filter((item) => item.conversationId === conversationId).slice(-limit);
  }
  async getCustomerProfile(contactId: string) { return this.profiles.get(contactId); }
}

class MemoryProvider implements WhatsAppProvider {
  sent: string[] = [];
  async sendText(input: { text: string }) { this.sent.push(input.text); }
}

async function receive(repository: ConversationRepository, provider: WhatsAppProvider, phone: string, id: string, text: string) {
  return handleIncomingMessage({ accountId: "account", providerConversationId: `provider-${phone}`,
    providerEventId: `event-${id}`, providerMessageId: id, phoneNumber: phone, text, repository, provider,
    generateReply: async ({ context }) => `context:${context.conversation.recentMessages.map((item) => item.content).join("|")}` });
}

test("first contact creates a contact and active conversation", async () => {
  const repository = new MemoryRepository();
  await receive(repository, new MemoryProvider(), "+5548999999999", "1", "Oi");
  assert.equal(repository.contacts.size, 1);
  assert.equal(repository.messages[0]?.conversationId, "conversation-1");
});

test("second webhook from the same phone reuses its contact", async () => {
  const repository = new MemoryRepository(); const provider = new MemoryProvider();
  await receive(repository, provider, "+5548999999999", "1", "Oi");
  await receive(repository, provider, "+55 (48) 99999-9999", "2", "Tudo bem?");
  assert.equal(repository.contacts.size, 1);
});

test("messages stay associated with the correct conversation", async () => {
  const repository = new MemoryRepository(); const provider = new MemoryProvider();
  await receive(repository, provider, "+5548999999999", "1", "Oi");
  assert.ok(repository.messages.every((item) => item.conversationId === "conversation-1"));
});

test("duplicate provider message id does not duplicate or reply", async () => {
  const repository = new MemoryRepository(); const provider = new MemoryProvider();
  await receive(repository, provider, "+5548999999999", "1", "Oi");
  assert.equal(await receive(repository, provider, "+5548999999999", "1", "Oi"), "duplicate");
  assert.equal(repository.messages.length, 2); assert.equal(provider.sent.length, 1);
});

test("recent history is returned oldest to newest", async () => {
  const repository = new MemoryRepository(); const provider = new MemoryProvider();
  await receive(repository, provider, "+5548999999999", "1", "Primeira");
  await receive(repository, provider, "+5548999999999", "2", "Segunda");
  const history = await repository.getRecentMessages("conversation-1", 3);
  assert.deepEqual(history.map((item) => item.content), ["context:Primeira", "Segunda", "context:Primeira|context:Primeira|Segunda"]);
});

test("different phones never share memory", async () => {
  const repository = new MemoryRepository(); const provider = new MemoryProvider();
  await receive(repository, provider, "+5548999999999", "1", "Pilates");
  await receive(repository, provider, "+5548888888888", "2", "Massagem");
  assert.equal(repository.contacts.size, 2);
  assert.notEqual(repository.messages[0]?.conversationId, repository.messages[2]?.conversationId);
});

test("customer context without a profile does not invent customer data", async () => {
  const repository = new MemoryRepository();
  const inbound = await repository.recordInbound({ phoneNumber: "+5548999999999", providerMessageId: "1", content: "Oi" });
  const context = await buildCustomerContext(repository, inbound.identity);
  assert.deepEqual(context.customer, {}); assert.equal(context.identity.relationshipStatus, "unknown");
});

test("Pilates follow-up preserves enough context for annual plan", async () => {
  const repository = new MemoryRepository(); const provider = new MemoryProvider();
  await receive(repository, provider, "+5548999999999", "1", "Quero Pilates");
  await receive(repository, provider, "+5548999999999", "2", "2 vezes por semana");
  await receive(repository, provider, "+5548999999999", "3", "E anual?");
  assert.match(provider.sent.at(-1) ?? "", /Quero Pilates/);
  assert.match(provider.sent.at(-1) ?? "", /2 vezes por semana/);
  assert.match(provider.sent.at(-1) ?? "", /E anual\?/);
});

test("database failure stops before sending a reply", async () => {
  const repository = new MemoryRepository(); const provider = new MemoryProvider();
  repository.recordInbound = async () => { throw new Error("database unavailable"); };
  await assert.rejects(receive(repository, provider, "+5548999999999", "1", "Oi"), /database unavailable/);
  assert.equal(provider.sent.length, 0);
});

test("social messages skip enrichment and AI generation", async () => {
  const repository = new MemoryRepository(); const provider = new MemoryProvider();
  let enriched = false; let generated = false;
  await handleIncomingMessage({ accountId: "account", providerConversationId: "provider-conversation",
    providerEventId: "event-social", providerMessageId: "social", phoneNumber: "+5548999999999",
    text: "obrigdao", repository, provider,
    enrichCustomer: async ({ identity }) => { enriched = true; return identity; },
    generateReply: async () => { generated = true; return "AI"; } });
  assert.equal(enriched, false);
  assert.equal(generated, false);
  assert.equal(provider.sent[0], "De nada 🙂 Se precisar, é só me chamar.");
});

test("safe logs omit phone, message content, tokens, and API keys", () => {
  const original = console.info; const calls: unknown[] = [];
  console.info = (...args: unknown[]) => { calls.push(args); };
  try { logProcessingEvent("info", { event: "processed", eventId: "event-1", result: "replied" }); }
  finally { console.info = original; }
  const serialized = JSON.stringify(calls);
  assert.doesNotMatch(serialized, /5548999999999|mensagem secreta|api[_-]?key|token/i);
});
