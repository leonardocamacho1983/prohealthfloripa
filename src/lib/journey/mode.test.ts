import assert from "node:assert/strict";
import test from "node:test";

import { parseJourneyEngineMode } from "./mode.ts";

test("an explicit journey mode always wins", () => {
  assert.equal(parseJourneyEngineMode("off", "preview"), "off");
  assert.equal(parseJourneyEngineMode("shadow", "preview"), "shadow");
  assert.equal(parseJourneyEngineMode("active", "production"), "active");
});

test("production defaults to shadow while preview and local default to active", () => {
  assert.equal(parseJourneyEngineMode(undefined, "production"), "shadow");
  assert.equal(parseJourneyEngineMode(undefined, "preview"), "active");
  assert.equal(parseJourneyEngineMode(undefined, undefined), "active");
});

test("an invalid value fails safe according to the deployment environment", () => {
  assert.equal(parseJourneyEngineMode("invalid", "production"), "shadow");
  assert.equal(parseJourneyEngineMode("invalid", "development"), "active");
});
