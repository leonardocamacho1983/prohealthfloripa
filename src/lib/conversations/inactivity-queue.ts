import { send } from "@vercel/queue";

import type { ConversationInactivityMessage } from "./inactivity";

export const CONVERSATION_INACTIVITY_TOPIC = "prohealth-conversation-inactivity";

export async function enqueueConversationInactivity(message: ConversationInactivityMessage, delaySeconds: number) {
  await send(CONVERSATION_INACTIVITY_TOPIC, message, {
    delaySeconds,
    retentionSeconds: Math.min(604_800, Math.max(delaySeconds + 86_400, 86_400)),
    idempotencyKey: `conversation-inactivity-${message.conversationId}-${message.token}`,
  });
}

