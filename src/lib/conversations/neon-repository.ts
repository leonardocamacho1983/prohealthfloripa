import { getDatabase } from "@/lib/db/neon";
import type { ConversationIdentity, ConversationMessage, ConversationRepository, ConversationTurnRepository, CustomerProfile, CustomerProfileStore, OutboundReservation, RelationshipStatus, TurnAcquisition, TurnCompletionState } from "./types";
import type { ConversationStatus } from "./types";
import type { HandoffConversation, HandoffSource, HandoffStore, InboxConversation } from "../handoff/types";

type IdentityRow = { contact_id: string; conversation_id: string; first_name: string | null; relationship_status: RelationshipStatus; conversation_status: ConversationStatus; human_expires_at: Date | null; revision: string | number };
type ProfileRow = { customer_since: string | null; date_of_birth: string | null; financial_status: string | null; last_visit_at: Date | null; next_visit_at: Date | null; active_contracts: unknown | null; consumed_services_summary: unknown | null; attendance_metrics: unknown | null; relationship_metrics: unknown | null; synced_at: Date | null };

let runtimeSchemaPromise: Promise<void> | undefined;
export function ensureConversationRuntimeSchema(): Promise<void> {
  if (!runtimeSchemaPromise) {
    const sql = getDatabase();
    runtimeSchemaPromise = sql.transaction((tx) => [
      tx`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS provider_account_id text,
        ADD COLUMN IF NOT EXISTS provider_conversation_id text, ADD COLUMN IF NOT EXISTS handoff_reason text,
        ADD COLUMN IF NOT EXISTS handoff_source text, ADD COLUMN IF NOT EXISTS handoff_requested_at timestamptz,
        ADD COLUMN IF NOT EXISTS human_started_at timestamptz, ADD COLUMN IF NOT EXISTS human_expires_at timestamptz,
        ADD COLUMN IF NOT EXISTS human_last_viewed_at timestamptz, ADD COLUMN IF NOT EXISTS closed_at timestamptz,
        ADD COLUMN IF NOT EXISTS inbound_revision bigint NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS processed_revision bigint NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS next_process_at timestamptz,
        ADD COLUMN IF NOT EXISTS processing_token text,
        ADD COLUMN IF NOT EXISTS processing_revision bigint,
        ADD COLUMN IF NOT EXISTS processing_lease_until timestamptz`,
      tx`ALTER TABLE messages ADD COLUMN IF NOT EXISTS input_revision bigint,
        ADD COLUMN IF NOT EXISTS response_revision bigint,
        ADD COLUMN IF NOT EXISTS bubble_index integer,
        ADD COLUMN IF NOT EXISTS idempotency_key text,
        ADD COLUMN IF NOT EXISTS delivery_status text NOT NULL DEFAULT 'sent',
        ADD COLUMN IF NOT EXISTS sent_at timestamptz,
        ADD COLUMN IF NOT EXISTS delivery_attempts integer NOT NULL DEFAULT 0`,
      tx`DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname='messages_inbound_input_revision_required'
              AND conrelid='messages'::regclass
          ) THEN
            ALTER TABLE messages ADD CONSTRAINT messages_inbound_input_revision_required
              CHECK (direction <> 'inbound' OR input_revision IS NOT NULL) NOT VALID;
          END IF;
        END
      $$`,
      tx`DROP INDEX IF EXISTS conversations_one_active_per_contact`,
      tx`CREATE UNIQUE INDEX IF NOT EXISTS conversations_one_open_per_contact ON conversations(contact_id)
        WHERE status IN ('active','human_requested','human_active')`,
      tx`CREATE INDEX IF NOT EXISTS conversations_handoff_queue_idx ON conversations(status, handoff_requested_at DESC)
        WHERE status IN ('human_requested','human_active')`,
      tx`CREATE UNIQUE INDEX IF NOT EXISTS messages_idempotency_key_unique ON messages(idempotency_key)
        WHERE idempotency_key IS NOT NULL`,
      tx`CREATE INDEX IF NOT EXISTS messages_conversation_input_revision_idx ON messages(conversation_id, input_revision)
        WHERE direction='inbound'`,
      tx`CREATE TABLE IF NOT EXISTS conversation_turns (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        revision bigint NOT NULL,
        state text NOT NULL DEFAULT 'processing',
        inbound_count integer NOT NULL DEFAULT 0,
        analysis jsonb, response_plan jsonb,
        started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (conversation_id, revision))`,
      tx`CREATE INDEX IF NOT EXISTS conversation_turns_state_idx ON conversation_turns(state, updated_at DESC)`,
    ]).then(() => undefined).catch((error) => { runtimeSchemaPromise = undefined; throw error; });
  }
  return runtimeSchemaPromise;
}

const ensureRuntimeSchema = ensureConversationRuntimeSchema;

export class NeonConversationRepository implements ConversationRepository, ConversationTurnRepository, CustomerProfileStore, HandoffStore {
  async recordInbound(input: { phoneNumber: string; providerMessageId: string; content: string; providerAccountId?: string; providerConversationId?: string; settleAt?: Date }) {
    await ensureRuntimeSchema();
    const sql = getDatabase();
    const settleAt = input.settleAt ?? new Date();
    // The advisory lock serializes the contact's inbound stream, including the first
    // message that creates its open conversation. Each statement below runs in order
    // in one transaction. The message receives its revision in the INSERT itself;
    // PostgreSQL data-modifying CTEs must not be used to insert and then retag that row.
    const results = await sql.transaction((tx) => [
      tx`SELECT pg_advisory_xact_lock(hashtextextended(${input.phoneNumber}, 0))`,
      tx`INSERT INTO contacts (phone_number) VALUES (${input.phoneNumber})
        ON CONFLICT (phone_number) DO UPDATE SET updated_at=now()
        RETURNING id`,
      tx`UPDATE conversations SET status='active', human_expires_at=NULL, updated_at=now()
        WHERE contact_id=(SELECT id FROM contacts WHERE phone_number=${input.phoneNumber})
          AND status='human_active' AND human_expires_at <= now()`,
      tx`INSERT INTO conversations (contact_id)
        SELECT id FROM contacts WHERE phone_number=${input.phoneNumber}
        ON CONFLICT (contact_id) WHERE status IN ('active','human_requested','human_active') DO NOTHING`,
      tx`SELECT id FROM conversations
        WHERE contact_id=(SELECT id FROM contacts WHERE phone_number=${input.phoneNumber})
          AND status IN ('active','human_requested','human_active')
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      tx`INSERT INTO messages (conversation_id, provider_message_id, direction, role, content, input_revision)
        SELECT id, ${input.providerMessageId}, 'inbound', 'user', ${input.content}, inbound_revision + 1
        FROM conversations
        WHERE contact_id=(SELECT id FROM contacts WHERE phone_number=${input.phoneNumber})
          AND status IN ('active','human_requested','human_active')
        ORDER BY created_at DESC LIMIT 1
        ON CONFLICT (provider_message_id) WHERE provider_message_id IS NOT NULL DO NOTHING
        RETURNING id, conversation_id, input_revision`,
      tx`UPDATE conversations c SET inbound_revision=m.input_revision,
          next_process_at=${settleAt}, processing_token=NULL, processing_revision=NULL,
          processing_lease_until=NULL, last_message_at=now(), updated_at=now(),
          provider_account_id=COALESCE(${input.providerAccountId ?? null}, c.provider_account_id),
          provider_conversation_id=COALESCE(${input.providerConversationId ?? null}, c.provider_conversation_id),
          human_expires_at=CASE WHEN c.status='human_active' THEN now() + interval '12 hours' ELSE c.human_expires_at END
        FROM messages m
        WHERE m.provider_message_id=${input.providerMessageId} AND m.conversation_id=c.id
          AND m.input_revision IS NOT NULL AND c.inbound_revision < m.input_revision
        RETURNING c.id, c.inbound_revision`,
      tx`SELECT ct.id contact_id, c.id conversation_id, ct.first_name, ct.relationship_status,
          c.status conversation_status, c.human_expires_at, c.inbound_revision revision
        FROM contacts ct JOIN conversations c ON c.contact_id=ct.id
        WHERE ct.phone_number=${input.phoneNumber}
          AND c.status IN ('active','human_requested','human_active')
        ORDER BY c.created_at DESC LIMIT 1`,
    ], { isolationLevel: "Serializable" });
    const inboundRows = results[5] as Array<{ id: string; conversation_id: string; input_revision: string | number }>;
    const rows = results[7] as IdentityRow[];
    const row = rows[0];
    if (!row) throw new Error("Failed to establish conversation identity");
    return { inserted: inboundRows.length > 0, ...(inboundRows[0]?.id ? { messageId: inboundRows[0].id } : {}), revision: Number(row.revision), conversationStatus: row.conversation_status,
      ...(row.human_expires_at ? { humanExpiresAt: new Date(row.human_expires_at) } : {}), identity: {
      contactId: row.contact_id, conversationId: row.conversation_id,
      relationshipStatus: row.relationship_status, ...(row.first_name ? { firstName: row.first_name } : {}),
    }};
  }

  async getConversationState(conversationId: string) {
    await ensureRuntimeSchema();
    const sql = getDatabase();
    const rows = await sql`UPDATE conversations SET status='active', human_expires_at=NULL, updated_at=now()
      WHERE id=${conversationId} AND status='human_active' AND human_expires_at <= now()
      RETURNING status, human_expires_at` as Array<{ status: ConversationStatus; human_expires_at: Date | null }>;
    const current = rows[0] ?? (await sql`SELECT status, human_expires_at FROM conversations WHERE id=${conversationId} LIMIT 1` as Array<{ status: ConversationStatus; human_expires_at: Date | null }>)[0];
    if (!current) throw new Error("Conversation not found");
    return { status: current.status, ...(current.human_expires_at ? { expiresAt: new Date(current.human_expires_at) } : {}) };
  }

  async requestHandoff(input: { conversationId: string; providerAccountId: string; providerConversationId: string;
    reason: string; source: HandoffSource; summary: string; now?: Date }) {
    await ensureRuntimeSchema(); const sql = getDatabase(); const now = input.now ?? new Date();
    await sql`UPDATE conversations SET status='human_requested', provider_account_id=${input.providerAccountId},
      provider_conversation_id=${input.providerConversationId}, handoff_reason=${input.reason}, handoff_source=${input.source},
      handoff_requested_at=COALESCE(handoff_requested_at, ${now}), human_expires_at=NULL,
      summary=${input.summary}, processed_revision=inbound_revision, processing_token=NULL,
      processing_revision=NULL, processing_lease_until=NULL, updated_at=now() WHERE id=${input.conversationId}`;
    await this.recordHandoffEvent(input.conversationId, `handoff_requested:${input.source}`);
  }

  async listHandoffs(): Promise<HandoffConversation[]> {
    await ensureRuntimeSchema(); const sql = getDatabase();
    await sql`UPDATE conversations SET status='active', human_expires_at=NULL, updated_at=now()
      WHERE status='human_active' AND human_expires_at <= now()`;
    const rows = await sql`SELECT c.id, c.contact_id, ct.first_name, ct.phone_number, c.status, c.handoff_reason,
      c.handoff_source, c.summary, c.handoff_requested_at, c.human_started_at, c.human_expires_at,
      c.last_message_at, c.provider_account_id, c.provider_conversation_id,
      (SELECT count(*)::int FROM messages m WHERE m.conversation_id=c.id AND m.direction='inbound'
        AND m.created_at > COALESCE(c.human_last_viewed_at, c.handoff_requested_at, c.created_at)) unread_count
      FROM conversations c JOIN contacts ct ON ct.id=c.contact_id
      WHERE c.status IN ('human_requested','human_active') ORDER BY c.handoff_requested_at ASC` as Array<{
        id: string; contact_id: string; first_name: string | null; phone_number: string; status: "human_requested" | "human_active";
        handoff_reason: string | null; handoff_source: HandoffSource | null; summary: string | null; handoff_requested_at: Date | null;
        human_started_at: Date | null; human_expires_at: Date | null; last_message_at: Date; unread_count: number;
        provider_account_id: string | null; provider_conversation_id: string | null;
      }>;
    return Promise.all(rows.map(async (row) => ({ id: row.id, contactId: row.contact_id,
      ...(row.first_name ? { firstName: row.first_name } : {}), maskedPhone: maskPhone(row.phone_number), status: row.status,
      reason: row.handoff_reason ?? "Atendimento humano solicitado.", source: row.handoff_source ?? "customer",
      summary: row.summary ?? "Resumo indisponível.", requestedAt: new Date(row.handoff_requested_at ?? new Date()),
      lastActivityAt: new Date(row.last_message_at), ...(row.human_started_at ? { humanStartedAt: new Date(row.human_started_at) } : {}),
      unreadCount: row.unread_count,
      ...(row.human_expires_at ? { expiresAt: new Date(row.human_expires_at) } : {}), providerAccountId: row.provider_account_id ?? "",
      providerConversationId: row.provider_conversation_id ?? "", messages: await this.getRecentMessages(row.id, 30) })));
  }

  async listInboxConversations(limit = 100): Promise<InboxConversation[]> {
    await ensureRuntimeSchema(); const sql = getDatabase();
    await sql`UPDATE conversations SET status='active', human_expires_at=NULL, updated_at=now()
      WHERE status='human_active' AND human_expires_at <= now()`;
    const rows = await sql`SELECT c.id, c.contact_id, ct.first_name, ct.phone_number, c.status, c.handoff_reason,
      c.handoff_source, c.summary, c.handoff_requested_at, c.human_started_at, c.human_expires_at,
      c.last_message_at, c.provider_account_id, c.provider_conversation_id,
      (SELECT count(*)::int FROM messages m WHERE m.conversation_id=c.id AND m.direction='inbound'
        AND m.created_at > COALESCE(c.human_last_viewed_at, c.handoff_requested_at, c.created_at)) unread_count
      FROM conversations c JOIN contacts ct ON ct.id=c.contact_id
      ORDER BY c.last_message_at DESC LIMIT ${limit}` as Array<{
        id: string; contact_id: string; first_name: string | null; phone_number: string; status: ConversationStatus;
        handoff_reason: string | null; handoff_source: HandoffSource | null; summary: string | null;
        handoff_requested_at: Date | null; human_started_at: Date | null; human_expires_at: Date | null;
        last_message_at: Date; unread_count: number; provider_account_id: string | null; provider_conversation_id: string | null;
      }>;
    return Promise.all(rows.map(async (row) => ({ id: row.id, contactId: row.contact_id,
      ...(row.first_name ? { firstName: row.first_name } : {}), maskedPhone: maskPhone(row.phone_number), status: row.status,
      ...(row.handoff_reason ? { reason: row.handoff_reason } : {}),
      ...(row.handoff_source ? { source: row.handoff_source } : {}),
      ...(row.handoff_requested_at ? { requestedAt: new Date(row.handoff_requested_at) } : {}),
      summary: row.summary ?? "Conversa conduzida pelo agente.", lastActivityAt: new Date(row.last_message_at),
      ...(row.human_started_at ? { humanStartedAt: new Date(row.human_started_at) } : {}), unreadCount: row.unread_count,
      ...(row.human_expires_at ? { expiresAt: new Date(row.human_expires_at) } : {}),
      providerAccountId: row.provider_account_id ?? "", providerConversationId: row.provider_conversation_id ?? "",
      messages: await this.getRecentMessages(row.id, 30) })));
  }

  async assumeAgentConversation(conversationId: string) {
    await ensureRuntimeSchema(); const sql = getDatabase();
    const rows = await sql`UPDATE conversations SET status='human_active', handoff_reason='Conversa assumida pela equipe.',
      handoff_source='customer', handoff_requested_at=COALESCE(handoff_requested_at, now()),
      human_started_at=now(), human_expires_at=now() + interval '12 hours',
      summary=COALESCE(summary, 'Conversa assumida diretamente pelo painel.'),
      processed_revision=inbound_revision, processing_token=NULL, processing_revision=NULL,
      processing_lease_until=NULL, updated_at=now()
      WHERE id=${conversationId} AND status='active'
        AND provider_account_id IS NOT NULL AND provider_conversation_id IS NOT NULL
      RETURNING id` as Array<{ id: string }>;
    if (!rows[0]) throw new Error("Active conversation not found");
    await this.recordHandoffEvent(conversationId, "handoff_taken_from_agent");
  }

  async takeHandoff(conversationId: string) {
    await ensureRuntimeSchema(); const sql = getDatabase();
    await sql`UPDATE conversations SET status='human_active', human_started_at=COALESCE(human_started_at, now()),
      human_expires_at=now() + interval '12 hours', processed_revision=inbound_revision,
      processing_token=NULL, processing_revision=NULL, processing_lease_until=NULL,
      updated_at=now() WHERE id=${conversationId} AND status='human_requested'`;
    await this.recordHandoffEvent(conversationId, "handoff_taken");
  }

  async touchHandoff(conversationId: string) {
    await ensureRuntimeSchema(); const sql = getDatabase();
    await sql`UPDATE conversations SET human_expires_at=now() + interval '12 hours', last_message_at=now(), updated_at=now()
      WHERE id=${conversationId} AND status='human_active'`;
  }

  async closeHandoff(conversationId: string) {
    await ensureRuntimeSchema(); const sql = getDatabase();
    await sql`UPDATE conversations SET status='closed', closed_at=now(), human_expires_at=NULL, updated_at=now(),
      processed_revision=inbound_revision, processing_token=NULL, processing_revision=NULL,
      processing_lease_until=NULL WHERE id=${conversationId} AND status IN ('human_requested','human_active')`;
    await this.recordHandoffEvent(conversationId, "handoff_closed");
  }

  async markHandoffViewed(conversationId: string) {
    await ensureRuntimeSchema(); const sql = getDatabase();
    await sql`UPDATE conversations SET human_last_viewed_at=now(), updated_at=now()
      WHERE id=${conversationId}`;
  }

  async recordHandoffEvent(conversationId: string, eventType: string) {
    const sql = getDatabase();
    await sql`INSERT INTO interaction_events (contact_id, event_type, metadata)
      SELECT contact_id, ${eventType}, jsonb_build_object('conversationId', id)
      FROM conversations WHERE id=${conversationId}`;
  }

  async recordOutbound(input: { conversationId: string; content: string }) {
    const sql = getDatabase();
    await sql`WITH outbound AS (
      INSERT INTO messages (conversation_id, direction, role, content, delivery_status, sent_at)
      VALUES (${input.conversationId}, 'outbound', 'assistant', ${input.content}, 'sent', now())
    ) UPDATE conversations SET last_message_at=now(), updated_at=now() WHERE id=${input.conversationId}`;
  }

  async acquireTurn(input: { conversationId: string; observedRevision: number; token: string; leaseSeconds: number }): Promise<TurnAcquisition> {
    await ensureRuntimeSchema();
    const sql = getDatabase();
    const rows = await sql`UPDATE conversations SET processing_token=${input.token},
      processing_revision=inbound_revision,
      processing_lease_until=now() + make_interval(secs => ${input.leaseSeconds}), updated_at=now()
      WHERE id=${input.conversationId} AND status='active'
        AND inbound_revision=${input.observedRevision} AND processed_revision < inbound_revision
        AND COALESCE(next_process_at, now()) <= now()
        AND (processing_token IS NULL OR processing_lease_until IS NULL OR processing_lease_until <= now())
      RETURNING id, contact_id, inbound_revision, processed_revision, provider_account_id,
        provider_conversation_id` as Array<{ id: string; contact_id: string; inbound_revision: string | number;
        processed_revision: string | number; provider_account_id: string | null; provider_conversation_id: string | null }>;
    const acquired = rows[0];
    if (!acquired) {
      const states = await sql`SELECT status, inbound_revision, processed_revision, next_process_at,
        processing_token, processing_lease_until FROM conversations WHERE id=${input.conversationId} LIMIT 1` as Array<{
          status: ConversationStatus; inbound_revision: string | number; processed_revision: string | number;
          next_process_at: Date | null; processing_token: string | null; processing_lease_until: Date | null }>;
      const state = states[0];
      if (!state) return { kind: "missing" };
      if (state.status !== "active") return { kind: "human" };
      if (Number(state.processed_revision) >= input.observedRevision) return { kind: "complete" };
      if (Number(state.inbound_revision) !== input.observedRevision) return { kind: "stale" };
      if (state.next_process_at && new Date(state.next_process_at).getTime() > Date.now()) return { kind: "not_due" };
      return { kind: "busy" };
    }

    const revision = Number(acquired.inbound_revision);
    const processedRevision = Number(acquired.processed_revision);
    const identityRows = await sql`SELECT ct.phone_number, ct.first_name, ct.relationship_status
      FROM contacts ct WHERE ct.id=${acquired.contact_id} LIMIT 1` as Array<{
        phone_number: string; first_name: string | null; relationship_status: RelationshipStatus }>;
    const identityRow = identityRows[0];
    if (!identityRow || !acquired.provider_account_id || !acquired.provider_conversation_id) {
      await this.releaseTurn({ conversationId: input.conversationId, token: input.token, state: "failed" });
      throw new Error("Conversation provider identity is incomplete");
    }
    const messageRows = await sql`SELECT id, conversation_id, provider_message_id, direction, role, content,
      created_at, input_revision, response_revision FROM messages
      WHERE conversation_id=${input.conversationId} AND direction='inbound'
        AND input_revision > ${processedRevision} AND input_revision <= ${revision}
      ORDER BY input_revision ASC, created_at ASC, id ASC` as Array<{
        id: string; conversation_id: string; provider_message_id: string | null;
        direction: "inbound" | "outbound"; role: "user" | "assistant" | "system"; content: string;
        created_at: Date; input_revision: string | number | null; response_revision: string | number | null }>;
    await sql`INSERT INTO conversation_turns (conversation_id, revision, state, inbound_count)
      VALUES (${input.conversationId}, ${revision}, 'processing', ${messageRows.length})
      ON CONFLICT (conversation_id, revision) DO UPDATE SET state='processing', inbound_count=EXCLUDED.inbound_count,
        started_at=now(), completed_at=NULL, updated_at=now()`;
    const identity: ConversationIdentity = { contactId: acquired.contact_id, conversationId: acquired.id,
      relationshipStatus: identityRow.relationship_status,
      ...(identityRow.first_name ? { firstName: identityRow.first_name } : {}) };
    return { kind: "acquired", turn: { conversationId: acquired.id, revision, processedRevision,
      phoneNumber: identityRow.phone_number, accountId: acquired.provider_account_id,
      providerConversationId: acquired.provider_conversation_id, identity,
      messages: messageRows.map((row) => ({ id: row.id, conversationId: row.conversation_id,
        ...(row.provider_message_id ? { providerMessageId: row.provider_message_id } : {}),
        direction: row.direction, role: row.role, content: row.content, createdAt: new Date(row.created_at),
        ...(row.input_revision !== null ? { inputRevision: Number(row.input_revision) } : {}),
        ...(row.response_revision !== null ? { responseRevision: Number(row.response_revision) } : {}) })) } };
  }

  async reserveOutbound(input: { conversationId: string; revision: number; token: string; bubbleIndex: number;
    content: string; idempotencyKey: string }): Promise<OutboundReservation> {
    const sql = getDatabase();
    const rows = await sql`WITH current AS (
      SELECT id FROM conversations WHERE id=${input.conversationId} AND status='active'
        AND inbound_revision=${input.revision} AND processing_revision=${input.revision}
        AND processing_token=${input.token} AND processing_lease_until > now()
    ), attempted AS (
      INSERT INTO messages (conversation_id, direction, role, content, response_revision, bubble_index,
        idempotency_key, delivery_status, delivery_attempts)
      SELECT id, 'outbound', 'assistant', ${input.content}, ${input.revision}, ${input.bubbleIndex},
        ${input.idempotencyKey}, 'pending', 1 FROM current
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE SET
        content=EXCLUDED.content,
        delivery_status=CASE WHEN messages.delivery_status='sent' THEN 'sent' ELSE 'pending' END,
        delivery_attempts=messages.delivery_attempts + 1
      RETURNING delivery_status
    ) SELECT EXISTS(SELECT 1 FROM current) valid,
      (SELECT delivery_status FROM attempted LIMIT 1) delivery_status` as Array<{
        valid: boolean; delivery_status: "pending" | "sent" | null }>;
    const row = rows[0];
    if (!row?.valid || !row.delivery_status) return "stale";
    return row.delivery_status === "sent" ? "already_sent" : "reserved";
  }

  async markOutboundSent(input: { idempotencyKey: string }) {
    const sql = getDatabase();
    await sql`WITH sent AS (UPDATE messages SET delivery_status='sent', sent_at=now()
      WHERE idempotency_key=${input.idempotencyKey} RETURNING conversation_id)
      UPDATE conversations SET last_message_at=now(), updated_at=now()
      WHERE id IN (SELECT conversation_id FROM sent)`;
  }

  async markOutboundFailed(input: { idempotencyKey: string }) {
    const sql = getDatabase();
    await sql`UPDATE messages SET delivery_status='failed' WHERE idempotency_key=${input.idempotencyKey}`;
  }

  async completeTurn(input: { conversationId: string; revision: number; token: string; state: TurnCompletionState;
    analysis?: unknown; responsePlan?: unknown }): Promise<boolean> {
    const sql = getDatabase();
    const rows = await sql`UPDATE conversations SET processed_revision=${input.revision},
      processing_token=NULL, processing_revision=NULL, processing_lease_until=NULL,
      next_process_at=NULL, updated_at=now()
      WHERE id=${input.conversationId} AND status='active' AND inbound_revision=${input.revision}
        AND processing_revision=${input.revision} AND processing_token=${input.token}
      RETURNING id` as Array<{ id: string }>;
    if (!rows[0]) return false;
    await sql`UPDATE conversation_turns SET state=${input.state},
      analysis=${input.analysis === undefined ? null : JSON.stringify(input.analysis)}::jsonb,
      response_plan=${input.responsePlan === undefined ? null : JSON.stringify(input.responsePlan)}::jsonb,
      completed_at=now(), updated_at=now()
      WHERE conversation_id=${input.conversationId} AND revision=${input.revision}`;
    return true;
  }

  async releaseTurn(input: { conversationId: string; token: string; state?: Extract<TurnCompletionState, "failed" | "stale"> }) {
    const sql = getDatabase();
    const rows = await sql`WITH current AS (
      SELECT processing_revision FROM conversations WHERE id=${input.conversationId}
        AND processing_token=${input.token} FOR UPDATE
    ), released AS (
      UPDATE conversations SET processing_token=NULL, processing_revision=NULL,
        processing_lease_until=NULL, updated_at=now() WHERE id=${input.conversationId}
          AND processing_token=${input.token} RETURNING id
    ) SELECT processing_revision FROM current WHERE EXISTS(SELECT 1 FROM released)` as Array<{
      processing_revision: string | number | null }>;
    const revision = rows[0]?.processing_revision;
    if (revision !== null && revision !== undefined && input.state) {
      await sql`UPDATE conversation_turns SET state=${input.state}, completed_at=now(), updated_at=now()
        WHERE conversation_id=${input.conversationId} AND revision=${Number(revision)}`;
    }
  }

  async getRecentMessages(conversationId: string, limit: number) {
    const sql = getDatabase();
    const rows = await sql`
      SELECT * FROM (
        SELECT id, conversation_id, provider_message_id, direction, role, content, created_at,
          input_revision, response_revision
        FROM messages WHERE conversation_id=${conversationId}
          AND (direction='inbound' OR delivery_status='sent')
        ORDER BY created_at DESC, id DESC LIMIT ${limit}
      ) recent ORDER BY created_at ASC, id ASC
    ` as Array<{ id: string; conversation_id: string; provider_message_id: string | null; direction: "inbound" | "outbound"; role: "user" | "assistant" | "system"; content: string; created_at: Date; input_revision: string | number | null; response_revision: string | number | null }>;
    return rows.map((row): ConversationMessage => ({
      id: row.id, conversationId: row.conversation_id, direction: row.direction, role: row.role,
      content: row.content, createdAt: new Date(row.created_at),
      ...(row.provider_message_id ? { providerMessageId: row.provider_message_id } : {}),
      ...(row.input_revision !== null ? { inputRevision: Number(row.input_revision) } : {}),
      ...(row.response_revision !== null ? { responseRevision: Number(row.response_revision) } : {}),
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
