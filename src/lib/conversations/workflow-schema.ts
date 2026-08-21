import "server-only";

import { getDatabase } from "@/lib/db/neon";
import { ensureReasonSchema } from "@/lib/reasons/repository";

let schemaPromise: Promise<void> | undefined;

export function ensureConversationWorkflowSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = ensureReasonSchema().then(async () => {
      const sql = getDatabase();
      await sql.transaction((tx) => [
        tx`ALTER TABLE conversations
          ADD COLUMN IF NOT EXISTS assignment_version integer NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS awaiting_customer_by_user_id text,
          ADD COLUMN IF NOT EXISTS awaiting_customer_deadline_at timestamptz,
          ADD COLUMN IF NOT EXISTS human_send_token text,
          ADD COLUMN IF NOT EXISTS human_send_lease_until timestamptz`,
        tx`UPDATE conversations SET assignment_version=1
          WHERE assigned_attendant_user_id IS NOT NULL AND assignment_version=0`,
        tx`CREATE INDEX IF NOT EXISTS conversations_owner_workflow_idx
          ON conversations(assigned_attendant_user_id, status, last_message_at DESC)`,
        tx`CREATE INDEX IF NOT EXISTS conversations_awaiting_customer_idx
          ON conversations(awaiting_customer_deadline_at)
          WHERE status='human_active' AND awaiting_customer_since IS NOT NULL`,
        tx`CREATE TABLE IF NOT EXISTS conversation_events (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          event_type text NOT NULL CHECK (event_type IN (
            'handoff_requested','assigned','assumed','transferred',
            'awaiting_customer_started','awaiting_customer_cancelled',
            'closed_human','closed_automatic','reopened','sla_warning','sla_breached',
            'promise_created','promise_completed','promise_cancelled','promise_rescheduled',
            'survey_sent','survey_answered')),
          actor_user_id text, actor_label text,
          from_user_id text, from_user_label text,
          to_user_id text, to_user_label text,
          reason_id text REFERENCES conversation_reason_catalog(id),
          internal_note text CHECK (internal_note IS NULL OR char_length(internal_note) <= 500),
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          idempotency_key text NOT NULL UNIQUE,
          occurred_at timestamptz NOT NULL DEFAULT now(),
          created_at timestamptz NOT NULL DEFAULT now())`,
        tx`CREATE INDEX IF NOT EXISTS conversation_events_conversation_occurred_idx
          ON conversation_events(conversation_id, occurred_at DESC)`,
        tx`DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conrelid='conversation_events'::regclass
              AND conname='conversation_events_event_type_check'
              AND pg_get_constraintdef(oid) LIKE '%survey_answered%'
          ) THEN
            ALTER TABLE conversation_events DROP CONSTRAINT IF EXISTS conversation_events_event_type_check;
            ALTER TABLE conversation_events ADD CONSTRAINT conversation_events_event_type_check CHECK (event_type IN (
              'handoff_requested','assigned','assumed','transferred','awaiting_customer_started',
              'awaiting_customer_cancelled','closed_human','closed_automatic','reopened','sla_warning','sla_breached',
              'promise_created','promise_completed','promise_cancelled','promise_rescheduled',
              'survey_sent','survey_answered'));
          END IF;
        END $$`,
      ]);
    }).catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }
  return schemaPromise;
}
