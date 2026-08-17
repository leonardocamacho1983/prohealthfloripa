import assert from "node:assert/strict";
import test from "node:test";

import { buildOperationalReconciliationPlan, isPendingHandoffRequest } from "./lifecycle.ts";
import type { NotificationCandidate } from "./types.ts";

const notification = (type: string, dedupeKey: string): NotificationCandidate => ({
  type,
  dedupeKey,
  severity: "warning",
  title: "Alerta",
  body: "Condição observada.",
});

test("metric alerts keep only the active dedupe bucket open", () => {
  const plan = buildOperationalReconciliationPlan([
    notification("first_response_p95_slow", "first_response_p95_slow:2026-08-16T18:00"),
  ]);
  assert.deepEqual(plan.find((item) => item.type === "first_response_p95_slow"), {
    type: "first_response_p95_slow",
    activeDedupeKey: "first_response_p95_slow:2026-08-16T18:00",
  });
  assert.deepEqual(plan.find((item) => item.type === "repair_success_low"), {
    type: "repair_success_low",
    activeDedupeKey: null,
  });
});

test("cleared metric conditions receive a null active key and can be resolved", () => {
  const plan = buildOperationalReconciliationPlan([]);
  assert.equal(plan.every((item) => item.activeDedupeKey === null), true);
});

test("handoff requested alerts remain actionable only while the conversation waits", () => {
  assert.equal(isPendingHandoffRequest("human_requested"), true);
  assert.equal(isPendingHandoffRequest("human_active"), false);
  assert.equal(isPendingHandoffRequest("closed"), false);
  assert.equal(isPendingHandoffRequest("active"), false);
  assert.equal(isPendingHandoffRequest(null), false);
});
