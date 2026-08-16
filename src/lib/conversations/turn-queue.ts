import { send } from "@vercel/queue";

export const WHATSAPP_TURN_TOPIC = "prohealth-whatsapp-turns";

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
