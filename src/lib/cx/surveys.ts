import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { getDatabase } from "@/lib/db/neon";
import { isFeatureEnabled } from "@/lib/feature-flags/repository";
import { ensureCxSchema } from "./schema";

export type SurveyDelivery = { id: string; conversationId: string; accountId: string; providerConversationId: string };
const fraction = (value: string) => Number.parseInt(createHash("sha256").update(value).digest("hex").slice(0, 8), 16) / 0xffffffff;

export async function scheduleCxSurvey(conversationId: string): Promise<{ surveyId: string; availableAt: Date } | undefined> {
  if (!await isFeatureEnabled("cx_surveys")) return undefined;
  await ensureCxSchema(); const sql = getDatabase();
  const settings = await sql`SELECT enabled, sample_rate, delay_minutes, expires_hours
    FROM cx_survey_settings WHERE id='default'` as Array<{
      enabled: boolean; sample_rate: string | number; delay_minutes: number; expires_hours: number }>;
  const setting = settings[0]; const sampleRate = Number(setting?.sample_rate ?? 0);
  if (!setting?.enabled || sampleRate <= 0 || fraction(conversationId) >= sampleRate) return undefined;
  const availableAt = new Date(Date.now() + Number(setting.delay_minutes) * 60000);
  const expiresAt = new Date(availableAt.getTime() + Number(setting.expires_hours) * 3600000);
  const tokenHash = createHash("sha256").update(randomUUID()).digest("hex");
  const rows = await sql`INSERT INTO cx_surveys (conversation_id, contact_id, token_hash, sampled, available_at, expires_at)
    SELECT id, contact_id, ${tokenHash}, true, ${availableAt}, ${expiresAt} FROM conversations WHERE id=${conversationId}
    ON CONFLICT (conversation_id) DO NOTHING RETURNING id` as Array<{ id: string }>;
  return rows[0] ? { surveyId: rows[0].id, availableAt } : undefined;
}

export async function reserveSurveyDelivery(surveyId: string): Promise<SurveyDelivery | undefined> {
  await ensureCxSchema(); const sql = getDatabase();
  const rows = await sql`SELECT s.id, s.conversation_id, c.provider_account_id, c.provider_conversation_id
    FROM cx_surveys s JOIN conversations c ON c.id=s.conversation_id
    WHERE s.id=${surveyId} AND s.status='pending' AND s.available_at <= now() AND s.expires_at > now()
      AND c.provider_account_id IS NOT NULL AND c.provider_conversation_id IS NOT NULL LIMIT 1` as Array<{
      id: string; conversation_id: string; provider_account_id: string; provider_conversation_id: string }>;
  const row = rows[0]; return row ? { id: row.id, conversationId: row.conversation_id,
    accountId: row.provider_account_id, providerConversationId: row.provider_conversation_id } : undefined;
}

export async function markSurveySent(surveyId: string): Promise<void> {
  await ensureCxSchema(); const sql = getDatabase();
  await sql`WITH changed AS (UPDATE cx_surveys SET status='sent', sent_at=now(), updated_at=now()
      WHERE id=${surveyId} AND status='pending' RETURNING conversation_id)
    INSERT INTO conversation_events (conversation_id, event_type, idempotency_key)
      SELECT conversation_id, 'survey_sent', 'survey-sent:' || ${surveyId} FROM changed
      ON CONFLICT (idempotency_key) DO NOTHING`;
}

export async function captureSurveyScore(phoneNumber: string, content: string): Promise<boolean> {
  const normalized = content.trim(); if (!/^(?:10|[0-9])$/.test(normalized)) return false;
  await ensureCxSchema(); const sql = getDatabase(); const score = Number(normalized);
  const rows = await sql`WITH candidate AS (
      SELECT s.id, s.conversation_id FROM cx_surveys s JOIN contacts ct ON ct.id=s.contact_id
      WHERE ct.phone_number=${phoneNumber} AND s.status='sent' AND s.expires_at > now()
      ORDER BY s.sent_at DESC LIMIT 1 FOR UPDATE
    ), response AS (
      INSERT INTO cx_survey_responses (survey_id, score) SELECT id, ${score} FROM candidate
      ON CONFLICT (survey_id) DO NOTHING RETURNING survey_id
    ), changed AS (
      UPDATE cx_surveys SET status='answered', answered_at=now(), updated_at=now()
      WHERE id IN (SELECT survey_id FROM response) RETURNING conversation_id
    ) INSERT INTO conversation_events (conversation_id, event_type, metadata, idempotency_key)
      SELECT conversation_id, 'survey_answered', jsonb_build_object('scoreBand',
        CASE WHEN ${score} <= 6 THEN 'detractor' WHEN ${score} <= 8 THEN 'passive' ELSE 'promoter' END),
        'survey-answered:' || conversation_id::text FROM changed
      ON CONFLICT (idempotency_key) DO NOTHING RETURNING conversation_id` as Array<{ conversation_id: string }>;
  return Boolean(rows[0]);
}

export async function scheduleCxSurveyBestEffort(conversationId: string): Promise<void> {
  try { const survey = await scheduleCxSurvey(conversationId);
    if (survey) { const { enqueueCxSurvey } = await import("./survey-queue");
      await enqueueCxSurvey(survey.surveyId, survey.availableAt); }
  } catch (error) { console.warn("CX survey could not be scheduled", { error: error instanceof Error ? error.name : "UnknownError" }); }
}
