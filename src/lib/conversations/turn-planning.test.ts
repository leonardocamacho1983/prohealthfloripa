import assert from "node:assert/strict";
import test from "node:test";

import type { ConversationMessage } from "./types.ts";
import { adaptiveBatchDelaySeconds, applyResetToHistory, planConversationTurn } from "./turn-planning.ts";

function messages(...contents: string[]): ConversationMessage[] {
  return contents.map((content, index) => ({ id: String(index), conversationId: "conversation",
    direction: "inbound", role: "user", content, inputRevision: index + 1, createdAt: new Date(index * 1000) }));
}

test("groups several fragments into one ordered turn", () => {
  const plan = planConversationTurn(messages("Quero Lomi-Lomi", "Quanto custa?", "Oi"));
  assert.match(plan.consolidatedMessage, /Mensagem 1: Quero Lomi-Lomi/);
  assert.match(plan.consolidatedMessage, /Mensagem 2: Quanto custa\?/);
  assert.equal(plan.repairRequested, false);
  assert.equal(plan.suppressReply, false);
});

test("a final reply nudge preserves the pending request without inventing an error", () => {
  for (const nudge of ["Oi", "?", "Travou"]) {
    const plan = planConversationTurn(messages("Quero Lomi-Lomi", "Quanto custa?", nudge));
    assert.equal(plan.repairRequested, false, nudge);
    assert.match(plan.consolidatedMessage, /Quanto custa/);
  }
});

test("suppresses a complete cancellation before anything is sent", () => {
  assert.equal(planConversationTurn(messages("Algum contato?", "Não precisa responder")).suppressReply, true);
});

test("keeps social text together with a real request", () => {
  const plan = planConversationTurn(messages("Obrigado", "Me passa o endereço?"));
  assert.equal(plan.socialKind, undefined);
  assert.match(plan.consolidatedMessage, /endereço/);
});

test("classifies an entire greeting burst as social even with a question mark", () => {
  const plan = planConversationTurn(messages("Oi bom dia", "Tudo bem?"));
  assert.equal(plan.socialKind, "greeting");
  assert.equal(plan.repairRequested, false);
});

test("keeps a five-message burst ordered when it contains different topics", () => {
  const plan = planConversationTurn(messages(
    "Oi bom dia",
    "Quero massagem relaxante",
    "Estou com dor no ombro",
    "Quanto custa?",
    "Ah, me fala também o endereço?",
  ));
  assert.equal(plan.messages.length, 5);
  assert.equal(plan.socialKind, undefined);
  assert.deepEqual(plan.consolidatedMessage.split("\n"), [
    "Mensagem 1: Oi bom dia",
    "Mensagem 2: Quero massagem relaxante",
    "Mensagem 3: Estou com dor no ombro",
    "Mensagem 4: Quanto custa?",
    "Mensagem 5: Ah, me fala também o endereço?",
  ]);
});

test("detects explicit contradiction and repair language", () => {
  for (const content of ["Ué", "Mas você disse que não tinha", "Ué, então vocês fazem?",
    "Não entendi", "Você se contradisse"]) {
    assert.equal(planConversationTurn(messages(content)).repairRequested, true, content);
  }
  assert.equal(planConversationTurn(messages("Então vocês oferecem isso?")).repairRequested, false);
  assert.equal(planConversationTurn(messages("Então vocês ficam no Córrego Grande?")).repairRequested, false);
});

test("reset only removes prior conversational history", () => {
  const history = messages("Quero Pilates", "Vamos começar do zero", "Quero massagem");
  const plan = planConversationTurn(history);
  assert.equal(plan.resetRequested, true);
  assert.deepEqual(applyResetToHistory(history, true).map((message) => message.content),
    ["Vamos começar do zero", "Quero massagem"]);
});

test("uses an adaptive quiet window for greetings, fragments and complete questions", () => {
  assert.equal(adaptiveBatchDelaySeconds("Oi bom dia"), 2);
  assert.equal(adaptiveBatchDelaySeconds("Ah também"), 9);
  assert.equal(adaptiveBatchDelaySeconds("Dor na cervical e no ombro direito"), 9);
  assert.equal(adaptiveBatchDelaySeconds("Qual é o endereço?"), 5);
  assert.equal(adaptiveBatchDelaySeconds("Gostaria de conhecer os planos."), 6);
});
