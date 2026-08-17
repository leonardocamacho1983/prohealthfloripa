import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { NeonConversationRepository } from "@/lib/conversations/neon-repository";
import { recordAuditEvent } from "@/lib/audit";
import { isAppAuthorizationError, requireAppUser } from "@/lib/handoff/server-auth";
import { ZernioWhatsAppProvider } from "@/lib/whatsapp/zernio-provider";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let actor;
  try {
    actor = await requireAppUser();
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
  if (typeof text !== "string" || !text.trim() || text.length > 1500) {
    await recordAuditEvent({ actorUserId: actor.userId, actorRole: actor.role,
      action: "handoff.reply", resourceType: "conversation", resourceId: id,
      outcome: "failure", metadata: { reason: "invalid_message", statusCode: 400 } });
    return new NextResponse("Invalid message", { status: 400 });
  }

  try {
    const repository = new NeonConversationRepository();
    const conversation = (await repository.listHandoffs()).find((item) => item.id === id);
    if (!conversation || !conversation.providerAccountId || !conversation.providerConversationId) {
      await recordAuditEvent({ actorUserId: actor.userId, actorRole: actor.role,
        action: "handoff.reply", resourceType: "conversation", resourceId: id,
        outcome: "failure", metadata: { reason: "conversation_not_found", statusCode: 404 } });
      return new NextResponse("Not found", { status: 404 });
    }
    if (conversation.status === "human_requested") await repository.takeHandoff(id);
    await new ZernioWhatsAppProvider(apiKey).sendText({ accountId: conversation.providerAccountId,
      conversationId: conversation.providerConversationId, idempotencyKey: `human-${randomUUID()}`, text: text.trim() });
    await repository.recordOutbound({ conversationId: id, content: text.trim() });
    await repository.touchHandoff(id);
    await repository.recordHandoffEvent(id, "handoff_replied");
    await recordAuditEvent({ actorUserId: actor.userId, actorRole: actor.role,
      action: "handoff.reply", resourceType: "conversation", resourceId: id, outcome: "success" });
  } catch (error) {
    await recordAuditEvent({ actorUserId: actor.userId, actorRole: actor.role,
      action: "handoff.reply", resourceType: "conversation", resourceId: id,
      outcome: "failure", metadata: { errorType: error instanceof Error ? error.name : "UnknownError" } });
    throw error;
  }
  return NextResponse.redirect(new URL(`/handoff?conversation=${id}`, request.url), 303);
}
