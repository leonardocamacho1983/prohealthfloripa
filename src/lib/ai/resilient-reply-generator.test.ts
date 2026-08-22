import assert from "node:assert/strict";
import test from "node:test";

import { generateReplyWithFallback } from "./resilient-reply-generator.ts";

test("keeps the primary reply when the active agent succeeds", async () => {
  let fallbackCalls = 0;
  const reply = await generateReplyWithFallback({
    input: "hello",
    primary: async () => "primary reply",
    fallback: async () => {
      fallbackCalls += 1;
      return "fallback reply";
    },
  });

  assert.equal(reply, "primary reply");
  assert.equal(fallbackCalls, 0);
});

test("uses the conversational generator when the active agent produces no reply", async () => {
  const failure = Object.assign(new Error("no output"), { name: "AI_NoOutputGeneratedError" });
  let observedFailure: unknown;
  const reply = await generateReplyWithFallback({
    input: "hello",
    primary: async () => { throw failure; },
    fallback: async () => "conversational reply",
    onPrimaryFailure: (error) => { observedFailure = error; },
  });

  assert.equal(reply, "conversational reply");
  assert.equal(observedFailure, failure);
});

test("propagates the fallback failure when both generators fail", async () => {
  const fallbackFailure = new Error("fallback failed");
  await assert.rejects(
    generateReplyWithFallback({
      input: "hello",
      primary: async () => { throw new Error("primary failed"); },
      fallback: async () => { throw fallbackFailure; },
    }),
    fallbackFailure,
  );
});
