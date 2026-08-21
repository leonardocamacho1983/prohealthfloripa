ALTER TABLE training_sessions
  ADD COLUMN IF NOT EXISTS review_note text;
