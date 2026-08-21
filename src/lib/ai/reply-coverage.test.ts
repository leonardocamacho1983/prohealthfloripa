import assert from "node:assert/strict";
import test from "node:test";

import { analyzeMassageRequest } from "../knowledge/massage-catalog-semantics.ts";
import type { WhatsAppReplyPlan } from "./reply-generation-fallback.ts";
import { ensureDeterministicReplyCoverage } from "./reply-coverage.ts";

function plan(...messages: string[]): WhatsAppReplyPlan {
  return {
    messages,
    answeredTopics: [],
    needsClarification: false,
    handoffRecommended: false,
  };
}

test("complements a missing technique without discarding the model answer", () => {
  const result = ensureDeterministicReplyCoverage({
    plan: plan("Thai é especial, dura 1h e custa R$ 300."),
    message: "Compare Thai e Lomi-Lomi",
    massageAnalysis: analyzeMassageRequest("Compare Thai e Lomi-Lomi"),
  });
  assert.equal(result.messages[0], "Thai é especial, dura 1h e custa R$ 300.");
  assert.match(result.messages[1] ?? "", /Lomi-Lomi.*tradicional\/cl[aá]ssica.*R\$ 270/i);
});

test("keeps distinct burst topics and supplies a missing public fact", () => {
  const result = ensureDeterministicReplyCoverage({
    plan: plan("A Relaxante é tradicional/clássica e custa R$ 270."),
    message: "Quanto custa massagem relaxante? Ah, e qual é o endereço?",
    massageAnalysis: analyzeMassageRequest("Quanto custa massagem relaxante?"),
  });
  assert.match(result.messages.join("\n"), /R\$ 270/);
  assert.match(result.messages.join("\n"), /Vera Linhares de Andrade, 2063/);
});

test("does not duplicate facts already covered", () => {
  const original = plan(
    "Thai é especial e custa R$ 300; Lomi-Lomi é tradicional e custa R$ 270. O endereço é Rua Vera Linhares de Andrade, 2063.",
  );
  const result = ensureDeterministicReplyCoverage({
    plan: original,
    message: "Compare Thai e Lomi-Lomi e me passe o endereço",
    massageAnalysis: analyzeMassageRequest("Compare Thai e Lomi-Lomi"),
  });
  assert.deepEqual(result, original);
});

test("answers requested e-mail as a confirmed public fact", () => {
  const result = ensureDeterministicReplyCoverage({
    plan: plan("Claro."),
    message: "Qual é o e-mail?",
    massageAnalysis: analyzeMassageRequest("Qual é o e-mail?"),
  });
  assert.match(result.messages.join("\n"), /prohealthfloripa@gmail\.com/);
});

test("does not re-add a massage already answered before a burst interruption", () => {
  const result = ensureDeterministicReplyCoverage({
    plan: plan("O endereço é Rua Vera Linhares de Andrade, 2063."),
    message: "Quanto custa Relaxante? E qual é o endereço? Também quero saber de Pilates.",
    massageAnalysis: analyzeMassageRequest("Quanto custa Relaxante?"),
    priorAssistantMessages: ["A Relaxante é tradicional/clássica e custa R$ 270."],
  });
  assert.equal(result.messages.join("\n").match(/R\$ 270/g)?.length ?? 0, 0);
  assert.equal(result.messages.length, 1);
});

test("does not repeat a public fact sent before a burst interruption", () => {
  const result = ensureDeterministicReplyCoverage({
    plan: plan("O Pilates 2x custa R$ 420."),
    message: "Qual é o endereço? E quanto custa Pilates 2x?",
    massageAnalysis: analyzeMassageRequest("Quanto custa Pilates 2x?"),
    priorAssistantMessages: ["O endereço é Rua Vera Linhares de Andrade, 2063."],
  });
  assert.equal(result.messages.length, 1);
  assert.doesNotMatch(result.messages.join("\n"), /Vera Linhares|2063/);
});

test("adds price, duration and hot-bath cross-sell to a commercial Relaxante reply", () => {
  const customerMessage = "Estou tenso, com dificuldade de relaxar. Quero ver a massagem relaxante";
  const result = ensureDeterministicReplyCoverage({
    plan: plan(
      "A massagem Relaxante pode contribuir para conforto e relaxamento. Qual dia você prefere?",
    ),
    message: customerMessage,
    massageAnalysis: analyzeMassageRequest(customerMessage),
  });
  const reply = result.messages.join("\n");
  assert.match(reply, /1 hora completa/i);
  assert.match(reply, /R\$ 270/);
  assert.match(reply, /banheira quente de R\$ 70 por R\$ 35/i);
  assert.match(reply, /roupa de banho/i);
  assert.match(reply, /toalhas macias, ducha e secador/i);
});

test("does not duplicate commercial massage facts already answered", () => {
  const customerMessage = "Quero ver a massagem relaxante";
  const original = plan(
    "A Relaxante custa R$ 270 no avulso e o atendimento ocupa 1 hora completa.",
  );
  const result = ensureDeterministicReplyCoverage({
    plan: original,
    message: customerMessage,
    massageAnalysis: analyzeMassageRequest(customerMessage),
  });
  const reply = result.messages.join("\n");
  assert.equal(reply.match(/R\$ 270/g)?.length, 1);
  assert.equal(reply.match(/1 hora completa/g)?.length, 1);
  assert.match(reply, /banheira quente de R\$ 70 por R\$ 35/i);
});

test("a prior Relaxante recommendation does not suppress a bath that was never offered", () => {
  const customerMessage = "Quero a massagem Relaxante para relaxar";
  const result = ensureDeterministicReplyCoverage({
    plan: plan("Perfeito, podemos seguir com a Relaxante."),
    message: customerMessage,
    massageAnalysis: analyzeMassageRequest(customerMessage),
    priorAssistantMessages: [
      "Para conforto e relaxamento, a massagem Relaxante tende a combinar melhor.",
    ],
  });
  assert.match(result.messages.join("\n"), /banheira quente de R\$ 70 por R\$ 35/i);
});
