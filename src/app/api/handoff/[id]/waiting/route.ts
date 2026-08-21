import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { recordAuditEvent } from "@/lib/audit";
import { enqueueConversationInactivity } from "@/lib/conversations/inactivity-queue";
import { NeonConversationRepository } from "@/lib/conversations/neon-repository";
import { isFeatureEnabled } from "@/lib/feature-flags/repository";
import { appUserLabel, isAppAuthorizationError, requireAppPermission } from "@/lib/handoff/server-auth";
import { getConversationOperationSettings } from "@/lib/reasons/repository";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let actor;
  try { actor = await requireAppPermission("handoff:reply"); }
  catch (error) {
    if (isAppAuthorizationError(error)) return new NextResponse(error.message, { status: error.status });
    throw error;
  }
  if (!await isFeatureEnabled("awaiting_customer")) return new NextResponse("Feature disabled", { status: 404 });
  const form = await request.formData();
  const operation = form.get("operation");
  const enabled = operation === "start" ? true : operation === "resume" ? false : undefined;
  const expectedAssignmentVersion = Number(form.get("expectedAssignmentVersion"));
  if (enabled === undefined || !Number.isSafeInteger(expectedAssignmentVersion) || expectedAssignmentVersion < 0) {
    return new NextResponse("Invalid workflow action", { status: 400 });
  }
  const suppliedKey = form.get("idempotencyKey");
  const idempotencyKey = typeof suppliedKey === "string" && suppliedKey.length >= 8
    ? `waiting:${id}:${suppliedKey.slice(0, 100)}` : `waiting:${id}:${randomUUID()}`;
  try {
    const settings = await getConversationOperationSettings();
    const result = await new NeonConversationRepository().setAwaitingCustomer({ conversationId: id,
      actorUserId: actor.userId, actorLabel: appUserLabel(actor), expectedAssignmentVersion,
      enabled, ...(enabled && settings.automaticInactivityEnabled
        ? { inactivityMinutes: settings.customerInactivityMinutes } : {}), idempotencyKey });
    if (result.inactivityToken && result.delaySeconds) {
      await enqueueConversationInactivity({ conversationId: id, token: result.inactivityToken }, result.delaySeconds);
    }
    await recordAuditEvent({ actorUserId: actor.userId, actorRole: actor.role,
      action: enabled ? "handoff.awaiting_customer.start" : "handoff.awaiting_customer.resume",
      resourceType: "conversation", resourceId: id, outcome: "success",
      metadata: { expectedAssignmentVersion } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    await recordAuditEvent({ actorUserId: actor.userId, actorRole: actor.role,
      action: "handoff.awaiting_customer", resourceType: "conversation", resourceId: id,
      outcome: "failure", metadata: { expectedAssignmentVersion,
        errorType: error instanceof Error ? error.name : "UnknownError" } });
    return new NextResponse("Conversation workflow changed", { status: 409 });
  }
}
