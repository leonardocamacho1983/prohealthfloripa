import { NextResponse } from "next/server";

import { recordAuditEvent } from "@/lib/audit";
import { hasPermission } from "@/lib/auth/permissions";
import { NeonConversationRepository } from "@/lib/conversations/neon-repository";
import { enqueueWhatsAppTurn } from "@/lib/conversations/turn-queue";
import { appUserLabel, isAppAuthorizationError, requireAppPermission } from "@/lib/handoff/server-auth";
import { resolveHandoffNotificationsBestEffort } from "@/lib/notifications/repository";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let actor;
  try {
    actor = await requireAppPermission("handoff:return_to_agent");
  } catch (error) {
    if (!isAppAuthorizationError(error)) throw error;
    return new NextResponse(error.message, { status: error.status });
  }
  const form = await request.formData();
  const expectedAssignmentVersion = Number(form.get("expectedAssignmentVersion"));
  if (!Number.isSafeInteger(expectedAssignmentVersion) || expectedAssignmentVersion < 0) {
    return new NextResponse("Invalid assignment version", { status: 400 });
  }

  const repository = new NeonConversationRepository();
  let result: { observedRevision: number; shouldQueue: boolean };
  try {
    result = await repository.returnToAgent({
      conversationId: id,
      actorUserId: actor.userId,
      actorLabel: appUserLabel(actor),
      actorCanForce: hasPermission(actor.role, "handoff:force_transfer"),
      expectedAssignmentVersion,
      idempotencyKey: `returned-to-agent:${id}:${expectedAssignmentVersion}`,
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
  if (result.shouldQueue) {
    try {
      await enqueueWhatsAppTurn({ conversationId: id, observedRevision: result.observedRevision }, 0);
    } catch (error) {
      await recordAuditEvent({ actorUserId: actor.userId, actorRole: actor.role,
        action: "handoff.return_to_agent", resourceType: "conversation", resourceId: id,
        outcome: "failure", metadata: { reason: "agent_queue_unavailable",
          errorType: error instanceof Error ? error.name : "UnknownError", statusCode: 503 } });
      return new NextResponse("Agent queue is temporarily unavailable", { status: 503 });
    }
  }
  await resolveHandoffNotificationsBestEffort(id, "returned");
  await recordAuditEvent({ actorUserId: actor.userId, actorRole: actor.role,
    action: "handoff.return_to_agent", resourceType: "conversation", resourceId: id,
    outcome: "success", metadata: { environment: process.env.VERCEL_ENV ?? "development",
      queuedForAgent: result.shouldQueue } });

  return NextResponse.redirect(new URL(`/handoff?conversation=${encodeURIComponent(id)}`, request.url), 303);
}
