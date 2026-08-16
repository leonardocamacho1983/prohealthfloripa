import assert from "node:assert/strict";
import test from "node:test";

import { ZernioWhatsAppProvider } from "./zernio-provider.ts";

test("sends the official Zernio typing indicator without exposing credentials in the body", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    requestUrl = String(input); requestInit = init;
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };
  const provider = new ZernioWhatsAppProvider("secret-key", fetcher);
  await provider.sendTypingIndicator({ accountId: "account-1", conversationId: "conversation/1" });
  assert.equal(requestUrl, "https://zernio.com/api/v1/inbox/conversations/conversation%2F1/typing");
  assert.equal(requestInit?.method, "POST");
  assert.deepEqual(JSON.parse(String(requestInit?.body)), { accountId: "account-1" });
  assert.equal(String(requestInit?.body).includes("secret-key"), false);
});
