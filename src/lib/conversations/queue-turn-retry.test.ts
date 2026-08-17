import assert from "node:assert/strict";
import test from "node:test";

import {
  isRetryableTurnStateError,
  queueTurnRetryDirective,
  requireSettledQueueTurn,
} from "./queue-turn-retry.ts";
import type { TurnProcessingResult } from "./process-conversation-turn.ts";

test("temporary acquisition states are retried instead of acknowledged", () => {
  for (const state of ["not_due", "busy"] as const) {
    assert.throws(() => requireSettledQueueTurn(state), (error) => {
      if (!isRetryableTurnStateError(error)) return false;
      assert.equal(error.state, state);
      assert.ok(error.retryAfterSeconds > 0);
      return true;
    });
  }
});

test("terminal and superseded turns may be acknowledged", () => {
  const terminal: TurnProcessingResult[] = [
    "replied",
    "suppressed",
    "handoff_requested",
    "stale",
    "human_silent",
    "complete",
    "missing",
  ];
  for (const result of terminal) assert.equal(requireSettledQueueTurn(result), result);
});

test("temporary states never become permanent failures after repeated delivery", () => {
  let error: unknown;
  try {
    requireSettledQueueTurn("not_due");
  } catch (caught) {
    error = caught;
  }
  assert.deepEqual(queueTurnRetryDirective(error, 20), { afterSeconds: 1 });
});

test("real repeated failures keep the bounded permanent-failure policy", () => {
  assert.deepEqual(queueTurnRetryDirective(new Error("provider failed"), 3), { afterSeconds: 24 });
  assert.deepEqual(queueTurnRetryDirective(new Error("provider failed"), 7), { acknowledge: true });
});
