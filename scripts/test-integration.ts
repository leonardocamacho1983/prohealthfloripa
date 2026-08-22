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
  const migrations = Array.from({ length: 22 }, (_, index) => String(index + 1).padStart(4, "0"));
  const directory = fileURLToPath(new URL("../migrations/", import.meta.url));
  const names = [
    "customer_context", "handoffs", "conversation_orchestration", "nextfit_catalog_cache", "auth_audit",
    "inbox_productivity", "metrics_notifications", "conversation_revision_integrity", "training_mode",
    "conversation_journey_state", "conversation_journey_dialogue", "attendant_availability",
    "reliable_handoff_operations", "training_governance", "conversation_workflow",
    "notification_delivery_observability", "sla_engine", "outcomes_surveys_promises",
    "knowledge_governance", "evaluation_and_workforce", "conversation_burst_batching",
    "handoff_return_to_agent",
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
  process.env.DATABASE_URL = scopedUrl.toString();
  const { NeonConversationRepository } = await import("../src/lib/conversations/neon-repository.ts");
  const repository = new NeonConversationRepository();
  const contacts = await sql`INSERT INTO contacts (phone_number) VALUES ('+15550000001') RETURNING id` as Array<{ id: string }>;
  const conversations = await sql`INSERT INTO conversations (contact_id, status, provider_account_id,
      provider_conversation_id, handoff_reason, handoff_source, handoff_reason_id, handoff_requested_at,
      assigned_attendant_user_id, assignment_version)
    VALUES (${contacts[0].id}, 'human_requested', 'account-test', 'provider-test', 'Teste', 'customer',
      'customer_requested_human', now(), 'attendant-test', 4) RETURNING id` as Array<{ id: string }>;
  const conversationId = conversations[0].id;
  await repository.takeHandoff(conversationId, { userId: "attendant-test", label: "Atendente teste" });
  await sql`INSERT INTO messages (conversation_id, direction, role, content, input_revision)
    VALUES (${conversationId}, 'inbound', 'user', 'Pergunta pendente', 1)`;
  await sql`UPDATE conversations SET inbound_revision=1, processed_revision=0, last_message_at=now()
    WHERE id=${conversationId}`;
  const returned = await repository.returnToAgent({ conversationId, actorUserId: "attendant-test",
    actorLabel: "Atendente teste", actorCanForce: false, expectedAssignmentVersion: 5,
    idempotencyKey: `integration-return:${conversationId}:5` });
  if (!returned.shouldQueue || returned.observedRevision !== 1) {
    throw new Error("Return-to-agent did not preserve the pending customer message");
  }
  const repeatedReturn = await repository.returnToAgent({ conversationId, actorUserId: "attendant-test",
    actorLabel: "Atendente teste", actorCanForce: false, expectedAssignmentVersion: 5,
    idempotencyKey: `integration-return:${conversationId}:5` });
  if (!repeatedReturn.shouldQueue || repeatedReturn.observedRevision !== 1) {
    throw new Error("Return-to-agent is not idempotent");
  }
  const states = await sql`SELECT status, inbound_revision, processed_revision, next_process_at
    FROM conversations WHERE id=${conversationId}` as Array<{
      status: string; inbound_revision: string | number; processed_revision: string | number; next_process_at: Date | null }>;
  if (states[0]?.status !== "active" || Number(states[0].processed_revision) !== 0 || !states[0].next_process_at) {
    throw new Error("Returned conversation state is inconsistent");
  }
  const closeContacts = await sql`INSERT INTO contacts (phone_number) VALUES ('+15550000002') RETURNING id` as Array<{ id: string }>;
  const closeConversations = await sql`INSERT INTO conversations (contact_id, status, provider_account_id,
      provider_conversation_id, assigned_attendant_user_id, assignment_version, inbound_revision, processed_revision)
    VALUES (${closeContacts[0].id}, 'human_active', 'account-test', 'provider-close-test',
      'attendant-test', 2, 1, 0) RETURNING id` as Array<{ id: string }>;
  const closureReasons = await sql`SELECT id, label FROM conversation_reason_catalog
    WHERE category='human_closure' AND active=true ORDER BY sort_order LIMIT 1` as Array<{ id: string; label: string }>;
  let staleCloseRejected = false;
  try {
    await repository.closeHandoff({ conversationId: closeConversations[0].id,
      actorUserId: "attendant-test", actorLabel: "Atendente teste", expectedAssignmentVersion: 2,
      expectedInboundRevision: 0, reasonId: closureReasons[0].id, reasonLabel: closureReasons[0].label });
  } catch {
    staleCloseRejected = true;
  }
  if (!staleCloseRejected) throw new Error("Stale close accepted an unseen customer message");
  console.info("Integration migrations passed in isolated schema.");
} finally {
  await adminSql.query(`DROP SCHEMA "${schema}" CASCADE`);
}
