import assert from "node:assert/strict";
import test from "node:test";

import type { MetricSnapshot } from "../metrics/types.ts";
import { buildHandoffRequestedNotification, buildOperationalAlerts } from "./rules.ts";

function healthySnapshot(): MetricSnapshot {
  const now = new Date("2026-08-16T18:00:00Z");
  return {
    generatedAt: now,
    window: { days: 7, since: new Date("2026-08-09T18:00:00Z"), until: now },
    volume: { conversations: 50, inboundMessages: 120, outboundMessages: 48 },
    handoffs: { requested: 2, requestRate: 0.04, waitingNow: 0, oldestWaitingMinutes: null,
      timeToHuman: { eligible: 2, observed: 2, coverage: 1, p50Ms: 120_000, p95Ms: 240_000 } },
    response: {
      firstOutbound: { eligible: 40, observed: 40, coverage: 1, p50Ms: 5_000, p95Ms: 18_000 },
      turnProcessing: { eligible: 80, observed: 80, coverage: 1, p50Ms: 4_000, p95Ms: 12_000 },
    },
    failures: { turns: 0, outboundDeliveries: 0, instrumented: 0, completedTurns: 80, turnFailureRate: 0 },
    quality: { intentCoverage: 0.98, intentCoverageSamples: 40, repairRequested: 12, repairSucceeded: 12,
      repairSuccessRate: 1, duplicateReplies: 0, outOfOrderReplies: 0 },
    catalog: { status: "healthy", lastAttemptAt: now, lastSuccessAt: now, lastFailureAt: null,
      ageHours: 0, itemCount: 80, staleAfterHours: 26 },
    commercial: { observedEvents: 0, observedAmountCents: 0, recoveryEvents: 0,
      evidenceWithAmount: 0, amountCoverage: null, attribution: "associated_only" },
  };
}

test("healthy operational snapshot produces no alert", () => {
  assert.deepEqual(buildOperationalAlerts(healthySnapshot()), []);
});

test("Joao-style failure signals surface slowness, order and repair problems", () => {
  const snapshot = healthySnapshot();
  snapshot.response.firstOutbound.p95Ms = 75_000;
  snapshot.quality.duplicateReplies = 1;
  snapshot.quality.outOfOrderReplies = 2;
  snapshot.quality.repairSucceeded = 5;
  snapshot.quality.repairSuccessRate = 5 / 12;
  const alerts = buildOperationalAlerts(snapshot);
  assert.deepEqual(alerts.map((item) => item.type).sort(), [
    "first_response_p95_slow",
    "repair_success_low",
    "reply_integrity_failure",
  ]);
  assert.equal(alerts.find((item) => item.type === "reply_integrity_failure")?.severity, "critical");
});

test("waiting alerts escalate after thirty minutes and remain deduplicated per bucket", () => {
  const snapshot = healthySnapshot();
  snapshot.handoffs.waitingNow = 3;
  snapshot.handoffs.oldestWaitingMinutes = 31;
  const first = buildOperationalAlerts(snapshot, new Date("2026-08-16T18:01:00Z"))[0];
  const second = buildOperationalAlerts(snapshot, new Date("2026-08-16T18:14:00Z"))[0];
  assert.equal(first.severity, "critical");
  assert.equal(first.dedupeKey, second.dedupeKey);
});

test("missing intent telemetry is not presented as a successful zero-error result", () => {
  const snapshot = healthySnapshot();
  snapshot.quality.intentCoverage = null;
  snapshot.quality.intentCoverageSamples = 0;
  assert.equal(buildOperationalAlerts(snapshot).some((item) => item.type === "intent_coverage_low"), false);
});

test("new handoff alert links to the conversation without copying its transcript", () => {
  const alert = buildHandoffRequestedNotification({
    conversationId: "conversation-1",
    firstName: "João",
    dedupeKey: "handoff-notification-conversation-1-7",
  });
  assert.equal(alert.type, "handoff_requested");
  assert.equal(alert.body, "João está aguardando na caixa de atendimento.");
  assert.deepEqual(alert.payload, { conversationId: "conversation-1" });
  assert.equal(JSON.stringify(alert).includes("resumo"), false);
});
