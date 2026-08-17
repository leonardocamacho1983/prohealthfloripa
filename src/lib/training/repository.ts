import { getDatabase } from "@/lib/db/neon";
import { ensureConversationRuntimeSchema } from "@/lib/conversations/neon-repository";

export type TrainingProfile = { id: string; displayName: string };
export type TrainingItemInput = {
  profileId: string; inboundMessageId: string; summary: string;
  itemType: "commercial_fact" | "tone" | "faq" | "correction" | "workflow" | "unknown";
  needsClarification: boolean; clarificationQuestion?: string; riskFlags: string[];
  sourceKind: "text" | "audio";
};

let schemaPromise: Promise<void> | undefined;
export function ensureTrainingSchema(): Promise<void> {
  if (!schemaPromise) {
    const sql = getDatabase();
    schemaPromise = ensureConversationRuntimeSchema().then(() => sql.transaction((tx) => [
      tx`CREATE TABLE IF NOT EXISTS training_profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE, provider_account_id text NOT NULL, display_name text NOT NULL DEFAULT 'Treinador', active boolean NOT NULL DEFAULT true, enrolled_by text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(contact_id, provider_account_id))`,
      tx`CREATE TABLE IF NOT EXISTS training_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), profile_id uuid NOT NULL REFERENCES training_profiles(id) ON DELETE CASCADE, status text NOT NULL DEFAULT 'collecting' CHECK(status IN ('collecting','pending_review','approved','rejected','cancelled')), submitted_at timestamptz, review_due_at timestamptz, reviewed_at timestamptz, reviewed_by text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`,
      tx`CREATE UNIQUE INDEX IF NOT EXISTS training_one_collecting_session ON training_sessions(profile_id) WHERE status='collecting'`,
      tx`CREATE TABLE IF NOT EXISTS training_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE, inbound_message_id uuid NOT NULL REFERENCES messages(id) ON DELETE RESTRICT, sequence_number integer NOT NULL, item_type text NOT NULL CHECK(item_type IN ('commercial_fact','tone','faq','correction','workflow','unknown')), summary text NOT NULL, needs_clarification boolean NOT NULL DEFAULT false, clarification_question text, risk_flags jsonb NOT NULL DEFAULT '[]'::jsonb, source_kind text NOT NULL CHECK(source_kind IN ('text','audio')), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(inbound_message_id), UNIQUE(session_id, sequence_number))`,
    ]).then(() => undefined)).catch((error) => { schemaPromise = undefined; throw error; });
  }
  return schemaPromise;
}

export class TrainingRepository {
  async listSessions() {
    await ensureTrainingSchema(); const sql = getDatabase();
    const rows = await sql`SELECT s.id, s.status, s.created_at, s.submitted_at, s.review_due_at,
      p.display_name, i.sequence_number, i.item_type, i.summary, i.needs_clarification,
      i.clarification_question, i.risk_flags, i.source_kind
      FROM training_sessions s JOIN training_profiles p ON p.id=s.profile_id
      LEFT JOIN training_items i ON i.session_id=s.id
      ORDER BY s.created_at DESC, i.sequence_number ASC` as Array<{
        id: string; status: string; created_at: Date; submitted_at: Date | null; review_due_at: Date | null;
        display_name: string; sequence_number: number | null; item_type: string | null; summary: string | null;
        needs_clarification: boolean | null; clarification_question: string | null; risk_flags: unknown;
        source_kind: string | null;
      }>;
    const sessions = new Map<string, { id: string; status: string; trainer: string; createdAt: Date;
      submittedAt?: Date; reviewDueAt?: Date; items: Array<{ sequence: number; type: string; summary: string;
        needsClarification: boolean; clarificationQuestion?: string; sourceKind: string; riskFlags: string[] }> }>();
    for (const row of rows) {
      const session = sessions.get(row.id) ?? { id: row.id, status: row.status, trainer: row.display_name,
        createdAt: new Date(row.created_at), ...(row.submitted_at ? { submittedAt: new Date(row.submitted_at) } : {}),
        ...(row.review_due_at ? { reviewDueAt: new Date(row.review_due_at) } : {}), items: [] };
      if (row.sequence_number !== null && row.summary && row.item_type && row.source_kind) {
        session.items.push({ sequence: row.sequence_number, type: row.item_type, summary: row.summary,
          needsClarification: Boolean(row.needs_clarification),
          ...(row.clarification_question ? { clarificationQuestion: row.clarification_question } : {}),
          sourceKind: row.source_kind, riskFlags: Array.isArray(row.risk_flags)
            ? row.risk_flags.filter((value): value is string => typeof value === "string") : [] });
      }
      sessions.set(row.id, session);
    }
    return [...sessions.values()];
  }

  async findProfile(phoneNumber: string, accountId: string): Promise<TrainingProfile | undefined> {
    await ensureTrainingSchema(); const sql = getDatabase();
    const rows = (await sql`SELECT tp.id, tp.display_name FROM training_profiles tp
      JOIN contacts c ON c.id=tp.contact_id
      WHERE c.phone_number=${phoneNumber} AND tp.provider_account_id=${accountId} AND tp.active=true LIMIT 1`) as Array<{ id: string; display_name: string }>;
    return rows[0] ? { id: rows[0].id, displayName: rows[0].display_name } : undefined;
  }

  async enrollConversation(conversationId: string, displayName: string, enrolledBy: string) {
    await ensureTrainingSchema(); const sql = getDatabase();
    const rows = await sql`INSERT INTO training_profiles(contact_id, provider_account_id, display_name, enrolled_by)
      SELECT contact_id, provider_account_id, ${displayName}, ${enrolledBy} FROM conversations
      WHERE id=${conversationId} AND provider_account_id IS NOT NULL
      ON CONFLICT(contact_id, provider_account_id) DO UPDATE SET active=true, display_name=EXCLUDED.display_name, enrolled_by=EXCLUDED.enrolled_by, updated_at=now()
      RETURNING id` as Array<{ id: string }>;
    if (!rows[0]) throw new Error("Conversation unavailable for trainer enrollment");
    return rows[0];
  }

  async addItem(input: TrainingItemInput): Promise<{ sequence: number; inserted: boolean }> {
    await ensureTrainingSchema(); const sql = getDatabase();
    const results = await sql.transaction((tx) => [
      tx`INSERT INTO training_sessions(profile_id) VALUES (${input.profileId})
        ON CONFLICT(profile_id) WHERE status='collecting' DO NOTHING`,
      tx`SELECT id FROM training_sessions WHERE profile_id=${input.profileId} AND status='collecting' FOR UPDATE`,
      tx`INSERT INTO training_items(session_id, inbound_message_id, sequence_number, item_type, summary, needs_clarification, clarification_question, risk_flags, source_kind)
        SELECT s.id, ${input.inboundMessageId}, COALESCE((SELECT max(sequence_number)+1 FROM training_items WHERE session_id=s.id),1), ${input.itemType}, ${input.summary}, ${input.needsClarification}, ${input.clarificationQuestion ?? null}, ${JSON.stringify(input.riskFlags)}::jsonb, ${input.sourceKind}
        FROM training_sessions s WHERE s.profile_id=${input.profileId} AND s.status='collecting'
        ON CONFLICT(inbound_message_id) DO NOTHING RETURNING sequence_number`,
      tx`SELECT sequence_number FROM training_items WHERE inbound_message_id=${input.inboundMessageId}`,
    ]);
    const inserted = results[2] as Array<{ sequence_number: number }>;
    const existing = results[3] as Array<{ sequence_number: number }>;
    const row = inserted[0] ?? existing[0];
    if (!row) throw new Error("Training item could not be persisted");
    return { sequence: Number(row.sequence_number), inserted: inserted.length > 0 };
  }

  async submit(profileId: string): Promise<{ count: number; alreadySubmitted: boolean }> {
    await ensureTrainingSchema(); const sql = getDatabase();
    const rows = (await sql`UPDATE training_sessions s SET status='pending_review', submitted_at=now(), review_due_at=now()+interval '8 hours', updated_at=now()
      WHERE profile_id=${profileId} AND status='collecting'
      RETURNING (SELECT count(*)::int FROM training_items i WHERE i.session_id=s.id) item_count`) as Array<{ item_count: number }>;
    if (rows[0]) return { count: rows[0].item_count, alreadySubmitted: false };
    return { count: 0, alreadySubmitted: true };
  }

  async recordOutbound(conversationId: string, content: string, idempotencyKey: string) {
    const sql = getDatabase();
    await sql`WITH inserted AS (INSERT INTO messages(conversation_id,direction,role,content,idempotency_key,delivery_status,sent_at)
      VALUES(${conversationId},'outbound','assistant',${content},${idempotencyKey},'sent',now())
      ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING conversation_id)
      UPDATE conversations SET last_message_at=now(),updated_at=now() WHERE id IN (SELECT conversation_id FROM inserted)`;
  }
}
