import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSchedulingInstructions,
  detectSchedulingIntent,
  shouldHandoffSchedulingRequest,
} from "./scheduling.ts";

test("recognizes a service plus a date as scheduling intent", () => {
  assert.deepEqual(detectSchedulingIntent("Preciso de massagem relaxante hoje"), {
    requested: true, hasService: true, hasDatePreference: true,
    hasDayPreference: true, hasPeriodPreference: false, hasExactTimePreference: false,
  });
});

test("does not confuse opening hours with a booking request", () => {
  assert.equal(detectSchedulingIntent("Qual é o horário de funcionamento?").requested, false);
  assert.equal(detectSchedulingIntent("Tem horário de massagem amanhã?").requested, true);
});

test("asks only for the missing scheduling detail", () => {
  const instructions = buildSchedulingInstructions("Quero agendar uma massagem", undefined);
  assert.match(instructions ?? "", /dia e período/);
  assert.doesNotMatch(instructions ?? "", /descobrir: serviço/);

  const today = buildSchedulingInstructions("Quero massagem hoje", undefined);
  assert.match(today ?? "", /descobrir: período \(manhã, tarde ou noite\)/);
  assert.doesNotMatch(today ?? "", /descobrir: dia/);
});

test("uses only a valid HTTPS booking URL and never claims a booking", () => {
  const instructions = buildSchedulingInstructions("Massagem hoje", "https://agenda.example.com/prohealth");
  assert.match(instructions ?? "", /https:\/\/agenda\.example\.com\/prohealth/);
  assert.match(instructions ?? "", /não declare que uma reserva foi criada/i);
  const unsafe = buildSchedulingInstructions("Massagem hoje", "javascript:alert(1)");
  assert.doesNotMatch(unsafe ?? "", /javascript:/);
});

test("an exact hour is more specific than a broad period", () => {
  const intent = detectSchedulingIntent("Massagem amanhã às 14?");
  assert.equal(intent.hasDayPreference, true);
  assert.equal(intent.hasExactTimePreference, true);
  assert.equal(intent.hasPeriodPreference, true);
});

test("recognizes common Brazilian hour shorthand", () => {
  for (const message of ["Amanhã às 10hs", "amanhã 10h", "amanhã 10:00"]) {
    const intent = detectSchedulingIntent(message);
    assert.equal(intent.hasDayPreference, true, message);
    assert.equal(intent.hasExactTimePreference, true, message);
    assert.equal(intent.hasPeriodPreference, true, message);
  }
});

test("consolidates service and exact time across consecutive customer turns", () => {
  const instructions = buildSchedulingInstructions(
    "amanhã às 14?",
    undefined,
    ["Quero ver a massagem relaxante"],
  );
  assert.match(instructions ?? "", /pedido já contém serviço, dia e período/i);
  assert.doesNotMatch(instructions ?? "", /descobrir:/i);
  assert.match(instructions ?? "", /encaminhar a conversa para a equipe/i);
});

test("explicit scheduling authorization can hand off when complete context is in history", () => {
  assert.equal(shouldHandoffSchedulingRequest(
    "ok pode agendar",
    ["Quero massagem relaxante", "amanhã às 14"],
    undefined,
  ), true);
  assert.equal(shouldHandoffSchedulingRequest(
    "ok pode agendar",
    ["Quero massagem relaxante"],
    undefined,
  ), false);
});
