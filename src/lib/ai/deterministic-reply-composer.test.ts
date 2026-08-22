import assert from "node:assert/strict";
import test from "node:test";

import { composeDeterministicReply } from "./deterministic-reply-composer.ts";

test("presents an integrated recommendation in the approved two-bubble structure", () => {
  const reply = composeDeterministicReply({
    kind: "integrated_recommendation",
    goal: "localized_tension",
  });
  assert.equal(reply.messages.length, 2);
  assert.match(reply.messages[0], /tensão localizada/i);
  assert.match(reply.messages[0], /Miofascial/i);
  assert.match(reply.messages[0], /Relaxante/i);
  assert.match(reply.messages[0], /profissional ajusta a abordagem quando você chegar/i);
  assert.equal(reply.messages[1], "Qual delas faz mais sentido para você: Miofascial ou Relaxante?");
  assert.doesNotMatch(reply.messages.join("\n"), /termoterapia|endere[cç]o/i);
});

test("adds the confirmed address only when requested for a non-customer journey", () => {
  const visitor = composeDeterministicReply({
    kind: "integrated_recommendation",
    goal: "localized_tension",
    includeAddress: true,
  });
  const customer = composeDeterministicReply({
    kind: "integrated_recommendation",
    goal: "localized_tension",
  });
  assert.match(visitor.messages[0], /Rua Vera Linhares de Andrade, 2063/i);
  assert.doesNotMatch(customer.messages[0], /Rua Vera Linhares de Andrade/i);
});

test("recommends at most two concrete techniques for tension and relaxation", () => {
  const reply = composeDeterministicReply({ kind: "service_recommendation", goal: "both" });
  assert.equal(reply.messages.length, 1);
  assert.match(reply.messages[0], /Miofascial/);
  assert.match(reply.messages[0], /Relaxante/);
  assert.equal(reply.messages[0].match(/\?/g)?.length, 1);
});

test("presents Relaxante facts and the personalized post-Pilates hot-bath offer once", () => {
  const reply = composeDeterministicReply({
    kind: "selected_service",
    service: "Relaxante",
    includePrice: true,
    includeDuration: true,
    offerHotBath: true,
    activePilates: true,
  });
  const text = reply.messages[0];
  assert.match(text, /uma hora completa/);
  assert.match(text, /R\$ 270/);
  assert.match(text, /depois de uma das suas aulas/);
  assert.match(text, /R\$ 70 por R\$ 35/);
  assert.match(text, /roupa de banho/);
  assert.match(text, /toalhas macias, secas e cheirosas, ducha e secador/);
  assert.match(text, /Você quer incluir essa experiência\?/);
  assert.equal(text.match(/\?/g)?.length, 1);
});

test("schedule handoff summarizes the slot without claiming a reservation", () => {
  const reply = composeDeterministicReply({
    kind: "schedule_handoff",
    service: "Relaxante",
    day: "amanhã",
    time: "15:30",
  });
  assert.match(reply.messages[0], /Relaxante, amanhã, às 15:30/);
  assert.match(reply.messages[0], /confirmar a disponibilidade/);
  assert.match(reply.messages[0], /só fica reservado depois dessa confirmação/);
  assert.equal(reply.handoffRecommended, true);
  assert.equal(reply.handoffValidated, true);
});

test("schedule handoff can summarize an accepted hot bath without repeating its price", () => {
  const reply = composeDeterministicReply({
    kind: "schedule_handoff",
    service: "Relaxante",
    day: "amanhã",
    time: "15:30",
    hotBathAccepted: true,
  });
  assert.match(reply.messages[0], /Relaxante \+ banheira quente, amanhã, às 15:30/i);
  assert.doesNotMatch(reply.messages[0], /R\$ 35/);
});

test("a direct Relaxante schedule includes unsent facts and the bath in one concise handoff", () => {
  const reply = composeDeterministicReply({
    kind: "schedule_handoff",
    service: "Relaxante",
    day: "amanhã",
    time: "15:30",
    includePrice: true,
    includeDuration: true,
    offerHotBath: true,
    activePilates: true,
  });
  const text = reply.messages[0];
  assert.match(text, /R\$ 270/);
  assert.match(text, /uma hora completa/i);
  assert.match(text, /banheira quente depois de uma das suas aulas/i);
  assert.match(text, /só fica reservado depois/i);
  assert.ok(text.length <= 700);
  assert.equal((text.match(/\?/g) ?? []).length, 0);
});
