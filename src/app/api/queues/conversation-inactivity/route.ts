import { handleCallback } from "@vercel/queue";

import { closeConversationForInactivity, type ConversationInactivityMessage } from "@/lib/conversations/inactivity";
import { resolveHandoffNotificationsBestEffort } from "@/lib/notifications/repository";

export const runtime = "nodejs";
export const maxDuration = 30;

export const POST = handleCallback<ConversationInactivityMessage>(async (message) => {
  const closed = await closeConversationForInactivity(message);
  if (closed) await resolveHandoffNotificationsBestEffort(message.conversationId, "closed");
}, { visibilityTimeoutSeconds: 45 });

