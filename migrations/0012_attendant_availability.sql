ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS assigned_attendant_user_id text,
  ADD COLUMN IF NOT EXISTS assigned_attendant_at timestamptz;

CREATE INDEX IF NOT EXISTS conversations_assigned_attendant_queue_idx
  ON conversations(assigned_attendant_user_id, handoff_requested_at ASC)
  WHERE status = 'human_requested';

CREATE TABLE IF NOT EXISTS attendant_profiles (
  clerk_user_id text PRIMARY KEY,
  display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 120),
  notification_phone_e164 text,
  notification_enabled boolean NOT NULL DEFAULT false,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  weekly_schedule jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_assignment_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (notification_phone_e164 IS NULL OR notification_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  CHECK (notification_enabled = false OR notification_phone_e164 IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS attendant_profiles_notifications_idx
  ON attendant_profiles(notification_enabled, last_assignment_at ASC NULLS FIRST)
  WHERE notification_enabled = true;

CREATE TABLE IF NOT EXISTS attendant_shift_digests (
  attendant_user_id text NOT NULL REFERENCES attendant_profiles(clerk_user_id) ON DELETE CASCADE,
  shift_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  pending_count integer NOT NULL DEFAULT 0 CHECK (pending_count >= 0),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  sent_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (attendant_user_id, shift_key)
);
