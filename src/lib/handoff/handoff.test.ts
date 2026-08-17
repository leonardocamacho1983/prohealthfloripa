import assert from "node:assert/strict";
import test from "node:test";
import { detectHandoffConsent, detectHandoffRequest } from "./detection.ts";
import { buildHandoffSummary } from "./summary.ts";
import { handleIncomingMessage } from "../conversations/handle-incoming-message.ts";
import type { ConversationMessage, ConversationStatus } from "../conversations/types.ts";

test("detects an explicit request for a human", () => {
  assert.deepEqual(detectHandoffRequest("Quero falar com uma pessoa"), {
    reason: "Cliente solicitou atendimento humano.", source: "customer",
  });
});

test("accepts a short confirmation only after a clear handoff offer", () => {
  const offer = "Posso encaminhar seu pedido para nossa equipe verificar e continuar por aqui?";
  for (const answer of ["Sim", "Pode sim", "Claro", "Por favor", "Tá bom"]) {
    assert.equal(detectHandoffConsent(answer, offer)?.source, "customer", answer);
  }
  assert.equal(detectHandoffConsent("Sim", "A massagem custa R$ 270."), undefined);
  assert.equal(detectHandoffConsent("Não", offer), undefined);
});

test("does not hand off a negated human request", () => {
  for (const message of [
    "Não quero atendimento humano, quero resolver por aqui",
    "Não precisa chamar a Bia",
    "Prefiro não falar com atendente",
    "Não preciso de uma pessoa",
    "Não gostaria de atendimento humano",
  ]) {
    assert.equal(detectHandoffRequest(message), undefined, message);
  }
  assert.equal(detectHandoffRequest("Não quero falar com robô, quero uma pessoa")?.source, "customer");
});

test("does not escalate a normal service question", () => {
  assert.equal(detectHandoffRequest("Quanto custa Pilates duas vezes por semana?"), undefined);
});

test("ordinary shoulder discomfort remains a useful commercial conversation", () => {
  assert.equal(
    detectHandoffRequest("Quero massagem relaxante porque estou com dor no ombro"),
    undefined,
  );
  assert.equal(
    detectHandoffRequest("Posso fazer massagem para dor no ombro?"),
    undefined,
  );
});

test("a red-flag symptom escalates for clinical safety", () => {
  assert.equal(
    detectHandoffRequest("Estou com dor no peito e falta de ar")?.source,
    "safety_rule",
  );
});

test("escalates a sensitive clinical decision", () => {
  assert.equal(detectHandoffRequest("Estou grávida, posso fazer crioterapia?")?.source, "safety_rule");
  for (const message of [
    "Posso fazer massagem grávida?",
    "Posso fazer massagem depois de cirurgia?",
    "Posso fazer crioterapia com pressão alta?",
    "Quero massagem e estou gestante",
  ]) {
    assert.equal(detectHandoffRequest(message)?.source, "safety_rule", message);
  }
});

test("only escalates disagreement when it is actually financial", () => {
  assert.equal(
    detectHandoffRequest("Discordo: Thai é especial, não tradicional"),
    undefined,
  );
  assert.equal(
    detectHandoffRequest("Quero contestar essa classificação da massagem"),
    undefined,
  );
  assert.equal(detectHandoffRequest("Essa cobrança é indevida")?.source, "safety_rule");
  assert.equal(detectHandoffRequest("Quero reembolso")?.source, "safety_rule");
  assert.equal(detectHandoffRequest("Discordo do valor cobrado")?.source, "safety_rule");
});

test("summary is concise and identifies speakers", () => {
  const summary = buildHandoffSummary([{ id: "1", conversationId: "c", direction: "inbound", role: "user",
    content: "Preciso de ajuda", createdAt: new Date() }], "Pedido humano");
  assert.match(summary, /Motivo: Pedido humano/); assert.match(summary, /Cliente: Preciso de ajuda/);
});

function flowFixture(status: ConversationStatus = "active") {
  const messages: ConversationMessage[] = []; const sent: string[] = []; let handoffRequested = false;
  const repository = {
    async recordInbound(input: { providerMessageId: string; content: string }) {
      messages.push({ id: input.providerMessageId, conversationId: "conversation", providerMessageId: input.providerMessageId,
        direction: "inbound" as const, role: "user" as const, content: input.content, createdAt: new Date() });
      return { identity: { contactId: "contact", conversationId: "conversation", relationshipStatus: "unknown" as const },
        inserted: true, revision: 1, conversationStatus: status };
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
