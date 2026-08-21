import { clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { recordAuditEvent } from "@/lib/audit";
import { parseAppRole } from "@/lib/auth/permissions";
import { isAppAuthorizationError, requireAppUser } from "@/lib/handoff/server-auth";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let principal;
  try {
    principal = await requireAppUser(["admin", "owner"]);
  } catch (error) {
    if (isAppAuthorizationError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }

  try {
    const form = await request.formData();
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const client = await clerkClient();
    const pending = await client.invitations.getInvitationList({ status: "pending", query: email, limit: 10 });
    const invitation = pending.data.find((item) => item.id === id);
    const role = parseAppRole(invitation?.publicMetadata?.role);
    if (!invitation || !role) return NextResponse.redirect(new URL("/admin/users?error=invite_missing", request.url), 303);
    await client.invitations.revokeInvitation(invitation.id);
    await client.invitations.createInvitation({
      emailAddress: invitation.emailAddress,
      publicMetadata: { role },
      notify: true,
      redirectUrl: `${process.env.APP_URL ?? new URL(request.url).origin}/sign-up`,
    });
    await recordAuditEvent({ actorUserId: principal.userId, actorRole: principal.role,
      action: "user.invite_resend", resourceType: "clerk_user_invitation", resourceId: id,
      outcome: "success", metadata: { reason: role } });
    return NextResponse.redirect(new URL("/admin/users?success=resent", request.url), 303);
  } catch (error) {
    await recordAuditEvent({ actorUserId: principal.userId, actorRole: principal.role,
      action: "user.invite_resend", resourceType: "clerk_user_invitation", resourceId: id,
      outcome: "failure", metadata: { errorType: error instanceof Error ? error.name : "UnknownError" } });
    return NextResponse.redirect(new URL("/admin/users?error=invite", request.url), 303);
  }
}
