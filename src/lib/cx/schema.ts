import "server-only";
import { getDatabase } from "@/lib/db/neon";
import { ensureConversationWorkflowSchema } from "@/lib/conversations/workflow-schema";

let schemaPromise: Promise<void> | undefined;
export function ensureCxSchema(): Promise<void> {
  if (!schemaPromise) schemaPromise = ensureConversationWorkflowSchema().then(async () => {
    const sql = getDatabase();
    await sql.transaction((tx) => [
      tx`CREATE TABLE IF NOT EXISTS conversation_outcomes (
        conversation_id uuid PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
        origin text NOT NULL CHECK (origin IN ('human','automatic','technical')),
        reason_id text REFERENCES conversation_reason_catalog(id), responsible_user_id text,
        started_at timestamptz NOT NULL, closed_at timestamptz NOT NULL,
        team_time_seconds integer CHECK (team_time_seconds IS NULL OR team_time_seconds >= 0),
        customer_time_seconds integer CHECK (customer_time_seconds IS NULL OR customer_time_seconds >= 0),
        reopened_at timestamptz, reopened_as_conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`,
      tx`CREATE TABLE IF NOT EXISTS cx_survey_settings (
        id text PRIMARY KEY CHECK (id='default'), enabled boolean NOT NULL DEFAULT false,
        sample_rate numeric NOT NULL DEFAULT 0 CHECK (sample_rate BETWEEN 0 AND 1),
        delay_minutes integer NOT NULL DEFAULT 5 CHECK (delay_minutes BETWEEN 0 AND 10080),
        expires_hours integer NOT NULL DEFAULT 72 CHECK (expires_hours BETWEEN 1 AND 720),
        updated_by_user_id text, updated_at timestamptz NOT NULL DEFAULT now())`,
      tx`INSERT INTO cx_survey_settings (id) VALUES ('default') ON CONFLICT (id) DO NOTHING`,
      tx`CREATE TABLE IF NOT EXISTS cx_surveys (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
        contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        survey_type text NOT NULL DEFAULT 'csat' CHECK (survey_type IN ('csat','ces')),
        status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','answered','expired','cancelled')),
        token_hash text NOT NULL UNIQUE, sampled boolean NOT NULL, available_at timestamptz NOT NULL,
        expires_at timestamptz NOT NULL, sent_at timestamptz, answered_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`,
      tx`CREATE TABLE IF NOT EXISTS cx_survey_responses (
        survey_id uuid PRIMARY KEY REFERENCES cx_surveys(id) ON DELETE CASCADE,
        score integer NOT NULL CHECK (score BETWEEN 0 AND 10),
        comment text CHECK (comment IS NULL OR char_length(comment) <= 500), created_at timestamptz NOT NULL DEFAULT now())`,
    ]);
  }).catch((error) => { schemaPromise = undefined; throw error; });
  return schemaPromise;
}
