import assert from "node:assert/strict";
import test from "node:test";

import { APP_FEATURE_FLAGS, parseAppFeatureFlag } from "./types.ts";

test("accepts only declared application feature flags", () => {
  for (const flag of APP_FEATURE_FLAGS) assert.equal(parseAppFeatureFlag(flag), flag);
  for (const value of [undefined, "", "unknown", "CONVERSATION_TRANSFER", 1]) {
    assert.equal(parseAppFeatureFlag(value), undefined);
  }
});
