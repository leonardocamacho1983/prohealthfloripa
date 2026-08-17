import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeAuditMetadata } from "./repository.ts";

test("audit metadata keeps only a small non-sensitive allowlist", () => {
  assert.deepEqual(sanitizeAuditMetadata({
    reason: "forbidden", statusCode: 403, errorType: "ConflictError",
    token: "secret", phone: "5548999999999", message: "private content", nested: { secret: true },
  }), { reason: "forbidden", statusCode: 403, errorType: "ConflictError" });
});
