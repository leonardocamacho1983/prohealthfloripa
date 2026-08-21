import { send } from "@vercel/queue";
import { nextShiftStartAt, type WeeklySchedule } from "@/lib/attendants/schedule";

export const NOTIFIER_TOPIC = "prohealth-notifier";

export type NotifierQueueMessage = {
  kind: "delivery";
  notificationId: string;
} | {
  kind: "shift_start";
  attendantUserId: string;
  shiftKey: string;
};

export async function enqueueNotifierMessage(message: NotifierQueueMessage): Promise<void> {
  await send(NOTIFIER_TOPIC, message, {
    retentionSeconds: 604_800,
    idempotencyKey: message.kind === "delivery"
      ? `notifier-delivery-${message.notificationId}`
      : `notifier-shift-${message.attendantUserId}-${message.shiftKey}`,
  });
}

export async function scheduleNextShiftNotifier(input: {
  attendantUserId: string;
  weeklySchedule: WeeklySchedule;
  timezone: string;
  now?: Date;
}): Promise<boolean> {
  const now = input.now ?? new Date();
  const next = nextShiftStartAt(input.weeklySchedule, now, input.timezone);
  if (!next) return false;
  const delaySeconds = Math.max(1, Math.ceil((next.at.getTime() - now.getTime()) / 1000));
  await send(NOTIFIER_TOPIC, { kind: "shift_start", attendantUserId: input.attendantUserId,
    shiftKey: next.shiftKey } satisfies NotifierQueueMessage, {
    delaySeconds: Math.min(604_800, delaySeconds),
    retentionSeconds: 604_800,
    idempotencyKey: `notifier-shift-${input.attendantUserId}-${next.shiftKey}`,
  });
  return true;
}
