-- Existing rows are intentionally not validated here so affected conversations can
-- be inspected and repaired safely. PostgreSQL still enforces a NOT VALID check for
-- every new or updated row, preventing another silent inbound message without a turn revision.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='messages_inbound_input_revision_required'
      AND conrelid='messages'::regclass
  ) THEN
    ALTER TABLE messages ADD CONSTRAINT messages_inbound_input_revision_required
      CHECK (direction <> 'inbound' OR input_revision IS NOT NULL) NOT VALID;
  END IF;
END
$$;
