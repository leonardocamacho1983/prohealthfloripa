import "server-only";

import { getDatabase } from "@/lib/db/neon";
import { HANDOFF_TEMPLATE_NAME } from "./zernio-templates";
import { ensureNotificationDeliverySchema } from "./delivery-schema";

export type WhatsAppDelivery = {
  id: string; conversationId: string; attendantUserId: string; accountId: string;
  reason: string; templateName: string; dedupeKey: string; attempts: number;
};

export async function createHandoffDelivery(input: { conversationId: string; attendantUserId: string;
  accountId: string; reason: string; dedupeKey: string }): Promise<string> {
  await ensureNotificationDeliverySchema();
  const sql = getDatabase();
  const templateName = process.env.ZERNIO_HANDOFF_TEMPLATE_NAME ?? HANDOFF_TEMPLATE_NAME;
  const reason = input.reason.replace(/\s+/g, " ").trim().slice(0, 300);
  const rows = await sql`INSERT INTO notification_outbox (channel, notification_type, severity,
      title, body, dedupe_key, payload, recipient_user_id, conversation_id, template_name)
    VALUES ('whatsapp', 'handoff_requested', 'info', 'Novo atendimento', ${reason},
      ${input.dedupeKey}, ${JSON.stringify({ conversationId: input.conversationId,
        accountId: input.accountId })}::jsonb, ${input.attendantUserId}, ${input.conversationId}, ${templateName})
    ON CONFLICT (channel, dedupe_key) DO UPDATE SET last_seen_at=now(), updated_at=now()
    RETURNING id` as Array<{ id: string }>;
  if (!rows[0]) throw new Error("Notification delivery could not be created");
  return rows[0].id;
}

export async function reserveWhatsAppDelivery(notificationId: string): Promise<WhatsAppDelivery | undefined> {
  await ensureNotificationDeliverySchema();
  const sql = getDatabase();
  const rows = await sql`WITH reserved AS (
      UPDATE notification_outbox SET status='pending', attempts=attempts + 1, updated_at=now()
      WHERE id=${notificationId} AND channel='whatsapp' AND status IN ('pending','failed')
      RETURNING id, conversation_id, recipient_user_id, payload, body, template_name, dedupe_key, attempts
    ), attempt AS (
      INSERT INTO notification_delivery_attempts (notification_id, attempt_number, outcome)
      SELECT id, attempts, 'pending' FROM reserved
      ON CONFLICT (notification_id, attempt_number) DO NOTHING
    ) SELECT id, conversation_id, recipient_user_id, payload->>'accountId' account_id,
        body, template_name, dedupe_key, attempts FROM reserved` as Array<{
      id: string; conversation_id: string | null; recipient_user_id: string | null; account_id: string | null;
      body: string; template_name: string | null; dedupe_key: string; attempts: number }>;
  const row = rows[0];
  if (!row?.conversation_id || !row.recipient_user_id || !row.account_id || !row.template_name) return undefined;
  return { id: row.id, conversationId: row.conversation_id, attendantUserId: row.recipient_user_id,
    accountId: row.account_id, reason: row.body, templateName: row.template_name,
    dedupeKey: row.dedupe_key, attempts: Number(row.attempts) };
}

export async function finishWhatsAppDelivery(input: { notificationId: string; attempt: number;
  outcome: "sent" | "failed" | "suppressed"; errorCode?: string }): Promise<void> {
  await ensureNotificationDeliverySchema();
  const sql = getDatabase();
  const errorCode = input.errorCode?.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 80) ?? null;
  await sql.transaction((tx) => [
    tx`UPDATE notification_delivery_attempts SET outcome=${input.outcome}, error_code=${errorCode},
        finished_at=now() WHERE notification_id=${input.notificationId} AND attempt_number=${input.attempt}`,
    tx`UPDATE notification_outbox SET status=${input.outcome === "sent" ? "sent"
        : input.outcome === "suppressed" ? "suppressed" : "failed"},
        sent_at=CASE WHEN ${input.outcome}='sent' THEN now() ELSE sent_at END,
        last_error_code=${errorCode}, updated_at=now() WHERE id=${input.notificationId}`,
  ]);
}

export async function cancelConversationDeliveries(conversationId: string, reason: string): Promise<void> {
  await ensureNotificationDeliverySchema();
  const sql = getDatabase();
  await sql`UPDATE notification_outbox SET status='cancelled', cancelled_at=now(),
    resolution_reason=${reason.slice(0, 80)}, updated_at=now()
    WHERE channel='whatsapp' AND conversation_id=${conversationId} AND status IN ('pending','failed')`;
}

export type NotifierHealth = { lastSentAt?: Date; lastFailedAt?: Date; lastErrorCode?: string };
export async function getNotifierHealth(userId: string): Promise<NotifierHealth> {
  await ensureNotificationDeliverySchema();
  const sql = getDatabase();
  const rows = await sql`SELECT
      max(updated_at) FILTER (WHERE status='sent') last_sent_at,
      max(updated_at) FILTER (WHERE status='failed') last_failed_at,
      (array_agg(last_error_code ORDER BY updated_at DESC)
        FILTER (WHERE status='failed' AND last_error_code IS NOT NULL))[1] last_error_code
    FROM notification_outbox WHERE channel='whatsapp' AND recipient_user_id=${userId}` as Array<{
      last_sent_at: Date | null; last_failed_at: Date | null; last_error_code: string | null }>;
  const row = rows[0];
  return { ...(row?.last_sent_at ? { lastSentAt: new Date(row.last_sent_at) } : {}),
    ...(row?.last_failed_at ? { lastFailedAt: new Date(row.last_failed_at) } : {}),
    ...(row?.last_error_code ? { lastErrorCode: row.last_error_code } : {}) };
}

export async function beginNotificationTest(input: { userId: string; accountId: string }): Promise<{
  notificationId: string; attempt: number;
}> {
  await ensureNotificationDeliverySchema();
  const sql = getDatabase();
  const recent = await sql`SELECT id FROM notification_outbox
    WHERE channel='whatsapp' AND notification_type='notification_test'
      AND recipient_user_id=${input.userId} AND created_at > now() - interval '10 minutes'
    LIMIT 1` as Array<{ id: string }>;
  if (recent[0]) throw new Error("Notification test rate limited");
  const rows = await sql`WITH created AS (
      INSERT INTO notification_outbox (channel, notification_type, severity, title, body,
        dedupe_key, payload, recipient_user_id, template_name, attempts)
      VALUES ('whatsapp', 'notification_test', 'info', 'Teste de notificação',
        'Teste solicitado pelo atendente', ${`notification-test:${input.userId}:${Date.now()}`},
        ${JSON.stringify({ accountId: input.accountId })}::jsonb, ${input.userId},
        ${process.env.ZERNIO_HANDOFF_TEMPLATE_NAME ?? HANDOFF_TEMPLATE_NAME}, 1)
      RETURNING id
    ), attempt AS (
      INSERT INTO notification_delivery_attempts (notification_id, attempt_number, outcome)
      SELECT id, 1, 'pending' FROM created RETURNING notification_id
    ) SELECT id FROM created` as Array<{ id: string }>;
  if (!rows[0]) throw new Error("Notification test could not be created");
  return { notificationId: rows[0].id, attempt: 1 };
}
