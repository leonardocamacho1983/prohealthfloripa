import assert from "node:assert/strict";
import test from "node:test";

import { activeShiftKeyAt, defaultWeeklySchedule, isAttendantOnDuty, nextShiftStartAt,
  normalizeWeeklySchedule, parseSaoPauloDateTimeLocal } from "./schedule.ts";

test("considera o atendente disponível somente dentro do horário local configurado", () => {
  const schedule = defaultWeeklySchedule();
  assert.equal(isAttendantOnDuty(schedule, new Date("2026-08-19T15:00:00.000Z")), true);
  assert.equal(isAttendantOnDuty(schedule, new Date("2026-08-19T22:00:00.000Z")), false);
  assert.equal(isAttendantOnDuty(schedule, new Date("2026-08-23T15:00:00.000Z")), false);
});

test("gera uma chave estável por início de turno para impedir resumos duplicados", () => {
  const schedule = defaultWeeklySchedule();
  assert.equal(activeShiftKeyAt(schedule, new Date("2026-08-19T12:01:00.000Z")), "2026-08-19:08:00");
  assert.equal(activeShiftKeyAt(schedule, new Date("2026-08-19T20:59:00.000Z")), "2026-08-19:08:00");
});

test("desabilita intervalos inválidos sem inventar horários", () => {
  const schedule = normalizeWeeklySchedule({ "1": { enabled: true, start: "18:00", end: "08:00" } });
  assert.equal(schedule["1"]?.enabled, false);
});

test("encontra o início exato do próximo turno para o agente notificador", () => {
  const schedule = defaultWeeklySchedule();
  const next = nextShiftStartAt(schedule, new Date("2026-08-19T22:00:00.000Z"));
  assert.equal(next?.at.toISOString(), "2026-08-20T11:00:00.000Z");
  assert.equal(next?.shiftKey, "2026-08-20:08:00");
});

test("interpreta exceção digitada no horário de Florianópolis", () => {
  assert.equal(parseSaoPauloDateTimeLocal("2026-08-20T08:30")?.toISOString(), "2026-08-20T11:30:00.000Z");
  assert.equal(parseSaoPauloDateTimeLocal("20/08/2026 08:30"), undefined);
});
