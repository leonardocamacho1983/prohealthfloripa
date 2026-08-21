import { NextResponse } from "next/server";
import { NeonConversationRepository } from "@/lib/conversations/neon-repository";
import { recordAuditEvent } from "@/lib/audit";
import { appUserLabel, isAppAuthorizationError, requireAppPermission } from "@/lib/handoff/server-auth";
import { resolveHandoffNotificationsBestEffort } from "@/lib/notifications/repository";
import { findActiveConversationReason } from "@/lib/reasons/repository";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let actor;
  try {
    actor = await requireAppPermission("handoff:close");
  } catch (error) {
    if (!isAppAuthorizationError(error)) throw error;
    await recordAuditEvent({ actorUserId: error.userId, actorRole: error.role,
      action: "handoff.close", resourceType: "conversation", resourceId: id,
      outcome: "denied", metadata: { statusCode: error.status } });
    return new NextResponse(error.message, { status: error.status });
  }
  const form = await request.formData();
  const reasonId = form.get("reasonId");
  const noteValue = form.get("note");
  const note = typeof noteValue === "string" ? noteValue.trim().slice(0, 500) : "";
  if (typeof reasonId !== "string") return new NextResponse("Closure reason is required", { status: 400 });
  const reason = await findActiveConversationReason("human_closure", reasonId);
  if (!reason) return new NextResponse("Invalid closure reason", { status: 400 });
  try {
    await new NeonConversationRepository().closeHandoff({ conversationId: id,
      actorUserId: actor.userId, actorLabel: appUserLabel(actor), reasonId: reason.id,
      reasonLabel: reason.label, ...(note ? { note } : {}) });
    await resolveHandoffNotificationsBestEffort(id, "closed");
    await recordAuditEvent({ actorUserId: actor.userId, actorRole: actor.role,
      action: "handoff.close", resourceType: "conversation", resourceId: id, outcome: "success",
      metadata: { reasonId: reason.id } });
  } catch (error) {
    await recordAuditEvent({ actorUserId: actor.userId, actorRole: actor.role,
      action: "handoff.close", resourceType: "conversation", resourceId: id,
      outcome: "failure", metadata: { errorType: error instanceof Error ? error.name : "UnknownError", statusCode: 409 } });
    return new NextResponse("Conversation is not owned by this attendant", { status: 409 });
  }
  return NextResponse.redirect(new URL("/handoff", request.url), 303);
}
