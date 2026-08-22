import { getDatabase } from "@/lib/db/neon";
import { hasConfiguredNotificationProfile } from "@/lib/attendants/repository";
import { getMetricSnapshot } from "@/lib/metrics/repository";
import { ensureMetricsSchema } from "@/lib/metrics/schema";
import type { MetricPeriodDays } from "@/lib/metrics/types";

import { buildOperationalReconciliationPlan } from "./lifecycle";
import { buildOperationalAlerts } from "./rules";
import type { NotificationCandidate, NotificationChannelSetting, NotificationRecord } from "./types";
import { cancelConversationDeliveries } from "./delivery-repository";

export type HandoffNotificationResolution = "assumed" | "closed" | "returned" | "taken";

async function reconcileOperationalNotifications(activeNotifications: readonly NotificationCandidate[]) {
  await ensureMetricsSchema();
  const sql = getDatabase();
  const plan = buildOperationalReconciliationPlan(activeNotifications);
  await Promise.all(plan.map(({ type, activeDedupeKey }) => sql`UPDATE notification_outbox
    SET status='resolved', resolved_at=now(), resolution_reason='condition_cleared', updated_at=now()
    WHERE notification_type=${type} AND status IN ('pending','failed')
      AND (${activeDedupeKey}::text IS NULL OR dedupe_key <> ${activeDedupeKey})`));
}

async function resolveStaleHandoffRequestedNotifications() {
  const sql = getDatabase();
  await sql`UPDATE notification_outbox notification
    SET status='resolved', resolved_at=now(), resolution_reason='handoff_no_longer_waiting', updated_at=now()
    WHERE notification.notification_type='handoff_requested'
      AND notification.status IN ('pending','failed')
      AND NOT EXISTS (
        SELECT 1 FROM conversations conversation
        WHERE conversation.id::text=notification.payload->>'conversationId'
          AND conversation.status='human_requested')`;
}

export async function enqueueInAppNotification(input: NotificationCandidate): Promise<boolean> {
  await ensureMetricsSchema();
  const sql = getDatabase();
  const handoffConversationId = input.type === "handoff_requested"
    && typeof input.payload?.conversationId === "string"
    ? input.payload.conversationId
    : "";
  const rows = await sql`INSERT INTO notification_outbox (
      channel, notification_type, severity, title, body, dedupe_key, payload)
    SELECT 'in_app', ${input.type}, ${input.severity}, ${input.title}, ${input.body},
      ${input.dedupeKey}, ${JSON.stringify(input.payload ?? {})}::jsonb
    WHERE ${input.type !== "handoff_requested"}::boolean OR EXISTS (
      SELECT 1 FROM conversations
      WHERE id::text=${handoffConversationId} AND status='human_requested')
    ON CONFLICT (channel, dedupe_key) DO UPDATE SET
      occurrence_count=notification_outbox.occurrence_count + 1,
      severity=EXCLUDED.severity, title=EXCLUDED.title, body=EXCLUDED.body,
      status=CASE WHEN notification_outbox.status='resolved' THEN 'pending' ELSE notification_outbox.status END,
      resolved_at=CASE WHEN notification_outbox.status='resolved' THEN NULL ELSE notification_outbox.resolved_at END,
      resolution_reason=CASE WHEN notification_outbox.status='resolved' THEN NULL ELSE notification_outbox.resolution_reason END,
      last_seen_at=now(), updated_at=now(), payload=EXCLUDED.payload
    RETURNING (xmax = 0) inserted` as Array<{ inserted: boolean }>;
  return Boolean(rows[0]?.inserted);
}

export async function evaluateAndEnqueueAlerts(days: MetricPeriodDays): Promise<{
  evaluated: number;
  newlyQueued: number;
}> {
  const snapshot = await getMetricSnapshot(days);
  const alerts = buildOperationalAlerts(snapshot);
  await reconcileOperationalNotifications(alerts);
  const results = await Promise.all(alerts.map(enqueueInAppNotification));
  return { evaluated: alerts.length, newlyQueued: results.filter(Boolean).length };
}

export async function listOpenNotifications(limit = 30): Promise<NotificationRecord[]> {
  await ensureMetricsSchema();
  await resolveStaleHandoffRequestedNotifications();
  const sql = getDatabase();
  const rows = await sql`SELECT id, channel, notification_type, severity, title, body, status,
    dedupe_key, payload, occurrence_count, last_seen_at, created_at
    FROM notification_outbox
    WHERE status IN ('pending','failed') AND available_at <= now()
    ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
      last_seen_at DESC LIMIT ${Math.min(100, Math.max(1, limit))}` as Array<{
      id: string; channel: "in_app" | "whatsapp"; notification_type: string;
      severity: "info" | "warning" | "critical"; title: string; body: string;
      status: "pending" | "failed"; dedupe_key: string; payload: Record<string, string | number | boolean | null>;
      occurrence_count: number | string;
      last_seen_at: Date | string; created_at: Date | string;
    }>;
  return rows.map((row) => ({
    id: row.id,
    channel: row.channel,
    type: row.notification_type,
    severity: row.severity,
    title: row.title,
    body: row.body,
    status: row.status,
    dedupeKey: row.dedupe_key,
    payload: row.payload,
    occurrenceCount: Number(row.occurrence_count),
    lastSeenAt: new Date(row.last_seen_at),
    createdAt: new Date(row.created_at),
  }));
}

export async function resolveHandoffNotifications(
  conversationId: string,
  resolution: HandoffNotificationResolution,
): Promise<number> {
  await ensureMetricsSchema();
  const sql = getDatabase();
  const rows = await sql`WITH resolved_handoff AS (
      UPDATE notification_outbox
      SET status='resolved', resolved_at=now(), resolution_reason=${`handoff_${resolution}`}, updated_at=now()
      WHERE notification_type='handoff_requested'
        AND status IN ('pending','failed') AND payload->>'conversationId'=${conversationId}
      RETURNING id
    ), resolved_waiting AS (
      UPDATE notification_outbox
      SET status='resolved', resolved_at=now(), resolution_reason='handoff_queue_recovered', updated_at=now()
      WHERE notification_type='handoff_waiting_too_long'
        AND status IN ('pending','failed')
        AND NOT EXISTS (
          SELECT 1 FROM conversations
          WHERE status='human_requested' AND handoff_requested_at <= now() - interval '10 minutes')
      RETURNING id
    ) SELECT count(*)::int resolved_count FROM (
      SELECT id FROM resolved_handoff UNION ALL SELECT id FROM resolved_waiting
    ) resolved` as Array<{ resolved_count: number | string }>;
  return Number(rows[0]?.resolved_count ?? 0);
}

export async function resolveHandoffNotificationsBestEffort(
  conversationId: string,
  resolution: HandoffNotificationResolution,
): Promise<void> {
  try {
    await Promise.all([
      resolveHandoffNotifications(conversationId, resolution),
      cancelConversationDeliveries(conversationId, `handoff_${resolution}`),
    ]);
  } catch (error) {
    console.warn("Handoff notification resolution deferred", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

export async function dismissNotification(id: string): Promise<boolean> {
  await ensureMetricsSchema();
  const sql = getDatabase();
  const rows = await sql`UPDATE notification_outbox SET status='dismissed', dismissed_at=now(), updated_at=now()
    WHERE id=${id} AND channel='in_app' AND status IN ('pending','failed') RETURNING id` as Array<{ id: string }>;
  return Boolean(rows[0]);
}

export async function listNotificationChannels(): Promise<NotificationChannelSetting[]> {
  await ensureMetricsSchema();
  const sql = getDatabase();
  const [rawRows, hasAttendantProfile] = await Promise.all([
    sql`SELECT channel, status, recipient_reference, updated_at
      FROM notification_channel_settings ORDER BY channel`,
    hasConfiguredNotificationProfile(),
  ]);
  const rows = rawRows as Array<{
      channel: "in_app" | "whatsapp"; status: "enabled" | "pending" | "disabled";
      recipient_reference: string | null; updated_at: Date | string;
    }>;
  const whatsappConfigured = hasAttendantProfile && Boolean(process.env.ZERNIO_API_KEY?.trim());
  return rows.map((row) => ({
    channel: row.channel,
    status: row.channel === "whatsapp" && row.status !== "disabled"
      ? whatsappConfigured && row.status === "enabled" ? "enabled" : "pending"
      : row.status,
    configured: row.channel === "in_app" || whatsappConfigured || Boolean(row.recipient_reference),
    updatedAt: new Date(row.updated_at),
  }));
}
