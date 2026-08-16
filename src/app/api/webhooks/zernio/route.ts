import { ZernioWhatsAppProvider } from "@/lib/whatsapp/zernio-provider";
import {
  parseZernioWebhook,
  verifyZernioSignature,
} from "@/lib/whatsapp/zernio-webhook";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const apiKey = process.env.ZERNIO_API_KEY;
  const webhookSecret = process.env.ZERNIO_WEBHOOK_SECRET;

  if (!apiKey || !webhookSecret) {
    console.error("Zernio webhook configuration is incomplete");
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

  try {
    const provider = new ZernioWhatsAppProvider(apiKey);
    await provider.sendText({
      accountId: message.accountId,
      conversationId: message.conversationId,
      idempotencyKey: `zernio-webhook-${message.eventId}`,
      text: `ProHealth teste recebido: ${message.text}`,
    });
  } catch (error) {
    console.error("Zernio reply failed", {
      eventId: message.eventId,
      messageId: message.messageId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return Response.json({ error: "Reply failed" }, { status: 502 });
  }

  console.info("Zernio reply sent", {
    eventId: message.eventId,
    messageId: message.messageId,
  });
  return Response.json({ received: true });
}
