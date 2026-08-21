import assert from "node:assert/strict";
import test from "node:test";

import type { ConversationMessage } from "./types.ts";
import { adaptiveBatchDelaySeconds, applyResetToHistory, planConversationTurn,
  shouldResumePendingHandoff } from "./turn-planning.ts";

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
  assert.deepEqual(plan.greeting, { daypart: "morning" });
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

test("explicit reset resumes only a handoff that has not been assumed", () => {
  assert.equal(shouldResumePendingHandoff("human_requested", "Vamos começar do zero"), true);
  assert.equal(shouldResumePendingHandoff("human_active", "Vamos começar do zero"), false);
  assert.equal(shouldResumePendingHandoff("human_requested", "oi"), false);
});

test("uses a short adaptive quiet window for greetings, actions and complete questions", () => {
  assert.equal(adaptiveBatchDelaySeconds("Oi bom dia"), 4);
  assert.equal(adaptiveBatchDelaySeconds("Pode agendar"), 2);
  assert.equal(adaptiveBatchDelaySeconds("amanhã"), 2);
  assert.equal(adaptiveBatchDelaySeconds("15:30"), 2);
  assert.equal(adaptiveBatchDelaySeconds("10hs"), 2);
  assert.equal(adaptiveBatchDelaySeconds("Qual é o endereço?"), 2);
  assert.equal(adaptiveBatchDelaySeconds("Ah também"), 4);
  assert.equal(adaptiveBatchDelaySeconds("Dor na cervical e no ombro direito"), 3);
  assert.equal(adaptiveBatchDelaySeconds("Gostaria de conhecer os planos."), 3);
});

test("reserves the longest quiet window only for a clearly unfinished continuation", () => {
  for (const fragment of ["E", "Quero saber também", "Tenho outra dúvida sobre", "Pode ser com"]) {
    assert.equal(adaptiveBatchDelaySeconds(fragment), 4, fragment);
  }
});

test("keeps every batching delay between two and four seconds", () => {
  for (const content of ["", "Oi", "Pode marcar", "sexta-feira", "Quanto custa?", "Tenho dor", "Uma frase completa.", "e"]) {
    assert.ok(adaptiveBatchDelaySeconds(content) >= 2, content);
    assert.ok(adaptiveBatchDelaySeconds(content) <= 4, content);
  }
});
