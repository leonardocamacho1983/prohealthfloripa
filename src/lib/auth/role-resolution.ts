import { parseAppRole, type AppRole } from "./permissions.ts";

export const BOOTSTRAP_ADMIN_EMAIL = "leonardocamacho@gmail.com";

export type RoleResolution =
  | { kind: "resolved"; role: AppRole; bootstrap: false }
  | { kind: "resolved"; role: "admin"; bootstrap: true }
  | { kind: "denied"; reason: "missing_role" | "invalid_role" };

export function resolveAppRole(input: {
  metadataRole: unknown;
  metadataRolePresent: boolean;
  primaryEmail?: string | null;
  primaryEmailVerified?: boolean;
}): RoleResolution {
  const role = parseAppRole(input.metadataRole);
  if (role) return { kind: "resolved", role, bootstrap: false };

  // Invalid metadata is never overwritten automatically. That keeps a typo or
  // unauthorized value from silently becoming an administrator account.
  if (input.metadataRolePresent) return { kind: "denied", reason: "invalid_role" };

  const email = input.primaryEmail?.trim().toLowerCase();
  if (input.primaryEmailVerified && email === BOOTSTRAP_ADMIN_EMAIL) {
    return { kind: "resolved", role: "admin", bootstrap: true };
  }

  return { kind: "denied", reason: "missing_role" };
}
