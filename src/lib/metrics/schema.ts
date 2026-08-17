import { getDatabase } from "@/lib/db/neon";

let schemaPromise: Promise<void> | undefined;

export function ensureMetricsSchema(): Promise<void> {
  if (!schemaPromise) {
    const sql = getDatabase();
    schemaPromise = sql.transaction((tx) => [
      tx`CREATE TABLE IF NOT EXISTS operational_metric_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        event_name text NOT NULL CHECK (length(btrim(event_name)) > 0),
        outcome text NOT NULL DEFAULT 'info' CHECK (outcome IN ('info','success','failure')),
        conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
        duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
        value numeric, unit text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, dedupe_key text,
        occurred_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now())`,
      tx`CREATE UNIQUE INDEX IF NOT EXISTS operational_metric_events_dedupe_unique
        ON operational_metric_events(dedupe_key) WHERE dedupe_key IS NOT NULL`,
      tx`CREATE INDEX IF NOT EXISTS operational_metric_events_name_occurred_idx
        ON operational_metric_events(event_name, occurred_at DESC)`,
      tx`CREATE INDEX IF NOT EXISTS operational_metric_events_conversation_occurred_idx
        ON operational_metric_events(conversation_id, occurred_at DESC) WHERE conversation_id IS NOT NULL`,
      tx`CREATE TABLE IF NOT EXISTS commercial_outcome_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        event_type text NOT NULL CHECK (event_type IN ('payment_observed','conversion_observed','recovery_observed')),
        conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
        amount_cents integer CHECK (amount_cents IS NULL OR amount_cents >= 0),
        currency text NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
        evidence_source text NOT NULL CHECK (length(btrim(evidence_source)) > 0),
        relationship text NOT NULL DEFAULT 'associated_only' CHECK (relationship = 'associated_only'),
        external_reference text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, dedupe_key text,
        occurred_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now())`,
      tx`CREATE UNIQUE INDEX IF NOT EXISTS commercial_outcome_events_dedupe_unique
        ON commercial_outcome_events(dedupe_key) WHERE dedupe_key IS NOT NULL`,
      tx`CREATE INDEX IF NOT EXISTS commercial_outcome_events_type_occurred_idx
        ON commercial_outcome_events(event_type, occurred_at DESC)`,
      tx`CREATE INDEX IF NOT EXISTS commercial_outcome_events_conversation_occurred_idx
        ON commercial_outcome_events(conversation_id, occurred_at DESC) WHERE conversation_id IS NOT NULL`,
      tx`CREATE TABLE IF NOT EXISTS notification_channel_settings (
        channel text PRIMARY KEY CHECK (channel IN ('in_app','whatsapp')),
        status text NOT NULL CHECK (status IN ('enabled','pending','disabled')),
        recipient_reference text, updated_at timestamptz NOT NULL DEFAULT now(),
        CHECK (channel <> 'whatsapp' OR status <> 'enabled' OR recipient_reference IS NOT NULL))`,
      tx`INSERT INTO notification_channel_settings (channel, status)
        VALUES ('in_app','enabled'), ('whatsapp','pending') ON CONFLICT (channel) DO NOTHING`,
      tx`CREATE TABLE IF NOT EXISTS notification_outbox (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        channel text NOT NULL REFERENCES notification_channel_settings(channel),
        notification_type text NOT NULL CHECK (length(btrim(notification_type)) > 0),
        severity text NOT NULL CHECK (severity IN ('info','warning','critical')),
        title text NOT NULL CHECK (length(btrim(title)) > 0),
        body text NOT NULL CHECK (length(btrim(body)) > 0),
        status text NOT NULL DEFAULT 'pending'
          CONSTRAINT notification_outbox_status_check
          CHECK (status IN ('pending','sent','failed','dismissed','suppressed','resolved')),
        dedupe_key text NOT NULL, payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        occurrence_count integer NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
        available_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(),
        sent_at timestamptz, dismissed_at timestamptz, resolved_at timestamptz, resolution_reason text,
        attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0), last_error_code text,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (channel, dedupe_key))`,
      tx`ALTER TABLE notification_outbox ADD COLUMN IF NOT EXISTS resolved_at timestamptz`,
      tx`ALTER TABLE notification_outbox ADD COLUMN IF NOT EXISTS resolution_reason text`,
      tx`DO $$
        DECLARE status_constraint text;
        BEGIN
          SELECT pg_get_constraintdef(oid) INTO status_constraint
          FROM pg_constraint
          WHERE conrelid='notification_outbox'::regclass
            AND conname='notification_outbox_status_check';
          IF status_constraint IS NULL OR position('resolved' in status_constraint) = 0 THEN
            ALTER TABLE notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_status_check;
            ALTER TABLE notification_outbox ADD CONSTRAINT notification_outbox_status_check
              CHECK (status IN ('pending','sent','failed','dismissed','suppressed','resolved'));
          END IF;
        END $$`,
      tx`CREATE INDEX IF NOT EXISTS notification_outbox_open_available_idx
        ON notification_outbox(severity, available_at, created_at DESC) WHERE status IN ('pending','failed')`,
    ]).then(() => undefined).catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }
  return schemaPromise;
}
