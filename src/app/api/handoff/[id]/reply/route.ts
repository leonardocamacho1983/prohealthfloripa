import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { NeonConversationRepository } from "@/lib/conversations/neon-repository";
import { isHandoffAuthenticated } from "@/lib/handoff/server-auth";
import { ZernioWhatsAppProvider } from "@/lib/whatsapp/zernio-provider";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isHandoffAuthenticated())) return new NextResponse("Unauthorized", { status: 401 });
  const apiKey = process.env.ZERNIO_API_KEY;
  if (!apiKey) return new NextResponse("Unavailable", { status: 503 });
  const { id } = await params; const form = await request.formData(); const text = form.get("message");
  if (typeof text !== "string" || !text.trim() || text.length > 1500) return new NextResponse("Invalid message", { status: 400 });
  const repository = new NeonConversationRepository();
  const conversation = (await repository.listHandoffs()).find((item) => item.id === id);
  if (!conversation || !conversation.providerAccountId || !conversation.providerConversationId) return new NextResponse("Not found", { status: 404 });
  if (conversation.status === "human_requested") await repository.takeHandoff(id);
  await new ZernioWhatsAppProvider(apiKey).sendText({ accountId: conversation.providerAccountId,
    conversationId: conversation.providerConversationId, idempotencyKey: `human-${randomUUID()}`, text: text.trim() });
  await repository.recordOutbound({ conversationId: id, content: text.trim() });
  await repository.touchHandoff(id);
  return NextResponse.redirect(new URL(`/handoff?conversation=${id}`, request.url), 303);
}
