import { send } from "@vercel/queue";

export const SLA_TOPIC = "prohealth-sla-deadlines";
export type SlaQueueMessage = { conversationId: string; token: string; kind: "warning" | "breach" };

export async function enqueueSlaDeadlines(input: { conversationId: string; token: string;
  warningAt: Date; dueAt: Date; now?: Date }): Promise<void> {
  const now = input.now ?? new Date();
  await Promise.all(([{ kind: "warning" as const, at: input.warningAt },
    { kind: "breach" as const, at: input.dueAt }]).map(({ kind, at }) => send(SLA_TOPIC,
    { conversationId: input.conversationId, token: input.token, kind } satisfies SlaQueueMessage,
    { delaySeconds: Math.max(1, Math.min(604800, Math.ceil((at.getTime() - now.getTime()) / 1000))),
      retentionSeconds: 604800, idempotencyKey: `sla-${input.conversationId}-${input.token}-${kind}` })));
}
