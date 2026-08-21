import { handleCallback } from "@vercel/queue";
import { enqueueInAppNotification } from "@/lib/notifications/repository";
import { applySlaDeadline } from "@/lib/sla/repository";
import type { SlaQueueMessage } from "@/lib/sla/queue";

export const runtime = "nodejs";
export const POST = handleCallback<SlaQueueMessage>(async (message) => {
  const applied = await applySlaDeadline(message);
  if (!applied) return;
  await enqueueInAppNotification({ type: message.kind === "warning" ? "sla_warning" : "sla_breached",
    severity: message.kind === "warning" ? "warning" : "critical",
    title: message.kind === "warning" ? "Atendimento próximo do prazo" : "Atendimento fora do prazo",
    body: "Abra a conversa e realize a próxima ação necessária.",
    dedupeKey: `sla-${message.kind}-${message.conversationId}-${message.token}`,
    payload: { conversationId: message.conversationId } });
}, { visibilityTimeoutSeconds: 30,
  retry: (_error, metadata) => ({ afterSeconds: Math.min(900, 20 * 2 ** Math.min(metadata.deliveryCount, 5)) }) });
