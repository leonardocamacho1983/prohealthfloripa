import assert from "node:assert/strict";
import test from "node:test";

import { AUTOMATIC_CLOSURE_CONFIRMATION, buildSocialReply, classifySocialMessage, detectGreetingContext,
  hasAssistantGreetingAcknowledgement, isGreetingMessage,
  isClosureConsent, prependGreetingAcknowledgement } from "./social-message.ts";

test("recognizes greeting questions without intercepting a request", () => {
  for (const message of ["Oi bom dia", "Tudo bem?", "Olá, boa tarde!", "oi, tudo bem?"]) {
    assert.equal(isGreetingMessage(message), true, message);
    assert.equal(classifySocialMessage(message), "greeting", message);
  }
  assert.equal(classifySocialMessage("Oi, qual é o endereço?"), undefined);
  assert.equal(buildSocialReply("greeting", "Leonardo", { daypart: "afternoon" }),
    "Oi, Leonardo, boa tarde! Tudo ótimo por aqui 😊 E com você? Como podemos te ajudar hoje?");
});

test("acknowledges a greeting naturally when it arrives with a substantive request", () => {
  assert.deepEqual(detectGreetingContext("Oi, boa tarde! Estou com dor na lombar"), {
    daypart: "afternoon",
  });
  assert.equal(
    prependGreetingAcknowledgement("Para essa queixa, podemos orientar.", { daypart: "afternoon" }),
    "Oi, boa tarde! Tudo ótimo por aqui 😊 Para essa queixa, podemos orientar.",
  );
  assert.equal(
    prependGreetingAcknowledgement("Oi! Já vou te ajudar.", { daypart: "afternoon" }),
    "Oi! Já vou te ajudar.",
  );
  assert.equal(detectGreetingContext("Como vai funcionar a massagem?"), undefined);
});

test("recognizes that the assistant already greeted in the current episode", () => {
  assert.equal(hasAssistantGreetingAcknowledgement([
    "Oi, Leonardo, boa noite! Tudo ótimo por aqui 😊 E com você? Como podemos te ajudar hoje?",
  ]), true);
  assert.equal(hasAssistantGreetingAcknowledgement([
    "Para essa tensão, temos duas opções de massagem.",
  ]), false);
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

test("asks permission before closing a satisfied conversation", () => {
  assert.equal(classifySocialMessage("Estou satisfeito, era isso"), "satisfaction");
  assert.equal(classifySocialMessage("Não estou satisfeito"), undefined);
  assert.equal(buildSocialReply("gratitude", "Leonardo"),
    "De nada, Leonardo 🙂 Posso encerrar este atendimento por aqui?");
  assert.equal(isClosureConsent("sim, pode encerrar",
    "Que bom 🙂 Posso encerrar este atendimento por aqui?"), true);
  assert.equal(isClosureConsent("sim, pode encerrar", "Como posso ajudar?"), false);
  assert.match(AUTOMATIC_CLOSURE_CONFIRMATION, /Vou encerrar/);
});
