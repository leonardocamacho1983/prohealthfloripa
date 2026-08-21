import assert from "node:assert/strict";
import test from "node:test";

import { buildShiftDigestSummary } from "./handoff-message.ts";

test("resumo do início do turno preserva a ordem de maior espera e minimiza dados", () => {
  const now = new Date("2026-08-20T15:00:00.000Z");
  const summary = buildShiftDigestSummary([
    { reason: "Marcação de horário", requestedAt: new Date("2026-08-20T12:00:00.000Z") },
    { reason: "Cliente pediu uma pessoa", requestedAt: new Date("2026-08-20T14:50:00.000Z") },
  ], now);
  assert.match(summary, /^1\. 3 h — Marcação de horário\n2\. 10 min — Cliente pediu uma pessoa$/);
  assert.doesNotMatch(summary, /conversationId|providerAccountId/);
});
