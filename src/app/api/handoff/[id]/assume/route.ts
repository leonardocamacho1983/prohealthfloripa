import { NextResponse } from "next/server";
import { NeonConversationRepository } from "@/lib/conversations/neon-repository";
import { recordAuditEvent } from "@/lib/audit";
import { appUserLabel, isAppAuthorizationError, requireAppPermission } from "@/lib/handoff/server-auth";
import { resolveHandoffNotificationsBestEffort } from "@/lib/notifications/repository";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let actor;
  try {
    actor = await requireAppPermission("handoff:assume");
  } catch (error) {
    if (!isAppAuthorizationError(error)) throw error;
    await recordAuditEvent({ actorUserId: error.userId, actorRole: error.role,
      action: "handoff.assume", resourceType: "conversation", resourceId: id,
      outcome: "denied", metadata: { statusCode: error.status } });
    return new NextResponse(error.message, { status: error.status });
  }
  try {
    await new NeonConversationRepository().assumeAgentConversation(id, {
      userId: actor.userId, label: appUserLabel(actor),
    });
    await resolveHandoffNotificationsBestEffort(id, "assumed");
    await recordAuditEvent({ actorUserId: actor.userId, actorRole: actor.role,
      action: "handoff.assume", resourceType: "conversation", resourceId: id, outcome: "success" });
  } catch (error) {
    await recordAuditEvent({ actorUserId: actor.userId, actorRole: actor.role,
      action: "handoff.assume", resourceType: "conversation", resourceId: id,
      outcome: "failure", metadata: { errorType: error instanceof Error ? error.name : "UnknownError", statusCode: 409 } });
    return new NextResponse("Conversation is no longer available", { status: 409 });
  }
  return NextResponse.redirect(new URL(`/handoff?filter=human&conversation=${id}`, request.url), 303);
}
