import assert from "node:assert/strict";
import test from "node:test";
import { isValidHandoffAccessKey, isValidHandoffSession, handoffSessionValue } from "./auth.ts";
import { detectHandoffRequest } from "./detection.ts";
import { buildHandoffSummary } from "./summary.ts";
import { handleIncomingMessage } from "../conversations/handle-incoming-message.ts";
import type { ConversationMessage, ConversationStatus } from "../conversations/types.ts";

test("detects an explicit request for a human", () => {
  assert.deepEqual(detectHandoffRequest("Quero falar com uma pessoa"), {
    reason: "Cliente solicitou atendimento humano.", source: "customer",
  });
});

test("does not escalate a normal service question", () => {
  assert.equal(detectHandoffRequest("Quanto custa Pilates duas vezes por semana?"), undefined);
});

test("escalates a sensitive clinical decision", () => {
  assert.equal(detectHandoffRequest("Estou grávida, posso fazer crioterapia?")?.source, "safety_rule");
});

test("summary is concise and identifies speakers", () => {
  const summary = buildHandoffSummary([{ id: "1", conversationId: "c", direction: "inbound", role: "user",
    content: "Preciso de ajuda", createdAt: new Date() }], "Pedido humano");
  assert.match(summary, /Motivo: Pedido humano/); assert.match(summary, /Cliente: Preciso de ajuda/);
});

test("handoff session only accepts the correct secret-derived cookie", () => {
  const value = handoffSessionValue("segredo-forte");
  assert.equal(isValidHandoffSession(value, "segredo-forte"), true);
  assert.equal(isValidHandoffSession(value, "outro-segredo"), false);
});

test("access key comparison rejects an incorrect key", () => {
  assert.equal(isValidHandoffAccessKey("correta", "correta"), true);
  assert.equal(isValidHandoffAccessKey("incorreta", "correta"), false);
});

function flowFixture(status: ConversationStatus = "active") {
  const messages: ConversationMessage[] = []; const sent: string[] = []; let handoffRequested = false;
  const repository = {
    async recordInbound(input: { providerMessageId: string; content: string }) {
      messages.push({ id: input.providerMessageId, conversationId: "conversation", providerMessageId: input.providerMessageId,
        direction: "inbound" as const, role: "user" as const, content: input.content, createdAt: new Date() });
      return { identity: { contactId: "contact", conversationId: "conversation", relationshipStatus: "unknown" as const },
        inserted: true, conversationStatus: status };
    },
    async recordOutbound(input: { conversationId: string; content: string }) { messages.push({ id: "out", conversationId: input.conversationId,
      direction: "outbound", role: "assistant", content: input.content, createdAt: new Date() }); },
    async getRecentMessages() { return messages; }, async getCustomerProfile() { return undefined; },
    async requestHandoff() { handoffRequested = true; }, async getConversationState() { return { status }; },
    async listHandoffs() { return []; }, async takeHandoff() {}, async touchHandoff() {}, async closeHandoff() {},
    async markHandoffViewed() {}, async recordHandoffEvent() {},
  };
  const provider = { async sendText(input: { text: string }) { sent.push(input.text); } };
  return { repository, provider, sent, wasRequested: () => handoffRequested };
}

test("human request acknowledges once and opens a handoff", async () => {
  const fixture = flowFixture();
  const result = await handleIncomingMessage({ accountId: "account", providerConversationId: "provider",
    providerEventId: "event", providerMessageId: "message", phoneNumber: "5548999999999",
    text: "Quero falar com uma pessoa", repository: fixture.repository, provider: fixture.provider,
    generateReply: async () => "should not run" });
  assert.equal(result, "handoff_requested"); assert.equal(fixture.wasRequested(), true); assert.equal(fixture.sent.length, 1);
});

test("agent stays silent while a human handoff is active", async () => {
  const fixture = flowFixture("human_active");
  const result = await handleIncomingMessage({ accountId: "account", providerConversationId: "provider",
    providerEventId: "event", providerMessageId: "message", phoneNumber: "5548999999999",
    text: "Oi, Bia", repository: fixture.repository, provider: fixture.provider,
    generateReply: async () => "should not run" });
  assert.equal(result, "human_silent"); assert.equal(fixture.sent.length, 0);
});
