import { getDatabase } from "@/lib/db/neon";

import { calculateCatalogHealth, rate } from "./calculations";
import { ensureMetricsSchema } from "./schema";
import type { CommercialOutcomeEventInput, DurationSummary, MetricPeriodDays, MetricSnapshot,
  OperationalMetricEventInput } from "./types";

type NumberLike = number | string | null;

const numberValue = (value: NumberLike): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const nullableNumber = (value: NumberLike): number | null => {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const dateValue = (value: Date | string | null): Date | null => value ? new Date(value) : null;

function durationSummary(row: {
  eligible: NumberLike;
  observed: NumberLike;
  p50_ms: NumberLike;
  p95_ms: NumberLike;
}): DurationSummary {
  const eligible = numberValue(row.eligible);
  const observed = numberValue(row.observed);
  return {
    eligible,
    observed,
    coverage: rate(observed, eligible),
    p50Ms: nullableNumber(row.p50_ms),
    p95Ms: nullableNumber(row.p95_ms),
  };
}

export async function getMetricSnapshot(days: MetricPeriodDays, now = new Date()): Promise<MetricSnapshot> {
  await ensureMetricsSchema();
  const sql = getDatabase();
  const since = new Date(now.getTime() - days * 86_400_000);

  const [overviewRows, firstResponseRows, humanResponseRows, turnLatencyRows, waitingRows, qualityRows,
    catalogRows, commercialRows] = await Promise.all([
    sql`SELECT
      (SELECT count(DISTINCT conversation_id)::int FROM messages
        WHERE direction='inbound' AND created_at >= ${since} AND created_at < ${now}) conversations,
      (SELECT count(*)::int FROM messages
        WHERE direction='inbound' AND created_at >= ${since} AND created_at < ${now}) inbound_messages,
      (SELECT count(*)::int FROM messages
        WHERE direction='outbound' AND delivery_status='sent'
          AND created_at >= ${since} AND created_at < ${now}) outbound_messages,
      (SELECT count(*)::int FROM conversations c
        WHERE c.handoff_requested_at >= ${since} AND c.handoff_requested_at < ${now}
          AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id=c.id
            AND m.direction='inbound' AND m.created_at >= ${since} AND m.created_at < ${now})) handoff_requests,
      (SELECT count(*)::int FROM conversation_turns
        WHERE state='failed' AND updated_at >= ${since} AND updated_at < ${now}) failed_turns,
      (SELECT count(*)::int FROM conversation_turns
        WHERE state <> 'processing' AND updated_at >= ${since} AND updated_at < ${now}) completed_turns,
      (SELECT count(*)::int FROM messages
        WHERE direction='outbound' AND delivery_status='failed'
          AND created_at >= ${since} AND created_at < ${now}) failed_deliveries,
      (SELECT count(*)::int FROM operational_metric_events
        WHERE outcome='failure' AND occurred_at >= ${since} AND occurred_at < ${now}) instrumented_failures`,
    sql`WITH first_inbound AS (
        SELECT conversation_id, min(created_at) first_inbound_at
        FROM messages WHERE direction='inbound' GROUP BY conversation_id
        HAVING min(created_at) >= ${since} AND min(created_at) < ${now}
      ), first_response AS (
        SELECT inbound.conversation_id, inbound.first_inbound_at,
          min(outbound.created_at) first_outbound_at
        FROM first_inbound inbound
        LEFT JOIN messages outbound ON outbound.conversation_id=inbound.conversation_id
          AND outbound.direction='outbound' AND outbound.delivery_status='sent'
          AND outbound.created_at >= inbound.first_inbound_at
        GROUP BY inbound.conversation_id, inbound.first_inbound_at
      ), durations AS (
        SELECT extract(epoch FROM (first_outbound_at - first_inbound_at)) * 1000 duration_ms
        FROM first_response WHERE first_outbound_at IS NOT NULL
      ) SELECT
        (SELECT count(*)::int FROM first_response) eligible,
        (SELECT count(*)::int FROM durations) observed,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) p50_ms,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) p95_ms
      FROM durations`,
    sql`WITH handoffs AS (
        SELECT handoff_requested_at, human_started_at
        FROM conversations
        WHERE handoff_requested_at >= ${since} AND handoff_requested_at < ${now}
      ), durations AS (
        SELECT extract(epoch FROM (human_started_at - handoff_requested_at)) * 1000 duration_ms
        FROM handoffs WHERE human_started_at IS NOT NULL AND human_started_at >= handoff_requested_at
      ) SELECT
        (SELECT count(*)::int FROM handoffs) eligible,
        (SELECT count(*)::int FROM durations) observed,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) p50_ms,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) p95_ms
      FROM durations`,
    sql`WITH durations AS (
        SELECT extract(epoch FROM (completed_at - started_at)) * 1000 duration_ms
        FROM conversation_turns
        WHERE state='replied' AND completed_at IS NOT NULL
          AND started_at >= ${since} AND started_at < ${now} AND completed_at >= started_at
      ) SELECT count(*)::int eligible, count(*)::int observed,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) p50_ms,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) p95_ms
      FROM durations`,
    sql`SELECT count(*)::int waiting_now,
      extract(epoch FROM (${now} - min(handoff_requested_at))) / 60 oldest_waiting_minutes
      FROM conversations WHERE status='human_requested'`,
    sql`SELECT
      avg(value) FILTER (WHERE event_name='turn_intent_coverage' AND value BETWEEN 0 AND 1) intent_coverage,
      count(*) FILTER (WHERE event_name='turn_intent_coverage' AND value BETWEEN 0 AND 1)::int intent_samples,
      count(*) FILTER (WHERE event_name='conversation_repair_requested')::int repair_requested,
      count(*) FILTER (WHERE event_name='conversation_repair_succeeded')::int repair_succeeded,
      count(*) FILTER (WHERE event_name='duplicate_reply_detected')::int duplicate_replies,
      count(*) FILTER (WHERE event_name='out_of_order_reply_detected')::int out_of_order_replies
      FROM operational_metric_events WHERE occurred_at >= ${since} AND occurred_at < ${now}`,
    sql`SELECT
      (SELECT completed_at FROM catalog_sync_runs WHERE source='nextfit'
        ORDER BY completed_at DESC LIMIT 1) last_attempt_at,
      (SELECT completed_at FROM catalog_sync_runs WHERE source='nextfit' AND status='succeeded'
        ORDER BY completed_at DESC LIMIT 1) last_success_at,
      (SELECT completed_at FROM catalog_sync_runs WHERE source='nextfit' AND status='failed'
        ORDER BY completed_at DESC LIMIT 1) last_failure_at,
      (SELECT count(*)::int FROM catalog_items WHERE source='nextfit' AND active=true) item_count`,
    sql`SELECT count(*)::int observed_events,
      coalesce(sum(amount_cents), 0)::bigint observed_amount_cents,
      count(*) FILTER (WHERE event_type='recovery_observed')::int recovery_events,
      count(*) FILTER (WHERE amount_cents IS NOT NULL)::int evidence_with_amount
      FROM commercial_outcome_events WHERE occurred_at >= ${since} AND occurred_at < ${now}`,
  ]);

  const overview = overviewRows[0] as {
    conversations: NumberLike; inbound_messages: NumberLike; outbound_messages: NumberLike;
    handoff_requests: NumberLike; failed_turns: NumberLike; completed_turns: NumberLike;
    failed_deliveries: NumberLike; instrumented_failures: NumberLike;
  };
  const firstResponse = firstResponseRows[0] as {
    eligible: NumberLike; observed: NumberLike; p50_ms: NumberLike; p95_ms: NumberLike;
  };
  const humanResponse = humanResponseRows[0] as typeof firstResponse;
  const turnLatency = turnLatencyRows[0] as typeof firstResponse;
  const waiting = waitingRows[0] as { waiting_now: NumberLike; oldest_waiting_minutes: NumberLike };
  const quality = qualityRows[0] as {
    intent_coverage: NumberLike; intent_samples: NumberLike; repair_requested: NumberLike;
    repair_succeeded: NumberLike; duplicate_replies: NumberLike; out_of_order_replies: NumberLike;
  };
  const catalog = catalogRows[0] as {
    last_attempt_at: Date | string | null; last_success_at: Date | string | null;
    last_failure_at: Date | string | null; item_count: NumberLike;
  };
  const commercial = commercialRows[0] as {
    observed_events: NumberLike; observed_amount_cents: NumberLike;
    recovery_events: NumberLike; evidence_with_amount: NumberLike;
  };

  const conversations = numberValue(overview.conversations);
  const requested = numberValue(overview.handoff_requests);
  const completedTurns = numberValue(overview.completed_turns);
  const failedTurns = numberValue(overview.failed_turns);
  const repairRequested = numberValue(quality.repair_requested);
  const repairSucceeded = numberValue(quality.repair_succeeded);
  const observedEvents = numberValue(commercial.observed_events);
  const evidenceWithAmount = numberValue(commercial.evidence_with_amount);

  return {
    generatedAt: now,
    window: { days, since, until: now },
    volume: {
      conversations,
      inboundMessages: numberValue(overview.inbound_messages),
      outboundMessages: numberValue(overview.outbound_messages),
    },
    handoffs: {
      requested,
      requestRate: rate(requested, conversations),
      waitingNow: numberValue(waiting.waiting_now),
      oldestWaitingMinutes: nullableNumber(waiting.oldest_waiting_minutes),
      timeToHuman: durationSummary(humanResponse),
    },
    response: {
      firstOutbound: durationSummary(firstResponse),
      turnProcessing: durationSummary(turnLatency),
    },
    failures: {
      turns: failedTurns,
      outboundDeliveries: numberValue(overview.failed_deliveries),
      instrumented: numberValue(overview.instrumented_failures),
      completedTurns,
      turnFailureRate: rate(failedTurns, completedTurns),
    },
    quality: {
      intentCoverage: nullableNumber(quality.intent_coverage),
      intentCoverageSamples: numberValue(quality.intent_samples),
      repairRequested,
      repairSucceeded,
      repairSuccessRate: rate(repairSucceeded, repairRequested),
      duplicateReplies: numberValue(quality.duplicate_replies),
      outOfOrderReplies: numberValue(quality.out_of_order_replies),
    },
    catalog: calculateCatalogHealth({
      now,
      lastAttemptAt: dateValue(catalog.last_attempt_at),
      lastSuccessAt: dateValue(catalog.last_success_at),
      lastFailureAt: dateValue(catalog.last_failure_at),
      itemCount: nullableNumber(catalog.item_count),
    }),
    commercial: {
      observedEvents,
      observedAmountCents: numberValue(commercial.observed_amount_cents),
      recoveryEvents: numberValue(commercial.recovery_events),
      evidenceWithAmount,
      amountCoverage: rate(evidenceWithAmount, observedEvents),
      attribution: "associated_only",
    },
  };
}

export async function recordOperationalMetric(input: OperationalMetricEventInput): Promise<boolean> {
  if (!input.eventName.trim()) throw new Error("Metric event name is required");
  if (input.durationMs !== undefined && (!Number.isFinite(input.durationMs) || input.durationMs < 0)) {
    throw new Error("Metric duration must be non-negative");
  }
  await ensureMetricsSchema();
  const sql = getDatabase();
  const rows = await sql`INSERT INTO operational_metric_events (
      event_name, outcome, conversation_id, duration_ms, value, unit, metadata, dedupe_key, occurred_at)
    VALUES (${input.eventName.trim()}, ${input.outcome ?? "info"}, ${input.conversationId ?? null},
      ${input.durationMs ?? null}, ${input.value ?? null}, ${input.unit ?? null}, ${JSON.stringify(input.metadata ?? {})}::jsonb,
      ${input.dedupeKey ?? null}, ${input.occurredAt ?? new Date()})
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    RETURNING id` as Array<{ id: string }>;
  return Boolean(rows[0]);
}

export async function recordCommercialOutcome(input: CommercialOutcomeEventInput): Promise<boolean> {
  if (!input.evidenceSource.trim()) throw new Error("Commercial evidence source is required");
  if (input.amountCents !== undefined && (!Number.isInteger(input.amountCents) || input.amountCents < 0)) {
    throw new Error("Commercial amount must be a non-negative integer in cents");
  }
  await ensureMetricsSchema();
  const sql = getDatabase();
  const rows = await sql`INSERT INTO commercial_outcome_events (
      event_type, conversation_id, amount_cents, evidence_source, external_reference, metadata, dedupe_key, occurred_at)
    VALUES (${input.eventType}, ${input.conversationId ?? null}, ${input.amountCents ?? null},
      ${input.evidenceSource.trim()}, ${input.externalReference ?? null}, ${JSON.stringify(input.metadata ?? {})}::jsonb,
      ${input.dedupeKey ?? null}, ${input.occurredAt ?? new Date()})
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    RETURNING id` as Array<{ id: string }>;
  return Boolean(rows[0]);
}
