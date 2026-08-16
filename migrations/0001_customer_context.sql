CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), phone_number text NOT NULL UNIQUE,
  first_name text, relationship_status text NOT NULL DEFAULT 'unknown'
    CHECK (relationship_status IN ('unknown','prospect','lead','customer','former_customer')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','human_requested','human_active','closed')),
  started_at timestamptz NOT NULL DEFAULT now(), last_message_at timestamptz NOT NULL DEFAULT now(),
  summary text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS conversations_one_active_per_contact ON conversations(contact_id) WHERE status='active';
CREATE INDEX IF NOT EXISTS conversations_contact_id_idx ON conversations(contact_id);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  provider_message_id text, direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  role text NOT NULL CHECK (role IN ('user','assistant','system')), content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS messages_provider_message_id_unique ON messages(provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_conversation_created_idx ON messages(conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS customer_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contact_id uuid NOT NULL UNIQUE REFERENCES contacts(id) ON DELETE CASCADE,
  external_customer_id text, source text, customer_since date, date_of_birth date, financial_status text,
  last_visit_at timestamptz, next_visit_at timestamptz, active_contracts jsonb,
  consumed_services_summary jsonb, attendance_metrics jsonb, relationship_metrics jsonb,
  synced_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS interaction_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  event_type text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS interaction_events_contact_occurred_idx ON interaction_events(contact_id, occurred_at DESC);
