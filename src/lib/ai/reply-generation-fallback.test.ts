import assert from "node:assert/strict";
import test from "node:test";

import { RetryError } from "ai";

import { summarizeAiError } from "./error-summary.ts";
import {
  generateReplyPlanWithFallback,
  plainTextReplyToMessages,
  WhatsAppReplyGenerationError,
} from "./reply-generation-fallback.ts";

test("summarizeAiError keeps diagnostic codes but excludes sensitive error content", () => {
  const apiError = new Error("customer said secret-message and token sk-secret");
  apiError.name = "AI_APICallError";
  Object.assign(apiError, {
    statusCode: 503,
    responseBody: "sensitive provider response",
    requestBodyValues: { prompt: "sensitive customer prompt" },
  });
  const retryError = new RetryError({
    message: "Failed after 2 attempts. Last error: sensitive",
    reason: "maxRetriesExceeded",
    errors: [apiError],
  });

  const summary = summarizeAiError(retryError);

  assert.deepEqual(summary, {
    name: "AI_RetryError",
    retryReason: "maxRetriesExceeded",
    lastErrorName: "AI_APICallError",
    statusCode: 503,
  });
  const serialized = JSON.stringify(summary);
  assert.doesNotMatch(serialized, /secret|customer|prompt|response|token/i);
});

test("structured RetryError falls back to a simple plain-text response", async () => {
  const failures: Array<{ attempt: string; name: string }> = [];
  const retryError = new RetryError({
    message: "provider response included private content",
    reason: "errorNotRetryable",
    errors: [Object.assign(new Error("private"), { name: "AI_APICallError", statusCode: 400 })],
  });

  const plan = await generateReplyPlanWithFallback({
    generateStructured: async () => { throw retryError; },
    generatePlainText: async () => "Primeira resposta curta.\n---\nSegunda resposta curta.",
    onAttemptFailure: (attempt, summary) => failures.push({ attempt, name: summary.name }),
  });

  assert.deepEqual(plan, {
    messages: ["Primeira resposta curta.", "Segunda resposta curta."],
    answeredTopics: [],
    needsClarification: false,
    handoffRecommended: false,
    generationMode: "plain_text_fallback",
  });
  assert.deepEqual(failures, [{ attempt: "structured", name: "AI_RetryError" }]);
});

test("a grounded deterministic answer avoids a second provider attempt", async () => {
  let plainAttempts = 0;
  const result = await generateReplyPlanWithFallback({
    generateStructured: async () => { throw new Error("structured unavailable"); },
    generateDeterministicFallback: () => ({
      messages: ["Miofascial custa R$ 270 no avulso."],
      answeredTopics: ["massagem_confirmada"],
      needsClarification: false,
      handoffRecommended: false,
    }),
    generatePlainText: async () => { plainAttempts += 1; return "should not run"; },
  });

  assert.equal(result.generationMode, "deterministic_fallback");
  assert.equal(plainAttempts, 0);
});

test("a double generation failure throws only sanitized diagnostics for the orchestrator", async () => {
  const failures: Array<{ attempt: string; summary: unknown }> = [];

  await assert.rejects(async () => generateReplyPlanWithFallback({
      generateStructured: async () => { throw new Error("secret structured prompt"); },
      generatePlainText: async () => { throw new Error("secret plain output"); },
      onAttemptFailure: (attempt, summary) => failures.push({ attempt, summary }),
    }), (error: unknown) => {
    assert.equal(error instanceof WhatsAppReplyGenerationError, true);
    const safeError = error as WhatsAppReplyGenerationError;
    assert.deepEqual(safeError.structuredError, { name: "Error" });
    assert.deepEqual(safeError.plainTextError, { name: "Error" });
    assert.doesNotMatch(JSON.stringify(safeError), /secret|prompt|output/i);
    return true;
  });
  assert.equal(failures.length, 2);
  assert.doesNotMatch(JSON.stringify(failures), /secret|prompt|output/i);
});

test("empty plain-text fallback becomes a sanitized terminal generation error", async () => {
  const attempts: string[] = [];
  await assert.rejects(() => generateReplyPlanWithFallback({
      generateStructured: async () => { throw new Error("failed"); },
      generatePlainText: async () => "  ",
      onAttemptFailure: (attempt) => attempts.push(attempt),
    }), WhatsAppReplyGenerationError);

  assert.deepEqual(attempts, ["structured", "plain_text_fallback"]);
});

test("plain text parser removes fences, limits bubbles and safely bounds length", () => {
  const long = `\`\`\`text\n${"a".repeat(750)}\n---\nsegunda\n---\nterceira\n\`\`\``;
  const messages = plainTextReplyToMessages(long);

  assert.equal(messages.length, 2);
  assert.equal(messages[0].length, 700);
  assert.match(messages[0], /…$/);
  assert.equal(messages[1], "segunda");
});
