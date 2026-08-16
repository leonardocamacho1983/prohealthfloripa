import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  parseZernioWebhook,
  verifyZernioSignature,
} from "./zernio-webhook.ts";

const validPayload = {
  id: "event-123",
  event: "message.received",
  message: {
    id: "message-internal-123",
    conversationId: "conversation-123",
    platform: "whatsapp",
    platformMessageId: "wamid.123",
    direction: "incoming",
    text: "Oi",
    attachments: [],
    sender: {
      id: "5548999999999",
      phoneNumber: "+5548999999999",
    },
    sentAt: "2026-08-16T12:00:00.000Z",
    isRead: false,
  },
  conversation: {
    id: "conversation-123",
    platformConversationId: "platform-conversation-123",
    status: "active",
  },
  account: {
    id: "account-123",
    accountId: "account-123",
    platform: "whatsapp",
    username: "+12029087457",
  },
  timestamp: "2026-08-16T12:00:00.000Z",
};

test("parses an incoming WhatsApp text message", () => {
  const result = parseZernioWebhook(validPayload);

  assert.equal(result.kind, "message");
  if (result.kind === "message") {
    assert.equal(result.message.text, "Oi");
    assert.equal(result.message.sender.phoneNumber, "+5548999999999");
    assert.equal(result.message.conversationId, "conversation-123");
    assert.equal(result.message.messageId, "wamid.123");
  }
});

test("ignores outgoing messages to prevent reply loops", () => {
  const payload = structuredClone(validPayload);
  payload.message.direction = "outgoing";

  assert.deepEqual(parseZernioWebhook(payload), {
    kind: "ignored",
    reason: "not_incoming",
  });
});

test("ignores messages without text", () => {
  const payload = structuredClone(validPayload);
  payload.message.text = "";

  assert.deepEqual(parseZernioWebhook(payload), {
    kind: "ignored",
    reason: "not_text",
  });
});

test("rejects malformed message payloads", () => {
  const payload = structuredClone(validPayload);
  delete (payload.message as Partial<typeof payload.message>).sender;

  assert.deepEqual(parseZernioWebhook(payload), {
    kind: "invalid",
    reason: "missing_sender",
  });
});

test("verifies the documented Zernio HMAC-SHA256 signature", () => {
  const rawBody = JSON.stringify(validPayload);
  const secret = "test-only-secret";
  const signature = createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  assert.equal(verifyZernioSignature(rawBody, signature, secret), true);
  assert.equal(verifyZernioSignature(`${rawBody} `, signature, secret), false);
});
