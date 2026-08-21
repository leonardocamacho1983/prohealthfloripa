import assert from "node:assert/strict";
import test from "node:test";

import { parseProHealthAgentMode } from "./prohealth-agent-mode.ts";

test("new agent is active by default only in Preview", () => {
  assert.equal(parseProHealthAgentMode(undefined, "preview"), "active");
  assert.equal(parseProHealthAgentMode(undefined, "production"), "off");
  assert.equal(parseProHealthAgentMode(undefined, "development"), "off");
});

test("new agent supports explicit rollback", () => {
  assert.equal(parseProHealthAgentMode("off", "preview"), "off");
  assert.equal(parseProHealthAgentMode("active", "production"), "active");
});
