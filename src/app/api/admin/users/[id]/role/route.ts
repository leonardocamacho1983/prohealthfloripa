import { clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { recordAuditEvent } from "@/lib/audit";
import { evaluateRoleChange, parseAssignableRole } from "@/lib/auth/user-management";
import { isAppAuthorizationError, requireAppUser, type AppUser } from "@/lib/handoff/server-auth";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let principal: AppUser;
  try {
    principal = await requireAppUser(["admin", "owner"]);
  } catch (error) {
    if (isAppAuthorizationError(error)) {
      await recordAuditEvent({ actorUserId: error.userId, actorRole: error.role,
        action: "user.role_change", resourceType: "clerk_user", resourceId: id,
        outcome: "denied", metadata: { statusCode: error.status } });
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  try {
    const form = await request.formData();
    const role = parseAssignableRole(form.get("role"));
    if (!id || !role) {
      await recordAuditEvent({ actorUserId: principal.userId, actorRole: principal.role,
        action: "user.role_change", resourceType: "clerk_user", resourceId: id,
        outcome: "denied", metadata: { reason: "invalid_role", statusCode: 400 } });
      return NextResponse.redirect(new URL("/admin/users?error=invalid", request.url), 303);
    }

    const client = await clerkClient();
    const target = await client.users.getUser(id);
    const currentRole = parseAssignableRole(target.publicMetadata.role);
    const decision = evaluateRoleChange({ actorUserId: principal.userId, actorRole: principal.role,
      targetUserId: id, targetCurrentRole: currentRole, nextRole: role });
    if (!decision.allowed) {
      await recordAuditEvent({ actorUserId: principal.userId, actorRole: principal.role,
        action: "user.role_change", resourceType: "clerk_user", resourceId: id,
        outcome: "denied", metadata: { reason: decision.reason, statusCode: 403 } });
      return NextResponse.redirect(new URL(`/admin/users?error=${decision.reason}`, request.url), 303);
    }
    if (decision.noChange) return NextResponse.redirect(new URL("/admin/users", request.url), 303);

    await client.users.updateUserMetadata(id, { publicMetadata: { role } });
    await recordAuditEvent({
      actorUserId: principal.userId,
      actorRole: principal.role,
      action: "user.role_change",
      resourceType: "clerk_user",
      resourceId: id,
      outcome: "success",
      metadata: { reason: role },
    });
    return NextResponse.redirect(new URL("/admin/users?success=role", request.url), 303);
  } catch (error) {
    await recordAuditEvent({ actorUserId: principal.userId, actorRole: principal.role,
      action: "user.role_change", resourceType: "clerk_user", resourceId: id,
      outcome: "failure", metadata: { errorType: error instanceof Error ? error.name : "UnknownError" } });
    console.warn("Clerk role update failed", { error: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.redirect(new URL("/admin/users?error=role", request.url), 303);
  }
}
