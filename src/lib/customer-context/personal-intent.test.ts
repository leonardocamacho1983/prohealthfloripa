import assert from "node:assert/strict";
import test from "node:test";

import { isPersonalAccountFollowUp, isPersonalAccountQuery,
  isPersonalPaymentAmountQuery } from "./personal-intent.ts";

test("recognizes first-person account questions", () => {
  for (const message of [
    "Quando vence meu plano?",
    "Qual foi meu último pagamento?",
    "Estou com alguma pendência?",
    "Eu tenho um contrato ativo?",
    "Quando é minha próxima aula?",
  ]) assert.equal(isPersonalAccountQuery(message), true, message);
  assert.equal(isPersonalPaymentAmountQuery("Qual foi o valor do meu último pagamento?"), true);
});

test("resolves short account follow-ups only from an immediate personal request", () => {
  assert.equal(isPersonalAccountFollowUp("E quando vence?", "Quero saber do meu plano"), true);
  assert.equal(isPersonalAccountFollowUp("E a próxima?", "Quando é minha próxima aula?"), true);
  assert.equal(isPersonalAccountFollowUp("E quando vence?", "Qual é o preço do Pilates?"), false);
  assert.equal(isPersonalAccountFollowUp("E a próxima?"), false);
});

test("does not treat third-party possessives or public catalog questions as personal", () => {
  for (const message of [
    "Minha amiga quer saber o endereço",
    "Meu marido quer saber o preço",
    "Eu gostaria de saber como funciona o contrato de Pilates",
    "Qual é a mensalidade do Pilates?",
  ]) assert.equal(isPersonalAccountQuery(message), false, message);
});
