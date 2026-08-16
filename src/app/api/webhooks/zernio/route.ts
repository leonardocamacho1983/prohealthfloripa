import { after } from "next/server";

import { NeonConversationRepository } from "@/lib/conversations/neon-repository";
import { normalizeBrazilianPhoneNumber } from "@/lib/conversations/phone";
import { adaptiveBatchDelaySeconds } from "@/lib/conversations/turn-planning";
import { enqueueWhatsAppTurn } from "@/lib/conversations/turn-queue";
import { logProcessingEvent } from "@/lib/observability/safe-log";
import { ZernioWhatsAppProvider } from "@/lib/whatsapp/zernio-provider";
import {
  parseZernioWebhook,
  verifyZernioSignature,
} from "@/lib/whatsapp/zernio-webhook";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const apiKey = process.env.ZERNIO_API_KEY;
  const webhookSecret = process.env.ZERNIO_WEBHOOK_SECRET;
  const databaseUrl = process.env.DATABASE_URL;

  if (!apiKey || !webhookSecret || !databaseUrl) {
    console.error("Webhook configuration is incomplete");
    return Response.json({ error: "Webhook unavailable" }, { status: 503 });
  }

  const signature = request.headers.get("x-zernio-signature");
  const rawBody = await request.text();

  if (!signature || !verifyZernioSignature(rawBody, signature, webhookSecret)) {
    console.warn("Zernio webhook signature rejected");
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parseZernioWebhook(payload);

  if (parsed.kind === "invalid") {
    console.warn("Invalid Zernio webhook", { reason: parsed.reason });
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  if (parsed.kind === "ignored") {
    console.info("Zernio webhook ignored", { reason: parsed.reason });
    return Response.json({ received: true });
  }

  const { message } = parsed;
  console.info("Zernio text message received", {
    eventId: message.eventId,
    messageId: message.messageId,
  });

  const delaySeconds = adaptiveBatchDelaySeconds(message.text);
  try {
    const repository = new NeonConversationRepository();
    const inbound = await repository.recordInbound({
      phoneNumber: normalizeBrazilianPhoneNumber(message.sender.phoneNumber ?? message.sender.id),
      providerMessageId: message.messageId,
      content: message.text,
      providerAccountId: message.accountId,
      providerConversationId: message.conversationId,
      settleAt: new Date(Date.now() + delaySeconds * 1000),
    });
    if (inbound.conversationStatus !== "human_requested" && inbound.conversationStatus !== "human_active") {
      await enqueueWhatsAppTurn({ conversationId: inbound.identity.conversationId,
        observedRevision: inbound.revision }, delaySeconds);
      if (inbound.inserted) {
        after(async () => {
          try {
            await new ZernioWhatsAppProvider(apiKey).sendTypingIndicator({ accountId: message.accountId,
              conversationId: message.conversationId });
          } catch (error) {
            console.warn("WhatsApp typing indicator failed", { error: error instanceof Error ? error.name : "UnknownError" });
          }
        });
      }
    }
    logProcessingEvent("info", { event: "WhatsApp message durably queued", eventId: message.eventId,
      messageId: message.messageId, result: inbound.inserted ? "queued" : "duplicate_requeued" });
  } catch (error) {
    logProcessingEvent("error", { event: "WhatsApp message ingestion failed", eventId: message.eventId,
      messageId: message.messageId, error: error instanceof Error ? error.name : "UnknownError" });
    return Response.json({ error: "Temporary ingestion failure" }, { status: 503 });
  }

  return Response.json({ received: true });
}
