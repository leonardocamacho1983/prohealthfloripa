import "server-only";
import { createHash } from "node:crypto";
import { getDatabase } from "../db/neon.ts";
import { evaluateKnowledgeChangeSet } from "../evaluations/repository.ts";

let schemaPromise: Promise<void> | undefined;
export function ensureKnowledgeGovernanceSchema(): Promise<void> {
  if (!schemaPromise) {
    const sql = getDatabase();
    schemaPromise = sql.transaction((tx) => [
      tx`CREATE TABLE IF NOT EXISTS knowledge_change_sets (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), training_session_id uuid NOT NULL UNIQUE REFERENCES training_sessions(id) ON DELETE RESTRICT,
        status text NOT NULL DEFAULT 'approved' CHECK (status IN ('approved','blocked','published','reverted')),
        title text NOT NULL, evidence text, risk_level text NOT NULL CHECK (risk_level IN ('low','medium','high')),
        checksum text NOT NULL, approved_by text NOT NULL, approved_at timestamptz NOT NULL DEFAULT now(),
        published_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`,
      tx`CREATE TABLE IF NOT EXISTS knowledge_change_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), change_set_id uuid NOT NULL REFERENCES knowledge_change_sets(id) ON DELETE CASCADE,
        item_type text NOT NULL, statement text NOT NULL, source_kind text NOT NULL,
        risk_flags jsonb NOT NULL DEFAULT '[]'::jsonb, sequence_number integer NOT NULL,
        UNIQUE (change_set_id, sequence_number))`,
      tx`CREATE TABLE IF NOT EXISTS knowledge_versions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version_number integer NOT NULL UNIQUE,
        artifact jsonb NOT NULL, checksum text NOT NULL, active boolean NOT NULL DEFAULT false,
        created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`,
      tx`CREATE UNIQUE INDEX IF NOT EXISTS knowledge_one_active_version ON knowledge_versions(active) WHERE active=true`,
      tx`CREATE TABLE IF NOT EXISTS knowledge_publications (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), change_set_id uuid NOT NULL REFERENCES knowledge_change_sets(id),
        version_id uuid NOT NULL REFERENCES knowledge_versions(id), published_by text NOT NULL,
        published_at timestamptz NOT NULL DEFAULT now())`,
      tx`CREATE TABLE IF NOT EXISTS knowledge_rollbacks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), from_version_id uuid NOT NULL REFERENCES knowledge_versions(id),
        to_version_id uuid NOT NULL REFERENCES knowledge_versions(id), reason text NOT NULL,
        rolled_back_by text NOT NULL, rolled_back_at timestamptz NOT NULL DEFAULT now())`,
    ]).then(() => undefined).catch((error) => { schemaPromise = undefined; throw error; });
  }
  return schemaPromise;
}

const checksum = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export type KnowledgeChangeSet = { id: string; status: string; title: string; evidence?: string;
  riskLevel: "low" | "medium" | "high"; checksum: string; approvedAt: Date; itemCount: number };
export type KnowledgeVersion = { id: string; versionNumber: number; active: boolean; checksum: string;
  createdBy: string; createdAt: Date };

let activeInstructionsCache: { value: string; expiresAt: number } | undefined;
function invalidateActiveKnowledgeCache() { activeInstructionsCache = undefined; }

export async function createKnowledgeChangeSet(sessionId: string, approvedBy: string): Promise<string> {
  await ensureKnowledgeGovernanceSchema(); const sql = getDatabase();
  const items = await sql`SELECT sequence_number, item_type, summary, source_kind, risk_flags
    FROM training_items WHERE session_id=${sessionId} ORDER BY sequence_number` as Array<{
      sequence_number: number; item_type: string; summary: string; source_kind: string; risk_flags: unknown }>;
  if (items.length === 0) throw new Error("Knowledge change set has no items");
  const sessionRows = await sql`SELECT review_note FROM training_sessions WHERE id=${sessionId} AND status='approved'` as Array<{ review_note: string | null }>;
  if (!sessionRows[0]) throw new Error("Training session is not approved");
  const hasRisk = items.some((item) => Array.isArray(item.risk_flags) && item.risk_flags.length > 0);
  const riskLevel = items.some((item) => item.item_type === "commercial_fact" || item.item_type === "correction")
    ? "high" : items.some((item) => item.item_type === "workflow") ? "medium" : "low";
  const artifact = items.map((item) => ({ sequence: item.sequence_number, type: item.item_type,
    statement: item.summary, sourceKind: item.source_kind, riskFlags: item.risk_flags }));
  const digest = checksum(artifact); const evidence = sessionRows[0].review_note?.trim() || null;
  const status = hasRisk || !evidence ? "blocked" : "approved";
  const rows = await sql`WITH change_set AS (
      INSERT INTO knowledge_change_sets (training_session_id, status, title, evidence, risk_level, checksum, approved_by)
      VALUES (${sessionId}, ${status}, ${`Treinamento ${sessionId.slice(0, 8)}`}, ${evidence}, ${riskLevel}, ${digest}, ${approvedBy})
      ON CONFLICT (training_session_id) DO UPDATE SET updated_at=now() RETURNING id
    ) INSERT INTO knowledge_change_items (change_set_id, item_type, statement, source_kind, risk_flags, sequence_number)
      SELECT change_set.id, item->>'type', item->>'statement', item->>'sourceKind', item->'riskFlags',
        (item->>'sequence')::integer FROM change_set,
        jsonb_array_elements(${JSON.stringify(artifact)}::jsonb) item
      ON CONFLICT (change_set_id, sequence_number) DO NOTHING RETURNING change_set_id` as Array<{ change_set_id: string }>;
  return rows[0]?.change_set_id ?? (await sql`SELECT id FROM knowledge_change_sets WHERE training_session_id=${sessionId}` as Array<{ id: string }>)[0]!.id;
}

export async function listKnowledgeChangeSets(): Promise<KnowledgeChangeSet[]> {
  await ensureKnowledgeGovernanceSchema(); const sql = getDatabase();
  const rows = await sql`SELECT c.id, c.status, c.title, c.evidence, c.risk_level, c.checksum, c.approved_at,
      count(i.id)::int item_count FROM knowledge_change_sets c
    LEFT JOIN knowledge_change_items i ON i.change_set_id=c.id GROUP BY c.id ORDER BY c.approved_at DESC` as Array<{
      id: string; status: string; title: string; evidence: string | null; risk_level: "low" | "medium" | "high";
      checksum: string; approved_at: Date; item_count: number }>;
  return rows.map((row) => ({ id: row.id, status: row.status, title: row.title,
    ...(row.evidence ? { evidence: row.evidence } : {}), riskLevel: row.risk_level,
    checksum: row.checksum, approvedAt: new Date(row.approved_at), itemCount: Number(row.item_count) }));
}

export async function publishKnowledgeChangeSet(changeSetId: string, actorUserId: string): Promise<number> {
  await ensureKnowledgeGovernanceSchema(); const sql = getDatabase();
  if (!await evaluateKnowledgeChangeSet(changeSetId)) throw new Error("Knowledge evaluation failed");
  const rows = await sql.transaction((tx) => [
    tx`SELECT pg_advisory_xact_lock(hashtext('prohealth-knowledge-publication'))`,
    tx`WITH candidate AS (
        SELECT c.id, c.checksum, jsonb_build_object('schemaVersion',1,'changeSetId',c.id,
          'items', COALESCE(jsonb_agg(jsonb_build_object('type',i.item_type,'statement',i.statement,
            'sourceKind',i.source_kind) ORDER BY i.sequence_number) FILTER (WHERE i.id IS NOT NULL), '[]'::jsonb)) artifact
        FROM knowledge_change_sets c LEFT JOIN knowledge_change_items i ON i.change_set_id=c.id
        WHERE c.id=${changeSetId} AND c.status='approved' AND c.evidence IS NOT NULL
        GROUP BY c.id
      ), deactivated AS (UPDATE knowledge_versions SET active=false WHERE active=true), version AS (
        INSERT INTO knowledge_versions (version_number, artifact, checksum, active, created_by)
        SELECT COALESCE((SELECT max(version_number) FROM knowledge_versions),0)+1,
          artifact, checksum, true, ${actorUserId} FROM candidate RETURNING id, version_number
      ), publication AS (
        INSERT INTO knowledge_publications (change_set_id, version_id, published_by)
        SELECT candidate.id, version.id, ${actorUserId} FROM candidate, version
      ) UPDATE knowledge_change_sets SET status='published', published_at=now(), updated_at=now()
        WHERE id IN (SELECT id FROM candidate) RETURNING (SELECT version_number FROM version) version_number`,
  ]);
  const published = (rows[1] as Array<{ version_number: number }>)[0];
  if (!published) throw new Error("Knowledge change set is blocked or already published");
  invalidateActiveKnowledgeCache();
  return Number(published.version_number);
}

export async function listKnowledgeVersions(limit = 20): Promise<KnowledgeVersion[]> {
  await ensureKnowledgeGovernanceSchema(); const sql = getDatabase();
  const rows = await sql`SELECT id, version_number, active, checksum, created_by, created_at
    FROM knowledge_versions ORDER BY version_number DESC LIMIT ${Math.min(100, Math.max(1, limit))}` as Array<{
      id: string; version_number: number; active: boolean; checksum: string; created_by: string; created_at: Date }>;
  return rows.map((row) => ({ id: row.id, versionNumber: Number(row.version_number), active: row.active,
    checksum: row.checksum, createdBy: row.created_by, createdAt: new Date(row.created_at) }));
}

export async function rollbackKnowledgeVersion(input: { targetVersionId: string; reason: string;
  actorUserId: string }): Promise<number> {
  await ensureKnowledgeGovernanceSchema();
  const reason = input.reason.trim().slice(0, 500);
  if (reason.length < 5) throw new Error("Rollback reason is required");
  const sql = getDatabase();
  const rows = await sql.transaction((tx) => [
    tx`SELECT pg_advisory_xact_lock(hashtext('prohealth-knowledge-publication'))`,
    tx`WITH current AS MATERIALIZED (
        SELECT id FROM knowledge_versions WHERE active=true FOR UPDATE
      ), target AS MATERIALIZED (
        SELECT id, version_number FROM knowledge_versions
        WHERE id=${input.targetVersionId} AND active=false FOR UPDATE
      ), deactivated AS (
        UPDATE knowledge_versions SET active=false WHERE id IN (SELECT id FROM current)
      ), activated AS (
        UPDATE knowledge_versions SET active=true WHERE id IN (SELECT id FROM target)
        RETURNING id, version_number
      ), recorded AS (
        INSERT INTO knowledge_rollbacks (from_version_id, to_version_id, reason, rolled_back_by)
        SELECT current.id, activated.id, ${reason}, ${input.actorUserId} FROM current, activated
      ) SELECT version_number FROM activated`,
  ]);
  const target = (rows[1] as Array<{ version_number: number }>)[0];
  if (!target) throw new Error("Knowledge version is not available for rollback");
  invalidateActiveKnowledgeCache();
  return Number(target.version_number);
}

export async function getActiveKnowledgeInstructions(): Promise<string> {
  if (activeInstructionsCache && activeInstructionsCache.expiresAt > Date.now()) {
    return activeInstructionsCache.value;
  }
  try {
    await ensureKnowledgeGovernanceSchema(); const sql = getDatabase();
    const rows = await sql`SELECT version_number, artifact FROM knowledge_versions
      WHERE active=true LIMIT 1` as Array<{ version_number: number; artifact: unknown }>;
    const row = rows[0];
    if (!row || typeof row.artifact !== "object" || row.artifact === null) return "";
    const items = (row.artifact as { items?: unknown }).items;
    if (!Array.isArray(items)) return "";
    const statements = items.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const statement = (item as { statement?: unknown }).statement;
      const sourceKind = (item as { sourceKind?: unknown }).sourceKind;
      return typeof statement === "string" && statement.trim()
        ? [`- ${statement.trim().slice(0, 1_000)}${typeof sourceKind === "string" ? ` [fonte: ${sourceKind}]` : ""}`]
        : [];
    }).slice(0, 100);
    const value = statements.length > 0
      ? `CONHECIMENTO PUBLICADO — versão ${Number(row.version_number)}:\n${statements.join("\n")}` : "";
    activeInstructionsCache = { value, expiresAt: Date.now() + 30_000 };
    return value;
  } catch {
    return "";
  }
}
