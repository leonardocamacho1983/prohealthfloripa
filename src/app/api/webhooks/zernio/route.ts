import { after } from "next/server";

import { generateWhatsAppReply } from "@/lib/ai/generate-whatsapp-reply";
import { handleIncomingMessage } from "@/lib/conversations/handle-incoming-message";
import { NeonConversationRepository } from "@/lib/conversations/neon-repository";
import { logProcessingEvent } from "@/lib/observability/safe-log";
import { NextfitClient } from "@/lib/nextfit/client";
import { createNextfitEnricher } from "@/lib/nextfit/sync-customer";
import { ZernioWhatsAppProvider } from "@/lib/whatsapp/zernio-provider";
import {
  parseZernioWebhook,
  verifyZernioSignature,
} from "@/lib/whatsapp/zernio-webhook";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const aiGatewayApiKey = process.env.AI_GATEWAY_API_KEY;
  const apiKey = process.env.ZERNIO_API_KEY;
  const webhookSecret = process.env.ZERNIO_WEBHOOK_SECRET;
  const databaseUrl = process.env.DATABASE_URL;

  if (!aiGatewayApiKey || !apiKey || !webhookSecret || !databaseUrl) {
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

  after(async () => {
    try {
      const provider = new ZernioWhatsAppProvider(apiKey);
      const repository = new NeonConversationRepository();
      const nextfitApiKey = process.env.NEXTFIT_API_KEY;
      const result = await handleIncomingMessage({
        accountId: message.accountId,
        providerConversationId: message.conversationId,
        providerEventId: message.eventId,
        providerMessageId: message.messageId,
        phoneNumber: message.sender.phoneNumber ?? message.sender.id,
        text: message.text,
        repository,
        provider,
        generateReply: generateWhatsAppReply,
        ...(nextfitApiKey ? { enrichCustomer: createNextfitEnricher({ api: new NextfitClient(nextfitApiKey), store: repository }) } : {}),
      });

      logProcessingEvent("info", {
        event: "WhatsApp message processing completed",
        eventId: message.eventId,
        messageId: message.messageId,
        result,
      });
    } catch (error) {
      logProcessingEvent("error", {
        event: "WhatsApp message processing failed",
        eventId: message.eventId,
        messageId: message.messageId,
        error: error instanceof Error ? error.name : "UnknownError",
      });
    }
  });

  return Response.json({ received: true });
}
