CREATE TABLE IF NOT EXISTS catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  external_id text NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  synced_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, external_id)
);

CREATE INDEX IF NOT EXISTS catalog_items_active_name_idx
  ON catalog_items(source, active, name);

CREATE TABLE IF NOT EXISTS catalog_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  status text NOT NULL CHECK (status IN ('succeeded','failed')),
  item_count integer NOT NULL DEFAULT 0,
  completed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_sync_runs_source_completed_idx
  ON catalog_sync_runs(source, completed_at DESC);
