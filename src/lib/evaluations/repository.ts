import "server-only";
import { getDatabase } from "../db/neon.ts";

let schemaPromise: Promise<void> | undefined;
export function ensureEvaluationSchema(): Promise<void> {
  if (!schemaPromise) {
    const sql = getDatabase(); schemaPromise = sql.transaction((tx) => [
      tx`CREATE TABLE IF NOT EXISTS evaluation_cases (
        id text PRIMARY KEY, category text NOT NULL, input jsonb NOT NULL, expected jsonb NOT NULL,
        critical boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`,
      tx`CREATE TABLE IF NOT EXISTS evaluation_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), subject_type text NOT NULL, subject_version text NOT NULL,
        status text NOT NULL CHECK (status IN ('running','passed','failed')), passed_count integer NOT NULL DEFAULT 0,
        failed_count integer NOT NULL DEFAULT 0, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz)`,
      tx`CREATE TABLE IF NOT EXISTS evaluation_results (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL REFERENCES evaluation_runs(id) ON DELETE CASCADE,
        case_id text NOT NULL REFERENCES evaluation_cases(id), passed boolean NOT NULL,
        scores jsonb NOT NULL DEFAULT '{}'::jsonb, failure_code text, UNIQUE (run_id, case_id))`,
      tx`INSERT INTO evaluation_cases (id, category, input, expected, critical) VALUES
        ('governance_evidence','governance','{"artifact":"candidate"}'::jsonb,'{"evidence":true}'::jsonb,true),
        ('governance_unresolved_risk','safety','{"artifact":"candidate"}'::jsonb,'{"riskFlags":0}'::jsonb,true),
        ('governance_nonempty','precision','{"artifact":"candidate"}'::jsonb,'{"itemsMin":1}'::jsonb,true)
        ON CONFLICT (id) DO NOTHING`,
    ]).then(() => undefined).catch((error) => { schemaPromise = undefined; throw error; });
  }
  return schemaPromise;
}

export async function evaluateKnowledgeChangeSet(changeSetId: string): Promise<boolean> {
  await ensureEvaluationSchema(); const sql = getDatabase();
  const rows = await sql`SELECT c.evidence, count(i.id)::int item_count,
      count(*) FILTER (WHERE jsonb_array_length(i.risk_flags) > 0)::int risky_count
    FROM knowledge_change_sets c LEFT JOIN knowledge_change_items i ON i.change_set_id=c.id
    WHERE c.id=${changeSetId} GROUP BY c.id` as Array<{
      evidence: string | null; item_count: number; risky_count: number }>;
  const candidate = rows[0]; if (!candidate) return false;
  const results = [
    { id: "governance_evidence", passed: Boolean(candidate.evidence), failure: "missing_evidence" },
    { id: "governance_unresolved_risk", passed: Number(candidate.risky_count) === 0, failure: "unresolved_risk" },
    { id: "governance_nonempty", passed: Number(candidate.item_count) > 0, failure: "empty_artifact" },
  ];
  const passed = results.every((result) => result.passed);
  await sql.transaction((tx) => [
    tx`INSERT INTO evaluation_runs (subject_type, subject_version, status, passed_count, failed_count, finished_at)
      VALUES ('knowledge_change_set', ${changeSetId}, ${passed ? "passed" : "failed"},
        ${results.filter((item) => item.passed).length}, ${results.filter((item) => !item.passed).length}, now())
      RETURNING id`,
  ]).then(async (transactionRows) => {
    const runId = (transactionRows[0] as Array<{ id: string }>)[0]?.id;
    if (!runId) return;
    await Promise.all(results.map((result) => sql`INSERT INTO evaluation_results
      (run_id, case_id, passed, scores, failure_code) VALUES (${runId}, ${result.id}, ${result.passed},
        ${JSON.stringify({ deterministic: true })}::jsonb, ${result.passed ? null : result.failure})`));
  });
  return passed;
}
