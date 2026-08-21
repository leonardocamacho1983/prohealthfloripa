import assert from "node:assert/strict";
import test from "node:test";

import { hasAiGatewayCredential } from "./gateway-auth.ts";

test("aceita chave explícita do AI Gateway", () => {
  assert.equal(hasAiGatewayCredential({ AI_GATEWAY_API_KEY: "key", VERCEL_OIDC_TOKEN: undefined }), true);
});

test("aceita OIDC automático da Vercel", () => {
  assert.equal(hasAiGatewayCredential({ AI_GATEWAY_API_KEY: undefined, VERCEL_OIDC_TOKEN: "oidc" }), true);
});

test("rejeita ambiente sem nenhuma credencial", () => {
  assert.equal(hasAiGatewayCredential({ AI_GATEWAY_API_KEY: " ", VERCEL_OIDC_TOKEN: undefined }), false);
});
