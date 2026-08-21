import { authorize } from "@/lib/auth/server";
import { APP_ROLES, hasPermission, type AppPermission, type AppRole as AuthAppRole } from "@/lib/auth/permissions";
import { AppAuthorizationError } from "@/lib/auth/http";

export { AppAuthorizationError, isAppAuthorizationError } from "@/lib/auth/http";

export type AppRole = AuthAppRole;
export type AppUser = { userId: string; role: AppRole; email?: string; name?: string };

export async function requireAppUser(allowedRoles: readonly AppRole[] = APP_ROLES): Promise<AppUser> {
  const result = await authorize("handoff:view");
  if (!result.ok) {
    throw new AppAuthorizationError(result.status, undefined, {
      userId: result.userId,
      role: result.role,
    });
  }
  if (!allowedRoles.includes(result.principal.role)) {
    throw new AppAuthorizationError(403, undefined, result.principal);
  }
  return result.principal;
}

export async function requireAppPermission(permission: AppPermission): Promise<AppUser> {
  const user = await requireAppUser();
  if (!hasPermission(user.role, permission)) throw new AppAuthorizationError(403, undefined, user);
  return user;
}

export function appUserLabel(user: AppUser): string {
  return user.name?.trim() || user.email?.trim() || "Atendimento";
}

export async function isHandoffAuthenticated(): Promise<boolean> {
  try {
    await requireAppUser();
    return true;
  } catch {
    return false;
  }
}
