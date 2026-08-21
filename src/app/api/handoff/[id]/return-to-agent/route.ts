import { NextResponse } from "next/server";

import { recordAuditEvent } from "@/lib/audit";
import { NeonConversationRepository } from "@/lib/conversations/neon-repository";
import { appUserLabel, isAppAuthorizationError, requireAppPermission } from "@/lib/handoff/server-auth";
import { resolveHandoffNotificationsBestEffort } from "@/lib/notifications/repository";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (process.env.VERCEL_ENV !== "preview") {
    return new NextResponse("Preview-only action", { status: 404 });
  }

  let actor;
  try {
    actor = await requireAppPermission("handoff:close");
  } catch (error) {
    if (!isAppAuthorizationError(error)) throw error;
    return new NextResponse(error.message, { status: error.status });
  }
  if (actor.role !== "admin" && actor.role !== "owner") {
    return new NextResponse("Only administrators can return a conversation to the agent", { status: 403 });
  }

  try {
    await new NeonConversationRepository().returnToAgent({
      conversationId: id,
      actorUserId: actor.userId,
      actorLabel: appUserLabel(actor),
    });
    await resolveHandoffNotificationsBestEffort(id, "closed");
    await recordAuditEvent({
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "handoff.return_to_agent",
      resourceType: "conversation",
      resourceId: id,
      outcome: "success",
      metadata: { environment: "preview" },
    });
  } catch (error) {
    await recordAuditEvent({
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "handoff.return_to_agent",
      resourceType: "conversation",
      resourceId: id,
      outcome: "failure",
      metadata: { errorType: error instanceof Error ? error.name : "UnknownError" },
    });
    return new NextResponse("Conversation cannot be returned to the agent", { status: 409 });
  }

  return NextResponse.redirect(new URL(`/handoff?conversation=${encodeURIComponent(id)}`, request.url), 303);
}
