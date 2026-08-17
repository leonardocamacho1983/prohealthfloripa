import { auth, clerkClient } from "@clerk/nextjs/server";
import { recordAuditEvent } from "@/lib/audit";
import { hasPermission, type AppPermission, type AppRole } from "./permissions";
import { resolveAppRole } from "./role-resolution";

export type AuthorizedPrincipal = { userId: string; role: AppRole; email?: string; name?: string };

export type AuthorizationResult =
  | { ok: true; principal: AuthorizedPrincipal }
  | {
      ok: false;
      status: 401 | 403 | 503;
      reason: "unauthenticated" | "missing_role" | "invalid_role" | "forbidden" | "identity_unavailable";
      userId?: string;
      role?: AppRole;
    };

export async function authorize(permission: AppPermission): Promise<AuthorizationResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, status: 401, reason: "unauthenticated" };

  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const metadataRolePresent = Object.prototype.hasOwnProperty.call(user.publicMetadata, "role");
    const primaryEmail = user.primaryEmailAddress;
    const resolution = resolveAppRole({
      metadataRole: user.publicMetadata.role,
      metadataRolePresent,
      primaryEmail: primaryEmail?.emailAddress,
      primaryEmailVerified: primaryEmail?.verification?.status === "verified",
    });

    if (resolution.kind === "denied") {
      return { ok: false, status: 403, reason: resolution.reason, userId };
    }

    if (resolution.bootstrap) {
      await client.users.updateUserMetadata(userId, { publicMetadata: { role: "admin" } });
      await recordAuditEvent({
        actorUserId: userId,
        actorRole: "admin",
        action: "auth.bootstrap_role",
        resourceType: "clerk_user",
        resourceId: userId,
        outcome: "success",
        metadata: { reason: "exclusive_verified_email_bootstrap" },
      });
    }

    if (!hasPermission(resolution.role, permission)) {
      return { ok: false, status: 403, reason: "forbidden", userId, role: resolution.role };
    }

    const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
    return { ok: true, principal: {
      userId,
      role: resolution.role,
      ...(primaryEmail?.emailAddress ? { email: primaryEmail.emailAddress } : {}),
      ...(name ? { name } : {}),
    } };
  } catch (error) {
    console.warn("Clerk authorization unavailable", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
    return { ok: false, status: 503, reason: "identity_unavailable", userId };
  }
}
