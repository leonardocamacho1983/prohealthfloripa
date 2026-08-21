import "server-only";

import { getDatabase } from "@/lib/db/neon";
import { ensureMetricsSchema } from "@/lib/metrics/schema";

let schemaPromise: Promise<void> | undefined;

export function ensureNotificationDeliverySchema(): Promise<void> {
  if (!schemaPromise) schemaPromise = ensureMetricsSchema().then(async () => {
    const sql = getDatabase();
    await sql.transaction((tx) => [
      tx`ALTER TABLE notification_outbox
        ADD COLUMN IF NOT EXISTS recipient_user_id text,
        ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS template_name text,
        ADD COLUMN IF NOT EXISTS external_message_id text,
        ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
        ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz`,
      tx`DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid='notification_outbox'::regclass
            AND conname='notification_outbox_status_check'
            AND pg_get_constraintdef(oid) LIKE '%cancelled%'
        ) THEN
          ALTER TABLE notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_status_check;
          ALTER TABLE notification_outbox ADD CONSTRAINT notification_outbox_status_check
            CHECK (status IN ('pending','sent','failed','dismissed','suppressed','resolved','cancelled'));
        END IF;
      END $$`,
      tx`CREATE INDEX IF NOT EXISTS notification_outbox_recipient_status_idx
        ON notification_outbox(recipient_user_id, status, updated_at DESC)
        WHERE recipient_user_id IS NOT NULL`,
      tx`CREATE TABLE IF NOT EXISTS notification_delivery_attempts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        notification_id uuid NOT NULL REFERENCES notification_outbox(id) ON DELETE CASCADE,
        attempt_number integer NOT NULL CHECK (attempt_number > 0),
        provider text NOT NULL DEFAULT 'zernio' CHECK (provider='zernio'),
        outcome text NOT NULL CHECK (outcome IN ('pending','sent','failed','suppressed')),
        error_code text, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
        UNIQUE (notification_id, attempt_number))`,
      tx`CREATE INDEX IF NOT EXISTS notification_delivery_attempts_notification_idx
        ON notification_delivery_attempts(notification_id, attempt_number DESC)`,
    ]);
  }).catch((error) => { schemaPromise = undefined; throw error; });
  return schemaPromise;
}
