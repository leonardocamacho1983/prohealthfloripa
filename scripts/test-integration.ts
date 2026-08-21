import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.info("Integration database test skipped: TEST_DATABASE_URL is not configured.");
  process.exit(0);
}

const schema = `prohealth_test_${randomBytes(8).toString("hex")}`;
if (!/^prohealth_test_[a-f0-9]{16}$/.test(schema)) throw new Error("Unsafe test schema name");
const adminSql = neon(databaseUrl);
await adminSql.query(`CREATE SCHEMA "${schema}"`);
const scopedUrl = new URL(databaseUrl);
scopedUrl.searchParams.set("options", `-c search_path=${schema},public`);
const sql = neon(scopedUrl.toString());

try {
  const migrations = Array.from({ length: 20 }, (_, index) => String(index + 1).padStart(4, "0"));
  const directory = fileURLToPath(new URL("../migrations/", import.meta.url));
  const names = [
    "customer_context", "handoffs", "conversation_orchestration", "nextfit_catalog_cache", "auth_audit",
    "inbox_productivity", "metrics_notifications", "conversation_revision_integrity", "training_mode",
    "conversation_journey_state", "conversation_journey_dialogue", "attendant_availability",
    "reliable_handoff_operations", "training_governance", "conversation_workflow",
    "notification_delivery_observability", "sla_engine", "outcomes_surveys_promises",
    "knowledge_governance", "evaluation_and_workforce",
  ];
  for (let index = 0; index < migrations.length; index += 1) {
    const file = `${migrations[index]}_${names[index]}.sql`;
    await sql.query(await readFile(`${directory}${file}`, "utf8"));
  }
  // Reapply the additive release to prove migration idempotency.
  for (let index = 14; index < migrations.length; index += 1) {
    const file = `${migrations[index]}_${names[index]}.sql`;
    await sql.query(await readFile(`${directory}${file}`, "utf8"));
  }
  const rows = await sql`SELECT
    to_regclass('conversation_events') IS NOT NULL events,
    to_regclass('notification_delivery_attempts') IS NOT NULL deliveries,
    to_regclass('conversation_sla') IS NOT NULL sla,
    to_regclass('conversation_outcomes') IS NOT NULL outcomes,
    to_regclass('conversation_promises') IS NOT NULL promises,
    to_regclass('knowledge_versions') IS NOT NULL knowledge,
    to_regclass('evaluation_runs') IS NOT NULL evaluations,
    to_regclass('attendant_presence') IS NOT NULL workforce` as Array<Record<string, boolean>>;
  if (!rows[0] || Object.values(rows[0]).some((value) => value !== true)) {
    throw new Error("Integration schema validation failed");
  }
  console.info("Integration migrations passed in isolated schema.");
} finally {
  await adminSql.query(`DROP SCHEMA "${schema}" CASCADE`);
}
