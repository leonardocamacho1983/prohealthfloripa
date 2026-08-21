import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SEMANTIC_MODEL,
  gatewayProviderOptions,
  semanticModelRouting,
  whatsappModelRouting,
} from "./gateway-routing.ts";

test("semantic routing uses independent model fallbacks and removes duplicates", () => {
  const routing = semanticModelRouting({
    SEMANTIC_AI_MODEL: "openai/gpt-5.4-mini",
    SEMANTIC_AI_FALLBACK_MODELS: "google/gemini-3-flash, openai/gpt-5.4-mini, google/gemini-3-flash",
  });
  assert.equal(routing.model, "openai/gpt-5.4-mini");
  assert.deepEqual(routing.fallbackModels, ["google/gemini-3-flash"]);
});

test("invalid configured fallbacks fail closed without inventing a model id", () => {
  const routing = semanticModelRouting({
    SEMANTIC_AI_FALLBACK_MODELS: "invalid, /missing-provider, good/model",
  });
  assert.equal(routing.model, DEFAULT_SEMANTIC_MODEL);
  assert.deepEqual(routing.fallbackModels, ["good/model"]);
});

test("WhatsApp generation can use a separately configured fallback chain", () => {
  assert.deepEqual(whatsappModelRouting({
    WHATSAPP_AI_MODEL: "openai/gpt-5.4-mini",
    WHATSAPP_AI_FALLBACK_MODELS: "google/gemini-3-flash",
  }), {
    model: "openai/gpt-5.4-mini",
    fallbackModels: ["google/gemini-3-flash"],
  });
});

test("gateway options contain only operational tags and fallback models", () => {
  const options = gatewayProviderOptions({
    fallbackModels: ["google/gemini-3-flash"],
    feature: "semantic-turn",
  });
  assert.deepEqual(options.gateway.models, ["google/gemini-3-flash"]);
  assert.ok((options.gateway.tags as string[]).includes("feature:semantic-turn"));
  assert.equal(JSON.stringify(options).includes("cervical"), false);
});
