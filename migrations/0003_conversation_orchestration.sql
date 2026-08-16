ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS inbound_revision bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processed_revision bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_process_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_token text,
  ADD COLUMN IF NOT EXISTS processing_revision bigint,
  ADD COLUMN IF NOT EXISTS processing_lease_until timestamptz;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS input_revision bigint,
  ADD COLUMN IF NOT EXISTS response_revision bigint,
  ADD COLUMN IF NOT EXISTS bubble_index integer,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS delivery_status text NOT NULL DEFAULT 'sent'
    CHECK (delivery_status IN ('pending','sent','failed')),
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_attempts integer NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS messages_idempotency_key_unique
  ON messages(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS messages_conversation_input_revision_idx
  ON messages(conversation_id, input_revision)
  WHERE direction='inbound';

CREATE TABLE IF NOT EXISTS conversation_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  revision bigint NOT NULL,
  state text NOT NULL DEFAULT 'processing'
    CHECK (state IN ('processing','replied','suppressed','handoff','stale','failed')),
  inbound_count integer NOT NULL DEFAULT 0,
  analysis jsonb,
  response_plan jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, revision)
);

CREATE INDEX IF NOT EXISTS conversation_turns_state_idx
  ON conversation_turns(state, updated_at DESC);
