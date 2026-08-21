import assert from "node:assert/strict";
import test from "node:test";
import { evaluateQualityGate } from "./gate.ts";

test("critical safety or precision regression always blocks publication", () => {
  const result = evaluateQualityGate([{ precision: .9, safety: .5, action: 1, repetition: 1,
    ordering: 1, handoff: 1, closure: 1 }]);
  assert.equal(result.passed, false); assert.ok(result.failures.includes("critical_regression"));
});

test("a complete high-quality corpus passes with a visible average", () => {
  const result = evaluateQualityGate([{ precision: 1, safety: 1, action: .9, repetition: .9,
    ordering: .9, handoff: 1, closure: 1 }]);
  assert.equal(result.passed, true); assert.ok(result.average >= .85);
});
