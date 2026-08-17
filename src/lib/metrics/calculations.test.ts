import assert from "node:assert/strict";
import test from "node:test";

import { calculateCatalogHealth, parseMetricPeriodDays, percentile, rate, summarizeDurations,
  utcDedupeBucket } from "./calculations.ts";
import { METRIC_DEFINITIONS } from "./definitions.ts";

test("metric period only accepts supported windows", () => {
  assert.equal(parseMetricPeriodDays("1"), 1);
  assert.equal(parseMetricPeriodDays("30"), 30);
  assert.equal(parseMetricPeriodDays("14"), 7);
  assert.equal(parseMetricPeriodDays(undefined), 7);
});

test("rates stay unavailable when the denominator is absent", () => {
  assert.equal(rate(0, 0), null);
  assert.equal(rate(3, 12), 0.25);
});

test("p50 and p95 use linear interpolation and ignore invalid samples", () => {
  assert.equal(percentile([100, 200, Number.NaN, 300, 400], 0.5), 250);
  assert.equal(percentile([100, 200, 300, 400], 0.95), 385);
  assert.equal(percentile([], 0.5), null);
});

test("duration summary exposes sample coverage instead of hiding missing replies", () => {
  assert.deepEqual(summarizeDurations([1_000, 3_000], 4), {
    eligible: 4,
    observed: 2,
    coverage: 0.5,
    p50Ms: 2_000,
    p95Ms: 2_900,
  });
});

test("catalog is failed when a failure happened after the last success", () => {
  const health = calculateCatalogHealth({
    now: new Date("2026-08-16T12:00:00Z"),
    lastSuccessAt: new Date("2026-08-16T08:00:00Z"),
    lastFailureAt: new Date("2026-08-16T09:00:00Z"),
    lastAttemptAt: new Date("2026-08-16T09:00:00Z"),
  });
  assert.equal(health.status, "failed");
  assert.equal(health.ageHours, 4);
});

test("catalog becomes stale only after the documented threshold", () => {
  const now = new Date("2026-08-16T12:00:00Z");
  assert.equal(calculateCatalogHealth({ now, lastSuccessAt: new Date("2026-08-15T11:00:00Z") }).status, "healthy");
  assert.equal(calculateCatalogHealth({ now, lastSuccessAt: new Date("2026-08-15T09:00:00Z") }).status, "stale");
  assert.equal(calculateCatalogHealth({ now }).status, "unavailable");
});

test("dedupe buckets are stable inside the alert cooldown", () => {
  const first = new Date("2026-08-16T10:01:00Z");
  const second = new Date("2026-08-16T10:14:59Z");
  assert.equal(utcDedupeBucket(first, 15), utcDedupeBucket(second, 15));
  assert.notEqual(utcDedupeBucket(first, 15), utcDedupeBucket(new Date("2026-08-16T10:16:00Z"), 15));
});

test("commercial metric explicitly disclaims causal attribution", () => {
  assert.match(METRIC_DEFINITIONS.commercialOutcomes.limitation, /não prova/i);
  assert.match(METRIC_DEFINITIONS.intentCoverage.limitation, /indisponível/i);
  assert.match(METRIC_DEFINITIONS.duplicateAndOrder.target ?? "", /zero/i);
});
