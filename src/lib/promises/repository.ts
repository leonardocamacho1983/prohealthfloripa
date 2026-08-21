import "server-only";
import { randomUUID } from "node:crypto";
import { getDatabase } from "@/lib/db/neon";
import { ensureCxSchema } from "@/lib/cx/schema";

export type ConversationPromise = { id: string; conversationId: string; ownerUserId: string;
  description: string; dueAt: Date; status: "open" | "completed" | "cancelled"; createdAt: Date };

let schemaPromise: Promise<void> | undefined;
export function ensurePromiseSchema(): Promise<void> {
  if (!schemaPromise) schemaPromise = ensureCxSchema().then(async () => {
    const sql = getDatabase();
    await sql.transaction((tx) => [
      tx`CREATE TABLE IF NOT EXISTS conversation_promises (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        owner_user_id text NOT NULL, description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 3 AND 240),
        due_at timestamptz NOT NULL, status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed','cancelled')),
        source text NOT NULL DEFAULT 'human' CHECK (source IN ('human','automatic')), timer_token text NOT NULL,
        completion_reason text, completed_at timestamptz, cancelled_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`,
      tx`CREATE INDEX IF NOT EXISTS conversation_promises_open_due_idx ON conversation_promises(due_at) WHERE status='open'`,
      tx`CREATE TABLE IF NOT EXISTS promise_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), promise_id uuid NOT NULL REFERENCES conversation_promises(id) ON DELETE CASCADE,
        action text NOT NULL CHECK (action IN ('created','completed','cancelled','rescheduled')),
        actor_user_id text, reason text, due_at timestamptz, occurred_at timestamptz NOT NULL DEFAULT now())`,
    ]);
  }).catch((error) => { schemaPromise = undefined; throw error; });
  return schemaPromise;
}

const fromRow = (row: { id: string; conversation_id: string; owner_user_id: string; description: string;
  due_at: Date; status: "open" | "completed" | "cancelled"; created_at: Date }): ConversationPromise => ({
  id: row.id, conversationId: row.conversation_id, ownerUserId: row.owner_user_id,
  description: row.description, dueAt: new Date(row.due_at), status: row.status, createdAt: new Date(row.created_at),
});

export async function listConversationPromises(conversationId: string): Promise<ConversationPromise[]> {
  await ensurePromiseSchema(); const sql = getDatabase();
  const rows = await sql`SELECT id, conversation_id, owner_user_id, description, due_at, status, created_at
    FROM conversation_promises WHERE conversation_id=${conversationId}
    ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, due_at ASC` as Array<Parameters<typeof fromRow>[0]>;
  return rows.map(fromRow);
}

export async function createConversationPromise(input: { conversationId: string; actorUserId: string;
  description: string; dueAt: Date }): Promise<{ id: string; token: string }> {
  await ensurePromiseSchema();
  const description = input.description.replace(/\s+/g, " ").trim().slice(0, 240);
  if (description.length < 3 || !Number.isFinite(input.dueAt.getTime())
      || input.dueAt.getTime() <= Date.now() || input.dueAt.getTime() > Date.now() + 366 * 86400000) {
    throw new Error("Invalid promise");
  }
  const sql = getDatabase(); const token = randomUUID();
  const rows = await sql`WITH created AS (
      INSERT INTO conversation_promises (conversation_id, owner_user_id, description, due_at, timer_token)
      SELECT id, ${input.actorUserId}, ${description}, ${input.dueAt}, ${token}
      FROM conversations WHERE id=${input.conversationId} AND status='human_active'
        AND assigned_attendant_user_id=${input.actorUserId}
      RETURNING id, conversation_id, due_at
    ), promise_event AS (
      INSERT INTO promise_events (promise_id, action, actor_user_id, due_at)
      SELECT id, 'created', ${input.actorUserId}, due_at FROM created
    ) INSERT INTO conversation_events (conversation_id, event_type, actor_user_id, metadata, idempotency_key)
      SELECT conversation_id, 'promise_created', ${input.actorUserId}, jsonb_build_object('promiseId', id),
        'promise-created:' || id::text FROM created RETURNING metadata->>'promiseId' id` as Array<{ id: string }>;
  if (!rows[0]) throw new Error("Conversation is not owned by this attendant");
  return { id: rows[0].id, token };
}

export async function updateConversationPromise(input: { promiseId: string; actorUserId: string;
  action: "complete" | "cancel" | "reschedule"; reason?: string; dueAt?: Date }): Promise<{ token?: string; dueAt?: Date }> {
  await ensurePromiseSchema(); const sql = getDatabase();
  const reason = input.reason?.replace(/\s+/g, " ").trim().slice(0, 240);
  if ((input.action === "cancel" || input.action === "reschedule") && (!reason || reason.length < 3)) {
    throw new Error("Reason required");
  }
  if (input.action === "reschedule" && (!input.dueAt || input.dueAt.getTime() <= Date.now())) throw new Error("Invalid due date");
  const token = randomUUID();
  const nextStatus = input.action === "complete" ? "completed" : input.action === "cancel" ? "cancelled" : "open";
  const eventType = input.action === "complete" ? "promise_completed"
    : input.action === "cancel" ? "promise_cancelled" : "promise_rescheduled";
  const rows = await sql`WITH changed AS (
      UPDATE conversation_promises p SET status=${nextStatus},
        due_at=CASE WHEN ${input.action}='reschedule' THEN ${input.dueAt ?? null} ELSE due_at END,
        timer_token=${token}, completion_reason=${reason ?? null},
        completed_at=CASE WHEN ${input.action}='complete' THEN now() ELSE completed_at END,
        cancelled_at=CASE WHEN ${input.action}='cancel' THEN now() ELSE cancelled_at END, updated_at=now()
      FROM conversations c WHERE p.id=${input.promiseId} AND p.status='open'
        AND c.id=p.conversation_id AND (p.owner_user_id=${input.actorUserId}
          OR c.assigned_attendant_user_id=${input.actorUserId})
      RETURNING p.id, p.conversation_id, p.due_at
    ), promise_event AS (
      INSERT INTO promise_events (promise_id, action, actor_user_id, reason, due_at)
      SELECT id, ${input.action === "cancel" ? "cancelled" : input.action === "complete" ? "completed" : "rescheduled"},
        ${input.actorUserId}, ${reason ?? null}, due_at FROM changed
    ) INSERT INTO conversation_events (conversation_id, event_type, actor_user_id, internal_note, idempotency_key)
      SELECT conversation_id, ${eventType}, ${input.actorUserId}, ${reason ?? null},
        ${eventType} || ':' || id::text || ':' || ${token} FROM changed RETURNING conversation_id` as Array<{ conversation_id: string }>;
  if (!rows[0]) throw new Error("Promise changed");
  return input.action === "reschedule" && input.dueAt ? { token, dueAt: input.dueAt } : {};
}

export async function validatePromiseDeadline(input: { promiseId: string; token: string }): Promise<boolean> {
  await ensurePromiseSchema(); const sql = getDatabase();
  const rows = await sql`SELECT id FROM conversation_promises WHERE id=${input.promiseId}
    AND timer_token=${input.token} AND status='open' AND due_at <= now() LIMIT 1` as Array<{ id: string }>;
  return Boolean(rows[0]);
}
