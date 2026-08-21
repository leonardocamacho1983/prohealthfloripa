CREATE TABLE IF NOT EXISTS conversation_journey_states (
  conversation_id uuid PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  stage text NOT NULL DEFAULT 'discovery'
    CHECK (stage IN ('discovery','recommendation','service_selected','collecting_schedule',
      'ready_for_handoff','human_handoff','completed')),
  goals jsonb NOT NULL DEFAULT '[]'::jsonb,
  latest_goals jsonb NOT NULL DEFAULT '[]'::jsonb,
  service_family text,
  recommended_services jsonb NOT NULL DEFAULT '[]'::jsonb,
  selected_service text,
  facts_sent jsonb NOT NULL DEFAULT '[]'::jsonb,
  offers jsonb NOT NULL DEFAULT '{}'::jsonb,
  scheduling jsonb NOT NULL DEFAULT '{"status":"not_started"}'::jsonb,
  dialogue jsonb NOT NULL DEFAULT '{"safetyStatus":"not_asked"}'::jsonb,
  active_pilates boolean NOT NULL DEFAULT false,
  last_action text,
  updated_from_revision bigint NOT NULL DEFAULT 0 CHECK (updated_from_revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversation_journey_states_stage_updated_idx
  ON conversation_journey_states(stage, updated_at DESC);
