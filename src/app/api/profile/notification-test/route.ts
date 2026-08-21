import { NextResponse } from "next/server";

import { getAttendantProfile, latestWhatsAppAccountId } from "@/lib/attendants/repository";
import { recordAuditEvent } from "@/lib/audit";
import { isAppAuthorizationError, requireAppPermission } from "@/lib/handoff/server-auth";
import { beginNotificationTest, finishWhatsAppDelivery } from "@/lib/notifications/delivery-repository";
import { HANDOFF_TEMPLATE_NAME, NOTIFICATION_TEMPLATE_LANGUAGE } from "@/lib/notifications/zernio-templates";
import { ZernioWhatsAppProvider } from "@/lib/whatsapp/zernio-provider";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let actor;
  try { actor = await requireAppPermission("notifications:test"); }
  catch (error) {
    if (isAppAuthorizationError(error)) return new NextResponse(error.message, { status: error.status });
    throw error;
  }
  const apiKey = process.env.ZERNIO_API_KEY;
  const displayName = actor.name?.trim() || actor.email?.trim() || "Atendimento";
  const [profile, accountId] = await Promise.all([
    getAttendantProfile({ userId: actor.userId, displayName }), latestWhatsAppAccountId(),
  ]);
  if (!apiKey || !profile.notificationEnabled || !profile.notificationPhone || !accountId) {
    return NextResponse.redirect(new URL("/profile?error=test_config", request.url), 303);
  }
  let record: { notificationId: string; attempt: number } | undefined;
  try {
    record = await beginNotificationTest({ userId: actor.userId, accountId });
    await new ZernioWhatsAppProvider(apiKey).sendTemplate({ accountId,
      participantId: profile.notificationPhone.replace(/^\+/, ""),
      templateName: process.env.ZERNIO_HANDOFF_TEMPLATE_NAME ?? HANDOFF_TEMPLATE_NAME,
      templateLanguage: process.env.ZERNIO_HANDOFF_TEMPLATE_LANGUAGE ?? NOTIFICATION_TEMPLATE_LANGUAGE,
      templateParams: [profile.displayName, "Este é um teste do agente notificador da ProHealth.",
        "agora", `${process.env.APP_URL ?? "https://prohealthfloripa.vercel.app"}/profile`],
      idempotencyKey: `notification-test:${record.notificationId}` });
    await finishWhatsAppDelivery({ notificationId: record.notificationId, attempt: record.attempt, outcome: "sent" });
    await recordAuditEvent({ actorUserId: actor.userId, actorRole: actor.role,
      action: "notifications.test", resourceType: "attendant_profile", resourceId: actor.userId,
      outcome: "success" });
    return NextResponse.redirect(new URL("/profile?test=sent", request.url), 303);
  } catch (error) {
    if (record) await finishWhatsAppDelivery({ notificationId: record.notificationId,
      attempt: record.attempt, outcome: "failed", errorCode: error instanceof Error ? error.name : "UnknownError" });
    await recordAuditEvent({ actorUserId: actor.userId, actorRole: actor.role,
      action: "notifications.test", resourceType: "attendant_profile", resourceId: actor.userId,
      outcome: "failure", metadata: { errorType: error instanceof Error ? error.name : "UnknownError" } });
    const limited = error instanceof Error && /rate limited/i.test(error.message);
    return NextResponse.redirect(new URL(`/profile?error=${limited ? "test_rate" : "test_failed"}`, request.url), 303);
  }
}
