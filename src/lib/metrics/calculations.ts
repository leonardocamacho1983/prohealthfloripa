import { METRIC_PERIOD_DAYS, type CatalogHealth, type DurationSummary, type MetricPeriodDays } from "./types.ts";

export function parseMetricPeriodDays(value: string | null | undefined): MetricPeriodDays {
  const parsed = Number(value);
  return METRIC_PERIOD_DAYS.includes(parsed as MetricPeriodDays) ? parsed as MetricPeriodDays : 7;
}

export function rate(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return Math.max(0, numerator) / denominator;
}

export function percentile(values: readonly number[], quantile: number): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const bounded = Math.min(1, Math.max(0, quantile));
  const position = (sorted.length - 1) * bounded;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function summarizeDurations(values: readonly number[], eligible = values.length): DurationSummary {
  const valid = values.filter((value) => Number.isFinite(value) && value >= 0);
  return {
    eligible: Math.max(0, eligible),
    observed: valid.length,
    coverage: rate(valid.length, eligible),
    p50Ms: percentile(valid, 0.5),
    p95Ms: percentile(valid, 0.95),
  };
}

export function calculateCatalogHealth(input: {
  lastAttemptAt?: Date | null;
  lastSuccessAt?: Date | null;
  lastFailureAt?: Date | null;
  itemCount?: number | null;
  now?: Date;
  staleAfterHours?: number;
}): CatalogHealth {
  const now = input.now ?? new Date();
  const staleAfterHours = input.staleAfterHours ?? 26;
  const lastAttemptAt = input.lastAttemptAt ?? null;
  const lastSuccessAt = input.lastSuccessAt ?? null;
  const lastFailureAt = input.lastFailureAt ?? null;
  const ageHours = lastSuccessAt
    ? Math.max(0, now.getTime() - lastSuccessAt.getTime()) / 3_600_000
    : null;
  const failedAfterSuccess = Boolean(lastFailureAt && (!lastSuccessAt || lastFailureAt > lastSuccessAt));
  const status = failedAfterSuccess
    ? "failed"
    : !lastSuccessAt
      ? "unavailable"
      : ageHours !== null && ageHours > staleAfterHours
        ? "stale"
        : "healthy";

  return {
    status,
    lastAttemptAt,
    lastSuccessAt,
    lastFailureAt,
    ageHours,
    itemCount: input.itemCount ?? null,
    staleAfterHours,
  };
}

export function utcDedupeBucket(now: Date, bucketMinutes: number): string {
  const size = Math.max(1, Math.floor(bucketMinutes)) * 60_000;
  return String(Math.floor(now.getTime() / size));
}
