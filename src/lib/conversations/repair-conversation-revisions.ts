import { getDatabase } from "@/lib/db/neon";

import { ensureConversationRuntimeSchema } from "./neon-repository";
import { enqueueWhatsAppTurn } from "./turn-queue";

export type ConversationRevisionRepairPreview = {
  affectedConversations: number;
  affectedMessages: number;
};

export type ConversationRevisionRepairResult = ConversationRevisionRepairPreview & {
  queuedTurns: number;
  queueFailures: number;
};

type CountRow = { affected_conversations: string | number; affected_messages: string | number };
type PendingTurnRow = { conversation_id: string; revision: string | number };

// A candidate must match the exact signature of the production incident: an
// unrevisioned inbound message followed shortly by a completed zero-input turn,
// with no successful outbound response after that message. No content or phone
// number is selected, logged, or returned by this maintenance operation.
const candidateCte = `
  WITH last_sent AS (
    SELECT conversation_id, max(created_at) last_sent_at
    FROM messages
    WHERE direction='outbound' AND delivery_status='sent'
    GROUP BY conversation_id
  ), candidates AS (
    SELECT m.id, m.conversation_id
    FROM messages m
    JOIN conversations c ON c.id=m.conversation_id
    LEFT JOIN last_sent sent ON sent.conversation_id=m.conversation_id
    WHERE c.status='active' AND m.direction='inbound' AND m.input_revision IS NULL
      AND m.created_at > COALESCE(sent.last_sent_at, '-infinity'::timestamptz)
      AND EXISTS (
        SELECT 1 FROM conversation_turns turn
        WHERE turn.conversation_id=m.conversation_id
          AND turn.state='suppressed' AND turn.inbound_count=0
          AND turn.started_at >= m.created_at
          AND turn.started_at <= m.created_at + interval '10 minutes'
      )
  )`;

export async function previewConversationRevisionRepair(): Promise<ConversationRevisionRepairPreview> {
  await ensureConversationRuntimeSchema();
  const sql = getDatabase();
  const rows = await sql.query(`${candidateCte}
    SELECT count(DISTINCT conversation_id)::int affected_conversations,
      count(*)::int affected_messages FROM candidates`) as CountRow[];
  const row = rows[0];
  return {
    affectedConversations: Number(row?.affected_conversations ?? 0),
    affectedMessages: Number(row?.affected_messages ?? 0),
  };
}

export async function repairConversationRevisions(): Promise<ConversationRevisionRepairResult> {
  await ensureConversationRuntimeSchema();
  const sql = getDatabase();
  const results = await sql.transaction((tx) => [
    tx.query(`${candidateCte}
      SELECT c.id FROM conversations c
      WHERE c.id IN (SELECT DISTINCT conversation_id FROM candidates)
      ORDER BY c.id FOR UPDATE`),
    tx.query(`${candidateCte}, affected AS (
        SELECT DISTINCT conversation_id FROM candidates
      )
      UPDATE conversations c SET inbound_revision=c.inbound_revision + 1,
        next_process_at=now(), processing_token=NULL, processing_revision=NULL,
        processing_lease_until=NULL, updated_at=now()
      FROM affected WHERE c.id=affected.conversation_id
      RETURNING c.id conversation_id, c.inbound_revision revision`),
    tx.query(`${candidateCte}
      UPDATE messages m SET input_revision=c.inbound_revision
      FROM candidates candidate, conversations c
      WHERE m.id=candidate.id AND c.id=candidate.conversation_id
      RETURNING m.id, m.conversation_id`),
    tx`SELECT c.id conversation_id, c.inbound_revision revision
      FROM conversations c
      WHERE c.status='active' AND c.processed_revision < c.inbound_revision
        AND EXISTS (
          SELECT 1 FROM messages m WHERE m.conversation_id=c.id AND m.direction='inbound'
            AND m.input_revision > c.processed_revision AND m.input_revision <= c.inbound_revision
        )
        AND (c.processing_token IS NULL OR c.processing_lease_until IS NULL OR c.processing_lease_until <= now())
      ORDER BY c.updated_at ASC LIMIT 100`,
  ], { isolationLevel: "Serializable" });

  const repairedConversations = results[1] as PendingTurnRow[];
  const repairedMessages = results[2] as Array<{ id: string; conversation_id: string }>;
  const pendingTurns = results[3] as PendingTurnRow[];
  const queued = await Promise.allSettled(pendingTurns.map((turn) => enqueueWhatsAppTurn({
    conversationId: turn.conversation_id,
    observedRevision: Number(turn.revision),
  }, 0)));
  return {
    affectedConversations: repairedConversations.length,
    affectedMessages: repairedMessages.length,
    queuedTurns: queued.filter((result) => result.status === "fulfilled").length,
    queueFailures: queued.filter((result) => result.status === "rejected").length,
  };
}
