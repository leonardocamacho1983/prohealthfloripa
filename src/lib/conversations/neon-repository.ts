import { getDatabase } from "@/lib/db/neon";
import type { ConversationIdentity, ConversationMessage, ConversationRepository, CustomerProfile, CustomerProfileStore, RelationshipStatus } from "./types";
import type { ConversationStatus } from "./types";
import type { HandoffConversation, HandoffSource, HandoffStore } from "../handoff/types";

type IdentityRow = { contact_id: string; conversation_id: string; first_name: string | null; relationship_status: RelationshipStatus; conversation_status: ConversationStatus; human_expires_at: Date | null; inserted: boolean };
type ProfileRow = { customer_since: string | null; date_of_birth: string | null; financial_status: string | null; last_visit_at: Date | null; next_visit_at: Date | null; active_contracts: unknown | null; consumed_services_summary: unknown | null; attendance_metrics: unknown | null; relationship_metrics: unknown | null; synced_at: Date | null };

let handoffSchemaPromise: Promise<void> | undefined;
function ensureHandoffSchema(): Promise<void> {
  if (!handoffSchemaPromise) {
    const sql = getDatabase();
    handoffSchemaPromise = sql.transaction((tx) => [
      tx`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS provider_account_id text,
        ADD COLUMN IF NOT EXISTS provider_conversation_id text, ADD COLUMN IF NOT EXISTS handoff_reason text,
        ADD COLUMN IF NOT EXISTS handoff_source text, ADD COLUMN IF NOT EXISTS handoff_requested_at timestamptz,
        ADD COLUMN IF NOT EXISTS human_started_at timestamptz, ADD COLUMN IF NOT EXISTS human_expires_at timestamptz,
        ADD COLUMN IF NOT EXISTS closed_at timestamptz`,
      tx`DROP INDEX IF EXISTS conversations_one_active_per_contact`,
      tx`CREATE UNIQUE INDEX IF NOT EXISTS conversations_one_open_per_contact ON conversations(contact_id)
        WHERE status IN ('active','human_requested','human_active')`,
      tx`CREATE INDEX IF NOT EXISTS conversations_handoff_queue_idx ON conversations(status, handoff_requested_at DESC)
        WHERE status IN ('human_requested','human_active')`,
    ]).then(() => undefined).catch((error) => { handoffSchemaPromise = undefined; throw error; });
  }
  return handoffSchemaPromise;
}

export class NeonConversationRepository implements ConversationRepository, CustomerProfileStore, HandoffStore {
  async recordInbound(input: { phoneNumber: string; providerMessageId: string; content: string; providerAccountId?: string; providerConversationId?: string }) {
    await ensureHandoffSchema();
    const sql = getDatabase();
    await sql`UPDATE conversations SET status='active', human_expires_at=NULL, updated_at=now()
      WHERE contact_id IN (SELECT id FROM contacts WHERE phone_number=${input.phoneNumber})
        AND status IN ('human_requested','human_active') AND human_expires_at <= now()`;
    const rows = await sql`
      WITH contact AS (
        INSERT INTO contacts (phone_number) VALUES (${input.phoneNumber})
        ON CONFLICT (phone_number) DO UPDATE SET updated_at=now()
        RETURNING id, first_name, relationship_status
      ), existing_conversation AS (
        SELECT id, contact_id, status, human_expires_at FROM conversations
        WHERE contact_id=(SELECT id FROM contact) AND status IN ('active','human_requested','human_active') LIMIT 1
      ), inserted_conversation AS (
        INSERT INTO conversations (contact_id)
        SELECT id FROM contact WHERE NOT EXISTS (SELECT 1 FROM existing_conversation)
        RETURNING id, contact_id, status, human_expires_at
      ), conversation AS (
        SELECT * FROM existing_conversation UNION ALL SELECT * FROM inserted_conversation
      ), inbound AS (
        INSERT INTO messages (conversation_id, provider_message_id, direction, role, content)
        SELECT id, ${input.providerMessageId}, 'inbound', 'user', ${input.content} FROM conversation
        ON CONFLICT (provider_message_id) WHERE provider_message_id IS NOT NULL DO NOTHING
        RETURNING conversation_id
      ), touched AS (
        UPDATE conversations SET last_message_at=now(), updated_at=now(),
          provider_account_id=COALESCE(${input.providerAccountId ?? null}, provider_account_id),
          provider_conversation_id=COALESCE(${input.providerConversationId ?? null}, provider_conversation_id),
          human_expires_at=CASE WHEN status IN ('human_requested','human_active') THEN now() + interval '1 hour' ELSE human_expires_at END
        WHERE id IN (SELECT conversation_id FROM inbound)
      )
      SELECT contact.id contact_id, conversation.id conversation_id, contact.first_name,
             contact.relationship_status, conversation.status conversation_status,
             conversation.human_expires_at, EXISTS(SELECT 1 FROM inbound) inserted
      FROM contact CROSS JOIN conversation
    ` as IdentityRow[];
    const row = rows[0];
    if (!row) throw new Error("Failed to establish conversation identity");
    return { inserted: row.inserted, conversationStatus: row.conversation_status,
      ...(row.human_expires_at ? { humanExpiresAt: new Date(row.human_expires_at) } : {}), identity: {
      contactId: row.contact_id, conversationId: row.conversation_id,
      relationshipStatus: row.relationship_status, ...(row.first_name ? { firstName: row.first_name } : {}),
    }};
  }

  async getConversationState(conversationId: string) {
    await ensureHandoffSchema();
    const sql = getDatabase();
    const rows = await sql`UPDATE conversations SET status='active', human_expires_at=NULL, updated_at=now()
      WHERE id=${conversationId} AND status IN ('human_requested','human_active') AND human_expires_at <= now()
      RETURNING status, human_expires_at` as Array<{ status: ConversationStatus; human_expires_at: Date | null }>;
    const current = rows[0] ?? (await sql`SELECT status, human_expires_at FROM conversations WHERE id=${conversationId} LIMIT 1` as Array<{ status: ConversationStatus; human_expires_at: Date | null }>)[0];
    if (!current) throw new Error("Conversation not found");
    return { status: current.status, ...(current.human_expires_at ? { expiresAt: new Date(current.human_expires_at) } : {}) };
  }

  async requestHandoff(input: { conversationId: string; providerAccountId: string; providerConversationId: string;
    reason: string; source: HandoffSource; summary: string; now?: Date }) {
    await ensureHandoffSchema(); const sql = getDatabase(); const now = input.now ?? new Date();
    await sql`UPDATE conversations SET status='human_requested', provider_account_id=${input.providerAccountId},
      provider_conversation_id=${input.providerConversationId}, handoff_reason=${input.reason}, handoff_source=${input.source},
      handoff_requested_at=COALESCE(handoff_requested_at, ${now}), human_expires_at=${new Date(now.getTime() + 3_600_000)},
      summary=${input.summary}, updated_at=now() WHERE id=${input.conversationId}`;
  }

  async listHandoffs(): Promise<HandoffConversation[]> {
    await ensureHandoffSchema(); const sql = getDatabase();
    await sql`UPDATE conversations SET status='active', human_expires_at=NULL, updated_at=now()
      WHERE status IN ('human_requested','human_active') AND human_expires_at <= now()`;
    const rows = await sql`SELECT c.id, c.contact_id, ct.first_name, ct.phone_number, c.status, c.handoff_reason,
      c.handoff_source, c.summary, c.handoff_requested_at, c.human_expires_at, c.provider_account_id, c.provider_conversation_id
      FROM conversations c JOIN contacts ct ON ct.id=c.contact_id
      WHERE c.status IN ('human_requested','human_active') ORDER BY c.handoff_requested_at ASC` as Array<{
        id: string; contact_id: string; first_name: string | null; phone_number: string; status: "human_requested" | "human_active";
        handoff_reason: string | null; handoff_source: HandoffSource | null; summary: string | null; handoff_requested_at: Date | null;
        human_expires_at: Date | null; provider_account_id: string | null; provider_conversation_id: string | null;
      }>;
    return Promise.all(rows.map(async (row) => ({ id: row.id, contactId: row.contact_id,
      ...(row.first_name ? { firstName: row.first_name } : {}), maskedPhone: maskPhone(row.phone_number), status: row.status,
      reason: row.handoff_reason ?? "Atendimento humano solicitado.", source: row.handoff_source ?? "customer",
      summary: row.summary ?? "Resumo indisponível.", requestedAt: new Date(row.handoff_requested_at ?? new Date()),
      expiresAt: new Date(row.human_expires_at ?? new Date()), providerAccountId: row.provider_account_id ?? "",
      providerConversationId: row.provider_conversation_id ?? "", messages: await this.getRecentMessages(row.id, 30) })));
  }

  async takeHandoff(conversationId: string) {
    await ensureHandoffSchema(); const sql = getDatabase();
    await sql`UPDATE conversations SET status='human_active', human_started_at=COALESCE(human_started_at, now()),
      human_expires_at=now() + interval '1 hour', updated_at=now() WHERE id=${conversationId} AND status='human_requested'`;
  }

  async touchHandoff(conversationId: string) {
    await ensureHandoffSchema(); const sql = getDatabase();
    await sql`UPDATE conversations SET human_expires_at=now() + interval '1 hour', last_message_at=now(), updated_at=now()
      WHERE id=${conversationId} AND status IN ('human_requested','human_active')`;
  }

  async closeHandoff(conversationId: string) {
    await ensureHandoffSchema(); const sql = getDatabase();
    await sql`UPDATE conversations SET status='closed', closed_at=now(), human_expires_at=NULL, updated_at=now()
      WHERE id=${conversationId} AND status IN ('human_requested','human_active')`;
  }

  async recordOutbound(input: { conversationId: string; content: string }) {
    const sql = getDatabase();
    await sql`WITH outbound AS (
      INSERT INTO messages (conversation_id, direction, role, content)
      VALUES (${input.conversationId}, 'outbound', 'assistant', ${input.content})
    ) UPDATE conversations SET last_message_at=now(), updated_at=now() WHERE id=${input.conversationId}`;
  }

  async getRecentMessages(conversationId: string, limit: number) {
    const sql = getDatabase();
    const rows = await sql`
      SELECT * FROM (
        SELECT id, conversation_id, provider_message_id, direction, role, content, created_at
        FROM messages WHERE conversation_id=${conversationId}
        ORDER BY created_at DESC, id DESC LIMIT ${limit}
      ) recent ORDER BY created_at ASC, id ASC
    ` as Array<{ id: string; conversation_id: string; provider_message_id: string | null; direction: "inbound" | "outbound"; role: "user" | "assistant" | "system"; content: string; created_at: Date }>;
    return rows.map((row): ConversationMessage => ({
      id: row.id, conversationId: row.conversation_id, direction: row.direction, role: row.role,
      content: row.content, createdAt: new Date(row.created_at),
      ...(row.provider_message_id ? { providerMessageId: row.provider_message_id } : {}),
    }));
  }

  async getCustomerProfile(contactId: string): Promise<CustomerProfile | undefined> {
    const sql = getDatabase();
    const rows = await sql`SELECT customer_since, date_of_birth, financial_status, last_visit_at, next_visit_at,
      active_contracts, consumed_services_summary, attendance_metrics, relationship_metrics, synced_at
      FROM customer_profiles WHERE contact_id=${contactId} LIMIT 1`;
    const row = rows[0] as ProfileRow | undefined;
    if (!row) return undefined;
    return {
      ...(row.customer_since ? { customerSince: row.customer_since } : {}),
      ...(row.date_of_birth ? { dateOfBirth: row.date_of_birth } : {}),
      ...(row.financial_status ? { financialStatus: row.financial_status } : {}),
      ...(row.last_visit_at ? { lastVisitAt: new Date(row.last_visit_at).toISOString() } : {}),
      ...(row.next_visit_at ? { nextVisitAt: new Date(row.next_visit_at).toISOString() } : {}),
      ...(row.active_contracts ? { activeContracts: row.active_contracts } : {}),
      ...(row.consumed_services_summary ? { consumedServicesSummary: row.consumed_services_summary } : {}),
      ...(row.attendance_metrics ? { attendanceMetrics: row.attendance_metrics } : {}),
      ...(row.relationship_metrics ? { relationshipMetrics: row.relationship_metrics } : {}),
      ...(row.synced_at ? { syncedAt: new Date(row.synced_at).toISOString() } : {}),
    };
  }

  async getProfileSyncState(contactId: string) {
    const sql = getDatabase();
    const rows = await sql`SELECT external_customer_id, synced_at, relationship_metrics->>'snapshotVersion' snapshot_version
      FROM customer_profiles WHERE contact_id=${contactId} LIMIT 1` as Array<{ external_customer_id: string | null; synced_at: Date | null; snapshot_version: string | null }>;
    const row = rows[0];
    if (!row) return {};
    return {
      ...(row.synced_at ? { syncedAt: new Date(row.synced_at).toISOString() } : {}),
      ...(row.external_customer_id ? { externalCustomerId: row.external_customer_id } : {}),
      ...(row.snapshot_version ? { snapshotVersion: Number(row.snapshot_version) } : {}),
    };
  }

  async saveCustomerSnapshot(input: { contactId: string; firstName?: string; relationshipStatus: RelationshipStatus; profile: CustomerProfile & { externalCustomerId?: string; source: "nextfit" } }): Promise<ConversationIdentity> {
    const sql = getDatabase();
    const p = input.profile;
    const rows = await sql.transaction((tx) => [
      tx`UPDATE contacts SET first_name=COALESCE(${input.firstName ?? null}, first_name), relationship_status=${input.relationshipStatus}, updated_at=now()
         WHERE id=${input.contactId} RETURNING id, first_name, relationship_status`,
      tx`INSERT INTO customer_profiles (contact_id, external_customer_id, source, customer_since, date_of_birth,
           financial_status, last_visit_at, next_visit_at, active_contracts, consumed_services_summary,
           attendance_metrics, relationship_metrics, synced_at)
         VALUES (${input.contactId}, ${p.externalCustomerId ?? null}, ${p.source}, ${p.customerSince ?? null},
           ${p.dateOfBirth ?? null}, ${p.financialStatus ?? null}, ${p.lastVisitAt ?? null}, ${p.nextVisitAt ?? null},
           ${p.activeContracts ? JSON.stringify(p.activeContracts) : null}::jsonb,
           ${p.consumedServicesSummary ? JSON.stringify(p.consumedServicesSummary) : null}::jsonb,
           ${p.attendanceMetrics ? JSON.stringify(p.attendanceMetrics) : null}::jsonb,
           ${p.relationshipMetrics ? JSON.stringify(p.relationshipMetrics) : null}::jsonb,
           ${p.syncedAt ?? null})
         ON CONFLICT (contact_id) DO UPDATE SET external_customer_id=EXCLUDED.external_customer_id, source=EXCLUDED.source,
           customer_since=EXCLUDED.customer_since, date_of_birth=EXCLUDED.date_of_birth,
           financial_status=EXCLUDED.financial_status, last_visit_at=EXCLUDED.last_visit_at,
           next_visit_at=EXCLUDED.next_visit_at, active_contracts=EXCLUDED.active_contracts,
           consumed_services_summary=EXCLUDED.consumed_services_summary, attendance_metrics=EXCLUDED.attendance_metrics,
           relationship_metrics=EXCLUDED.relationship_metrics, synced_at=EXCLUDED.synced_at, updated_at=now()`,
    ]);
    const contact = rows[0][0] as { id: string; first_name: string | null; relationship_status: RelationshipStatus };
    const conversation = await sql`SELECT id FROM conversations WHERE contact_id=${input.contactId} AND status='active' LIMIT 1` as Array<{ id: string }>;
    return { contactId: contact.id, conversationId: conversation[0]!.id, relationshipStatus: contact.relationship_status,
      ...(contact.first_name ? { firstName: contact.first_name } : {}) };
  }
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 4 ? `••••••${digits.slice(-4)}` : "••••";
}
