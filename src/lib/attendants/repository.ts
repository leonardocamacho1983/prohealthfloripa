import "server-only";

import { clerkClient } from "@clerk/nextjs/server";
import { getDatabase } from "@/lib/db/neon";
import { parseAppRole } from "@/lib/auth/permissions";
import { normalizeBrazilianPhoneNumber } from "@/lib/conversations/phone";
import { ensureConversationWorkflowSchema } from "@/lib/conversations/workflow-schema";
import { isFeatureEnabled } from "@/lib/feature-flags/repository";
import {
  ATTENDANT_TIMEZONE,
  activeShiftKeyAt,
  defaultWeeklySchedule,
  isAttendantOnDuty,
  normalizeWeeklySchedule,
  type WeeklySchedule,
} from "./schedule";

export type AttendantProfile = {
  userId: string;
  displayName: string;
  notificationPhone?: string;
  notificationEnabled: boolean;
  timezone: string;
  weeklySchedule: WeeklySchedule;
  lastAssignmentAt?: Date;
};

export type PendingHandoffDigestItem = {
  conversationId: string;
  firstName?: string;
  reason: string;
  requestedAt: Date;
  providerAccountId: string;
};

let schemaPromise: Promise<void> | undefined;

export function ensureAttendantSchema(): Promise<void> {
  if (!schemaPromise) {
    const sql = getDatabase();
    schemaPromise = sql.transaction((tx) => [
      tx`ALTER TABLE conversations
        ADD COLUMN IF NOT EXISTS assigned_attendant_user_id text,
        ADD COLUMN IF NOT EXISTS assigned_attendant_at timestamptz`,
      tx`CREATE INDEX IF NOT EXISTS conversations_assigned_attendant_queue_idx
        ON conversations(assigned_attendant_user_id, handoff_requested_at ASC)
        WHERE status='human_requested'`,
      tx`CREATE TABLE IF NOT EXISTS attendant_profiles (
        clerk_user_id text PRIMARY KEY,
        display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 120),
        notification_phone_e164 text,
        notification_enabled boolean NOT NULL DEFAULT false,
        timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
        weekly_schedule jsonb NOT NULL DEFAULT '{}'::jsonb,
        last_assignment_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CHECK (notification_phone_e164 IS NULL OR notification_phone_e164 ~ '^\\+[1-9][0-9]{7,14}$'),
        CHECK (notification_enabled=false OR notification_phone_e164 IS NOT NULL))`,
      tx`CREATE INDEX IF NOT EXISTS attendant_profiles_notifications_idx
        ON attendant_profiles(notification_enabled, last_assignment_at ASC NULLS FIRST)
        WHERE notification_enabled=true`,
      tx`CREATE TABLE IF NOT EXISTS attendant_shift_digests (
        attendant_user_id text NOT NULL REFERENCES attendant_profiles(clerk_user_id) ON DELETE CASCADE,
        shift_key text NOT NULL,
        status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
        pending_count integer NOT NULL DEFAULT 0 CHECK (pending_count >= 0),
        attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        sent_at timestamptz,
        last_error_code text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (attendant_user_id, shift_key))`,
    ]).then(() => undefined).catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }
  return schemaPromise;
}

function profileFromRow(row: {
  clerk_user_id: string;
  display_name: string;
  notification_phone_e164: string | null;
  notification_enabled: boolean;
  timezone: string;
  weekly_schedule: unknown;
  last_assignment_at: Date | string | null;
}): AttendantProfile {
  return {
    userId: row.clerk_user_id,
    displayName: row.display_name,
    ...(row.notification_phone_e164 ? { notificationPhone: row.notification_phone_e164 } : {}),
    notificationEnabled: row.notification_enabled,
    timezone: row.timezone,
    weeklySchedule: normalizeWeeklySchedule(row.weekly_schedule),
    ...(row.last_assignment_at ? { lastAssignmentAt: new Date(row.last_assignment_at) } : {}),
  };
}

export async function getAttendantProfile(input: {
  userId: string;
  displayName: string;
}): Promise<AttendantProfile> {
  await ensureAttendantSchema();
  const sql = getDatabase();
  const rows = await sql`SELECT clerk_user_id, display_name, notification_phone_e164,
    notification_enabled, timezone, weekly_schedule, last_assignment_at
    FROM attendant_profiles WHERE clerk_user_id=${input.userId} LIMIT 1` as Array<Parameters<typeof profileFromRow>[0]>;
  return rows[0] ? profileFromRow(rows[0]) : {
    userId: input.userId,
    displayName: input.displayName,
    notificationEnabled: false,
    timezone: ATTENDANT_TIMEZONE,
    weeklySchedule: defaultWeeklySchedule(),
  };
}

export async function saveAttendantProfile(input: {
  userId: string;
  displayName: string;
  notificationPhone?: string;
  notificationEnabled: boolean;
  weeklySchedule: WeeklySchedule;
}): Promise<void> {
  await ensureAttendantSchema();
  const sql = getDatabase();
  const phone = input.notificationPhone?.trim()
    ? normalizeBrazilianPhoneNumber(input.notificationPhone)
    : undefined;
  if (input.notificationEnabled && !phone) throw new Error("Notification phone is required");
  const schedule = normalizeWeeklySchedule(input.weeklySchedule);
  await sql`INSERT INTO attendant_profiles (
      clerk_user_id, display_name, notification_phone_e164, notification_enabled, timezone, weekly_schedule)
    VALUES (${input.userId}, ${input.displayName.trim().slice(0, 120) || "Atendimento"},
      ${phone ?? null}, ${input.notificationEnabled}, ${ATTENDANT_TIMEZONE}, ${JSON.stringify(schedule)}::jsonb)
    ON CONFLICT (clerk_user_id) DO UPDATE SET
      display_name=EXCLUDED.display_name,
      notification_phone_e164=EXCLUDED.notification_phone_e164,
      notification_enabled=EXCLUDED.notification_enabled,
      timezone=EXCLUDED.timezone,
      weekly_schedule=EXCLUDED.weekly_schedule,
      updated_at=now()`;
}

export async function listNotificationProfiles(): Promise<AttendantProfile[]> {
  await ensureAttendantSchema();
  const sql = getDatabase();
  const rows = await sql`SELECT clerk_user_id, display_name, notification_phone_e164,
    notification_enabled, timezone, weekly_schedule, last_assignment_at
    FROM attendant_profiles
    WHERE notification_enabled=true AND notification_phone_e164 IS NOT NULL
    ORDER BY last_assignment_at ASC NULLS FIRST, created_at ASC` as Array<Parameters<typeof profileFromRow>[0]>;
  const profiles = rows.map(profileFromRow);
  if (profiles.length === 0) return [];
  try {
    const users = await (await clerkClient()).users.getUserList({
      userId: profiles.map((profile) => profile.userId), limit: Math.min(100, profiles.length),
    });
    const activeIds = new Set(users.data.filter((user) => !user.banned && !user.locked
      && parseAppRole(user.publicMetadata.role) !== undefined).map((user) => user.id));
    return profiles.filter((profile) => activeIds.has(profile.userId));
  } catch {
    // Identity could not be confirmed; fail closed so an inactive account is never assigned.
    return [];
  }
}

export async function hasConfiguredNotificationProfile(): Promise<boolean> {
  const profiles = await listNotificationProfiles();
  return profiles.length > 0;
}

export async function assignOnDutyAttendant(conversationId: string, now = new Date()): Promise<AttendantProfile | undefined> {
  await ensureConversationWorkflowSchema();
  const profiles = await listNotificationProfiles();
  let selected: AttendantProfile | undefined;
  if (await isFeatureEnabled("workforce_routing")) {
    const { filterAssignableProfiles } = await import("./workforce");
    selected = (await filterAssignableProfiles(profiles, now))[0];
  } else {
    selected = profiles.find((profile) => isAttendantOnDuty(profile.weeklySchedule, now, profile.timezone));
  }
  if (!selected) return undefined;
  const sql = getDatabase();
  const rows = await sql`UPDATE conversations SET
      assigned_attendant_user_id=${selected.userId}, assigned_attendant_at=now(),
      assignment_version=assignment_version + 1, updated_at=now()
    WHERE id=${conversationId} AND status='human_requested'
      AND assigned_attendant_user_id IS NULL
    RETURNING id, assignment_version` as Array<{ id: string; assignment_version: number | string }>;
  if (!rows[0]) {
    const assigned = await sql`SELECT assigned_attendant_user_id FROM conversations
      WHERE id=${conversationId} AND status='human_requested' LIMIT 1` as Array<{ assigned_attendant_user_id: string | null }>;
    if (assigned[0]?.assigned_attendant_user_id !== selected.userId) return undefined;
  }
  if (rows[0]) await sql`INSERT INTO conversation_events (conversation_id, event_type, to_user_id,
      to_user_label, reason_id, idempotency_key)
    VALUES (${conversationId}, 'assigned', ${selected.userId}, ${selected.displayName},
      'customer_requested_human', ${`auto-assigned:${conversationId}:${rows[0].assignment_version}`})
    ON CONFLICT (idempotency_key) DO NOTHING`;
  await sql`UPDATE attendant_profiles SET last_assignment_at=now(), updated_at=now()
    WHERE clerk_user_id=${selected.userId}`;
  return selected;
}

export async function listProfilesWithActiveShift(now = new Date()): Promise<Array<AttendantProfile & { shiftKey: string }>> {
  const profiles = await listNotificationProfiles();
  return profiles.flatMap((profile) => {
    const shiftKey = activeShiftKeyAt(profile.weeklySchedule, now, profile.timezone);
    return shiftKey ? [{ ...profile, shiftKey }] : [];
  });
}

export async function claimAndListPendingHandoffs(userId: string, limit = 20): Promise<PendingHandoffDigestItem[]> {
  await Promise.all([ensureAttendantSchema(), ensureConversationWorkflowSchema()]);
  const sql = getDatabase();
  const claimLimit = Math.min(50, Math.max(1, limit));
  await sql`WITH candidates AS (
      SELECT id FROM conversations
      WHERE status='human_requested' AND assigned_attendant_user_id IS NULL
      ORDER BY handoff_requested_at ASC NULLS LAST, last_message_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${claimLimit}
    ), claimed AS (
      UPDATE conversations c SET assigned_attendant_user_id=${userId}, assigned_attendant_at=now(),
        assignment_version=assignment_version + 1, updated_at=now()
      FROM candidates WHERE c.id=candidates.id RETURNING c.id, c.assignment_version
    ) INSERT INTO conversation_events (conversation_id, event_type, to_user_id, to_user_label,
        reason_id, idempotency_key)
      SELECT claimed.id, 'assigned', ${userId}, ap.display_name, 'customer_requested_human',
        'shift-assigned:' || claimed.id::text || ':' || claimed.assignment_version::text
      FROM claimed LEFT JOIN attendant_profiles ap ON ap.clerk_user_id=${userId}
      ON CONFLICT (idempotency_key) DO NOTHING`;
  const rows = await sql`SELECT c.id, ct.first_name, c.handoff_reason, c.handoff_requested_at,
      c.provider_account_id
    FROM conversations c JOIN contacts ct ON ct.id=c.contact_id
    WHERE c.status='human_requested' AND c.assigned_attendant_user_id=${userId}
      AND c.provider_account_id IS NOT NULL
    ORDER BY c.handoff_requested_at ASC NULLS LAST, c.last_message_at ASC
    LIMIT ${claimLimit}` as Array<{
      id: string;
      first_name: string | null;
      handoff_reason: string | null;
      handoff_requested_at: Date | string | null;
      provider_account_id: string;
    }>;
  return rows.map((row) => ({
    conversationId: row.id,
    ...(row.first_name ? { firstName: row.first_name } : {}),
    reason: row.handoff_reason ?? "Atendimento humano solicitado.",
    requestedAt: new Date(row.handoff_requested_at ?? new Date()),
    providerAccountId: row.provider_account_id,
  }));
}

export async function reserveShiftDigest(input: {
  userId: string;
  shiftKey: string;
  pendingCount: number;
}): Promise<boolean> {
  const sql = getDatabase();
  const rows = await sql`INSERT INTO attendant_shift_digests (
      attendant_user_id, shift_key, status, pending_count, attempts)
    VALUES (${input.userId}, ${input.shiftKey}, 'pending', ${input.pendingCount}, 1)
    ON CONFLICT (attendant_user_id, shift_key) DO UPDATE SET
      status='pending', pending_count=EXCLUDED.pending_count,
      attempts=attendant_shift_digests.attempts + 1, last_error_code=NULL, updated_at=now()
    WHERE attendant_shift_digests.status='failed'
    RETURNING attendant_user_id` as Array<{ attendant_user_id: string }>;
  return Boolean(rows[0]);
}

export async function finishShiftDigest(input: {
  userId: string;
  shiftKey: string;
  success: boolean;
  errorCode?: string;
}): Promise<void> {
  const sql = getDatabase();
  await sql`UPDATE attendant_shift_digests SET
      status=${input.success ? "sent" : "failed"},
      sent_at=${input.success ? new Date() : null},
      last_error_code=${input.errorCode?.slice(0, 80) ?? null}, updated_at=now()
    WHERE attendant_user_id=${input.userId} AND shift_key=${input.shiftKey}`;
}

export async function latestWhatsAppAccountId(): Promise<string | undefined> {
  await ensureAttendantSchema();
  const sql = getDatabase();
  const rows = await sql`SELECT provider_account_id FROM conversations
    WHERE provider_account_id IS NOT NULL ORDER BY last_message_at DESC LIMIT 1` as Array<{ provider_account_id: string }>;
  return rows[0]?.provider_account_id;
}
