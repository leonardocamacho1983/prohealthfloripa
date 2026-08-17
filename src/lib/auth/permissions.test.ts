import assert from "node:assert/strict";
import test from "node:test";
import { APP_PERMISSIONS, hasPermission, parseAppRole, type AppRole } from "./permissions.ts";
import { resolveAppRole } from "./role-resolution.ts";

const handoffPermissions = ["handoff:view", "handoff:assume", "handoff:reply", "handoff:close"] as const;

test("owner and admin have every application permission", () => {
  for (const role of ["owner", "admin"] as const) {
    for (const permission of APP_PERMISSIONS) assert.equal(hasPermission(role, permission), true);
  }
});

test("attendant can operate handoffs but cannot administer users, audit, or catalog", () => {
  for (const permission of handoffPermissions) assert.equal(hasPermission("attendant", permission), true);
  for (const permission of ["catalog:sync", "users:manage", "audit:view"] as const) {
    assert.equal(hasPermission("attendant", permission), false);
  }
});

test("only the three declared roles are accepted", () => {
  for (const role of ["owner", "admin", "attendant"] as AppRole[]) assert.equal(parseAppRole(role), role);
  for (const value of [undefined, null, "", "administrator", "Admin", 1]) assert.equal(parseAppRole(value), undefined);
});

test("bootstrap grants admin only to the exact verified primary email when role is absent", () => {
  assert.deepEqual(resolveAppRole({ metadataRole: undefined, metadataRolePresent: false,
    primaryEmail: " LeonardoCamacho@gmail.com ", primaryEmailVerified: true }),
  { kind: "resolved", role: "admin", bootstrap: true });

  for (const primaryEmail of ["other@example.com", "leonardocamacho+admin@gmail.com", undefined]) {
    assert.deepEqual(resolveAppRole({ metadataRole: undefined, metadataRolePresent: false,
      primaryEmail, primaryEmailVerified: true }), { kind: "denied", reason: "missing_role" });
  }
  assert.deepEqual(resolveAppRole({ metadataRole: undefined, metadataRolePresent: false,
    primaryEmail: "leonardocamacho@gmail.com", primaryEmailVerified: false }),
  { kind: "denied", reason: "missing_role" });
});

test("existing metadata is authoritative and invalid metadata is never bootstrapped", () => {
  assert.deepEqual(resolveAppRole({ metadataRole: "attendant", metadataRolePresent: true,
    primaryEmail: "leonardocamacho@gmail.com", primaryEmailVerified: true }),
  { kind: "resolved", role: "attendant", bootstrap: false });
  assert.deepEqual(resolveAppRole({ metadataRole: "administrator", metadataRolePresent: true,
    primaryEmail: "leonardocamacho@gmail.com", primaryEmailVerified: true }),
  { kind: "denied", reason: "invalid_role" });
});
