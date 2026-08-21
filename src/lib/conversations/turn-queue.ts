import { send } from "@vercel/queue";

// A versioned topic prevents callbacks retained by a previous deployment from
// competing with the current worker against the same conversation state.
export const WHATSAPP_TURN_TOPIC = "prohealth-whatsapp-turns-v2";

export type WhatsAppTurnQueueMessage = {
  conversationId: string;
  observedRevision: number;
};

export async function enqueueWhatsAppTurn(message: WhatsAppTurnQueueMessage, delaySeconds: number): Promise<void> {
  await send(WHATSAPP_TURN_TOPIC, message, {
    delaySeconds,
    retentionSeconds: 86_400,
    idempotencyKey: `whatsapp-turn-${message.conversationId}-${message.observedRevision}`,
  });
}
