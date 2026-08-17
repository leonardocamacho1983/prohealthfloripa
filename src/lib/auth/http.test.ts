import assert from "node:assert/strict";
import test from "node:test";
import { AppAuthorizationError, authorizationStatusMessage, isAppAuthorizationError } from "./http.ts";

test("authorization HTTP status preserves identity-provider outages", () => {
  assert.equal(authorizationStatusMessage(401), "Unauthorized");
  assert.equal(authorizationStatusMessage(403), "Forbidden");
  assert.equal(authorizationStatusMessage(503), "Service Unavailable");
});

test("authorization errors retain a Clerk outage as HTTP 503", () => {
  const error = new AppAuthorizationError(503);
  assert.equal(error.status, 503);
  assert.equal(error.message, "Service Unavailable");
  assert.equal(isAppAuthorizationError(error), true);
});
