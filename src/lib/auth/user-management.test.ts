import assert from "node:assert/strict";
import test from "node:test";

import { canAssignRole, evaluateRoleChange, parseAssignableRole, roleLabel } from "./user-management.ts";

test("only declared application roles can be assigned", () => {
  assert.equal(parseAssignableRole("attendant"), "attendant");
  assert.equal(parseAssignableRole("admin"), "admin");
  assert.equal(parseAssignableRole("owner"), "owner");
  assert.equal(parseAssignableRole("manager"), undefined);
  assert.equal(parseAssignableRole(undefined), undefined);
});

test("admins cannot grant the owner role", () => {
  assert.equal(canAssignRole("admin", "attendant"), true);
  assert.equal(canAssignRole("admin", "admin"), true);
  assert.equal(canAssignRole("admin", "owner"), false);
  assert.equal(canAssignRole("owner", "owner"), true);
  assert.equal(canAssignRole("attendant", "attendant"), false);
});

test("roles have human-readable Portuguese labels", () => {
  assert.equal(roleLabel("attendant"), "Atendente");
  assert.equal(roleLabel("admin"), "Administrador");
  assert.equal(roleLabel("owner"), "Proprietário");
});

test("admin cannot alter an owner or grant the owner role", () => {
  assert.deepEqual(evaluateRoleChange({ actorUserId: "admin", actorRole: "admin", targetUserId: "owner",
    targetCurrentRole: "owner", nextRole: "attendant" }), { allowed: false, reason: "owner_protected" });
  assert.deepEqual(evaluateRoleChange({ actorUserId: "admin", actorRole: "admin", targetUserId: "attendant",
    targetCurrentRole: "attendant", nextRole: "owner" }), { allowed: false, reason: "cannot_assign_owner" });
});

test("the final owner is safe because owner roles cannot be demoted through the app", () => {
  assert.deepEqual(evaluateRoleChange({ actorUserId: "owner-a", actorRole: "owner", targetUserId: "owner-b",
    targetCurrentRole: "owner", nextRole: "admin" }), { allowed: false, reason: "owner_protected" });
});

test("users cannot change their own role", () => {
  assert.deepEqual(evaluateRoleChange({ actorUserId: "admin", actorRole: "admin", targetUserId: "admin",
    targetCurrentRole: "admin", nextRole: "attendant" }), { allowed: false, reason: "self_change" });
});

test("no-op role saves are harmless and normal authorized changes remain allowed", () => {
  assert.deepEqual(evaluateRoleChange({ actorUserId: "admin", actorRole: "admin", targetUserId: "attendant",
    targetCurrentRole: "attendant", nextRole: "attendant" }), { allowed: true, noChange: true });
  assert.deepEqual(evaluateRoleChange({ actorUserId: "admin", actorRole: "admin", targetUserId: "attendant",
    targetCurrentRole: "attendant", nextRole: "admin" }), { allowed: true, noChange: false });
});
