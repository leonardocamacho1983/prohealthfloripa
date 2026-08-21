import { NextResponse } from "next/server";

import { recordAuditEvent } from "@/lib/audit";
import { latestWhatsAppAccountId } from "@/lib/attendants/repository";
import { getDatabase } from "@/lib/db/neon";
import { isAppAuthorizationError, requireAppUser } from "@/lib/handoff/server-auth";
import { ensureMetricsSchema } from "@/lib/metrics/schema";
import { ensureZernioNotificationTemplates } from "@/lib/notifications/zernio-templates";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  let user;
  try {
    user = await requireAppUser(["admin", "owner"]);
  } catch (error) {
    if (isAppAuthorizationError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
  const apiKey = process.env.ZERNIO_API_KEY;
  if (!apiKey) return NextResponse.redirect(new URL("/profile?error=template_config", request.url), 303);
  try {
    const accountId = await latestWhatsAppAccountId();
    if (!accountId) return NextResponse.redirect(new URL("/profile?error=template_account", request.url), 303);
    const results = await ensureZernioNotificationTemplates({ apiKey, accountId });
    const templatesApproved = results.every((item) => item.status.toUpperCase() === "APPROVED");
    await ensureMetricsSchema();
    const sql = getDatabase();
    await sql`UPDATE notification_channel_settings SET
      status=${templatesApproved ? "enabled" : "pending"},
      recipient_reference='attendant_profiles', updated_at=now()
      WHERE channel='whatsapp'`;
    await recordAuditEvent({ actorUserId: user.userId, actorRole: user.role,
      action: "notifications.templates_ensure", resourceType: "whatsapp_template", outcome: "success",
      metadata: { reason: results.map((item) => `${item.name}:${item.status}`).join(",").slice(0, 120) } });
    return NextResponse.redirect(new URL(`/profile?template=${templatesApproved ? "ready" : "pending"}`, request.url), 303);
  } catch (error) {
    await recordAuditEvent({ actorUserId: user.userId, actorRole: user.role,
      action: "notifications.templates_ensure", resourceType: "whatsapp_template", outcome: "failure",
      metadata: { errorType: error instanceof Error ? error.name : "UnknownError" } });
    return NextResponse.redirect(new URL("/profile?error=template_failed", request.url), 303);
  }
}
