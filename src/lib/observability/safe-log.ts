import { createHmac } from "node:crypto";

type ProcessingLog = {
  event: string;
  eventId?: string;
  messageId?: string;
  phoneNumber?: string;
  contactId?: string;
  conversationId?: string;
  result?: string;
  error?: string;
};

export function fingerprintIdentifier(identifier: string): string {
  const key = process.env.ZERNIO_WEBHOOK_SECRET ?? "prohealth-local-log-fingerprint-v1";
  return `hmac:${createHmac("sha256", key).update(identifier).digest("hex").slice(0, 16)}`;
}

export function logProcessingEvent(level: "info" | "warn" | "error", data: ProcessingLog): void {
  console[level](data.event, {
    ...(data.eventId ? { eventFingerprint: fingerprintIdentifier(data.eventId) } : {}),
    ...(data.messageId ? { messageFingerprint: fingerprintIdentifier(data.messageId) } : {}),
    ...(data.phoneNumber ? { phoneFingerprint: fingerprintIdentifier(data.phoneNumber) } : {}),
    ...(data.contactId ? { contactFingerprint: fingerprintIdentifier(data.contactId) } : {}),
    ...(data.conversationId ? { conversationFingerprint: fingerprintIdentifier(data.conversationId) } : {}),
    ...(data.result ? { result: data.result } : {}),
    ...(data.error ? { error: data.error } : {}),
  });
}
