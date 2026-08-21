import "server-only";
import { getDatabase } from "@/lib/db/neon";
import { ensureAttendantSchema, type AttendantProfile } from "./repository";
import { isAttendantOnDuty } from "./schedule";

let schemaPromise: Promise<void> | undefined;
export function ensureWorkforceSchema(): Promise<void> {
  if (!schemaPromise) schemaPromise = ensureAttendantSchema().then(async () => {
    const sql = getDatabase(); await sql.transaction((tx) => [
      tx`CREATE TABLE IF NOT EXISTS attendant_schedule_exceptions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), attendant_user_id text NOT NULL,
        starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
        kind text NOT NULL CHECK (kind IN ('unavailable','coverage')), reason text,
        created_by_user_id text, created_at timestamptz NOT NULL DEFAULT now(), CHECK (ends_at > starts_at))`,
      tx`CREATE INDEX IF NOT EXISTS attendant_schedule_exceptions_active_idx
        ON attendant_schedule_exceptions(attendant_user_id, starts_at, ends_at)`,
      tx`CREATE TABLE IF NOT EXISTS attendant_presence (
        attendant_user_id text PRIMARY KEY, state text NOT NULL CHECK (state IN ('available','paused','offline')),
        reason text, until_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now())`,
      tx`CREATE TABLE IF NOT EXISTS attendant_skills (
        attendant_user_id text NOT NULL, skill text NOT NULL, active boolean NOT NULL DEFAULT true,
        PRIMARY KEY (attendant_user_id, skill))`,
      tx`CREATE TABLE IF NOT EXISTS attendant_capacity_settings (
        attendant_user_id text PRIMARY KEY, max_active_conversations integer NOT NULL DEFAULT 5
          CHECK (max_active_conversations BETWEEN 1 AND 100), updated_at timestamptz NOT NULL DEFAULT now())`,
    ]);
  }).catch((error) => { schemaPromise = undefined; throw error; });
  return schemaPromise;
}

export type WorkforceState = { state: "available" | "paused" | "offline"; reason?: string; untilAt?: Date };
export type ScheduleException = { id: string; startsAt: Date; endsAt: Date;
  kind: "unavailable" | "coverage"; reason?: string };
export type WorkforceConfiguration = { state: WorkforceState; capacity: number; skills: string[];
  exceptions: ScheduleException[]; notificationTested: boolean };
export async function getWorkforceState(userId: string): Promise<WorkforceState> {
  await ensureWorkforceSchema(); const sql = getDatabase();
  const rows = await sql`SELECT state, reason, until_at FROM attendant_presence
    WHERE attendant_user_id=${userId} LIMIT 1` as Array<{
      state: WorkforceState["state"]; reason: string | null; until_at: Date | null }>;
  const row = rows[0];
  if (!row || (row.until_at && new Date(row.until_at).getTime() <= Date.now())) return { state: "available" };
  return { state: row.state, ...(row.reason ? { reason: row.reason } : {}),
    ...(row.until_at ? { untilAt: new Date(row.until_at) } : {}) };
}

export async function setWorkforceState(input: { userId: string; state: WorkforceState["state"];
  reason?: string; untilAt?: Date }): Promise<void> {
  await ensureWorkforceSchema(); const sql = getDatabase();
  await sql`INSERT INTO attendant_presence (attendant_user_id, state, reason, until_at)
    VALUES (${input.userId}, ${input.state}, ${input.reason?.trim().slice(0, 120) ?? null}, ${input.untilAt ?? null})
    ON CONFLICT (attendant_user_id) DO UPDATE SET state=EXCLUDED.state, reason=EXCLUDED.reason,
      until_at=EXCLUDED.until_at, updated_at=now()`;
}

export async function getWorkforceConfiguration(userId: string): Promise<WorkforceConfiguration> {
  await ensureWorkforceSchema(); const sql = getDatabase();
  const results = await Promise.all([
    getWorkforceState(userId),
    sql`SELECT max_active_conversations FROM attendant_capacity_settings
      WHERE attendant_user_id=${userId}`,
    sql`SELECT skill FROM attendant_skills WHERE attendant_user_id=${userId} AND active=true
      ORDER BY skill`,
    sql`SELECT id, starts_at, ends_at, kind, reason FROM attendant_schedule_exceptions
      WHERE attendant_user_id=${userId} AND ends_at > now() - interval '30 days'
      ORDER BY starts_at`,
    sql`SELECT EXISTS (SELECT 1 FROM notification_outbox WHERE recipient_user_id=${userId}
      AND notification_type='notification_test' AND status='sent') tested`,
  ]);
  const [state, capacityRows, skillRows, exceptionRows, testRows] = results as unknown as [
    WorkforceState, Array<{ max_active_conversations: number }>, Array<{ skill: string }>,
    Array<{ id: string; starts_at: Date; ends_at: Date; kind: ScheduleException["kind"]; reason: string | null }>,
    Array<{ tested: boolean }>,
  ];
  return { state, capacity: Number(capacityRows[0]?.max_active_conversations ?? 5),
    skills: skillRows.map((row) => row.skill), notificationTested: testRows[0]?.tested === true,
    exceptions: exceptionRows.map((row) => ({ id: row.id, startsAt: new Date(row.starts_at),
      endsAt: new Date(row.ends_at), kind: row.kind, ...(row.reason ? { reason: row.reason } : {}) })) };
}

export async function saveWorkforceConfiguration(input: { userId: string; capacity: number;
  skills: readonly string[] }): Promise<void> {
  await ensureWorkforceSchema(); const sql = getDatabase();
  const capacity = Math.min(100, Math.max(1, Math.floor(input.capacity)));
  const skills = [...new Set(input.skills.map((skill) => skill.trim().toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_").slice(0, 50)).filter(Boolean))].slice(0, 30);
  await sql.transaction((tx) => [
    tx`INSERT INTO attendant_capacity_settings (attendant_user_id, max_active_conversations)
      VALUES (${input.userId}, ${capacity}) ON CONFLICT (attendant_user_id) DO UPDATE SET
        max_active_conversations=EXCLUDED.max_active_conversations, updated_at=now()`,
    tx`UPDATE attendant_skills SET active=false WHERE attendant_user_id=${input.userId}`,
    ...skills.map((skill) => tx`INSERT INTO attendant_skills (attendant_user_id, skill, active)
      VALUES (${input.userId}, ${skill}, true) ON CONFLICT (attendant_user_id, skill)
      DO UPDATE SET active=true`),
  ]);
}

export async function addScheduleException(input: { userId: string; startsAt: Date; endsAt: Date;
  kind: ScheduleException["kind"]; reason?: string; actorUserId: string }): Promise<void> {
  if (!Number.isFinite(input.startsAt.getTime()) || !Number.isFinite(input.endsAt.getTime())
    || input.endsAt <= input.startsAt) throw new Error("Invalid schedule exception");
  await ensureWorkforceSchema(); const sql = getDatabase();
  await sql`INSERT INTO attendant_schedule_exceptions
    (attendant_user_id, starts_at, ends_at, kind, reason, created_by_user_id)
    VALUES (${input.userId}, ${input.startsAt}, ${input.endsAt}, ${input.kind},
      ${input.reason?.trim().slice(0, 200) ?? null}, ${input.actorUserId})`;
}

export async function deleteScheduleException(input: { id: string; userId: string }): Promise<boolean> {
  await ensureWorkforceSchema(); const sql = getDatabase();
  const rows = await sql`DELETE FROM attendant_schedule_exceptions
    WHERE id=${input.id} AND attendant_user_id=${input.userId} RETURNING id` as Array<{ id: string }>;
  return Boolean(rows[0]);
}

export async function filterAssignableProfiles(profiles: readonly AttendantProfile[], now = new Date(),
  requiredSkill?: string): Promise<AttendantProfile[]> {
  await ensureWorkforceSchema(); const sql = getDatabase();
  const ids = profiles.map((profile) => profile.userId);
  if (ids.length === 0) return [];
  const rows = await sql`SELECT p.clerk_user_id,
      COALESCE(pr.state, 'available') presence_state, pr.until_at,
      COALESCE(cap.max_active_conversations, 5) capacity,
      (SELECT count(*)::int FROM conversations c WHERE c.assigned_attendant_user_id=p.clerk_user_id
        AND c.status='human_active') active_count,
      EXISTS (SELECT 1 FROM attendant_schedule_exceptions e WHERE e.attendant_user_id=p.clerk_user_id
        AND e.kind='unavailable' AND ${now} >= e.starts_at AND ${now} < e.ends_at) unavailable,
      EXISTS (SELECT 1 FROM attendant_schedule_exceptions e WHERE e.attendant_user_id=p.clerk_user_id
        AND e.kind='coverage' AND ${now} >= e.starts_at AND ${now} < e.ends_at) coverage
      , EXISTS (SELECT 1 FROM notification_outbox n WHERE n.recipient_user_id=p.clerk_user_id
        AND n.notification_type='notification_test' AND n.status='sent') notification_tested
      , (${requiredSkill ?? null}::text IS NULL OR EXISTS (SELECT 1 FROM attendant_skills s
        WHERE s.attendant_user_id=p.clerk_user_id AND s.skill=${requiredSkill ?? null} AND s.active=true)) skill_match
    FROM attendant_profiles p LEFT JOIN attendant_presence pr ON pr.attendant_user_id=p.clerk_user_id
    LEFT JOIN attendant_capacity_settings cap ON cap.attendant_user_id=p.clerk_user_id
    WHERE p.clerk_user_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))` as Array<{
      clerk_user_id: string; presence_state: WorkforceState["state"]; until_at: Date | null;
      capacity: number; active_count: number; unavailable: boolean; coverage: boolean;
      notification_tested: boolean; skill_match: boolean }>;
  const state = new Map(rows.map((row) => [row.clerk_user_id, row]));
  return profiles.filter((profile) => { const row = state.get(profile.userId); if (!row) return false;
    const presenceActive = !row.until_at || new Date(row.until_at).getTime() > now.getTime();
    const available = !presenceActive || row.presence_state === "available";
    const scheduled = row.coverage || isAttendantOnDuty(profile.weeklySchedule, now, profile.timezone);
    return available && !row.unavailable && scheduled && row.notification_tested && row.skill_match
      && Number(row.active_count) < Number(row.capacity);
  });
}
