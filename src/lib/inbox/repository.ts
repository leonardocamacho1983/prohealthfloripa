import { getDatabase } from "@/lib/db/neon";
import type { RelationshipStatus } from "@/lib/conversations/types";

export type InboxInternalNote = {
  id: string;
  authorLabel: string;
  content: string;
  createdAt: Date;
};

export type InboxQuickReply = {
  id: string;
  shortcut: string;
  label: string;
  content: string;
};

export type InboxCustomerPanel = {
  relationshipStatus: RelationshipStatus;
  customerSince?: string;
  financialStatus?: string;
  lastVisitAt?: Date;
  nextVisitAt?: Date;
  syncedAt?: Date;
  activeServices: string[];
  recentServices: string[];
  notes: InboxInternalNote[];
};

let inboxSchemaPromise: Promise<void> | undefined;

function ensureInboxProductivitySchema(): Promise<void> {
  if (!inboxSchemaPromise) {
    const sql = getDatabase();
    inboxSchemaPromise = sql.transaction((tx) => [
      tx`CREATE TABLE IF NOT EXISTS inbox_internal_notes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        author_label text NOT NULL DEFAULT 'Equipe',
        content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 1000),
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
      tx`CREATE INDEX IF NOT EXISTS inbox_internal_notes_conversation_created_idx
        ON inbox_internal_notes(conversation_id, created_at DESC)`,
      tx`CREATE TABLE IF NOT EXISTS inbox_quick_replies (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        shortcut text NOT NULL UNIQUE,
        label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
        content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 1500),
        sort_order integer NOT NULL DEFAULT 0,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      tx`INSERT INTO inbox_quick_replies (shortcut, label, content, sort_order)
        VALUES
          ('saudacao', 'Saudação', 'Olá! Como posso ajudar você hoje?', 10),
          ('confirmacao', 'Vou confirmar', 'Só um instante, por favor. Vou confirmar essa informação para você.', 20),
          ('encerramento', 'Encerramento', 'Obrigada pelo contato! Se precisar de algo mais, estou por aqui.', 30)
        ON CONFLICT (shortcut) DO NOTHING`,
    ]).then(() => undefined).catch((error) => {
      inboxSchemaPromise = undefined;
      throw error;
    });
  }
  return inboxSchemaPromise;
}

const asDate = (value: Date | string | null): Date | undefined => value ? new Date(value) : undefined;

function recordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];
}

function serviceNames(value: unknown): string[] {
  return recordArray(value).flatMap((item) => typeof item.name === "string" ? [item.name] : []).slice(0, 6);
}

function consumedServiceNames(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const services = (value as Record<string, unknown>).services;
  return Array.isArray(services)
    ? services.filter((item): item is string => typeof item === "string").slice(0, 6)
    : [];
}

export async function getInboxPhoneSearchIndex(limit = 100): Promise<Map<string, string>> {
  const sql = getDatabase();
  const rows = await sql`SELECT c.id conversation_id, ct.phone_number
    FROM conversations c JOIN contacts ct ON ct.id=c.contact_id
    ORDER BY c.last_message_at DESC LIMIT ${limit}` as Array<{ conversation_id: string; phone_number: string }>;
  return new Map(rows.map((row) => [row.conversation_id, row.phone_number]));
}

export async function listInboxQuickReplies(): Promise<InboxQuickReply[]> {
  await ensureInboxProductivitySchema();
  const sql = getDatabase();
  const rows = await sql`SELECT id, shortcut, label, content FROM inbox_quick_replies
    WHERE active=true ORDER BY sort_order ASC, label ASC` as Array<InboxQuickReply>;
  return rows;
}

export async function listInboxInternalNotes(conversationId: string): Promise<InboxInternalNote[]> {
  await ensureInboxProductivitySchema();
  const sql = getDatabase();
  const rows = await sql`SELECT id, author_label, content, created_at FROM inbox_internal_notes
    WHERE conversation_id=${conversationId} ORDER BY created_at DESC LIMIT 30` as Array<{
      id: string;
      author_label: string;
      content: string;
      created_at: Date | string;
    }>;
  return rows.map((row) => ({ id: row.id, authorLabel: row.author_label,
    content: row.content, createdAt: new Date(row.created_at) }));
}

export async function getInboxCustomerPanel(conversationId: string): Promise<InboxCustomerPanel | undefined> {
  const sql = getDatabase();
  const [rows, notes] = await Promise.all([
    sql`SELECT ct.relationship_status, cp.customer_since, cp.financial_status, cp.last_visit_at,
      cp.next_visit_at, cp.active_contracts, cp.consumed_services_summary, cp.synced_at
      FROM conversations c
      JOIN contacts ct ON ct.id=c.contact_id
      LEFT JOIN customer_profiles cp ON cp.contact_id=ct.id
      WHERE c.id=${conversationId} LIMIT 1`,
    listInboxInternalNotes(conversationId),
  ]);
  const row = rows[0] as {
    relationship_status: RelationshipStatus;
    customer_since: string | null;
    financial_status: string | null;
    last_visit_at: Date | string | null;
    next_visit_at: Date | string | null;
    active_contracts: unknown;
    consumed_services_summary: unknown;
    synced_at: Date | string | null;
  } | undefined;
  if (!row) return undefined;
  return {
    relationshipStatus: row.relationship_status,
    ...(row.customer_since ? { customerSince: row.customer_since } : {}),
    ...(row.financial_status ? { financialStatus: row.financial_status } : {}),
    ...(asDate(row.last_visit_at) ? { lastVisitAt: asDate(row.last_visit_at) } : {}),
    ...(asDate(row.next_visit_at) ? { nextVisitAt: asDate(row.next_visit_at) } : {}),
    ...(asDate(row.synced_at) ? { syncedAt: asDate(row.synced_at) } : {}),
    activeServices: serviceNames(row.active_contracts),
    recentServices: consumedServiceNames(row.consumed_services_summary),
    notes,
  };
}

export async function createInboxInternalNote(input: {
  conversationId: string;
  authorLabel: string;
  content: string;
}): Promise<void> {
  await ensureInboxProductivitySchema();
  const sql = getDatabase();
  await sql`INSERT INTO inbox_internal_notes (conversation_id, author_label, content)
    VALUES (${input.conversationId}, ${input.authorLabel.trim().slice(0, 80) || "Equipe"}, ${input.content.trim()})`;
}

export async function updateInboxQuickReply(input: {
  id: string;
  label: string;
  content: string;
}): Promise<boolean> {
  await ensureInboxProductivitySchema();
  const sql = getDatabase();
  const rows = await sql`UPDATE inbox_quick_replies SET label=${input.label.trim()}, content=${input.content.trim()},
    updated_at=now() WHERE id=${input.id} AND active=true RETURNING id` as Array<{ id: string }>;
  return Boolean(rows[0]);
}
