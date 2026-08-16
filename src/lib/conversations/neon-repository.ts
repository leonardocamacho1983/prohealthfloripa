import { getDatabase } from "@/lib/db/neon";
import type { ConversationMessage, ConversationRepository, CustomerProfile, RelationshipStatus } from "./types";

type IdentityRow = { contact_id: string; conversation_id: string; first_name: string | null; relationship_status: RelationshipStatus; inserted: boolean };
type ProfileRow = { customer_since: string | null; financial_status: string | null; active_contracts: unknown | null; consumed_services_summary: unknown | null; attendance_metrics: unknown | null };

export class NeonConversationRepository implements ConversationRepository {
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
    const rows = await sql`SELECT customer_since, financial_status, active_contracts,
      consumed_services_summary, attendance_metrics FROM customer_profiles WHERE contact_id=${contactId} LIMIT 1`;
    const row = rows[0] as ProfileRow | undefined;
    if (!row) return undefined;
    return {
      ...(row.customer_since ? { customerSince: row.customer_since } : {}),
      ...(row.financial_status ? { financialStatus: row.financial_status } : {}),
      ...(row.active_contracts ? { activeContracts: row.active_contracts } : {}),
      ...(row.consumed_services_summary ? { consumedServicesSummary: row.consumed_services_summary } : {}),
      ...(row.attendance_metrics ? { attendanceMetrics: row.attendance_metrics } : {}),
    };
  }
}
