import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not configured");
const sql = neon(databaseUrl);
const migrations = [
  "0015_conversation_workflow.sql",
  "0016_notification_delivery_observability.sql",
  "0017_sla_engine.sql",
  "0018_outcomes_surveys_promises.sql",
  "0019_knowledge_governance.sql",
  "0020_evaluation_and_workforce.sql",
  "0021_conversation_burst_batching.sql",
  "0022_handoff_return_to_agent.sql",
];

for (const migration of migrations) {
  const path = fileURLToPath(new URL(`../migrations/${migration}`, import.meta.url));
  const source = await readFile(path, "utf8");
  await sql.query(source);
  console.info("Applied", migration);
}

const rows = await sql`SELECT
  to_regclass('conversation_events') IS NOT NULL conversation_events,
  to_regclass('notification_delivery_attempts') IS NOT NULL notification_attempts,
  to_regclass('conversation_sla') IS NOT NULL sla,
  to_regclass('conversation_outcomes') IS NOT NULL outcomes,
  to_regclass('conversation_promises') IS NOT NULL promises,
  to_regclass('knowledge_versions') IS NOT NULL knowledge,
  to_regclass('evaluation_runs') IS NOT NULL evaluations,
  to_regclass('attendant_presence') IS NOT NULL workforce` as Array<Record<string, boolean>>;
if (!rows[0] || Object.values(rows[0]).some((value) => value !== true)) {
  throw new Error("Runtime schema validation failed");
}
console.info("Runtime schemas are ready", rows[0]);
