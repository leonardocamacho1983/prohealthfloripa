import assert from "node:assert/strict";
import test from "node:test";

import { validateResponsePolicy } from "./response-policy-validator.ts";

test("accepts a concise grounded schedule handoff", () => {
  const result = validateResponsePolicy({ messages: [
    "Perfeito: Relaxante, amanhã, às 15:30. Vou encaminhar para a equipe confirmar a disponibilidade; o horário só fica reservado depois dessa confirmação.",
  ] });
  assert.equal(result.valid, true);
});

test("rejects false booking, multiple questions and hot bath before Pilates", () => {
  const result = validateResponsePolicy({ messages: [
    "Agendei sua massagem. Qual dia? Qual horário? Faça a banheira quente antes do Pilates.",
  ] });
  assert.equal(result.valid, false);
  assert.deepEqual(result.issues.map((issue) => issue.code), [
    "too_many_questions",
    "false_booking_confirmation",
    "hot_bath_before_pilates",
  ]);
});

test("recognizes common informal claims of a completed booking", () => {
  for (const message of [
    "Marquei para amanhã.",
    "Sua vaga está garantida.",
    "Já está na agenda.",
  ]) {
    const validation = validateResponsePolicy({ messages: [message] });
    assert.equal(validation.issues.some((issue) => issue.code === "false_booking_confirmation"), true);
  }
});

test("rejects repeated commercial facts unless the caller explicitly allows them", () => {
  const previous = ["A Relaxante custa R$ 270 e dura 1 hora."];
  const messages = ["O valor é R$ 270 e a sessão ocupa uma hora completa."];
  const rejected = validateResponsePolicy({ messages, previousAssistantMessages: previous });
  assert.equal(rejected.valid, false);
  assert.equal(rejected.issues.filter((issue) => issue.code === "repeated_fact").length, 2);
  const allowed = validateResponsePolicy({ messages, previousAssistantMessages: previous,
    allowRepeatedFacts: ["massage_price", "massage_duration"] });
  assert.equal(allowed.valid, true);
});

test("flags language that asks permission instead of delivering value", () => {
  for (const message of [
    "Se quiser, eu posso te passar as opções.",
    "Se você quiser, te explico qual costuma fazer mais sentido.",
    "Posso te orientar sobre as massagens.",
  ]) {
    const validation = validateResponsePolicy({ messages: [message] });
    assert.equal(validation.issues.some((issue) => issue.code === "deferred_value"), true);
  }
  assert.equal(validateResponsePolicy({
    messages: ["Estas são as opções. Qual caminho parece melhor para você?"],
  }).valid, true);
});

test("blocks internal operational language from reaching the customer", () => {
  for (const message of [
    "Isso não impede uma avaliação comercial.",
    "Vamos continuar a jornada comercial.",
    "Você entrou no nosso funil de vendas.",
  ]) {
    const validation = validateResponsePolicy({ messages: [message] });
    assert.equal(validation.issues.some((issue) => issue.code === "internal_language_leak"), true, message);
  }
  assert.equal(validateResponsePolicy({
    messages: ["Entendi. Vamos encontrar a opção que combina melhor com o que você busca."],
  }).valid, true);
});
