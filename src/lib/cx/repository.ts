import "server-only";
import { getDatabase } from "@/lib/db/neon";
import { ensureCxSchema } from "./schema";

export async function getCxSettings() {
  await ensureCxSchema(); const sql = getDatabase();
  const rows = await sql`SELECT enabled, sample_rate, delay_minutes, expires_hours
    FROM cx_survey_settings WHERE id='default'` as Array<{
      enabled: boolean; sample_rate: string | number; delay_minutes: number; expires_hours: number }>;
  const row = rows[0]; return { enabled: row?.enabled ?? false, sampleRate: Number(row?.sample_rate ?? 0),
    delayMinutes: Number(row?.delay_minutes ?? 5), expiresHours: Number(row?.expires_hours ?? 72) };
}
export async function updateCxSettings(input: { enabled: boolean; sampleRate: number; delayMinutes: number;
  expiresHours: number; actorUserId: string }): Promise<void> {
  await ensureCxSchema();
  if (input.sampleRate < 0 || input.sampleRate > 1 || input.delayMinutes < 0 || input.delayMinutes > 10080
      || input.expiresHours < 1 || input.expiresHours > 720) throw new Error("Invalid CX settings");
  const sql = getDatabase(); await sql`UPDATE cx_survey_settings SET enabled=${input.enabled},
    sample_rate=${input.sampleRate}, delay_minutes=${Math.trunc(input.delayMinutes)},
    expires_hours=${Math.trunc(input.expiresHours)}, updated_by_user_id=${input.actorUserId}, updated_at=now()
    WHERE id='default'`;
}
export async function getCxSnapshot() {
  await ensureCxSchema(); const sql = getDatabase();
  const rows = await sql`SELECT
      (SELECT count(*)::int FROM conversation_outcomes) outcomes,
      (SELECT count(*)::int FROM conversation_outcomes WHERE reopened_at IS NOT NULL) reopened,
      (SELECT count(*)::int FROM cx_surveys WHERE status='sent') pending_surveys,
      (SELECT count(*)::int FROM cx_surveys WHERE status='answered') answered_surveys,
      (SELECT avg(score)::numeric FROM cx_survey_responses) average_score` as Array<{
      outcomes: number; reopened: number; pending_surveys: number; answered_surveys: number; average_score: string | null }>;
  const row = rows[0]; return { outcomes: Number(row?.outcomes ?? 0), reopened: Number(row?.reopened ?? 0),
    pendingSurveys: Number(row?.pending_surveys ?? 0), answeredSurveys: Number(row?.answered_surveys ?? 0),
    averageScore: row?.average_score === null || row?.average_score === undefined ? undefined : Number(row.average_score) };
}
