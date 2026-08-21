import "server-only";

import { randomUUID } from "node:crypto";

import { getDatabase } from "@/lib/db/neon";
import { DEFAULT_CONVERSATION_REASONS, type ReasonCategory } from "./catalog";

export type ConversationReason = {
  id: string;
  category: ReasonCategory;
  label: string;
  active: boolean;
  systemDefault: boolean;
  sortOrder: number;
};

let schemaPromise: Promise<void> | undefined;

export function ensureReasonSchema(): Promise<void> {
  if (!schemaPromise) {
    const sql = getDatabase();
    schemaPromise = sql.transaction((tx) => [
      tx`CREATE TABLE IF NOT EXISTS conversation_reason_catalog (
        id text PRIMARY KEY,
        category text NOT NULL CHECK (category IN ('handoff','human_closure','automatic_closure')),
        label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 2 AND 120),
        active boolean NOT NULL DEFAULT true,
        system_default boolean NOT NULL DEFAULT false,
        sort_order integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now())`,
      tx`CREATE INDEX IF NOT EXISTS conversation_reason_catalog_category_active_idx
        ON conversation_reason_catalog(category, active, sort_order, label)`,
      ...DEFAULT_CONVERSATION_REASONS.map((reason) => tx`INSERT INTO conversation_reason_catalog
        (id, category, label, active, system_default, sort_order)
        VALUES (${reason.id}, ${reason.category}, ${reason.label}, true, true, ${reason.sortOrder})
        ON CONFLICT (id) DO NOTHING`),
      tx`ALTER TABLE conversations
        ADD COLUMN IF NOT EXISTS handoff_reason_id text REFERENCES conversation_reason_catalog(id),
        ADD COLUMN IF NOT EXISTS closure_reason_id text REFERENCES conversation_reason_catalog(id),
        ADD COLUMN IF NOT EXISTS closure_note text,
        ADD COLUMN IF NOT EXISTS closure_origin text,
        ADD COLUMN IF NOT EXISTS closed_by_user_id text,
        ADD COLUMN IF NOT EXISTS reopened_from_conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS last_human_actor_user_id text,
        ADD COLUMN IF NOT EXISTS last_human_actor_label text,
        ADD COLUMN IF NOT EXISTS awaiting_customer_since timestamptz,
        ADD COLUMN IF NOT EXISTS inactivity_token text,
        ADD COLUMN IF NOT EXISTS assigned_attendant_user_id text,
        ADD COLUMN IF NOT EXISTS assigned_attendant_at timestamptz`,
      tx`ALTER TABLE messages ADD COLUMN IF NOT EXISTS actor_user_id text,
        ADD COLUMN IF NOT EXISTS actor_label text`,
      tx`CREATE TABLE IF NOT EXISTS conversation_views (
        conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        viewer_user_id text NOT NULL,
        last_viewed_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (conversation_id, viewer_user_id))`,
      tx`CREATE INDEX IF NOT EXISTS conversation_views_viewer_idx
        ON conversation_views(viewer_user_id, last_viewed_at DESC)`,
      tx`CREATE TABLE IF NOT EXISTS conversation_operation_settings (
        id text PRIMARY KEY CHECK (id='default'),
        automatic_inactivity_enabled boolean NOT NULL DEFAULT false,
        customer_inactivity_minutes integer NOT NULL DEFAULT 60
          CHECK (customer_inactivity_minutes BETWEEN 5 AND 10080),
        updated_by_user_id text,
        updated_at timestamptz NOT NULL DEFAULT now())`,
      tx`INSERT INTO conversation_operation_settings (id) VALUES ('default') ON CONFLICT (id) DO NOTHING`,
    ]).then(() => undefined).catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }
  return schemaPromise;
}

function fromRow(row: {
  id: string; category: ReasonCategory; label: string; active: boolean;
  system_default: boolean; sort_order: number;
}): ConversationReason {
  return { id: row.id, category: row.category, label: row.label, active: row.active,
    systemDefault: row.system_default, sortOrder: row.sort_order };
}

export async function listConversationReasons(input?: {
  category?: ReasonCategory;
  activeOnly?: boolean;
}): Promise<ConversationReason[]> {
  await ensureReasonSchema();
  const sql = getDatabase();
  const category = input?.category ?? null;
  const activeOnly = input?.activeOnly ?? false;
  const rows = await sql`SELECT id, category, label, active, system_default, sort_order
    FROM conversation_reason_catalog
    WHERE (${category}::text IS NULL OR category=${category})
      AND (${activeOnly}=false OR active=true)
    ORDER BY category, sort_order, label` as Array<Parameters<typeof fromRow>[0]>;
  return rows.map(fromRow);
}

export async function findActiveConversationReason(category: ReasonCategory, id: string): Promise<ConversationReason | undefined> {
  await ensureReasonSchema();
  const sql = getDatabase();
  const result = await sql`SELECT id, category, label, active, system_default, sort_order
    FROM conversation_reason_catalog WHERE id=${id} AND category=${category} AND active=true LIMIT 1`;
  const rows = result as Array<Parameters<typeof fromRow>[0]>;
  return rows[0] ? fromRow(rows[0]) : undefined;
}

export async function createConversationReason(input: {
  category: ReasonCategory;
  label: string;
}): Promise<string> {
  await ensureReasonSchema();
  const label = input.label.trim().replace(/\s+/g, " ").slice(0, 120);
  if (label.length < 2) throw new Error("Invalid reason label");
  const id = `custom_${randomUUID().replaceAll("-", "")}`;
  const sql = getDatabase();
  const rows = await sql`SELECT COALESCE(max(sort_order), 0) + 10 next_order
    FROM conversation_reason_catalog WHERE category=${input.category}` as Array<{ next_order: number | string }>;
  await sql`INSERT INTO conversation_reason_catalog (id, category, label, sort_order)
    VALUES (${id}, ${input.category}, ${label}, ${Number(rows[0]?.next_order ?? 10)})`;
  return id;
}

export async function updateConversationReason(input: {
  id: string;
  label: string;
  active: boolean;
}): Promise<boolean> {
  await ensureReasonSchema();
  const label = input.label.trim().replace(/\s+/g, " ").slice(0, 120);
  if (label.length < 2) throw new Error("Invalid reason label");
  const sql = getDatabase();
  const rows = await sql`UPDATE conversation_reason_catalog SET label=${label}, active=${input.active}, updated_at=now()
    WHERE id=${input.id} RETURNING id` as Array<{ id: string }>;
  return Boolean(rows[0]);
}

export type ConversationOperationSettings = {
  automaticInactivityEnabled: boolean;
  customerInactivityMinutes: number;
};

export async function getConversationOperationSettings(): Promise<ConversationOperationSettings> {
  await ensureReasonSchema();
  const sql = getDatabase();
  const rows = await sql`SELECT automatic_inactivity_enabled, customer_inactivity_minutes
    FROM conversation_operation_settings WHERE id='default' LIMIT 1` as Array<{
      automatic_inactivity_enabled: boolean; customer_inactivity_minutes: number;
    }>;
  return {
    automaticInactivityEnabled: rows[0]?.automatic_inactivity_enabled ?? false,
    customerInactivityMinutes: Number(rows[0]?.customer_inactivity_minutes ?? 60),
  };
}

export async function updateConversationOperationSettings(input: {
  automaticInactivityEnabled: boolean;
  customerInactivityMinutes: number;
  actorUserId: string;
}): Promise<void> {
  await ensureReasonSchema();
  const minutes = Math.trunc(input.customerInactivityMinutes);
  if (minutes < 5 || minutes > 10080) throw new Error("Invalid inactivity interval");
  const sql = getDatabase();
  await sql`UPDATE conversation_operation_settings SET
    automatic_inactivity_enabled=${input.automaticInactivityEnabled},
    customer_inactivity_minutes=${minutes}, updated_by_user_id=${input.actorUserId}, updated_at=now()
    WHERE id='default'`;
}
