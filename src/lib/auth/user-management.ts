import { parseAppRole, type AppRole } from "./permissions.ts";

export const ASSIGNABLE_ROLES: readonly AppRole[] = ["admin", "owner", "attendant"];

export function parseAssignableRole(value: unknown): AppRole | undefined {
  const role = parseAppRole(value);
  return role && ASSIGNABLE_ROLES.includes(role) ? role : undefined;
}

export function canAssignRole(actorRole: AppRole, nextRole: AppRole): boolean {
  if (actorRole === "owner") return true;
  return actorRole === "admin" && nextRole !== "owner";
}

export type RoleChangeDecision =
  | { allowed: true; noChange: boolean }
  | { allowed: false; reason: "actor_not_allowed" | "self_change" | "owner_protected" | "cannot_assign_owner" };

export function evaluateRoleChange(input: {
  actorUserId: string;
  actorRole: AppRole;
  targetUserId: string;
  targetCurrentRole?: AppRole;
  nextRole: AppRole;
}): RoleChangeDecision {
  if (!canAssignRole(input.actorRole, input.nextRole)) {
    return { allowed: false, reason: input.nextRole === "owner" ? "cannot_assign_owner" : "actor_not_allowed" };
  }
  if (input.targetCurrentRole === input.nextRole) return { allowed: true, noChange: true };
  if (input.actorUserId === input.targetUserId) return { allowed: false, reason: "self_change" };

  // Owner roles are immutable through the application. This is deliberately
  // stronger than a non-atomic "last owner" count against Clerk: concurrent
  // requests can never remove the final owner. Exceptional changes remain a
  // deliberate operation in the Clerk dashboard.
  if (input.targetCurrentRole === "owner") return { allowed: false, reason: "owner_protected" };

  return { allowed: true, noChange: false };
}

export function roleLabel(role: AppRole): string {
  return {
    admin: "Administrador",
    owner: "Proprietário",
    attendant: "Atendente",
  }[role];
}
