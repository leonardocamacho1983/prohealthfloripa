import assert from "node:assert/strict";
import test from "node:test";

import { buildSocialReply, classifySocialMessage, isGreetingMessage } from "./social-message.ts";

test("recognizes greeting questions without intercepting a request", () => {
  for (const message of ["Oi bom dia", "Tudo bem?", "Olá, boa tarde!", "oi, tudo bem?"]) {
    assert.equal(isGreetingMessage(message), true, message);
    assert.equal(classifySocialMessage(message), "greeting", message);
  }
  assert.equal(classifySocialMessage("Oi, qual é o endereço?"), undefined);
  assert.equal(buildSocialReply("greeting", "Leonardo"), "Oi, Leonardo! Tudo bem? Como posso ajudar?");
});

test("recognizes gratitude and common typing errors", () => {
  for (const message of ["obrigado", "Obrigada 🙂", "obg", "valeu", "obrigdao", "queria só ter dito obrigado"]) {
    assert.equal(classifySocialMessage(message), "gratitude", message);
  }
});

test("treats malformed gratitude sentence as social", () => {
  assert.equal(classifySocialMessage("quando foi a obrigado"), "gratitude");
});

test("does not intercept real customer questions", () => {
  for (const message of ["Obrigado, quando vence meu plano?", "qual o valor do plano", "valeu, quero agendar Pilates",
    "Obrigado, quero Thai", "Valeu, preciso de Lomi-Lomi", "Obrigada, gostaria de liberação miofascial"]) {
    assert.equal(classifySocialMessage(message), undefined, message);
  }
});

test("recognizes short acknowledgements and farewells", () => {
  assert.equal(classifySocialMessage("beleza"), "acknowledgement");
  assert.equal(classifySocialMessage("até mais"), "farewell");
});

test("builds a short personalized response", () => {
  assert.equal(buildSocialReply("gratitude", "Leonardo"), "De nada, Leonardo 🙂 Se precisar, é só me chamar.");
});
