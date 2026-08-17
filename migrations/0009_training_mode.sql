CREATE TABLE IF NOT EXISTS training_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  provider_account_id text NOT NULL,
  display_name text NOT NULL DEFAULT 'Treinador',
  active boolean NOT NULL DEFAULT true,
  enrolled_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contact_id, provider_account_id)
);

CREATE TABLE IF NOT EXISTS training_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES training_profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'collecting' CHECK (status IN ('collecting','pending_review','approved','rejected','cancelled')),
  submitted_at timestamptz,
  review_due_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS training_one_collecting_session
  ON training_sessions(profile_id) WHERE status='collecting';

CREATE TABLE IF NOT EXISTS training_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
  inbound_message_id uuid NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
  sequence_number integer NOT NULL,
  item_type text NOT NULL CHECK (item_type IN ('commercial_fact','tone','faq','correction','workflow','unknown')),
  summary text NOT NULL,
  needs_clarification boolean NOT NULL DEFAULT false,
  clarification_question text,
  risk_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_kind text NOT NULL CHECK (source_kind IN ('text','audio')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inbound_message_id),
  UNIQUE (session_id, sequence_number)
);
