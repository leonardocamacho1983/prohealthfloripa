import "server-only";
import { getDatabase } from "@/lib/db/neon";
import { ensureCxSchema } from "./schema";

export async function recordConversationOutcome(input: { conversationId: string;
  origin: "human" | "automatic" | "technical"; reasonId: string; responsibleUserId?: string }): Promise<void> {
  await ensureCxSchema(); const sql = getDatabase();
  await sql`INSERT INTO conversation_outcomes (conversation_id, origin, reason_id, responsible_user_id,
      started_at, closed_at, team_time_seconds, customer_time_seconds)
    SELECT id, ${input.origin}, ${input.reasonId}, ${input.responsibleUserId ?? null},
      created_at, COALESCE(closed_at, now()),
      CASE WHEN human_started_at IS NOT NULL THEN GREATEST(0, extract(epoch FROM
        (COALESCE(closed_at, now()) - human_started_at))::integer) ELSE NULL END,
      COALESCE((SELECT sum(GREATEST(0, extract(epoch FROM
        (COALESCE((SELECT min(cancelled.occurred_at) FROM conversation_events cancelled
          WHERE cancelled.conversation_id=c.id
            AND cancelled.event_type='awaiting_customer_cancelled'
            AND cancelled.occurred_at > started.occurred_at), c.closed_at, now()) - started.occurred_at))))::integer
        FROM conversation_events started
        WHERE started.conversation_id=c.id AND started.event_type='awaiting_customer_started'), 0)
    FROM conversations c WHERE id=${input.conversationId}
    ON CONFLICT (conversation_id) DO UPDATE SET origin=EXCLUDED.origin, reason_id=EXCLUDED.reason_id,
      responsible_user_id=EXCLUDED.responsible_user_id, closed_at=EXCLUDED.closed_at,
      team_time_seconds=EXCLUDED.team_time_seconds, customer_time_seconds=EXCLUDED.customer_time_seconds,
      updated_at=now()`;
}

export async function linkReopenedOutcome(previousConversationId: string, newConversationId: string): Promise<void> {
  await ensureCxSchema(); const sql = getDatabase();
  await sql`UPDATE conversation_outcomes SET reopened_at=now(),
    reopened_as_conversation_id=${newConversationId}, updated_at=now()
    WHERE conversation_id=${previousConversationId} AND reopened_at IS NULL`;
}
