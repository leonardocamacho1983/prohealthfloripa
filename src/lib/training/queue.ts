import { send } from "@vercel/queue";

export const TRAINING_TURN_TOPIC = "prohealth-training-turns";
export type TrainingQueueMessage = {
  kind: "text" | "audio"; accountId: string; providerConversationId: string;
  providerMessageId: string; phoneNumber: string; text?: string;
  mediaId?: string; mediaType?: string;
};

export async function enqueueTrainingTurn(message: TrainingQueueMessage) {
  await send(TRAINING_TURN_TOPIC, message, { retentionSeconds: 86_400,
    idempotencyKey: `training-turn-${message.providerMessageId}` });
}
