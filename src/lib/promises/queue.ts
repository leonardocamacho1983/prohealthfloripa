import { send } from "@vercel/queue";
export const PROMISE_TOPIC = "prohealth-promise-deadlines";
export type PromiseQueueMessage = { promiseId: string; token: string };
export async function enqueuePromiseDeadline(message: PromiseQueueMessage, dueAt: Date): Promise<void> {
  await send(PROMISE_TOPIC, message, { delaySeconds: Math.max(1, Math.min(604800,
    Math.ceil((dueAt.getTime() - Date.now()) / 1000))), retentionSeconds: 604800,
    idempotencyKey: `promise-${message.promiseId}-${message.token}` });
}
