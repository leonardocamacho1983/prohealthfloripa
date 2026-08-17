import assert from "node:assert/strict";
import test from "node:test";

import { buildSchedulingInstructions, detectSchedulingIntent } from "./scheduling.ts";

test("recognizes a service plus a date as scheduling intent", () => {
  assert.deepEqual(detectSchedulingIntent("Preciso de massagem relaxante hoje"), {
    requested: true, hasService: true, hasDatePreference: true,
  });
});

test("does not confuse opening hours with a booking request", () => {
  assert.equal(detectSchedulingIntent("Qual é o horário de funcionamento?").requested, false);
  assert.equal(detectSchedulingIntent("Tem horário de massagem amanhã?").requested, true);
});

test("asks only for the missing scheduling detail", () => {
  const instructions = buildSchedulingInstructions("Quero agendar uma massagem", undefined);
  assert.match(instructions ?? "", /dia ou período/);
  assert.doesNotMatch(instructions ?? "", /descobrir: serviço e/);
});

test("uses only a valid HTTPS booking URL and never claims a booking", () => {
  const instructions = buildSchedulingInstructions("Massagem hoje", "https://agenda.example.com/prohealth");
  assert.match(instructions ?? "", /https:\/\/agenda\.example\.com\/prohealth/);
  assert.match(instructions ?? "", /não declare que uma reserva foi criada/i);
  const unsafe = buildSchedulingInstructions("Massagem hoje", "javascript:alert(1)");
  assert.doesNotMatch(unsafe ?? "", /javascript:/);
});
