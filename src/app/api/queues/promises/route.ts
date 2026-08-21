import { handleCallback } from "@vercel/queue";
import { enqueueInAppNotification } from "@/lib/notifications/repository";
import { validatePromiseDeadline } from "@/lib/promises/repository";
import type { PromiseQueueMessage } from "@/lib/promises/queue";

export const runtime = "nodejs";
export const POST = handleCallback<PromiseQueueMessage>(async (message) => {
  if (!await validatePromiseDeadline(message)) return;
  await enqueueInAppNotification({ type: "promise_overdue", severity: "critical",
    title: "Compromisso de retorno vencido", body: "Abra a conversa e conclua, cancele ou reagende o compromisso.",
    dedupeKey: `promise-overdue-${message.promiseId}-${message.token}`, payload: { promiseId: message.promiseId } });
}, { visibilityTimeoutSeconds: 30,
  retry: (_error, metadata) => ({ afterSeconds: Math.min(900, 20 * 2 ** Math.min(metadata.deliveryCount, 5)) }) });
