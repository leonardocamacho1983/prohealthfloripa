import assert from "node:assert/strict";
import test from "node:test";

import type { WhatsAppProvider } from "./provider.ts";
import { startTypingPresence } from "./typing-presence.ts";

function providerWithTyping(
  sendTypingIndicator: NonNullable<WhatsAppProvider["sendTypingIndicator"]>,
): WhatsAppProvider {
  return { async sendText() {}, sendTypingIndicator };
}

test("typing presence starts immediately, refreshes once and never loops", async () => {
  let attempts = 0;
  const presence = startTypingPresence({
    provider: providerWithTyping(async () => { attempts += 1; }),
    accountId: "account",
    conversationId: "conversation",
    refreshAfterMs: 5,
  });

  assert.equal(attempts, 1);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(attempts, 2);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(attempts, 2);
  presence.stop();
});

test("typing presence is fail-open and reports a provider failure", async () => {
  const failure = new DOMException("provider timeout", "TimeoutError");
  let observed: unknown;
  const presence = startTypingPresence({
    provider: providerWithTyping(async () => { throw failure; }),
    accountId: "account",
    conversationId: "conversation",
    refreshAfterMs: 60_000,
    onFailure: (error) => { observed = error; },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(observed, failure);
  presence.stop();
});

test("stopping typing presence aborts an in-flight signal", async () => {
  let receivedSignal: AbortSignal | undefined;
  const presence = startTypingPresence({
    provider: providerWithTyping(async ({ signal }) => {
      receivedSignal = signal;
      await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
    }),
    accountId: "account",
    conversationId: "conversation",
    refreshAfterMs: 60_000,
  });

  assert.equal(receivedSignal?.aborted, false);
  presence.stop();
  assert.equal(receivedSignal?.aborted, true);
});
