import { randomUUID } from "node:crypto";
import { getDatabase } from "@/lib/db/neon";
import type { CompleteJourneyHandoffInput, CompleteTurnWithJourneyStateInput, ConversationIdentity, ConversationJourneyStateStore, ConversationMessage, ConversationRepository, ConversationTurnRepository, CustomerProfile, CustomerProfileStore, JourneyStateSaveResult, OutboundReservation, RelationshipStatus, TurnAcquisition, TurnCompletionState } from "./types";
import type { ConversationStatus } from "./types";
import type { HandoffConversation, HandoffSource, HandoffStore, InboxConversation } from "../handoff/types";
import { inferHandoffReasonId } from "../reasons/catalog";
import { ensureReasonSchema } from "../reasons/repository";
import { ensureAttendantSchema } from "../attendants/repository";
import {
  deserializeConversationJourneyState,
  serializeCompletedJourneyHandoffState,
  serializeConversationJourneyState,
  serializeJourneyStateForRevision,
  type ConversationJourneyStateRow,
} from "./journey-state-persistence";
import { ensureConversationWorkflowSchema } from "./workflow-schema";
import { workflowEventText, type ConversationWorkflowEventType } from "./workflow-events";
import { isFeatureEnabled } from "@/lib/feature-flags/repository";
import { completeConversationSla, startConversationSla } from "@/lib/sla/repository";
import { enqueueSlaDeadlines } from "@/lib/sla/queue";
import { ensureSlaSchema } from "@/lib/sla/repository";
import { ensureCxSchema } from "@/lib/cx/schema";
import { linkReopenedOutcome, recordConversationOutcome } from "@/lib/cx/outcomes";
import { scheduleCxSurveyBestEffort } from "@/lib/cx/surveys";
import { ensurePromiseSchema } from "@/lib/promises/repository";
import { ensureNotificationDeliverySchema } from "@/lib/notifications/delivery-schema";

type IdentityRow = { contact_id: string; conversation_id: string; first_name: string | null; relationship_status: RelationshipStatus; conversation_status: ConversationStatus; human_expires_at: Date | null; revision: string | number; next_process_at: Date | null };
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
        ADD COLUMN IF NOT EXISTS batch_started_at timestamptz,
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
      tx`CREATE TABLE IF NOT EXISTS conversation_journey_states (
        conversation_id uuid PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
        schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
        stage text NOT NULL DEFAULT 'discovery'
          CHECK (stage IN ('discovery','recommendation','service_selected','collecting_schedule',
            'ready_for_handoff','human_handoff','completed')),
        goals jsonb NOT NULL DEFAULT '[]'::jsonb,
        latest_goals jsonb NOT NULL DEFAULT '[]'::jsonb,
        service_family text,
        recommended_services jsonb NOT NULL DEFAULT '[]'::jsonb,
        selected_service text,
        facts_sent jsonb NOT NULL DEFAULT '[]'::jsonb,
        offers jsonb NOT NULL DEFAULT '{}'::jsonb,
        scheduling jsonb NOT NULL DEFAULT '{"status":"not_started"}'::jsonb,
        dialogue jsonb NOT NULL DEFAULT '{"safetyStatus":"not_asked"}'::jsonb,
        active_pilates boolean NOT NULL DEFAULT false,
        last_action text,
        updated_from_revision bigint NOT NULL DEFAULT 0 CHECK (updated_from_revision >= 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now())`,
      tx`ALTER TABLE conversation_journey_states
        ADD COLUMN IF NOT EXISTS latest_goals jsonb NOT NULL DEFAULT '[]'::jsonb`,
      tx`ALTER TABLE conversation_journey_states
        ADD COLUMN IF NOT EXISTS dialogue jsonb NOT NULL DEFAULT '{"safetyStatus":"not_asked"}'::jsonb`,
      tx`CREATE INDEX IF NOT EXISTS conversation_journey_states_stage_updated_idx
        ON conversation_journey_states(stage, updated_at DESC)`,
    ]).then(() => undefined).catch((error) => { runtimeSchemaPromise = undefined; throw error; });
  }
  return runtimeSchemaPromise;
}

const ensureRuntimeSchema = ensureConversationRuntimeSchema;

export class NeonConversationRepository implements ConversationRepository, ConversationTurnRepository,
  ConversationJourneyStateStore, CustomerProfileStore, HandoffStore {
  async recordInbound(input: { phoneNumber: string; providerMessageId: string; content: string; providerAccountId?: string; providerConversationId?: string; settleAt?: Date }) {
    await Promise.all([ensureRuntimeSchema(), ensureReasonSchema(), ensureConversationWorkflowSchema(), ensureCxSchema()]);
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
      tx`INSERT INTO conversations (contact_id, reopened_from_conversation_id)
        SELECT ct.id, (SELECT previous.id FROM conversations previous
          WHERE previous.contact_id=ct.id AND previous.status='closed'
          ORDER BY previous.closed_at DESC NULLS LAST, previous.created_at DESC LIMIT 1)
        FROM contacts ct WHERE ct.phone_number=${input.phoneNumber}
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
      tx`INSERT INTO conversation_events (conversation_id, event_type, metadata, idempotency_key)
        SELECT c.id, 'awaiting_customer_cancelled', jsonb_build_object('origin','customer_reply'),
          ${`awaiting-cancel:${input.providerMessageId}`}
        FROM conversations c JOIN messages m ON m.conversation_id=c.id
        WHERE m.provider_message_id=${input.providerMessageId}
          AND c.awaiting_customer_since IS NOT NULL
        ON CONFLICT (idempotency_key) DO NOTHING`,
      tx`UPDATE conversations c SET inbound_revision=m.input_revision,
          batch_started_at=CASE WHEN c.processed_revision >= c.inbound_revision
            THEN now() ELSE COALESCE(c.batch_started_at, now()) END,
          next_process_at=LEAST(${settleAt},
            CASE WHEN c.processed_revision >= c.inbound_revision
              THEN now() ELSE COALESCE(c.batch_started_at, now()) END + interval '8 seconds'),
          processing_token=NULL, processing_revision=NULL,
          processing_lease_until=NULL, last_message_at=now(), updated_at=now(),
          provider_account_id=COALESCE(${input.providerAccountId ?? null}, c.provider_account_id),
          provider_conversation_id=COALESCE(${input.providerConversationId ?? null}, c.provider_conversation_id),
          assignment_version=CASE WHEN c.awaiting_customer_since IS NOT NULL
            THEN c.assignment_version + 1 ELSE c.assignment_version END,
          awaiting_customer_since=NULL, awaiting_customer_by_user_id=NULL,
          awaiting_customer_deadline_at=NULL, inactivity_token=NULL,
          human_expires_at=CASE WHEN c.status='human_active' THEN now() + interval '12 hours' ELSE c.human_expires_at END
        FROM messages m
        WHERE m.provider_message_id=${input.providerMessageId} AND m.conversation_id=c.id
          AND m.input_revision IS NOT NULL AND c.inbound_revision < m.input_revision
        RETURNING c.id, c.inbound_revision`,
      tx`SELECT ct.id contact_id, c.id conversation_id, ct.first_name, ct.relationship_status,
          c.status conversation_status, c.human_expires_at, c.inbound_revision revision,
          c.next_process_at
        FROM contacts ct JOIN conversations c ON c.contact_id=ct.id
        WHERE ct.phone_number=${input.phoneNumber}
          AND c.status IN ('active','human_requested','human_active')
        ORDER BY c.created_at DESC LIMIT 1`,
      tx`INSERT INTO conversation_events (conversation_id, event_type, metadata, idempotency_key)
        SELECT c.id, 'reopened', jsonb_build_object('previousConversationId', c.reopened_from_conversation_id),
          'reopened:' || c.id::text
        FROM conversations c
        WHERE c.contact_id=(SELECT id FROM contacts WHERE phone_number=${input.phoneNumber})
          AND c.status IN ('active','human_requested','human_active')
          AND c.reopened_from_conversation_id IS NOT NULL
        ORDER BY c.created_at DESC LIMIT 1
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING conversation_id, metadata->>'previousConversationId' previous_conversation_id`,
    ], { isolationLevel: "Serializable" });
    const inboundRows = results[5] as Array<{ id: string; conversation_id: string; input_revision: string | number }>;
    const rows = results[8] as IdentityRow[];
    const row = rows[0];
    if (!row) throw new Error("Failed to establish conversation identity");
    const reopenedRows = results[9] as Array<{ conversation_id: string; previous_conversation_id: string | null }>;
    if (reopenedRows[0]?.previous_conversation_id) {
      await linkReopenedOutcome(reopenedRows[0].previous_conversation_id, reopenedRows[0].conversation_id);
    }
    return { inserted: inboundRows.length > 0, ...(inboundRows[0]?.id ? { messageId: inboundRows[0].id } : {}), revision: Number(row.revision), conversationStatus: row.conversation_status,
      processAt: row.next_process_at ? new Date(row.next_process_at) : settleAt,
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
    await Promise.all([ensureRuntimeSchema(), ensureReasonSchema(), ensureConversationWorkflowSchema()]);
    const sql = getDatabase(); const now = input.now ?? new Date();
    const reasonId = inferHandoffReasonId({ source: input.source, reason: input.reason });
    await sql`UPDATE conversations SET status='human_requested', provider_account_id=${input.providerAccountId},
      provider_conversation_id=${input.providerConversationId}, handoff_reason=${input.reason}, handoff_source=${input.source},
      handoff_reason_id=${reasonId},
      handoff_requested_at=COALESCE(handoff_requested_at, ${now}), human_expires_at=NULL,
      summary=${input.summary}, processed_revision=inbound_revision, processing_token=NULL,
      processing_revision=NULL, processing_lease_until=NULL, updated_at=now() WHERE id=${input.conversationId}`;
    await sql`INSERT INTO conversation_events (conversation_id, event_type, reason_id, metadata, idempotency_key)
      VALUES (${input.conversationId}, 'handoff_requested', ${reasonId},
        jsonb_build_object('source', ${input.source}), ${`handoff-requested:${input.conversationId}`})
      ON CONFLICT (idempotency_key) DO NOTHING`;
    await this.recordHandoffEvent(input.conversationId, `handoff_requested:${input.source}`);
    if (await isFeatureEnabled("sla_engine")) {
      try {
        const deadline = await startConversationSla(input.conversationId, now);
        await enqueueSlaDeadlines({ conversationId: input.conversationId, ...deadline, now });
      } catch (error) {
        console.warn("SLA deadline could not be scheduled", {
          error: error instanceof Error ? error.name : "UnknownError",
        });
      }
    }
  }

  async listHandoffs(): Promise<HandoffConversation[]> {
    await Promise.all([ensureRuntimeSchema(), ensureReasonSchema(), ensureConversationWorkflowSchema(),
      ensureAttendantSchema(), ensureSlaSchema()]); const sql = getDatabase();
    await sql`UPDATE conversations SET status='active', human_expires_at=NULL, updated_at=now()
      WHERE status='human_active' AND human_expires_at <= now()`;
    const rows = await sql`SELECT c.id, c.contact_id, ct.first_name, ct.phone_number, c.status, c.handoff_reason,
      c.handoff_source, c.summary, c.handoff_requested_at, c.human_started_at, c.human_expires_at,
      c.last_message_at, c.provider_account_id, c.provider_conversation_id, c.assigned_attendant_user_id,
      c.assignment_version, c.awaiting_customer_since, c.awaiting_customer_deadline_at,
      cs.status sla_status, cs.response_due_at,
      ap.display_name assigned_attendant_name,
      (SELECT count(*)::int FROM messages m WHERE m.conversation_id=c.id AND m.direction='inbound'
        AND m.created_at > COALESCE(c.human_last_viewed_at, c.handoff_requested_at, c.created_at)) unread_count
      FROM conversations c JOIN contacts ct ON ct.id=c.contact_id
      LEFT JOIN attendant_profiles ap ON ap.clerk_user_id=c.assigned_attendant_user_id
      LEFT JOIN conversation_sla cs ON cs.conversation_id=c.id
      WHERE c.status IN ('human_requested','human_active') ORDER BY c.handoff_requested_at ASC` as Array<{
        id: string; contact_id: string; first_name: string | null; phone_number: string; status: "human_requested" | "human_active";
        handoff_reason: string | null; handoff_source: HandoffSource | null; summary: string | null; handoff_requested_at: Date | null;
        human_started_at: Date | null; human_expires_at: Date | null; last_message_at: Date; unread_count: number;
        provider_account_id: string | null; provider_conversation_id: string | null; assigned_attendant_user_id: string | null;
        assignment_version: string | number; awaiting_customer_since: Date | null;
        awaiting_customer_deadline_at: Date | null; assigned_attendant_name: string | null;
        sla_status: "normal" | "warning" | "breached" | "paused" | "completed" | null;
        response_due_at: Date | null;
      }>;
    return Promise.all(rows.map(async (row) => ({ id: row.id, contactId: row.contact_id,
      ...(row.first_name ? { firstName: row.first_name } : {}), maskedPhone: maskPhone(row.phone_number), status: row.status,
      reason: row.handoff_reason ?? "Atendimento humano solicitado.", source: row.handoff_source ?? "customer",
      summary: row.summary ?? "Resumo indisponível.", requestedAt: new Date(row.handoff_requested_at ?? new Date()),
      lastActivityAt: new Date(row.last_message_at), ...(row.human_started_at ? { humanStartedAt: new Date(row.human_started_at) } : {}),
      unreadCount: row.unread_count,
      ...(row.human_expires_at ? { expiresAt: new Date(row.human_expires_at) } : {}), providerAccountId: row.provider_account_id ?? "",
      providerConversationId: row.provider_conversation_id ?? "",
      ...(row.assigned_attendant_user_id ? { assignedAttendantUserId: row.assigned_attendant_user_id } : {}),
      ...(row.assigned_attendant_name ? { assignedAttendantName: row.assigned_attendant_name } : {}),
      assignmentVersion: Number(row.assignment_version),
      ...(row.awaiting_customer_since ? { awaitingCustomerSince: new Date(row.awaiting_customer_since) } : {}),
      ...(row.awaiting_customer_deadline_at
        ? { awaitingCustomerDeadlineAt: new Date(row.awaiting_customer_deadline_at) } : {}),
      ...(row.sla_status ? { slaStatus: row.sla_status } : {}),
      ...(row.response_due_at ? { nextDeadlineAt: new Date(row.response_due_at) } : {}),
      messages: await this.getRecentMessages(row.id, 30) })));
  }

  async listInboxConversations(limit = 100, viewerUserId?: string): Promise<InboxConversation[]> {
    await Promise.all([ensureRuntimeSchema(), ensureReasonSchema(), ensureConversationWorkflowSchema(),
      ensureAttendantSchema(), ensureSlaSchema(), ensurePromiseSchema(), ensureNotificationDeliverySchema()]); const sql = getDatabase();
    await sql`UPDATE conversations SET status='active', human_expires_at=NULL, updated_at=now()
      WHERE status='human_active' AND human_expires_at <= now()`;
    const rows = await sql`SELECT c.id, c.contact_id, ct.first_name, ct.phone_number, c.status, c.handoff_reason,
      c.handoff_source, c.summary, c.handoff_requested_at, c.human_started_at, c.human_expires_at,
      c.last_message_at, c.provider_account_id, c.provider_conversation_id, c.assigned_attendant_user_id,
      c.assignment_version, c.awaiting_customer_since, c.awaiting_customer_deadline_at,
      cs.status sla_status, cs.response_due_at,
      (SELECT count(*)::int FROM conversation_promises cp WHERE cp.conversation_id=c.id
        AND cp.status IN ('open','overdue')) open_promise_count,
      EXISTS (SELECT 1 FROM notification_outbox no WHERE no.conversation_id=c.id
        AND no.status='failed') notification_failure,
      ap.display_name assigned_attendant_name,
      (SELECT count(*)::int FROM messages m WHERE m.conversation_id=c.id AND m.direction='inbound'
        AND m.created_at > COALESCE((SELECT v.last_viewed_at FROM conversation_views v
          WHERE v.conversation_id=c.id AND v.viewer_user_id=${viewerUserId ?? ""}),
          c.handoff_requested_at, c.created_at)) unread_count
      FROM conversations c JOIN contacts ct ON ct.id=c.contact_id
      LEFT JOIN attendant_profiles ap ON ap.clerk_user_id=c.assigned_attendant_user_id
      LEFT JOIN conversation_sla cs ON cs.conversation_id=c.id
      ORDER BY c.last_message_at DESC LIMIT ${limit}` as Array<{
        id: string; contact_id: string; first_name: string | null; phone_number: string; status: ConversationStatus;
        handoff_reason: string | null; handoff_source: HandoffSource | null; summary: string | null;
        handoff_requested_at: Date | null; human_started_at: Date | null; human_expires_at: Date | null;
        last_message_at: Date; unread_count: number; provider_account_id: string | null; provider_conversation_id: string | null;
        assigned_attendant_user_id: string | null; assignment_version: string | number;
        awaiting_customer_since: Date | null; awaiting_customer_deadline_at: Date | null;
        assigned_attendant_name: string | null;
        sla_status: "normal" | "warning" | "breached" | "paused" | "completed" | null;
        response_due_at: Date | null; open_promise_count: number; notification_failure: boolean;
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
      ...(row.assigned_attendant_user_id ? { assignedAttendantUserId: row.assigned_attendant_user_id } : {}),
      ...(row.assigned_attendant_name ? { assignedAttendantName: row.assigned_attendant_name } : {}),
      assignmentVersion: Number(row.assignment_version),
      ...(row.awaiting_customer_since ? { awaitingCustomerSince: new Date(row.awaiting_customer_since) } : {}),
      ...(row.awaiting_customer_deadline_at
        ? { awaitingCustomerDeadlineAt: new Date(row.awaiting_customer_deadline_at) } : {}),
      ...(row.sla_status ? { slaStatus: row.sla_status } : {}),
      ...(row.response_due_at ? { nextDeadlineAt: new Date(row.response_due_at) } : {}),
      notificationFailure: row.notification_failure,
      openPromiseCount: Number(row.open_promise_count),
      actionPriority: row.sla_status === "breached" ? 0 : row.sla_status === "warning" ? 1
        : !row.assigned_attendant_user_id && row.status === "human_requested" ? 2 : 3,
      ownerScope: row.assigned_attendant_user_id === viewerUserId ? "mine"
        : row.assigned_attendant_user_id ? "team" : "unassigned",
      messages: await this.getRecentMessages(row.id, 30) })));
  }

  async assumeAgentConversation(conversationId: string, actor: { userId: string; label: string }) {
    await Promise.all([ensureRuntimeSchema(), ensureReasonSchema(), ensureConversationWorkflowSchema()]);
    const sql = getDatabase();
    const rows = await sql`WITH assumed AS (
      UPDATE conversations SET status='human_active', handoff_reason='Conversa assumida pela equipe.',
      handoff_source='customer', handoff_reason_id='customer_requested_human',
      handoff_requested_at=COALESCE(handoff_requested_at, now()),
      human_started_at=now(), human_expires_at=now() + interval '12 hours',
      assigned_attendant_user_id=${actor.userId}, assigned_attendant_at=now(),
      assignment_version=assignment_version + 1,
      last_human_actor_user_id=${actor.userId}, last_human_actor_label=${actor.label},
      summary=COALESCE(summary, 'Conversa assumida diretamente pelo painel.'),
      processed_revision=inbound_revision, processing_token=NULL, processing_revision=NULL,
      processing_lease_until=NULL, updated_at=now()
      WHERE id=${conversationId} AND status='active'
        AND (assigned_attendant_user_id IS NULL OR assigned_attendant_user_id=${actor.userId})
        AND provider_account_id IS NOT NULL AND provider_conversation_id IS NOT NULL
      RETURNING id, assignment_version
    )
    INSERT INTO conversation_events (conversation_id, event_type, actor_user_id, actor_label,
      to_user_id, to_user_label, reason_id, idempotency_key)
    SELECT id, 'assumed', ${actor.userId}, ${actor.label}, ${actor.userId}, ${actor.label},
      'customer_requested_human', 'assume-agent:' || id::text || ':' || assignment_version::text
    FROM assumed ON CONFLICT (idempotency_key) DO NOTHING RETURNING conversation_id` as Array<{ conversation_id: string }>;
    if (!rows[0]) throw new Error("Active conversation not found");
    if (await isFeatureEnabled("sla_engine")) await completeConversationSla(conversationId);
    await this.recordHandoffEvent(conversationId, "handoff_taken_from_agent");
  }

  async takeHandoff(conversationId: string, actor: { userId: string; label: string }) {
    await Promise.all([ensureRuntimeSchema(), ensureReasonSchema(), ensureConversationWorkflowSchema()]);
    const sql = getDatabase();
    const rows = await sql`WITH assumed AS (
      UPDATE conversations SET status='human_active', human_started_at=COALESCE(human_started_at, now()),
      human_expires_at=now() + interval '12 hours', processed_revision=inbound_revision,
      assigned_attendant_user_id=${actor.userId}, assigned_attendant_at=COALESCE(assigned_attendant_at, now()),
      assignment_version=assignment_version + 1,
      last_human_actor_user_id=${actor.userId}, last_human_actor_label=${actor.label},
      processing_token=NULL, processing_revision=NULL, processing_lease_until=NULL,
      updated_at=now() WHERE id=${conversationId} AND status IN ('human_requested','human_active')
        AND (assigned_attendant_user_id IS NULL OR assigned_attendant_user_id=${actor.userId})
      RETURNING id, assignment_version
    )
    INSERT INTO conversation_events (conversation_id, event_type, actor_user_id, actor_label,
      to_user_id, to_user_label, reason_id, idempotency_key)
    SELECT id, 'assumed', ${actor.userId}, ${actor.label}, ${actor.userId}, ${actor.label},
      handoff_reason_id, 'take-handoff:' || assumed.id::text || ':' || assumed.assignment_version::text
    FROM assumed JOIN conversations c ON c.id=assumed.id
    ON CONFLICT (idempotency_key) DO NOTHING RETURNING conversation_id` as Array<{ conversation_id: string }>;
    if (!rows[0]) throw new Error("Conversation is assigned to another attendant");
    if (await isFeatureEnabled("sla_engine")) await completeConversationSla(conversationId);
    await this.recordHandoffEvent(conversationId, "handoff_taken");
  }

  async touchHandoff(conversationId: string, actorUserId: string) {
    await Promise.all([ensureRuntimeSchema(), ensureReasonSchema()]); const sql = getDatabase();
    const rows = await sql`UPDATE conversations SET human_expires_at=now() + interval '12 hours', last_message_at=now(), updated_at=now()
      WHERE id=${conversationId} AND status='human_active' AND assigned_attendant_user_id=${actorUserId}
      RETURNING id` as Array<{ id: string }>;
    if (!rows[0]) throw new Error("Conversation is not owned by this attendant");
  }

  async closeHandoff(input: { conversationId: string; actorUserId: string; actorLabel: string;
    reasonId: string; reasonLabel: string; note?: string }) {
    await Promise.all([ensureRuntimeSchema(), ensureReasonSchema()]); const sql = getDatabase();
    const rows = await sql`UPDATE conversations SET status='closed', closed_at=now(), human_expires_at=NULL, updated_at=now(),
      closure_reason_id=${input.reasonId}, closure_note=${input.note ?? null}, closure_origin='human',
      closed_by_user_id=${input.actorUserId}, last_human_actor_user_id=${input.actorUserId},
      last_human_actor_label=${input.actorLabel},
      awaiting_customer_since=NULL, awaiting_customer_by_user_id=NULL,
      awaiting_customer_deadline_at=NULL, inactivity_token=NULL,
      processed_revision=inbound_revision, processing_token=NULL, processing_revision=NULL,
      processing_lease_until=NULL WHERE id=${input.conversationId} AND status='human_active'
        AND assigned_attendant_user_id=${input.actorUserId}
      RETURNING id, contact_id` as Array<{ id: string; contact_id: string }>;
    if (!rows[0]) throw new Error("Conversation is not owned by this attendant");
    await sql`INSERT INTO interaction_events (contact_id, event_type, metadata)
      VALUES (${rows[0].contact_id}, 'handoff_closed', jsonb_build_object(
        'conversationId', ${input.conversationId}, 'reasonId', ${input.reasonId},
        'reasonLabel', ${input.reasonLabel}, 'actorUserId', ${input.actorUserId}))`;
    await sql`INSERT INTO conversation_events (conversation_id, event_type, actor_user_id, actor_label,
      reason_id, internal_note, idempotency_key)
      VALUES (${input.conversationId}, 'closed_human', ${input.actorUserId}, ${input.actorLabel},
        ${input.reasonId}, ${input.note ?? null}, ${`closed-human:${input.conversationId}`})
      ON CONFLICT (idempotency_key) DO NOTHING`;
    await recordConversationOutcome({ conversationId: input.conversationId, origin: "human",
      reasonId: input.reasonId, responsibleUserId: input.actorUserId });
    await scheduleCxSurveyBestEffort(input.conversationId);
  }

  async transferHandoff(input: { conversationId: string; actorUserId: string; actorLabel: string;
    actorCanForce: boolean; expectedAssignmentVersion: number; targetUserId: string;
    targetLabel: string; reasonId: string; reasonLabel: string; note?: string;
    idempotencyKey: string }): Promise<void> {
    await Promise.all([ensureRuntimeSchema(), ensureReasonSchema(), ensureConversationWorkflowSchema()]);
    const sql = getDatabase();
    const rows = await sql`WITH existing AS MATERIALIZED (
      SELECT conversation_id FROM conversation_events
      WHERE idempotency_key=${input.idempotencyKey} AND conversation_id=${input.conversationId}
    ), current AS MATERIALIZED (
      SELECT c.id, c.assigned_attendant_user_id,
        (SELECT display_name FROM attendant_profiles
          WHERE clerk_user_id=c.assigned_attendant_user_id) assigned_attendant_label
      FROM conversations c
      WHERE id=${input.conversationId} AND status IN ('active','human_requested','human_active')
        AND assignment_version=${input.expectedAssignmentVersion}
        AND (${input.actorCanForce} OR assigned_attendant_user_id=${input.actorUserId})
        AND assigned_attendant_user_id IS DISTINCT FROM ${input.targetUserId}
        AND (human_send_token IS NULL OR human_send_lease_until <= now())
      FOR UPDATE
    ), moved AS (
      UPDATE conversations c SET status='human_active',
        handoff_reason=${input.reasonLabel},
        handoff_reason_id=${input.reasonId},
        handoff_requested_at=COALESCE(c.handoff_requested_at, now()),
        human_started_at=COALESCE(c.human_started_at, now()),
        assigned_attendant_user_id=${input.targetUserId},
        assigned_attendant_at=now(), assignment_version=assignment_version + 1,
        last_human_actor_user_id=${input.actorUserId}, last_human_actor_label=${input.actorLabel},
        awaiting_customer_since=NULL, awaiting_customer_by_user_id=NULL,
        awaiting_customer_deadline_at=NULL, inactivity_token=NULL,
        next_process_at=NULL, processing_token=NULL, processing_revision=NULL,
        processing_lease_until=NULL,
        human_expires_at=now() + interval '12 hours',
        updated_at=now()
      FROM current WHERE c.id=current.id
      RETURNING c.id, current.assigned_attendant_user_id from_user_id,
        current.assigned_attendant_label from_user_label, c.assignment_version
    ), event_inserted AS (
      INSERT INTO conversation_events (conversation_id, event_type, actor_user_id, actor_label,
        from_user_id, from_user_label, to_user_id, to_user_label, reason_id, internal_note,
        idempotency_key)
      SELECT id, 'transferred', ${input.actorUserId}, ${input.actorLabel}, from_user_id,
        from_user_label, ${input.targetUserId}, ${input.targetLabel}, ${input.reasonId},
        ${input.note ?? null}, ${input.idempotencyKey}
      FROM moved ON CONFLICT (idempotency_key) DO NOTHING RETURNING conversation_id
    ) SELECT EXISTS(SELECT 1 FROM moved) OR EXISTS(SELECT 1 FROM existing) success` as Array<{ success: boolean }>;
    if (rows[0]?.success !== true) throw new Error("Conversation assignment changed");
  }

  async setAwaitingCustomer(input: { conversationId: string; actorUserId: string; actorLabel: string;
    expectedAssignmentVersion: number; enabled: boolean; inactivityMinutes?: number;
    idempotencyKey: string }): Promise<{ inactivityToken?: string; delaySeconds?: number }> {
    await Promise.all([ensureRuntimeSchema(), ensureReasonSchema(), ensureConversationWorkflowSchema()]);
    const sql = getDatabase();
    const inactivityToken = input.enabled && input.inactivityMinutes ? randomUUID() : undefined;
    const rows = await sql`WITH existing AS MATERIALIZED (
      SELECT conversation_id FROM conversation_events
      WHERE idempotency_key=${input.idempotencyKey} AND conversation_id=${input.conversationId}
    ), changed AS (
      UPDATE conversations SET
        awaiting_customer_since=CASE WHEN ${input.enabled} THEN now() ELSE NULL END,
        awaiting_customer_by_user_id=CASE WHEN ${input.enabled} THEN ${input.actorUserId} ELSE NULL END,
        awaiting_customer_deadline_at=CASE WHEN ${input.enabled} AND ${input.inactivityMinutes ?? null}::integer IS NOT NULL
          THEN now() + make_interval(mins => ${input.inactivityMinutes ?? 0}) ELSE NULL END,
        inactivity_token=CASE WHEN ${input.enabled} THEN ${inactivityToken ?? null} ELSE NULL END,
        assignment_version=assignment_version + 1,
        human_expires_at=now() + interval '12 hours', updated_at=now()
      WHERE id=${input.conversationId} AND status='human_active'
        AND assigned_attendant_user_id=${input.actorUserId}
        AND assignment_version=${input.expectedAssignmentVersion}
        AND ((${input.enabled} AND awaiting_customer_since IS NULL)
          OR (NOT ${input.enabled} AND awaiting_customer_since IS NOT NULL))
      RETURNING id
    ), event_inserted AS (
      INSERT INTO conversation_events (conversation_id, event_type, actor_user_id, actor_label,
        metadata, idempotency_key)
      SELECT id, ${input.enabled ? "awaiting_customer_started" : "awaiting_customer_cancelled"},
        ${input.actorUserId}, ${input.actorLabel},
        jsonb_build_object('origin', ${input.enabled ? "attendant" : "attendant_resume"}),
        ${input.idempotencyKey}
      FROM changed ON CONFLICT (idempotency_key) DO NOTHING RETURNING conversation_id
    ) SELECT EXISTS(SELECT 1 FROM changed) OR EXISTS(SELECT 1 FROM existing) success` as Array<{ success: boolean }>;
    if (rows[0]?.success !== true) throw new Error("Conversation workflow changed");
    return inactivityToken && input.inactivityMinutes
      ? { inactivityToken, delaySeconds: input.inactivityMinutes * 60 }
      : {};
  }

  async resumePendingHandoff(conversationId: string): Promise<boolean> {
    await ensureRuntimeSchema();
    const sql = getDatabase();
    const rows = await sql`WITH resumed AS (
      UPDATE conversations SET status='active', handoff_reason=NULL, handoff_source=NULL,
        handoff_requested_at=NULL, summary=NULL, human_expires_at=NULL,
        processing_token=NULL, processing_revision=NULL, processing_lease_until=NULL,
        updated_at=now()
      WHERE id=${conversationId} AND status='human_requested' AND human_started_at IS NULL
      RETURNING id, contact_id
    )
    INSERT INTO interaction_events (contact_id, event_type, metadata)
    SELECT contact_id, 'handoff_cancelled_by_customer_reset', jsonb_build_object('conversationId', id)
    FROM resumed RETURNING contact_id` as Array<{ contact_id: string }>;
    return Boolean(rows[0]);
  }

  async returnToAgent(input: { conversationId: string; actorUserId: string; actorLabel: string }): Promise<void> {
    await Promise.all([ensureRuntimeSchema(), ensureReasonSchema(), ensureConversationWorkflowSchema()]);
    const sql = getDatabase();
    const rows = await sql`WITH returned AS (
      UPDATE conversations SET status='active', handoff_reason=NULL, handoff_source=NULL,
        handoff_requested_at=NULL, summary=NULL, human_started_at=NULL, human_expires_at=NULL,
        assigned_attendant_user_id=NULL, awaiting_customer_since=NULL,
        awaiting_customer_by_user_id=NULL, awaiting_customer_deadline_at=NULL,
        inactivity_token=NULL, processing_token=NULL, processing_revision=NULL,
        processing_lease_until=NULL, processed_revision=inbound_revision,
        next_process_at=NULL, updated_at=now(),
        assignment_version=assignment_version + 1
      WHERE id=${input.conversationId} AND status IN ('human_requested','human_active')
        AND (human_send_token IS NULL OR human_send_lease_until <= now())
      RETURNING id, contact_id, inbound_revision, processed_revision
    ), event_inserted AS (
      INSERT INTO conversation_events (conversation_id, event_type, actor_user_id, actor_label,
        metadata, idempotency_key)
      SELECT id, 'returned_to_agent', ${input.actorUserId}, ${input.actorLabel},
        jsonb_build_object('origin', 'preview_control'),
        'returned-to-agent:' || id::text || ':' || assignment_version::text
      FROM returned JOIN conversations USING (id)
      ON CONFLICT (idempotency_key) DO NOTHING
    ) SELECT id, contact_id, inbound_revision, processed_revision FROM returned` as Array<{
      id: string; contact_id: string; inbound_revision: number; processed_revision: number;
    }>;
    if (!rows[0]) throw new Error("Conversation cannot be returned to the agent");
    await sql`INSERT INTO interaction_events (contact_id, event_type, metadata)
      VALUES (${rows[0].contact_id}, 'returned_to_agent', jsonb_build_object(
        'conversationId', ${input.conversationId}, 'actorUserId', ${input.actorUserId}))`;
  }

  async markHandoffViewed(conversationId: string, viewerUserId: string) {
    await Promise.all([ensureRuntimeSchema(), ensureReasonSchema()]); const sql = getDatabase();
    await sql`INSERT INTO conversation_views (conversation_id, viewer_user_id, last_viewed_at)
      SELECT id, ${viewerUserId}, now() FROM conversations WHERE id=${conversationId}
      ON CONFLICT (conversation_id, viewer_user_id) DO UPDATE SET last_viewed_at=EXCLUDED.last_viewed_at`;
  }

  async recordHandoffEvent(conversationId: string, eventType: string) {
    const sql = getDatabase();
    await sql`INSERT INTO interaction_events (contact_id, event_type, metadata)
      SELECT contact_id, ${eventType}, jsonb_build_object('conversationId', id)
      FROM conversations WHERE id=${conversationId}`;
  }

  async recordOutbound(input: { conversationId: string; content: string; actorUserId?: string; actorLabel?: string }) {
    await ensureReasonSchema(); const sql = getDatabase();
    await sql`WITH outbound AS (
      INSERT INTO messages (conversation_id, direction, role, content, delivery_status, sent_at, actor_user_id, actor_label)
      VALUES (${input.conversationId}, 'outbound', 'assistant', ${input.content}, 'sent', now(),
        ${input.actorUserId ?? null}, ${input.actorLabel ?? null})
    ) UPDATE conversations SET last_message_at=now(), updated_at=now() WHERE id=${input.conversationId}`;
  }

  async reserveHumanReply(input: { conversationId: string; actorUserId: string;
    expectedAssignmentVersion: number; idempotencyKey: string }): Promise<
      | { kind: "reserved"; token: string; providerAccountId: string; providerConversationId: string }
      | { kind: "already_sent" }
      | { kind: "conflict" }> {
    await Promise.all([ensureRuntimeSchema(), ensureReasonSchema(), ensureConversationWorkflowSchema()]);
    const sql = getDatabase();
    const alreadySent = await sql`SELECT id FROM messages
      WHERE idempotency_key=${input.idempotencyKey} AND delivery_status='sent' LIMIT 1` as Array<{ id: string }>;
    if (alreadySent[0]) return { kind: "already_sent" };

    const token = randomUUID();
    const rows = await sql`UPDATE conversations SET human_send_token=${token},
      human_send_lease_until=now() + interval '90 seconds', updated_at=now()
      WHERE id=${input.conversationId} AND status='human_active'
        AND assigned_attendant_user_id=${input.actorUserId}
        AND assignment_version=${input.expectedAssignmentVersion}
        AND (human_send_token IS NULL OR human_send_lease_until <= now())
      RETURNING provider_account_id, provider_conversation_id` as Array<{
        provider_account_id: string | null; provider_conversation_id: string | null }>;
    const row = rows[0];
    if (!row?.provider_account_id || !row.provider_conversation_id) {
      if (row) await this.releaseHumanReply({ conversationId: input.conversationId, token });
      return { kind: "conflict" };
    }
    return { kind: "reserved", token, providerAccountId: row.provider_account_id,
      providerConversationId: row.provider_conversation_id };
  }

  async completeHumanReply(input: { conversationId: string; token: string; idempotencyKey: string;
    content: string; actorUserId: string; actorLabel: string }): Promise<void> {
    const sql = getDatabase();
    const results = await sql.transaction((tx) => [
      tx`INSERT INTO messages (conversation_id, direction, role, content, delivery_status, sent_at,
          actor_user_id, actor_label, idempotency_key)
        SELECT id, 'outbound', 'assistant', ${input.content}, 'sent', now(), ${input.actorUserId},
          ${input.actorLabel}, ${input.idempotencyKey}
        FROM conversations WHERE id=${input.conversationId} AND human_send_token=${input.token}
        ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING id`,
      tx`UPDATE conversations SET human_send_token=NULL, human_send_lease_until=NULL,
          last_message_at=now(), human_expires_at=now() + interval '12 hours', updated_at=now()
        WHERE id=${input.conversationId} AND human_send_token=${input.token} RETURNING id`,
    ]);
    if (!(results[1] as Array<{ id: string }>)[0]) throw new Error("Human reply lease expired");
  }

  async releaseHumanReply(input: { conversationId: string; token: string }): Promise<void> {
    const sql = getDatabase();
    await sql`UPDATE conversations SET human_send_token=NULL, human_send_lease_until=NULL, updated_at=now()
      WHERE id=${input.conversationId} AND human_send_token=${input.token}`;
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
      next_process_at=NULL, batch_started_at=NULL, updated_at=now()
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

  async completeAutomaticClosure(input: { conversationId: string; revision: number; token: string;
    reasonId: "customer_satisfied"; analysis?: unknown; responsePlan?: unknown }): Promise<boolean> {
    await Promise.all([ensureReasonSchema(), ensureConversationWorkflowSchema()]);
    const sql = getDatabase();
    const analysis = input.analysis === undefined ? null : JSON.stringify(input.analysis);
    const responsePlan = input.responsePlan === undefined ? null : JSON.stringify(input.responsePlan);
    const idempotencyKey = `zernio-turn-${input.conversationId}-${input.revision}-0`;
    const rows = await sql`WITH eligible AS MATERIALIZED (
      SELECT id, contact_id FROM conversations
      WHERE id=${input.conversationId} AND status='active'
        AND inbound_revision=${input.revision} AND processing_revision=${input.revision}
        AND processing_token=${input.token} AND processing_lease_until > now()
        AND EXISTS (SELECT 1 FROM messages WHERE conversation_id=${input.conversationId}
          AND response_revision=${input.revision} AND idempotency_key=${idempotencyKey}
          AND delivery_status='sent')
      FOR UPDATE
    ), turn_completed AS (
      UPDATE conversation_turns t SET state='replied', analysis=${analysis}::jsonb,
        response_plan=${responsePlan}::jsonb, completed_at=now(), updated_at=now()
      FROM eligible e WHERE t.conversation_id=e.id AND t.revision=${input.revision}
      RETURNING t.conversation_id
    ), conversation_closed AS (
      UPDATE conversations c SET status='closed', closed_at=now(), human_expires_at=NULL,
        closure_reason_id=${input.reasonId}, closure_origin='automatic', closure_note=NULL,
        closed_by_user_id=NULL, processed_revision=${input.revision}, next_process_at=NULL,
        processing_token=NULL, processing_revision=NULL, processing_lease_until=NULL,
        awaiting_customer_since=NULL, awaiting_customer_by_user_id=NULL,
        awaiting_customer_deadline_at=NULL, inactivity_token=NULL, updated_at=now()
      FROM eligible e, turn_completed t
      WHERE c.id=e.id AND t.conversation_id=e.id
      RETURNING c.id, c.contact_id
    ), event_recorded AS (
      INSERT INTO interaction_events (contact_id, event_type, metadata)
      SELECT contact_id, 'conversation_closed_automatically',
        jsonb_build_object('conversationId', id, 'reasonId', ${input.reasonId})
      FROM conversation_closed RETURNING contact_id
    ), workflow_event AS (
      INSERT INTO conversation_events (conversation_id, event_type, reason_id, idempotency_key)
      SELECT id, 'closed_automatic', ${input.reasonId}, 'closed-automatic:' || id::text
      FROM conversation_closed ON CONFLICT (idempotency_key) DO NOTHING RETURNING conversation_id
    ) SELECT EXISTS(SELECT 1 FROM event_recorded) completed` as Array<{ completed: boolean }>;
    const completed = rows[0]?.completed === true;
    if (completed) await recordConversationOutcome({ conversationId: input.conversationId,
      origin: "automatic", reasonId: input.reasonId });
    if (completed) await scheduleCxSurveyBestEffort(input.conversationId);
    return completed;
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
    await Promise.all([ensureReasonSchema(), ensureConversationWorkflowSchema()]);
    const sql = getDatabase();
    const [rows, eventRows] = await Promise.all([sql`
      SELECT * FROM (
        SELECT id, conversation_id, provider_message_id, direction, role, content, created_at,
          input_revision, response_revision, actor_user_id, actor_label
        FROM messages WHERE conversation_id=${conversationId}
          AND (direction='inbound' OR delivery_status='sent')
        ORDER BY created_at DESC, id DESC LIMIT ${limit}
      ) recent ORDER BY created_at ASC, id ASC
    `, sql`SELECT e.id, e.conversation_id, e.event_type, e.actor_label,
        e.from_user_label, e.to_user_label, r.label reason_label, e.internal_note, e.occurred_at
      FROM conversation_events e
      LEFT JOIN conversation_reason_catalog r ON r.id=e.reason_id
      WHERE e.conversation_id=${conversationId}
      ORDER BY e.occurred_at DESC, e.id DESC LIMIT ${limit}`]) as [Array<{
        id: string; conversation_id: string; provider_message_id: string | null;
        direction: "inbound" | "outbound"; role: "user" | "assistant" | "system";
        content: string; created_at: Date; input_revision: string | number | null;
        response_revision: string | number | null; actor_user_id: string | null;
        actor_label: string | null }>, Array<{
        id: string; conversation_id: string; event_type: ConversationWorkflowEventType;
        actor_label: string | null; from_user_label: string | null; to_user_label: string | null;
        reason_label: string | null; internal_note: string | null; occurred_at: Date }>];
    const messages = rows.map((row): ConversationMessage => ({
      id: row.id, conversationId: row.conversation_id, direction: row.direction, role: row.role,
      content: row.content, createdAt: new Date(row.created_at), kind: "message", visibility: "customer",
      ...(row.provider_message_id ? { providerMessageId: row.provider_message_id } : {}),
      ...(row.input_revision !== null ? { inputRevision: Number(row.input_revision) } : {}),
      ...(row.response_revision !== null ? { responseRevision: Number(row.response_revision) } : {}),
      ...(row.actor_user_id ? { actorUserId: row.actor_user_id } : {}),
      ...(row.actor_label ? { actorLabel: row.actor_label } : {}),
    }));
    const events = eventRows.map((row): ConversationMessage => ({
      id: row.id, conversationId: row.conversation_id, direction: "outbound", role: "system",
      kind: "workflow_event", visibility: "internal", createdAt: new Date(row.occurred_at),
      content: workflowEventText({ eventType: row.event_type,
        ...(row.actor_label ? { actorLabel: row.actor_label } : {}),
        ...(row.from_user_label ? { fromUserLabel: row.from_user_label } : {}),
        ...(row.to_user_label ? { toUserLabel: row.to_user_label } : {}),
        ...(row.reason_label ? { reasonLabel: row.reason_label } : {}),
        ...(row.internal_note ? { internalNote: row.internal_note } : {}) }),
      ...(row.actor_label ? { actorLabel: row.actor_label } : {}),
    }));
    return [...messages, ...events]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
      .slice(-limit);
  }

  async getJourneyState(conversationId: string) {
    await ensureRuntimeSchema();
    const sql = getDatabase();
    const rows = await sql`SELECT schema_version, stage, goals, latest_goals, service_family,
      recommended_services, selected_service, facts_sent, offers, scheduling, dialogue, active_pilates,
      last_action, updated_from_revision
      FROM conversation_journey_states WHERE conversation_id=${conversationId} LIMIT 1` as ConversationJourneyStateRow[];
    return rows[0] ? deserializeConversationJourneyState(rows[0]) : undefined;
  }

  async saveJourneyState(input: Parameters<ConversationJourneyStateStore["saveJourneyState"]>[0]): Promise<JourneyStateSaveResult> {
    await ensureRuntimeSchema();
    const sql = getDatabase();
    const state = serializeConversationJourneyState(input.state);
    // The conversation revision guard prevents a slow turn from persisting state
    // after a newer inbound message has already superseded it. The conflict guard
    // additionally prevents an older journey snapshot from replacing a newer one.
    const rows = await sql`INSERT INTO conversation_journey_states (
        conversation_id, schema_version, stage, goals, latest_goals, service_family,
        recommended_services, selected_service, facts_sent, offers, scheduling, dialogue,
        active_pilates, last_action, updated_from_revision)
      SELECT c.id, ${state.schemaVersion}, ${state.stage}, ${state.goalsJson}::jsonb,
        ${state.latestGoalsJson}::jsonb, ${state.serviceFamily}, ${state.recommendedServicesJson}::jsonb,
        ${state.selectedService}, ${state.factsSentJson}::jsonb, ${state.offersJson}::jsonb,
        ${state.schedulingJson}::jsonb, ${state.dialogueJson}::jsonb, ${state.activePilates}, ${state.lastAction},
        ${state.updatedFromRevision}
      FROM conversations c
      WHERE c.id=${input.conversationId} AND c.inbound_revision=${state.updatedFromRevision}
      ON CONFLICT (conversation_id) DO UPDATE SET
        schema_version=EXCLUDED.schema_version, stage=EXCLUDED.stage, goals=EXCLUDED.goals,
        latest_goals=EXCLUDED.latest_goals, service_family=EXCLUDED.service_family,
        recommended_services=EXCLUDED.recommended_services, selected_service=EXCLUDED.selected_service,
        facts_sent=EXCLUDED.facts_sent, offers=EXCLUDED.offers, scheduling=EXCLUDED.scheduling,
        dialogue=EXCLUDED.dialogue,
        active_pilates=EXCLUDED.active_pilates, last_action=EXCLUDED.last_action,
        updated_from_revision=EXCLUDED.updated_from_revision, updated_at=now()
      WHERE conversation_journey_states.updated_from_revision <= EXCLUDED.updated_from_revision
      RETURNING conversation_id` as Array<{ conversation_id: string }>;
    return rows[0] ? "saved" : "stale";
  }

  async completeTurnWithJourneyState(input: CompleteTurnWithJourneyStateInput): Promise<boolean> {
    await ensureRuntimeSchema();
    const sql = getDatabase();
    const state = serializeJourneyStateForRevision(input.journeyState, input.revision);
    const analysis = input.analysis === undefined ? null : JSON.stringify(input.analysis);
    const responsePlan = input.responsePlan === undefined ? null : JSON.stringify(input.responsePlan);
    // Persisting the journey is part of completing the turn, rather than a
    // best-effort follow-up. A newer inbound revision or expired lease leaves
    // both the turn and its journey snapshot untouched.
    const rows = await sql`WITH eligible AS MATERIALIZED (
      SELECT c.id
      FROM conversations c
      WHERE c.id=${input.conversationId} AND c.status='active'
        AND c.inbound_revision=${input.revision} AND c.processing_revision=${input.revision}
        AND c.processing_token=${input.token} AND c.processing_lease_until > now()
        AND EXISTS (SELECT 1 FROM conversation_turns t
          WHERE t.conversation_id=c.id AND t.revision=${input.revision})
        AND NOT EXISTS (SELECT 1 FROM conversation_journey_states j
          WHERE j.conversation_id=c.id AND j.updated_from_revision > ${input.revision})
      FOR UPDATE
    ), journey_saved AS (
      INSERT INTO conversation_journey_states (
        conversation_id, schema_version, stage, goals, latest_goals, service_family,
        recommended_services, selected_service, facts_sent, offers, scheduling, dialogue,
        active_pilates, last_action, updated_from_revision)
      SELECT e.id, ${state.schemaVersion}, ${state.stage}, ${state.goalsJson}::jsonb,
        ${state.latestGoalsJson}::jsonb, ${state.serviceFamily}, ${state.recommendedServicesJson}::jsonb,
        ${state.selectedService}, ${state.factsSentJson}::jsonb, ${state.offersJson}::jsonb,
        ${state.schedulingJson}::jsonb, ${state.dialogueJson}::jsonb, ${state.activePilates}, ${state.lastAction},
        ${state.updatedFromRevision}
      FROM eligible e
      ON CONFLICT (conversation_id) DO UPDATE SET
        schema_version=EXCLUDED.schema_version, stage=EXCLUDED.stage, goals=EXCLUDED.goals,
        latest_goals=EXCLUDED.latest_goals, service_family=EXCLUDED.service_family,
        recommended_services=EXCLUDED.recommended_services, selected_service=EXCLUDED.selected_service,
        facts_sent=EXCLUDED.facts_sent, offers=EXCLUDED.offers, scheduling=EXCLUDED.scheduling,
        dialogue=EXCLUDED.dialogue,
        active_pilates=EXCLUDED.active_pilates, last_action=EXCLUDED.last_action,
        updated_from_revision=EXCLUDED.updated_from_revision, updated_at=now()
      WHERE conversation_journey_states.updated_from_revision <= EXCLUDED.updated_from_revision
      RETURNING conversation_id
    ), turn_completed AS (
      UPDATE conversation_turns t SET state='replied', analysis=${analysis}::jsonb,
        response_plan=${responsePlan}::jsonb, completed_at=now(), updated_at=now()
      FROM journey_saved j
      WHERE t.conversation_id=j.conversation_id AND t.revision=${input.revision}
      RETURNING t.conversation_id
    ), conversation_completed AS (
      UPDATE conversations c SET processed_revision=${input.revision}, next_process_at=NULL,
        processing_token=NULL, processing_revision=NULL, processing_lease_until=NULL, updated_at=now()
      FROM turn_completed t
      WHERE c.id=t.conversation_id AND c.status='active'
        AND c.inbound_revision=${input.revision} AND c.processing_revision=${input.revision}
        AND c.processing_token=${input.token} AND c.processing_lease_until > now()
      RETURNING c.id
    )
    SELECT EXISTS(SELECT 1 FROM conversation_completed) completed` as Array<{ completed: boolean }>;
    return rows[0]?.completed === true;
  }

  async completeJourneyHandoff(input: CompleteJourneyHandoffInput): Promise<boolean> {
    await Promise.all([ensureRuntimeSchema(), ensureReasonSchema()]);
    const sql = getDatabase();
    const state = serializeCompletedJourneyHandoffState(
      input.journeyState,
      input.revision,
      input.outboundRevision,
      input.outboundIdempotencyKey,
    );
    const analysis = input.analysis === undefined ? null : JSON.stringify(input.analysis);
    const responsePlan = input.responsePlan === undefined ? null : JSON.stringify(input.responsePlan);
    const now = input.now ?? new Date();
    const reasonId = inferHandoffReasonId({ source: input.source, reason: input.reason });
    // One PostgreSQL statement owns the conversation row, persists the delivered
    // journey outcome, completes the turn, transfers ownership, and records the
    // event. A current lease is the strict path; after provider delivery, the
    // persisted sent outbound is durable proof that handoff must still win a race
    // with a newer inbound revision.
    const rows = await sql`WITH eligible AS MATERIALIZED (
      SELECT c.id, c.contact_id, c.inbound_revision,
        EXISTS (SELECT 1 FROM messages m
          WHERE m.conversation_id=c.id AND m.direction='outbound'
            AND m.response_revision=${input.outboundRevision}
            AND m.idempotency_key=${input.outboundIdempotencyKey}
            AND m.delivery_status='sent') sent_outbound
      FROM conversations c
      WHERE c.id=${input.conversationId} AND c.status='active'
        AND c.inbound_revision >= ${input.revision}
        AND (
          (${input.outboundRevision}=${input.revision}
            AND c.inbound_revision=${input.revision} AND c.processing_revision=${input.revision}
            AND c.processing_token=${input.token} AND c.processing_lease_until > now())
          OR EXISTS (SELECT 1 FROM messages m
            WHERE m.conversation_id=c.id AND m.direction='outbound'
              AND m.response_revision=${input.outboundRevision}
              AND m.idempotency_key=${input.outboundIdempotencyKey}
              AND m.delivery_status='sent')
        )
        AND EXISTS (SELECT 1 FROM conversation_turns t
          WHERE t.conversation_id=c.id AND t.revision=${input.revision})
        AND NOT EXISTS (SELECT 1 FROM conversation_journey_states j
          WHERE j.conversation_id=c.id AND j.updated_from_revision > c.inbound_revision)
      FOR UPDATE
    ), journey_saved AS (
      INSERT INTO conversation_journey_states (
        conversation_id, schema_version, stage, goals, latest_goals, service_family,
        recommended_services, selected_service, facts_sent, offers, scheduling, dialogue,
        active_pilates, last_action, updated_from_revision)
      SELECT e.id, ${state.schemaVersion}, ${state.stage}, ${state.goalsJson}::jsonb,
        ${state.latestGoalsJson}::jsonb, ${state.serviceFamily}, ${state.recommendedServicesJson}::jsonb,
        ${state.selectedService}, ${state.factsSentJson}::jsonb, ${state.offersJson}::jsonb,
        ${state.schedulingJson}::jsonb, ${state.dialogueJson}::jsonb, ${state.activePilates}, ${state.lastAction},
        e.inbound_revision
      FROM eligible e
      ON CONFLICT (conversation_id) DO UPDATE SET
        schema_version=EXCLUDED.schema_version, stage=EXCLUDED.stage, goals=EXCLUDED.goals,
        latest_goals=EXCLUDED.latest_goals, service_family=EXCLUDED.service_family,
        recommended_services=EXCLUDED.recommended_services, selected_service=EXCLUDED.selected_service,
        facts_sent=EXCLUDED.facts_sent, offers=EXCLUDED.offers, scheduling=EXCLUDED.scheduling,
        dialogue=EXCLUDED.dialogue,
        active_pilates=EXCLUDED.active_pilates, last_action=EXCLUDED.last_action,
        updated_from_revision=EXCLUDED.updated_from_revision, updated_at=now()
      WHERE conversation_journey_states.updated_from_revision <= EXCLUDED.updated_from_revision
      RETURNING conversation_id
    ), turn_completed AS (
      UPDATE conversation_turns t SET state='handoff', analysis=${analysis}::jsonb,
        response_plan=${responsePlan}::jsonb, completed_at=now(), updated_at=now()
      FROM journey_saved j
      WHERE t.conversation_id=j.conversation_id AND t.revision=${input.revision}
      RETURNING t.conversation_id
    ), conversation_completed AS (
      UPDATE conversations c SET status='human_requested',
        provider_account_id=${input.providerAccountId},
        provider_conversation_id=${input.providerConversationId},
        handoff_reason=${input.reason}, handoff_source=${input.source},
        handoff_reason_id=${reasonId},
        handoff_requested_at=COALESCE(c.handoff_requested_at, ${now}), human_expires_at=NULL,
        summary=${input.summary}, processed_revision=c.inbound_revision, next_process_at=NULL,
        processing_token=NULL, processing_revision=NULL, processing_lease_until=NULL, updated_at=now()
      FROM turn_completed t
      JOIN eligible e ON e.id=t.conversation_id
      WHERE c.id=t.conversation_id AND c.status='active'
        AND c.inbound_revision=e.inbound_revision
        AND (
          (${input.outboundRevision}=${input.revision}
            AND e.inbound_revision=${input.revision} AND c.processing_revision=${input.revision}
            AND c.processing_token=${input.token} AND c.processing_lease_until > now())
          OR e.sent_outbound
        )
      RETURNING c.id, c.contact_id, c.inbound_revision
    ), event_recorded AS (
      INSERT INTO interaction_events (contact_id, event_type, metadata, occurred_at)
      SELECT c.contact_id, ${`handoff_requested:${input.source}`},
        jsonb_build_object('conversationId', c.id, 'revision', ${input.revision},
          'outboundRevision', ${input.outboundRevision},
          'coveredThroughRevision', c.inbound_revision, 'journey', true), ${now}
      FROM conversation_completed c
      RETURNING contact_id
    )
    SELECT EXISTS(SELECT 1 FROM event_recorded) completed` as Array<{ completed: boolean }>;
    return rows[0]?.completed === true;
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
