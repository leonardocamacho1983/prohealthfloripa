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
  assert.equal(plan.repairRequested, true);
  assert.equal(plan.suppressReply, false);
});

test("suppresses a complete cancellation before anything is sent", () => {
  assert.equal(planConversationTurn(messages("Algum contato?", "Não precisa responder")).suppressReply, true);
});

test("keeps social text together with a real request", () => {
  const plan = planConversationTurn(messages("Obrigado", "Me passa o endereço?"));
  assert.equal(plan.socialKind, undefined);
  assert.match(plan.consolidatedMessage, /endereço/);
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
