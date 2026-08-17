export const METRIC_PERIOD_DAYS = [1, 7, 30] as const;

export type MetricPeriodDays = (typeof METRIC_PERIOD_DAYS)[number];

export type DurationSummary = {
  eligible: number;
  observed: number;
  coverage: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
};

export type CatalogHealthStatus = "healthy" | "stale" | "failed" | "unavailable";

export type CatalogHealth = {
  status: CatalogHealthStatus;
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  ageHours: number | null;
  itemCount: number | null;
  staleAfterHours: number;
};

export type MetricSnapshot = {
  generatedAt: Date;
  window: { days: MetricPeriodDays; since: Date; until: Date };
  volume: {
    conversations: number;
    inboundMessages: number;
    outboundMessages: number;
  };
  handoffs: {
    requested: number;
    requestRate: number | null;
    waitingNow: number;
    oldestWaitingMinutes: number | null;
    timeToHuman: DurationSummary;
  };
  response: {
    firstOutbound: DurationSummary;
    turnProcessing: DurationSummary;
  };
  failures: {
    turns: number;
    outboundDeliveries: number;
    instrumented: number;
    completedTurns: number;
    turnFailureRate: number | null;
  };
  quality: {
    intentCoverage: number | null;
    intentCoverageSamples: number;
    repairRequested: number;
    repairSucceeded: number;
    repairSuccessRate: number | null;
    duplicateReplies: number;
    outOfOrderReplies: number;
  };
  catalog: CatalogHealth;
  commercial: {
    observedEvents: number;
    observedAmountCents: number;
    recoveryEvents: number;
    evidenceWithAmount: number;
    amountCoverage: number | null;
    attribution: "associated_only";
  };
};

export type OperationalMetricEventInput = {
  eventName: string;
  outcome?: "info" | "success" | "failure";
  conversationId?: string;
  durationMs?: number;
  value?: number;
  unit?: string;
  metadata?: Record<string, string | number | boolean | null>;
  dedupeKey?: string;
  occurredAt?: Date;
};
export type CommercialOutcomeEventInput = {
  eventType: "payment_observed" | "conversion_observed" | "recovery_observed";
  evidenceSource: string;
  conversationId?: string;
  amountCents?: number;
  externalReference?: string;
  metadata?: Record<string, string | number | boolean | null>;
  dedupeKey?: string;
  occurredAt?: Date;
};
