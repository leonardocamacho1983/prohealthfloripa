ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS batch_started_at timestamptz;

COMMENT ON COLUMN conversations.batch_started_at IS
  'Start of the current unprocessed inbound burst; bounds the sliding quiet window.';
