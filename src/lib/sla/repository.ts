import "server-only";

import { randomUUID } from "node:crypto";
import { getDatabase } from "@/lib/db/neon";
import { defaultWeeklySchedule, normalizeWeeklySchedule } from "@/lib/attendants/schedule";
import { ensureConversationWorkflowSchema } from "@/lib/conversations/workflow-schema";
import { addBusinessMinutes, type BusinessCalendar } from "./calendar";

let schemaPromise: Promise<void> | undefined;
export function ensureSlaSchema(): Promise<void> {
  if (!schemaPromise) schemaPromise = ensureConversationWorkflowSchema().then(async () => {
    const sql = getDatabase();
    await sql.transaction((tx) => [
      tx`CREATE TABLE IF NOT EXISTS business_calendar_settings (
        id text PRIMARY KEY CHECK (id='default'), timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
        weekly_schedule jsonb NOT NULL, holidays jsonb NOT NULL DEFAULT '[]'::jsonb,
        updated_by_user_id text, updated_at timestamptz NOT NULL DEFAULT now())`,
      tx`INSERT INTO business_calendar_settings (id, weekly_schedule)
        VALUES ('default', ${JSON.stringify(defaultWeeklySchedule())}::jsonb) ON CONFLICT (id) DO NOTHING`,
      tx`CREATE TABLE IF NOT EXISTS sla_policies (
        id text PRIMARY KEY, label text NOT NULL, reason_category text,
        priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high','urgent')),
        deadline_type text NOT NULL CHECK (deadline_type IN ('first_response','resolution')),
        target_business_minutes integer NOT NULL CHECK (target_business_minutes BETWEEN 1 AND 10080),
        warning_business_minutes integer NOT NULL CHECK (warning_business_minutes >= 0),
        active boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now())`,
      tx`INSERT INTO sla_policies (id, label, deadline_type, target_business_minutes, warning_business_minutes)
        VALUES ('human_first_response_default', 'Primeira resposta humana', 'first_response', 15, 5)
        ON CONFLICT (id) DO NOTHING`,
      tx`CREATE TABLE IF NOT EXISTS conversation_sla (
        conversation_id uuid PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
        policy_id text NOT NULL REFERENCES sla_policies(id),
        status text NOT NULL DEFAULT 'normal' CHECK (status IN ('normal','warning','breached','paused','completed')),
        response_due_at timestamptz, resolution_due_at timestamptz, timer_token text NOT NULL,
        warning_emitted_at timestamptz, breached_at timestamptz, paused_at timestamptz,
        completed_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now())`,
      tx`CREATE INDEX IF NOT EXISTS conversation_sla_status_due_idx ON conversation_sla(status, response_due_at)
        WHERE status IN ('normal','warning','breached')`,
      tx`CREATE TABLE IF NOT EXISTS sla_pause_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        action text NOT NULL CHECK (action IN ('paused','resumed')), reason text NOT NULL,
        actor_user_id text, occurred_at timestamptz NOT NULL DEFAULT now())`,
    ]);
  }).catch((error) => { schemaPromise = undefined; throw error; });
  return schemaPromise;
}

async function loadSlaConfiguration(): Promise<{ calendar: BusinessCalendar; target: number; warning: number }> {
  await ensureSlaSchema();
  const sql = getDatabase();
  const [calendarRows, policyRows] = await Promise.all([
    sql`SELECT timezone, weekly_schedule, holidays FROM business_calendar_settings WHERE id='default'`,
    sql`SELECT target_business_minutes, warning_business_minutes FROM sla_policies
      WHERE id='human_first_response_default' AND active=true LIMIT 1`,
  ]) as [Array<{ timezone: string; weekly_schedule: unknown; holidays: unknown }>,
    Array<{ target_business_minutes: number; warning_business_minutes: number }>];
  const calendarRow = calendarRows[0]; const policy = policyRows[0];
  const holidays = Array.isArray(calendarRow?.holidays)
    ? calendarRow.holidays.filter((value): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value))
    : [];
  return { calendar: { timezone: calendarRow?.timezone ?? "America/Sao_Paulo",
      weeklySchedule: normalizeWeeklySchedule(calendarRow?.weekly_schedule), holidays },
    target: Number(policy?.target_business_minutes ?? 15), warning: Number(policy?.warning_business_minutes ?? 5) };
}

export async function startConversationSla(conversationId: string, startedAt = new Date()): Promise<{
  token: string; warningAt: Date; dueAt: Date;
}> {
  const { calendar, target, warning } = await loadSlaConfiguration();
  const token = randomUUID();
  const dueAt = addBusinessMinutes(startedAt, target, calendar);
  const warningAt = addBusinessMinutes(startedAt, Math.max(0, target - warning), calendar);
  const sql = getDatabase();
  await sql`INSERT INTO conversation_sla (conversation_id, policy_id, status, response_due_at, timer_token)
    VALUES (${conversationId}, 'human_first_response_default', 'normal', ${dueAt}, ${token})
    ON CONFLICT (conversation_id) DO UPDATE SET policy_id=EXCLUDED.policy_id, status='normal',
      response_due_at=EXCLUDED.response_due_at, timer_token=EXCLUDED.timer_token,
      warning_emitted_at=NULL, breached_at=NULL, paused_at=NULL, completed_at=NULL, updated_at=now()`;
  return { token, warningAt, dueAt };
}

export async function completeConversationSla(conversationId: string): Promise<void> {
  await ensureSlaSchema(); const sql = getDatabase();
  await sql`UPDATE conversation_sla SET status='completed', timer_token=${randomUUID()},
    completed_at=now(), updated_at=now() WHERE conversation_id=${conversationId}
      AND status IN ('normal','warning','breached','paused')`;
}

export async function applySlaDeadline(input: { conversationId: string; token: string;
  kind: "warning" | "breach" }): Promise<boolean> {
  await ensureSlaSchema(); const sql = getDatabase();
  const eventType = input.kind === "warning" ? "sla_warning" : "sla_breached";
  const rows = await sql`WITH changed AS (
      UPDATE conversation_sla SET status=${input.kind === "warning" ? "warning" : "breached"},
        warning_emitted_at=CASE WHEN ${input.kind}='warning' THEN now() ELSE warning_emitted_at END,
        breached_at=CASE WHEN ${input.kind}='breach' THEN now() ELSE breached_at END, updated_at=now()
      WHERE conversation_id=${input.conversationId} AND timer_token=${input.token}
        AND status IN (${input.kind === "warning" ? "normal" : "normal"}, ${input.kind === "warning" ? "warning" : "warning"})
        AND (${input.kind === "warning"} OR response_due_at <= now())
      RETURNING conversation_id
    ) INSERT INTO conversation_events (conversation_id, event_type, metadata, idempotency_key)
      SELECT conversation_id, ${eventType}, jsonb_build_object('deadlineType','first_response'),
        ${`sla:${input.kind}:${input.conversationId}:${input.token}`} FROM changed
      ON CONFLICT (idempotency_key) DO NOTHING RETURNING conversation_id` as Array<{ conversation_id: string }>;
  return Boolean(rows[0]);
}
