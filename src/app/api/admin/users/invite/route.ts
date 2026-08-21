import { clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { recordAuditEvent } from "@/lib/audit";
import { canAssignRole, parseAssignableRole } from "@/lib/auth/user-management";
import { isAppAuthorizationError, requireAppUser, type AppUser } from "@/lib/handoff/server-auth";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  let principal: AppUser;
  try {
    principal = await requireAppUser(["admin", "owner"]);
  } catch (error) {
    if (isAppAuthorizationError(error)) {
      await recordAuditEvent({
        actorUserId: error.userId,
        actorRole: error.role,
        action: "user.invite",
        resourceType: "clerk_user_invitation",
        outcome: "denied",
        metadata: { statusCode: error.status },
      });
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  try {
    const form = await request.formData();
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const role = parseAssignableRole(form.get("role"));

    if (!EMAIL_PATTERN.test(email) || email.length > 254 || !role || !canAssignRole(principal.role, role)) {
      await recordAuditEvent({ actorUserId: principal.userId, actorRole: principal.role,
        action: "user.invite", resourceType: "clerk_user_invitation", outcome: "failure",
        metadata: { reason: "invalid_request", statusCode: 400 } });
      return NextResponse.redirect(new URL("/admin/users?error=invalid", request.url), 303);
    }

    const client = await clerkClient();
    await client.invitations.createInvitation({
      emailAddress: email,
      publicMetadata: { role },
      notify: true,
      redirectUrl: `${process.env.APP_URL ?? new URL(request.url).origin}/sign-up`,
    });
    await recordAuditEvent({
      actorUserId: principal.userId,
      actorRole: principal.role,
      action: "user.invite",
      resourceType: "clerk_user_invitation",
      outcome: "success",
      metadata: { reason: role },
    });
    return NextResponse.redirect(new URL("/admin/users?success=invited", request.url), 303);
  } catch (error) {
    await recordAuditEvent({ actorUserId: principal.userId, actorRole: principal.role,
      action: "user.invite", resourceType: "clerk_user_invitation", outcome: "failure",
      metadata: { errorType: error instanceof Error ? error.name : "UnknownError" } });
    console.warn("Clerk invitation failed", { error: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.redirect(new URL("/admin/users?error=invite", request.url), 303);
  }
}
