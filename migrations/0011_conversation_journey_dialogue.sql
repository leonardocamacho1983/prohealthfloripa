ALTER TABLE conversation_journey_states
  ADD COLUMN IF NOT EXISTS dialogue jsonb NOT NULL
  DEFAULT '{"safetyStatus":"not_asked"}'::jsonb;
