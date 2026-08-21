CREATE TABLE IF NOT EXISTS evaluation_cases (
  id text PRIMARY KEY, category text NOT NULL, input jsonb NOT NULL, expected jsonb NOT NULL,
  critical boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS evaluation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), subject_type text NOT NULL,
  subject_version text NOT NULL, status text NOT NULL CHECK (status IN ('running','passed','failed')),
  passed_count integer NOT NULL DEFAULT 0, failed_count integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
);
CREATE TABLE IF NOT EXISTS evaluation_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL REFERENCES evaluation_runs(id) ON DELETE CASCADE,
  case_id text NOT NULL REFERENCES evaluation_cases(id), passed boolean NOT NULL,
  scores jsonb NOT NULL DEFAULT '{}'::jsonb, failure_code text,
  UNIQUE (run_id, case_id)
);

CREATE TABLE IF NOT EXISTS attendant_schedule_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), attendant_user_id text NOT NULL,
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  kind text NOT NULL CHECK (kind IN ('unavailable','coverage')),
  reason text, created_by_user_id text, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS attendant_schedule_exceptions_active_idx
  ON attendant_schedule_exceptions(attendant_user_id, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS attendant_presence (
  attendant_user_id text PRIMARY KEY, state text NOT NULL CHECK (state IN ('available','paused','offline')),
  reason text, until_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS attendant_skills (
  attendant_user_id text NOT NULL, skill text NOT NULL, active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (attendant_user_id, skill)
);
CREATE TABLE IF NOT EXISTS attendant_capacity_settings (
  attendant_user_id text PRIMARY KEY, max_active_conversations integer NOT NULL DEFAULT 5
    CHECK (max_active_conversations BETWEEN 1 AND 100), updated_at timestamptz NOT NULL DEFAULT now()
);
