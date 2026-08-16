DROP INDEX IF EXISTS conversations_one_active_per_contact;
CREATE UNIQUE INDEX IF NOT EXISTS conversations_one_open_per_contact
  ON conversations(contact_id) WHERE status IN ('active','human_requested','human_active');

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS provider_account_id text,
  ADD COLUMN IF NOT EXISTS provider_conversation_id text,
  ADD COLUMN IF NOT EXISTS handoff_reason text,
  ADD COLUMN IF NOT EXISTS handoff_source text,
  ADD COLUMN IF NOT EXISTS handoff_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS human_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS human_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;

CREATE INDEX IF NOT EXISTS conversations_handoff_queue_idx
  ON conversations(status, handoff_requested_at DESC)
  WHERE status IN ('human_requested','human_active');
