import "server-only";

import { randomUUID } from "node:crypto";

import { getDatabase } from "@/lib/db/neon";
import { ensureReasonSchema, getConversationOperationSettings } from "@/lib/reasons/repository";
import { ensureConversationWorkflowSchema } from "./workflow-schema";
import { recordConversationOutcome } from "@/lib/cx/outcomes";
import { scheduleCxSurveyBestEffort } from "@/lib/cx/surveys";

export type ConversationInactivityMessage = {
  conversationId: string;
  token: string;
};

export async function armCustomerInactivity(input: {
  conversationId: string;
  actorUserId: string;
}): Promise<{ token: string; delaySeconds: number } | undefined> {
  const [settings] = await Promise.all([
    getConversationOperationSettings(),
    ensureReasonSchema(),
    ensureConversationWorkflowSchema(),
  ]);
  if (!settings.automaticInactivityEnabled) return undefined;
  const token = randomUUID();
  const sql = getDatabase();
  const rows = await sql`UPDATE conversations SET awaiting_customer_since=now(), inactivity_token=${token}, updated_at=now()
    WHERE id=${input.conversationId} AND status='human_active'
      AND assigned_attendant_user_id=${input.actorUserId}
    RETURNING id` as Array<{ id: string }>;
  if (!rows[0]) return undefined;
  return { token, delaySeconds: settings.customerInactivityMinutes * 60 };
}

export async function closeConversationForInactivity(message: ConversationInactivityMessage): Promise<boolean> {
  const [settings] = await Promise.all([
    getConversationOperationSettings(),
    ensureReasonSchema(),
    ensureConversationWorkflowSchema(),
  ]);
  if (!settings.automaticInactivityEnabled) return false;
  const sql = getDatabase();
  const rows = await sql`WITH closed AS (
    UPDATE conversations SET status='closed', closed_at=now(), human_expires_at=NULL,
      closure_reason_id='customer_inactivity', closure_origin='automatic',
      closure_note=NULL, closed_by_user_id=NULL, inactivity_token=NULL,
      awaiting_customer_by_user_id=NULL, awaiting_customer_deadline_at=NULL,
      processed_revision=inbound_revision, processing_token=NULL, processing_revision=NULL,
      processing_lease_until=NULL, updated_at=now()
    WHERE id=${message.conversationId} AND status='human_active'
      AND inactivity_token=${message.token} AND awaiting_customer_since IS NOT NULL
      AND awaiting_customer_since <= now() - make_interval(mins => ${settings.customerInactivityMinutes})
    RETURNING id, contact_id
  ), event_recorded AS (
    INSERT INTO interaction_events (contact_id, event_type, metadata)
    SELECT contact_id, 'conversation_closed_automatically',
      jsonb_build_object('conversationId', id, 'reasonId', 'customer_inactivity') FROM closed
    RETURNING contact_id
  ), workflow_event AS (
    INSERT INTO conversation_events (conversation_id, event_type, reason_id, idempotency_key)
    SELECT id, 'closed_automatic', 'customer_inactivity',
      'closed-inactivity:' || id::text FROM closed
    ON CONFLICT (idempotency_key) DO NOTHING RETURNING conversation_id
  ) SELECT EXISTS(SELECT 1 FROM event_recorded) closed` as Array<{ closed: boolean }>;
  const closed = rows[0]?.closed === true;
  if (closed) await recordConversationOutcome({ conversationId: message.conversationId,
    origin: "automatic", reasonId: "customer_inactivity" });
  if (closed) await scheduleCxSurveyBestEffort(message.conversationId);
  return closed;
}
