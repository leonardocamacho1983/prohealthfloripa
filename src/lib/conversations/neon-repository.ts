import { getDatabase } from "@/lib/db/neon";
import type { ConversationIdentity, ConversationMessage, ConversationRepository, CustomerProfile, CustomerProfileStore, RelationshipStatus } from "./types";

type IdentityRow = { contact_id: string; conversation_id: string; first_name: string | null; relationship_status: RelationshipStatus; inserted: boolean };
type ProfileRow = { customer_since: string | null; date_of_birth: string | null; financial_status: string | null; last_visit_at: Date | null; next_visit_at: Date | null; active_contracts: unknown | null; consumed_services_summary: unknown | null; attendance_metrics: unknown | null; relationship_metrics: unknown | null; synced_at: Date | null };

export class NeonConversationRepository implements ConversationRepository, CustomerProfileStore {
  async recordInbound(input: { phoneNumber: string; providerMessageId: string; content: string }) {
    const sql = getDatabase();
    const rows = await sql`
      WITH contact AS (
        INSERT INTO contacts (phone_number) VALUES (${input.phoneNumber})
        ON CONFLICT (phone_number) DO UPDATE SET updated_at=now()
        RETURNING id, first_name, relationship_status
      ), conversation AS (
        INSERT INTO conversations (contact_id) SELECT id FROM contact
        ON CONFLICT (contact_id) WHERE status='active' DO UPDATE SET updated_at=now()
        RETURNING id, contact_id
      ), inbound AS (
        INSERT INTO messages (conversation_id, provider_message_id, direction, role, content)
        SELECT id, ${input.providerMessageId}, 'inbound', 'user', ${input.content} FROM conversation
        ON CONFLICT (provider_message_id) WHERE provider_message_id IS NOT NULL DO NOTHING
        RETURNING conversation_id
      ), touched AS (
        UPDATE conversations SET last_message_at=now(), updated_at=now()
        WHERE id IN (SELECT conversation_id FROM inbound)
      )
      SELECT contact.id contact_id, conversation.id conversation_id, contact.first_name,
             contact.relationship_status, EXISTS(SELECT 1 FROM inbound) inserted
      FROM contact CROSS JOIN conversation
    ` as IdentityRow[];
    const row = rows[0];
    if (!row) throw new Error("Failed to establish conversation identity");
    return { inserted: row.inserted, identity: {
      contactId: row.contact_id, conversationId: row.conversation_id,
      relationshipStatus: row.relationship_status, ...(row.first_name ? { firstName: row.first_name } : {}),
    }};
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
