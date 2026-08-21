ALTER TABLE conversation_events DROP CONSTRAINT IF EXISTS conversation_events_event_type_check;
ALTER TABLE conversation_events ADD CONSTRAINT conversation_events_event_type_check CHECK (event_type IN (
  'handoff_requested','assigned','assumed','transferred','awaiting_customer_started',
  'awaiting_customer_cancelled','closed_human','closed_automatic','reopened','sla_warning','sla_breached',
  'promise_created','promise_completed','promise_cancelled','promise_rescheduled','survey_sent','survey_answered'
));

CREATE TABLE IF NOT EXISTS conversation_outcomes (
  conversation_id uuid PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  origin text NOT NULL CHECK (origin IN ('human','automatic','technical')),
  reason_id text REFERENCES conversation_reason_catalog(id),
  responsible_user_id text,
  started_at timestamptz NOT NULL,
  closed_at timestamptz NOT NULL,
  team_time_seconds integer CHECK (team_time_seconds IS NULL OR team_time_seconds >= 0),
  customer_time_seconds integer CHECK (customer_time_seconds IS NULL OR customer_time_seconds >= 0),
  reopened_at timestamptz,
  reopened_as_conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cx_survey_settings (
  id text PRIMARY KEY CHECK (id='default'),
  enabled boolean NOT NULL DEFAULT false,
  sample_rate numeric NOT NULL DEFAULT 0 CHECK (sample_rate BETWEEN 0 AND 1),
  delay_minutes integer NOT NULL DEFAULT 5 CHECK (delay_minutes BETWEEN 0 AND 10080),
  expires_hours integer NOT NULL DEFAULT 72 CHECK (expires_hours BETWEEN 1 AND 720),
  updated_by_user_id text, updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO cx_survey_settings (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS cx_surveys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  survey_type text NOT NULL DEFAULT 'csat' CHECK (survey_type IN ('csat','ces')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','answered','expired','cancelled')),
  token_hash text NOT NULL UNIQUE,
  sampled boolean NOT NULL,
  available_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  sent_at timestamptz, answered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cx_survey_responses (
  survey_id uuid PRIMARY KEY REFERENCES cx_surveys(id) ON DELETE CASCADE,
  score integer NOT NULL CHECK (score BETWEEN 0 AND 10),
  comment text CHECK (comment IS NULL OR char_length(comment) <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversation_promises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  owner_user_id text NOT NULL,
  description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 3 AND 240),
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed','cancelled')),
  source text NOT NULL DEFAULT 'human' CHECK (source IN ('human','automatic')),
  timer_token text NOT NULL,
  completion_reason text,
  completed_at timestamptz, cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversation_promises_open_due_idx ON conversation_promises(due_at)
  WHERE status='open';

CREATE TABLE IF NOT EXISTS promise_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promise_id uuid NOT NULL REFERENCES conversation_promises(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('created','completed','cancelled','rescheduled')),
  actor_user_id text,
  reason text,
  due_at timestamptz,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
