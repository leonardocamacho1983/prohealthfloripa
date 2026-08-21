import assert from "node:assert/strict";
import test from "node:test";

import { parseSemanticPlannerMode } from "./semantic-planner-mode.ts";

test("semantic planner defaults to active outside production and shadow in production", () => {
  assert.equal(parseSemanticPlannerMode(undefined, "preview"), "active");
  assert.equal(parseSemanticPlannerMode(undefined, "development"), "active");
  assert.equal(parseSemanticPlannerMode(undefined, "production"), "shadow");
});

test("semantic planner supports explicit rollback and rollout modes", () => {
  assert.equal(parseSemanticPlannerMode("off", "preview"), "off");
  assert.equal(parseSemanticPlannerMode("shadow", "preview"), "shadow");
  assert.equal(parseSemanticPlannerMode("active", "production"), "active");
});
