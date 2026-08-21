ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS assignment_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS awaiting_customer_by_user_id text,
  ADD COLUMN IF NOT EXISTS awaiting_customer_deadline_at timestamptz,
  ADD COLUMN IF NOT EXISTS human_send_token text,
  ADD COLUMN IF NOT EXISTS human_send_lease_until timestamptz;

UPDATE conversations SET assignment_version=1
WHERE assigned_attendant_user_id IS NOT NULL AND assignment_version=0;

CREATE INDEX IF NOT EXISTS conversations_owner_workflow_idx
  ON conversations(assigned_attendant_user_id, status, last_message_at DESC);

CREATE INDEX IF NOT EXISTS conversations_awaiting_customer_idx
  ON conversations(awaiting_customer_deadline_at)
  WHERE status='human_active' AND awaiting_customer_since IS NOT NULL;

CREATE TABLE IF NOT EXISTS conversation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'handoff_requested','assigned','assumed','transferred',
    'awaiting_customer_started','awaiting_customer_cancelled',
    'closed_human','closed_automatic','reopened'
  )),
  actor_user_id text,
  actor_label text,
  from_user_id text,
  from_user_label text,
  to_user_id text,
  to_user_label text,
  reason_id text REFERENCES conversation_reason_catalog(id),
  internal_note text CHECK (internal_note IS NULL OR char_length(internal_note) <= 500),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL UNIQUE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversation_events_conversation_occurred_idx
  ON conversation_events(conversation_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS app_feature_flags (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by_user_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_feature_flags (key, enabled) VALUES
  ('conversation_transfer', false),
  ('awaiting_customer', false),
  ('sla_engine', false),
  ('cx_surveys', false),
  ('promises', false),
  ('knowledge_publishing', false),
  ('new_app_shell', false),
  ('workforce_routing', false)
ON CONFLICT (key) DO NOTHING;
