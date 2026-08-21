CREATE TABLE IF NOT EXISTS knowledge_change_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  training_session_id uuid NOT NULL UNIQUE REFERENCES training_sessions(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'approved' CHECK (status IN ('approved','blocked','published','reverted')),
  title text NOT NULL,
  evidence text,
  risk_level text NOT NULL CHECK (risk_level IN ('low','medium','high')),
  checksum text NOT NULL,
  approved_by text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_change_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  change_set_id uuid NOT NULL REFERENCES knowledge_change_sets(id) ON DELETE CASCADE,
  item_type text NOT NULL,
  statement text NOT NULL,
  source_kind text NOT NULL,
  risk_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  sequence_number integer NOT NULL,
  UNIQUE (change_set_id, sequence_number)
);

CREATE TABLE IF NOT EXISTS knowledge_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_number integer NOT NULL UNIQUE,
  artifact jsonb NOT NULL,
  checksum text NOT NULL,
  active boolean NOT NULL DEFAULT false,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_one_active_version ON knowledge_versions(active) WHERE active=true;

CREATE TABLE IF NOT EXISTS knowledge_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), change_set_id uuid NOT NULL REFERENCES knowledge_change_sets(id),
  version_id uuid NOT NULL REFERENCES knowledge_versions(id), published_by text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_rollbacks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), from_version_id uuid NOT NULL REFERENCES knowledge_versions(id),
  to_version_id uuid NOT NULL REFERENCES knowledge_versions(id), reason text NOT NULL,
  rolled_back_by text NOT NULL, rolled_back_at timestamptz NOT NULL DEFAULT now()
);
