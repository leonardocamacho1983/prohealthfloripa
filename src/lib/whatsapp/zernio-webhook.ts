import { createHmac, timingSafeEqual } from "node:crypto";

type JsonObject = Record<string, unknown>;

export type ZernioTextMessage = {
  accountId: string;
  conversationId: string;
  eventId: string;
  messageId: string;
  sender: {
    id: string;
    phoneNumber?: string;
  };
  text: string;
};

export type ZernioWebhookParseResult =
  | { kind: "message"; message: ZernioTextMessage }
  | { kind: "ignored"; reason: string }
  | { kind: "invalid"; reason: string };

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

export function verifyZernioSignature(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest();

  if (!/^[a-f\d]{64}$/i.test(signature)) {
    return false;
  }

  const received = Buffer.from(signature, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function parseZernioWebhook(payload: unknown): ZernioWebhookParseResult {
  if (!isObject(payload)) {
    return { kind: "invalid", reason: "payload_not_object" };
  }

  if (payload.event !== "message.received") {
    return { kind: "ignored", reason: "unsupported_event" };
  }

  const eventId = nonEmptyString(payload.id);
  const message = payload.message;
  const account = payload.account;

  if (!eventId || !isObject(message) || !isObject(account)) {
    return { kind: "invalid", reason: "missing_event_context" };
  }

  if (message.platform !== "whatsapp") {
    return { kind: "ignored", reason: "not_whatsapp" };
  }

  if (message.direction !== "incoming") {
    return { kind: "ignored", reason: "not_incoming" };
  }

  const text = nonEmptyString(message.text);
  if (!text) {
    return { kind: "ignored", reason: "not_text" };
  }

  const sender = message.sender;
  if (!isObject(sender)) {
    return { kind: "invalid", reason: "missing_sender" };
  }

  const accountId =
    nonEmptyString(account.accountId) ?? nonEmptyString(account.id);
  const conversationId = nonEmptyString(message.conversationId);
  const messageId =
    nonEmptyString(message.platformMessageId) ?? nonEmptyString(message.id);
  const senderId = nonEmptyString(sender.id);

  if (!accountId || !conversationId || !messageId || !senderId) {
    return { kind: "invalid", reason: "missing_message_fields" };
  }

  const phoneNumber = nonEmptyString(sender.phoneNumber);

  return {
    kind: "message",
    message: {
      accountId,
      conversationId,
      eventId,
      messageId,
      sender: {
        id: senderId,
        ...(phoneNumber ? { phoneNumber } : {}),
      },
      text,
    },
  };
}
