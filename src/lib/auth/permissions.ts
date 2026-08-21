export const APP_ROLES = ["owner", "admin", "attendant"] as const;

export type AppRole = (typeof APP_ROLES)[number];

export const APP_PERMISSIONS = [
  "handoff:view",
  "handoff:assume",
  "handoff:reply",
  "handoff:close",
  "handoff:transfer",
  "handoff:force_transfer",
  "operations:configure",
  "notifications:test",
  "catalog:sync",
  "users:manage",
  "audit:view",
] as const;

export type AppPermission = (typeof APP_PERMISSIONS)[number];

const permissionsByRole: Record<AppRole, ReadonlySet<AppPermission>> = {
  owner: new Set(APP_PERMISSIONS),
  admin: new Set(APP_PERMISSIONS),
  attendant: new Set([
    "handoff:view",
    "handoff:assume",
    "handoff:reply",
    "handoff:close",
    "handoff:transfer",
    "notifications:test",
  ]),
};

export function parseAppRole(value: unknown): AppRole | undefined {
  return typeof value === "string" && APP_ROLES.includes(value as AppRole)
    ? (value as AppRole)
    : undefined;
}

export function hasPermission(role: AppRole, permission: AppPermission): boolean {
  return permissionsByRole[role].has(permission);
}
