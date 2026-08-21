import { getDatabase } from "../db/neon.ts";
import type { AuditEvent } from "./types";

const ALLOWED_METADATA_KEYS = new Set([
  "reason", "reasonId", "statusCode", "errorType", "assignedAttendantUserId",
  "targetUserId", "expectedAssignmentVersion", "enabled", "featureFlag",
]);
let schemaPromise: Promise<void> | undefined;

export function sanitizeAuditMetadata(metadata?: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const safe: Record<string, string | number | boolean | null> = {};
  if (!metadata) return safe;
  for (const [key, value] of Object.entries(metadata)) {
    if (!ALLOWED_METADATA_KEYS.has(key)) continue;
    if (typeof value === "string") safe[key] = value.slice(0, 120);
    else if (typeof value === "number" || typeof value === "boolean" || value === null) safe[key] = value;
  }
  return safe;
}

function ensureAuditSchema(): Promise<void> {
  if (!schemaPromise) {
    const sql = getDatabase();
    schemaPromise = sql.transaction((tx) => [
      tx`CREATE TABLE IF NOT EXISTS audit_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_user_id text,
        actor_role text CHECK (actor_role IS NULL OR actor_role IN ('owner','admin','attendant')),
        action text NOT NULL,
        resource_type text NOT NULL,
        resource_id text,
        outcome text NOT NULL CHECK (outcome IN ('success','denied','failure')),
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        occurred_at timestamptz NOT NULL DEFAULT now()
      )`,
      tx`CREATE INDEX IF NOT EXISTS audit_logs_occurred_at_idx ON audit_logs(occurred_at DESC)`,
      tx`CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs(actor_user_id, occurred_at DESC)`,
      tx`CREATE INDEX IF NOT EXISTS audit_logs_resource_idx ON audit_logs(resource_type, resource_id, occurred_at DESC)`,
    ]).then(() => undefined).catch((error) => { schemaPromise = undefined; throw error; });
  }
  return schemaPromise;
}

export async function recordAuditEvent(event: AuditEvent): Promise<void> {
  try {
    await ensureAuditSchema();
    const sql = getDatabase();
    const metadata = JSON.stringify(sanitizeAuditMetadata(event.metadata));
    await sql`INSERT INTO audit_logs
      (actor_user_id, actor_role, action, resource_type, resource_id, outcome, metadata)
      VALUES (${event.actorUserId ?? null}, ${event.actorRole ?? null}, ${event.action},
        ${event.resourceType}, ${event.resourceId ?? null}, ${event.outcome}, ${metadata}::jsonb)`;
  } catch (error) {
    // Auditing is intentionally best-effort: a transient database failure must
    // not cause an already-sent WhatsApp message to be retried or duplicated.
    console.warn("Audit log write failed", {
      action: event.action,
      outcome: event.outcome,
      error: error instanceof Error ? error.name : "UnknownError",
    });
  }
}
