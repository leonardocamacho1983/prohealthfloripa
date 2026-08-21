import assert from "node:assert/strict";
import test from "node:test";

import { repairAssistedReplyMessages } from "./assisted-reply-repair.ts";
import { validateResponsePolicy } from "./response-policy-validator.ts";

test("removes a repeated safety checklist after the customer already cleared it", () => {
  const messages = repairAssistedReplyMessages({
    messages: [
      "A Miofascial é mais direcionada para a tensão localizada.",
      "Você está com dor forte, formigamento, perda de força ou começou após algum trauma?",
    ],
    safetyStatus: "cleared",
    professionalAdjustmentMentioned: false,
    includeVisitorAddress: false,
    addressSent: false,
  });
  assert.deepEqual(messages, ["A Miofascial é mais direcionada para a tensão localizada."]);
  assert.equal(validateResponsePolicy({ messages, safetyStatus: "cleared" }).valid, true);
});

test("replaces an address permission gate with the confirmed address for a visitor", () => {
  const messages = repairAssistedReplyMessages({
    messages: [
      "A Relaxante pode ser uma boa opção. Quer que eu te diga como chegar até a unidade?",
    ],
    safetyStatus: "not_asked",
    professionalAdjustmentMentioned: false,
    includeVisitorAddress: true,
    addressSent: false,
  });
  assert.equal(messages.length, 1);
  assert.match(messages[0]!, /Rua Vera Linhares de Andrade, 2063/);
  assert.doesNotMatch(messages[0]!, /Quer que eu/);
});

test("removes a repeated professional disclaimer without erasing the concrete service", () => {
  const messages = repairAssistedReplyMessages({
    messages: [
      "Para esse mal-estar, a Miofascial pode fazer sentido, conforme a avaliação profissional no início.",
      "O profissional ajusta a abordagem de acordo com sua condição.",
    ],
    safetyStatus: "not_asked",
    professionalAdjustmentMentioned: true,
    includeVisitorAddress: false,
    addressSent: false,
  });
  assert.deepEqual(messages, ["Para esse mal-estar, a Miofascial pode fazer sentido."]);
});
