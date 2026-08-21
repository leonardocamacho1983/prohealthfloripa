import "server-only";

import {
  assignOnDutyAttendant,
  claimAndListPendingHandoffs,
  finishShiftDigest,
  listProfilesWithActiveShift,
  reserveShiftDigest,
  type AttendantProfile,
} from "@/lib/attendants/repository";
import type { ZernioWhatsAppProvider } from "@/lib/whatsapp/zernio-provider";
import { enqueueInAppNotification } from "./repository";
import { buildHandoffRequestedNotification } from "./rules";
import { buildShiftDigestSummary } from "./handoff-message";
import {
  NOTIFICATION_TEMPLATE_LANGUAGE,
  SHIFT_DIGEST_TEMPLATE_NAME,
} from "./zernio-templates";
import { enqueueNotifierMessage } from "./notifier-queue";
import { createHandoffDelivery } from "./delivery-repository";

const appUrl = () => process.env.APP_URL ?? "https://prohealthfloripa.vercel.app";

export function handoffNotifier(_provider: ZernioWhatsAppProvider) {
  void _provider;
  return async (input: {
    conversationId: string;
    firstName?: string;
    reason: string;
    summary: string;
    idempotencyKey: string;
    accountId: string;
  }) => {
    await enqueueInAppNotification(buildHandoffRequestedNotification({
      conversationId: input.conversationId,
      firstName: input.firstName,
      dedupeKey: input.idempotencyKey,
    }));
    const attendant = await assignOnDutyAttendant(input.conversationId);
    if (!attendant?.notificationPhone) return;
    // The queue is the durable notifier agent. It retries transient failures and
    // rechecks the work schedule before delivery without copying the transcript.
    const notificationId = await createHandoffDelivery({ conversationId: input.conversationId,
      attendantUserId: attendant.userId, accountId: input.accountId, reason: input.reason,
      dedupeKey: `${input.idempotencyKey}:${attendant.userId}` });
    await enqueueNotifierMessage({ kind: "delivery", notificationId });
  };
}

export async function sendShiftStartDigests(input: {
  provider: ZernioWhatsAppProvider;
  now?: Date;
}): Promise<{ profiles: number; sent: number; skipped: number }> {
  const now = input.now ?? new Date();
  const profiles = await listProfilesWithActiveShift(now);
  let sent = 0;
  let skipped = 0;
  for (const profile of profiles) {
    const result = await sendShiftStartDigestForProfile({ profile, shiftKey: profile.shiftKey,
      provider: input.provider, now });
    if (result === "sent") sent += 1;
    else skipped += 1;
  }
  return { profiles: profiles.length, sent, skipped };
}

export async function sendShiftStartDigestForProfile(input: {
  profile: AttendantProfile;
  shiftKey: string;
  provider: ZernioWhatsAppProvider;
  now?: Date;
}): Promise<"sent" | "skipped"> {
  const now = input.now ?? new Date();
  const pending = await claimAndListPendingHandoffs(input.profile.userId);
  if (!input.profile.notificationPhone) return "skipped";
  const reserved = await reserveShiftDigest({ userId: input.profile.userId,
    shiftKey: input.shiftKey, pendingCount: pending.length });
  if (!reserved) return "skipped";
  if (pending.length === 0) {
    await finishShiftDigest({ userId: input.profile.userId, shiftKey: input.shiftKey, success: true });
    return "skipped";
  }
  try {
    await input.provider.sendTemplate({
      accountId: pending[0]!.providerAccountId,
      participantId: input.profile.notificationPhone.replace(/^\+/, ""),
      templateName: process.env.ZERNIO_SHIFT_DIGEST_TEMPLATE_NAME ?? SHIFT_DIGEST_TEMPLATE_NAME,
      templateLanguage: process.env.ZERNIO_HANDOFF_TEMPLATE_LANGUAGE ?? NOTIFICATION_TEMPLATE_LANGUAGE,
      templateParams: [input.profile.displayName, String(pending.length), buildShiftDigestSummary(pending, now),
        `${appUrl()}/handoff?filter=waiting&sort=longest_waiting`],
      idempotencyKey: `shift-digest:${input.profile.userId}:${input.shiftKey}`,
    });
    await finishShiftDigest({ userId: input.profile.userId, shiftKey: input.shiftKey, success: true });
    return "sent";
  } catch (error) {
    await finishShiftDigest({ userId: input.profile.userId, shiftKey: input.shiftKey, success: false,
      errorCode: error instanceof Error ? error.name : "UnknownError" });
    throw error;
  }
}
