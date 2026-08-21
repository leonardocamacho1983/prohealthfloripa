import { handleCallback } from "@vercel/queue";

import { getAttendantProfile } from "@/lib/attendants/repository";
import { activeShiftKeyAt, isAttendantOnDuty } from "@/lib/attendants/schedule";
import { sendShiftStartDigestForProfile } from "@/lib/notifications/handoff-delivery";
import { scheduleNextShiftNotifier, type NotifierQueueMessage } from "@/lib/notifications/notifier-queue";
import { HANDOFF_TEMPLATE_NAME, NOTIFICATION_TEMPLATE_LANGUAGE } from "@/lib/notifications/zernio-templates";
import { ZernioWhatsAppProvider } from "@/lib/whatsapp/zernio-provider";
import { finishWhatsAppDelivery, reserveWhatsAppDelivery } from "@/lib/notifications/delivery-repository";

export const runtime = "nodejs";
export const maxDuration = 30;

const appUrl = () => process.env.APP_URL ?? "https://prohealthfloripa.vercel.app";

export const POST = handleCallback<NotifierQueueMessage>(async (message) => {
  const apiKey = process.env.ZERNIO_API_KEY;
  if (!apiKey) throw new Error("Notifier provider is unavailable");
  const now = new Date();
  const provider = new ZernioWhatsAppProvider(apiKey);

  if (message.kind === "shift_start") {
    const profile = await getAttendantProfile({ userId: message.attendantUserId, displayName: "Atendimento" });
    try {
      const activeShiftKey = activeShiftKeyAt(profile.weeklySchedule, now, profile.timezone);
      if (!profile.notificationEnabled || !profile.notificationPhone || activeShiftKey !== message.shiftKey) return;
      await sendShiftStartDigestForProfile({ profile, shiftKey: message.shiftKey, provider, now });
    } finally {
      if (profile.notificationEnabled) {
        await scheduleNextShiftNotifier({ attendantUserId: profile.userId,
          weeklySchedule: profile.weeklySchedule, timezone: profile.timezone,
          now: new Date(now.getTime() + 60_000) });
      }
    }
    return;
  }

  const delivery = await reserveWhatsAppDelivery(message.notificationId);
  if (!delivery) return;
  const profile = await getAttendantProfile({ userId: delivery.attendantUserId, displayName: "Atendimento" });
  if (!profile.notificationEnabled || !profile.notificationPhone
      || !isAttendantOnDuty(profile.weeklySchedule, now, profile.timezone)) {
    await finishWhatsAppDelivery({ notificationId: delivery.id, attempt: delivery.attempts,
      outcome: "suppressed", errorCode: "outside_work_schedule" });
    return;
  }
  try {
    await provider.sendTemplate({ accountId: delivery.accountId,
      participantId: profile.notificationPhone.replace(/^\+/, ""),
      templateName: delivery.templateName || HANDOFF_TEMPLATE_NAME,
      templateLanguage: process.env.ZERNIO_HANDOFF_TEMPLATE_LANGUAGE ?? NOTIFICATION_TEMPLATE_LANGUAGE,
      templateParams: [profile.displayName, delivery.reason, "agora",
        `${appUrl()}/handoff?conversation=${encodeURIComponent(delivery.conversationId)}`],
      idempotencyKey: `${delivery.dedupeKey}:${profile.userId}` });
    await finishWhatsAppDelivery({ notificationId: delivery.id, attempt: delivery.attempts, outcome: "sent" });
  } catch (error) {
    await finishWhatsAppDelivery({ notificationId: delivery.id, attempt: delivery.attempts,
      outcome: "failed", errorCode: error instanceof Error ? error.name : "UnknownError" });
    throw error;
  }
}, {
  visibilityTimeoutSeconds: 45,
  retry: (_error, metadata) => ({ afterSeconds: Math.min(900, 30 * 2 ** Math.min(metadata.deliveryCount, 5)) }),
});
