import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { getAttendantProfile } from "@/lib/attendants/repository";
import { getTransferCandidate } from "@/lib/attendants/directory";
import { recordAuditEvent } from "@/lib/audit";
import { hasPermission } from "@/lib/auth/permissions";
import { NeonConversationRepository } from "@/lib/conversations/neon-repository";
import { isFeatureEnabled } from "@/lib/feature-flags/repository";
import { appUserLabel, isAppAuthorizationError, requireAppPermission } from "@/lib/handoff/server-auth";
import { enqueueNotifierMessage } from "@/lib/notifications/notifier-queue";
import { cancelConversationDeliveries, createHandoffDelivery } from "@/lib/notifications/delivery-repository";
import { findActiveConversationReason } from "@/lib/reasons/repository";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let actor;
  try { actor = await requireAppPermission("handoff:transfer"); }
  catch (error) {
    if (isAppAuthorizationError(error)) return new NextResponse(error.message, { status: error.status });
    throw error;
  }
  if (!await isFeatureEnabled("conversation_transfer")) return new NextResponse("Feature disabled", { status: 404 });

  const form = await request.formData();
  const targetUserId = form.get("targetUserId");
  const reasonId = form.get("reasonId");
  const noteValue = form.get("note");
  const expectedAssignmentVersion = Number(form.get("expectedAssignmentVersion"));
  const requestKey = form.get("idempotencyKey");
  if (typeof targetUserId !== "string" || typeof reasonId !== "string"
      || !Number.isSafeInteger(expectedAssignmentVersion) || expectedAssignmentVersion < 0
      || (typeof noteValue === "string" && noteValue.length > 500)) {
    return new NextResponse("Invalid transfer", { status: 400 });
  }
  const [target, reason] = await Promise.all([
    getTransferCandidate(targetUserId).catch(() => undefined),
    findActiveConversationReason("handoff", reasonId),
  ]);
  if (!target || !reason) return new NextResponse("Invalid transfer", { status: 400 });
  const idempotencyKey = typeof requestKey === "string" && requestKey.length >= 8
    ? `transfer:${id}:${requestKey.slice(0, 100)}` : `transfer:${id}:${randomUUID()}`;
  const repository = new NeonConversationRepository();
  try {
    await repository.transferHandoff({ conversationId: id, actorUserId: actor.userId,
      actorLabel: appUserLabel(actor), actorCanForce: hasPermission(actor.role, "handoff:force_transfer"),
      expectedAssignmentVersion, targetUserId: target.userId, targetLabel: target.label,
      reasonId: reason.id, reasonLabel: reason.label,
      ...(typeof noteValue === "string" && noteValue.trim() ? { note: noteValue.trim() } : {}),
      idempotencyKey });
  } catch (error) {
    await recordAuditEvent({ actorUserId: actor.userId, actorRole: actor.role,
      action: "handoff.transfer", resourceType: "conversation", resourceId: id, outcome: "failure",
      metadata: { targetUserId: target.userId, reasonId: reason.id, expectedAssignmentVersion,
        errorType: error instanceof Error ? error.name : "UnknownError" } });
    return new NextResponse("Conversation assignment changed", { status: 409 });
  }

  let notificationStatus: "queued" | "skipped" | "failed" = "skipped";
  try {
    const conversation = (await repository.listHandoffs()).find((item) => item.id === id);
    const profile = await getAttendantProfile({ userId: target.userId, displayName: target.label });
    await cancelConversationDeliveries(id, "handoff_transferred");
    if (conversation && profile.notificationEnabled && profile.notificationPhone && conversation.providerAccountId) {
      const notificationId = await createHandoffDelivery({ conversationId: id,
        attendantUserId: target.userId, accountId: conversation.providerAccountId,
        reason: reason.label, dedupeKey: `${idempotencyKey}:${target.userId}` });
      await enqueueNotifierMessage({ kind: "delivery", notificationId });
      notificationStatus = "queued";
    }
  } catch (error) {
    notificationStatus = "failed";
    console.warn("Transferred handoff notification failed", {
      conversationId: id, error: error instanceof Error ? error.name : "UnknownError",
    });
  }
  await recordAuditEvent({ actorUserId: actor.userId, actorRole: actor.role,
    action: "handoff.transfer", resourceType: "conversation", resourceId: id, outcome: "success",
    metadata: { targetUserId: target.userId, reasonId: reason.id, expectedAssignmentVersion,
      notificationStatus } });
  return NextResponse.json({ ok: true, notificationStatus });
}
