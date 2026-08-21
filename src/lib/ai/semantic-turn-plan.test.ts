import assert from "node:assert/strict";
import test from "node:test";

import { validateSemanticTurnPlan, type SemanticTurnPlan } from "./semantic-turn-plan.ts";

function validPlan(overrides: Partial<SemanticTurnPlan> = {}): SemanticTurnPlan {
  return {
    primaryIntent: "scheduling",
    conversationAct: "continuation",
    requestedService: { family: "pilates", name: "aula experimental", explicit: true },
    scheduling: { requested: true, dayText: "hoje", period: "afternoon", time: "14:00" },
    factsAlreadyProvided: ["service", "day", "time"],
    factsNeeded: [],
    unresolvedQuestions: [],
    nextAction: "check_availability",
    acknowledgeGreeting: false,
    confidence: "high",
    ...overrides,
  };
}

test("accepts an exact hour as a complete scheduling preference", () => {
  assert.deepEqual(validateSemanticTurnPlan(validPlan()), []);
});

test("rejects a plan that asks for period after receiving an exact hour", () => {
  assert.deepEqual(validateSemanticTurnPlan(validPlan({ factsNeeded: ["período"] })), [
    "exact_time_marked_missing",
  ]);
});

test("rejects recovery upsell while the primary request is unresolved", () => {
  const plan = validPlan({
    nextAction: "ask_missing_information",
    scheduling: { requested: true },
    unresolvedQuestions: ["Qual dia e horário?"],
    optionalOffer: { id: "hot_bath", appropriateNow: true, reason: "cross-sell" },
  });
  assert.deepEqual(validateSemanticTurnPlan(plan), ["premature_optional_offer"]);
});

test("requires a complete request before checking availability", () => {
  const plan = validPlan({ scheduling: { requested: true, dayText: "hoje" } });
  assert.deepEqual(validateSemanticTurnPlan(plan), ["availability_without_complete_request"]);
});
