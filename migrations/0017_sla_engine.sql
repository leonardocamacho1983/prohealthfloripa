ALTER TABLE conversation_events DROP CONSTRAINT IF EXISTS conversation_events_event_type_check;
ALTER TABLE conversation_events ADD CONSTRAINT conversation_events_event_type_check CHECK (event_type IN (
  'handoff_requested','assigned','assumed','transferred','awaiting_customer_started',
  'awaiting_customer_cancelled','closed_human','closed_automatic','reopened','sla_warning','sla_breached'
));

CREATE TABLE IF NOT EXISTS business_calendar_settings (
  id text PRIMARY KEY CHECK (id='default'),
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  weekly_schedule jsonb NOT NULL,
  holidays jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_by_user_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO business_calendar_settings (id, weekly_schedule) VALUES ('default',
  '{"0":{"enabled":false,"start":"08:00","end":"18:00"},"1":{"enabled":true,"start":"08:00","end":"18:00"},"2":{"enabled":true,"start":"08:00","end":"18:00"},"3":{"enabled":true,"start":"08:00","end":"18:00"},"4":{"enabled":true,"start":"08:00","end":"18:00"},"5":{"enabled":true,"start":"08:00","end":"18:00"},"6":{"enabled":false,"start":"08:00","end":"18:00"}}'::jsonb)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS sla_policies (
  id text PRIMARY KEY,
  label text NOT NULL,
  reason_category text,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high','urgent')),
  deadline_type text NOT NULL CHECK (deadline_type IN ('first_response','resolution')),
  target_business_minutes integer NOT NULL CHECK (target_business_minutes BETWEEN 1 AND 10080),
  warning_business_minutes integer NOT NULL CHECK (warning_business_minutes >= 0),
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO sla_policies (id, label, deadline_type, target_business_minutes, warning_business_minutes)
VALUES ('human_first_response_default', 'Primeira resposta humana', 'first_response', 15, 5)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS conversation_sla (
  conversation_id uuid PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  policy_id text NOT NULL REFERENCES sla_policies(id),
  status text NOT NULL DEFAULT 'normal' CHECK (status IN ('normal','warning','breached','paused','completed')),
  response_due_at timestamptz,
  resolution_due_at timestamptz,
  timer_token text NOT NULL,
  warning_emitted_at timestamptz,
  breached_at timestamptz,
  paused_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversation_sla_status_due_idx
  ON conversation_sla(status, response_due_at) WHERE status IN ('normal','warning','breached');

CREATE TABLE IF NOT EXISTS sla_pause_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('paused','resumed')),
  reason text NOT NULL,
  actor_user_id text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
