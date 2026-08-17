import assert from "node:assert/strict";
import test from "node:test";

import { generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";

import type { ConversationMessage } from "../conversations/types.ts";
import { analyzeMassageRequest } from "../knowledge/massage-catalog-semantics.ts";
import {
  buildGroundedMassageFallback,
  prepareWhatsAppModelMessages,
} from "./generate-whatsapp-reply.ts";
import { generateReplyPlanWithFallback } from "./reply-generation-fallback.ts";

function message(input: {
  id: string;
  content: string;
  role?: ConversationMessage["role"];
}): ConversationMessage {
  const role = input.role ?? "user";
  return {
    id: input.id,
    conversationId: "conversation",
    direction: role === "assistant" ? "outbound" : "inbound",
    role,
    content: input.content,
    createdAt: new Date("2026-08-17T09:30:00.000Z"),
  };
}

test("first turn is always sent to AI SDK as a real non-empty user message", () => {
  const current = message({ id: "current", content: "Quero massagem relaxante" });
  const consolidated = "Mensagem 1: Quero massagem relaxante";

  const prompt = prepareWhatsAppModelMessages({
    recentMessages: [current],
    currentTurnMessageIds: [current.id],
    currentTurn: consolidated,
  });

  assert.deepEqual(prompt.priorMessages, []);
  assert.deepEqual(prompt.messages, [{ role: "user", content: consolidated }]);
});

test("new episode consolidates a burst once without duplicating its raw bubbles", () => {
  const current = [
    message({ id: "greeting", content: "Oi bom dia" }),
    message({ id: "service", content: "Queria ver massagem relaxante" }),
    message({ id: "symptom", content: "Dor na cervical" }),
  ];
  const consolidated = current
    .map((item, index) => `Mensagem ${index + 1}: ${item.content}`)
    .join("\n");

  const prompt = prepareWhatsAppModelMessages({
    recentMessages: current,
    currentTurnMessageIds: current.map((item) => item.id),
    currentTurn: consolidated,
  });

  assert.deepEqual(prompt.priorMessages, []);
  assert.equal(prompt.messages.length, 1);
  assert.deepEqual(prompt.messages[0], { role: "user", content: consolidated });
  assert.equal(prompt.messages.filter((item) => item.content === consolidated).length, 1);
});

test("system records are excluded while safe history and the current turn are preserved", () => {
  const current = message({ id: "current", content: "E o endereço?" });
  const prompt = prepareWhatsAppModelMessages({
    recentMessages: [
      message({ id: "prior-user", content: "Quanto custa a massagem?" }),
      message({ id: "internal", content: "segredo operacional", role: "system" }),
      message({ id: "prior-assistant", content: "A relaxante custa R$ 270.", role: "assistant" }),
      current,
    ],
    currentTurnMessageIds: [current.id],
    currentTurn: "Mensagem 1: E o endereço?",
  });

  assert.deepEqual(prompt.messages, [
    { role: "user", content: "Quanto custa a massagem?" },
    { role: "assistant", content: "A relaxante custa R$ 270." },
    { role: "user", content: "Mensagem 1: E o endereço?" },
  ]);
  assert.doesNotMatch(JSON.stringify(prompt.messages), /segredo operacional/);
});

test("legacy single-message caller does not duplicate the latest matching user bubble", () => {
  const current = message({ id: "current", content: "Quero Pilates" });
  const prompt = prepareWhatsAppModelMessages({
    recentMessages: [current],
    currentTurn: current.content,
  });

  assert.deepEqual(prompt.messages, [{ role: "user", content: "Quero Pilates" }]);
});

test("plain-text fallback can call AI SDK with the valid first-turn prompt", async () => {
  const current = message({ id: "current", content: "Quero Pilates" });
  const prompt = prepareWhatsAppModelMessages({
    recentMessages: [current],
    currentTurnMessageIds: [current.id],
    currentTurn: "Mensagem 1: Quero Pilates",
  });
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: "Claro! Você prefere uma ou duas vezes por semana?" }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 10, text: 10, reasoning: undefined },
      },
      warnings: [],
    }),
  });

  const plan = await generateReplyPlanWithFallback({
    generateStructured: async () => {
      const error = new Error("invalid structured prompt");
      error.name = "AI_InvalidPromptError";
      throw error;
    },
    generatePlainText: async () => (await generateText({ model, messages: prompt.messages })).text,
  });

  assert.equal(plan.generationMode, "plain_text_fallback");
  assert.deepEqual(plan.messages, ["Claro! Você prefere uma ou duas vezes por semana?"]);
});

test("grounded massage fallback preserves greeting and splits commercial from caution and action", () => {
  const currentTurn = [
    "Mensagem 1: Oi bom dia",
    "Mensagem 2: Queria ver massagem relaxante hoje",
    "Mensagem 3: Estou com dor na cervical e no ombro direito",
  ].join("\n");
  const plan = buildGroundedMassageFallback(
    analyzeMassageRequest(currentTurn),
    currentTurn,
    { allowPartial: false },
  );

  assert.ok(plan);
  assert.equal(plan.messages.length, 2);
  assert.match(plan.messages[0], /^Bom dia!/);
  assert.match(plan.messages[0], /tradicional\/clássica/i);
  assert.match(plan.messages[0], /R\$ 270/);
  assert.doesNotMatch(plan.messages[0], /dor|desconforto/i);
  assert.match(plan.messages[1], /profissional avalia/i);
  assert.match(plan.messages[1], /manhã, à tarde ou à noite/i);
  assert.equal(plan.messages.join(" ").match(/R\$ 270/g)?.length, 1);
});
