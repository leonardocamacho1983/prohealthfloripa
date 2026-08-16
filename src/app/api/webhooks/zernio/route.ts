import { after } from "next/server";

import { generateWhatsAppReply } from "@/lib/ai/generate-whatsapp-reply";
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

  if (!aiGatewayApiKey || !apiKey || !webhookSecret) {
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
      const reply = await generateWhatsAppReply(message.text);
      const provider = new ZernioWhatsAppProvider(apiKey);
      await provider.sendText({
        accountId: message.accountId,
        conversationId: message.conversationId,
        idempotencyKey: `zernio-webhook-${message.eventId}`,
        text: reply,
      });

      console.info("AI WhatsApp reply sent", {
        eventId: message.eventId,
        messageId: message.messageId,
      });
    } catch (error) {
      console.error("AI WhatsApp reply failed", {
        eventId: message.eventId,
        messageId: message.messageId,
        error: error instanceof Error ? error.name : "UnknownError",
      });
    }
  });

  return Response.json({ received: true });
}
