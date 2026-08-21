import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { NeonConversationRepository } from "@/lib/conversations/neon-repository";
import { recordAuditEvent } from "@/lib/audit";
import { appUserLabel, isAppAuthorizationError, requireAppPermission } from "@/lib/handoff/server-auth";
import { ZernioWhatsAppProvider } from "@/lib/whatsapp/zernio-provider";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let actor;
  try {
    actor = await requireAppPermission("handoff:reply");
  } catch (error) {
    if (!isAppAuthorizationError(error)) throw error;
    await recordAuditEvent({ actorUserId: error.userId, actorRole: error.role,
      action: "handoff.reply", resourceType: "conversation", resourceId: id,
      outcome: "denied", metadata: { statusCode: error.status } });
    return new NextResponse(error.message, { status: error.status });
  }

  const apiKey = process.env.ZERNIO_API_KEY;
  if (!apiKey) {
    await recordAuditEvent({ actorUserId: actor.userId, actorRole: actor.role,
      action: "handoff.reply", resourceType: "conversation", resourceId: id,
      outcome: "failure", metadata: { reason: "provider_unavailable", statusCode: 503 } });
    return new NextResponse("Unavailable", { status: 503 });
  }

  const form = await request.formData();
  const text = form.get("message");
  const expectedVersionValue = form.get("expectedAssignmentVersion");
  const suppliedIdempotencyKey = form.get("idempotencyKey");
  if (typeof text !== "string" || !text.trim() || text.length > 1500) {
    await recordAuditEvent({ actorUserId: actor.userId, actorRole: actor.role,
      action: "handoff.reply", resourceType: "conversation", resourceId: id,
      outcome: "failure", metadata: { reason: "invalid_message", statusCode: 400 } });
    return new NextResponse("Invalid message", { status: 400 });
  }
  const expectedAssignmentVersion = Number(expectedVersionValue);
  if (!Number.isSafeInteger(expectedAssignmentVersion) || expectedAssignmentVersion < 0) {
    return new NextResponse("Invalid assignment version", { status: 400 });
  }
  const idempotencyKey = typeof suppliedIdempotencyKey === "string" && suppliedIdempotencyKey.length >= 8
    ? `human-reply:${id}:${suppliedIdempotencyKey.slice(0, 100)}`
    : `human-reply:${id}:${randomUUID()}`;

  const repository = new NeonConversationRepository();
  let replyToken: string | undefined;
  try {
    let conversation = (await repository.listHandoffs()).find((item) => item.id === id);
    if (!conversation || !conversation.providerAccountId || !conversation.providerConversationId) {
      await recordAuditEvent({ actorUserId: actor.userId, actorRole: actor.role,
        action: "handoff.reply", resourceType: "conversation", resourceId: id,
        outcome: "failure", metadata: { reason: "conversation_not_found", statusCode: 404 } });
      return new NextResponse("Not found", { status: 404 });
    }
    if (conversation.assignedAttendantUserId && conversation.assignedAttendantUserId !== actor.userId) {
      await recordAuditEvent({ actorUserId: actor.userId, actorRole: actor.role,
        action: "handoff.reply", resourceType: "conversation", resourceId: id,
        outcome: "denied", metadata: { reason: "assigned_to_another_attendant", statusCode: 409,
          assignedAttendantUserId: conversation.assignedAttendantUserId } });
      return new NextResponse("Conversation is assigned to another attendant", { status: 409 });
    }
    if (conversation.assignedAttendantUserId === actor.userId
        && conversation.assignmentVersion !== expectedAssignmentVersion) {
      return new NextResponse("Conversation assignment changed", { status: 409 });
    }
    if (conversation.status === "human_requested" || !conversation.assignedAttendantUserId) {
      if (conversation.status === "human_requested") {
        await repository.takeHandoff(id, { userId: actor.userId, label: appUserLabel(actor) });
      } else {
        await repository.assumeAgentConversation(id, { userId: actor.userId, label: appUserLabel(actor) });
      }
      conversation = (await repository.listHandoffs()).find((item) => item.id === id);
      if (!conversation) return new NextResponse("Conversation changed", { status: 409 });
    }
    const reservation = await repository.reserveHumanReply({ conversationId: id,
      actorUserId: actor.userId, expectedAssignmentVersion: conversation.assignmentVersion,
      idempotencyKey });
    if (reservation.kind === "conflict") {
      return new NextResponse("Conversation assignment changed", { status: 409 });
    }
    if (reservation.kind === "already_sent") {
      return NextResponse.redirect(new URL(`/handoff?conversation=${id}`, request.url), 303);
    }
    replyToken = reservation.token;
    await new ZernioWhatsAppProvider(apiKey).sendText({ accountId: reservation.providerAccountId,
      conversationId: reservation.providerConversationId, idempotencyKey, text: text.trim() });
    await repository.completeHumanReply({ conversationId: id, token: reservation.token,
      idempotencyKey, content: text.trim(), actorUserId: actor.userId, actorLabel: appUserLabel(actor) });
    replyToken = undefined;
    await repository.recordHandoffEvent(id, "handoff_replied");
    await recordAuditEvent({ actorUserId: actor.userId, actorRole: actor.role,
      action: "handoff.reply", resourceType: "conversation", resourceId: id, outcome: "success" });
  } catch (error) {
    if (replyToken) await repository.releaseHumanReply({ conversationId: id, token: replyToken }).catch(() => undefined);
    await recordAuditEvent({ actorUserId: actor.userId, actorRole: actor.role,
      action: "handoff.reply", resourceType: "conversation", resourceId: id,
      outcome: "failure", metadata: { errorType: error instanceof Error ? error.name : "UnknownError" } });
    throw error;
  }
  return NextResponse.redirect(new URL(`/handoff?conversation=${id}`, request.url), 303);
}
