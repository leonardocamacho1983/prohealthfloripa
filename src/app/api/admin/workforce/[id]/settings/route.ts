import { clerkClient } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { parseAppRole } from "@/lib/auth/permissions";
import { saveWorkforceConfiguration } from "@/lib/attendants/workforce";
import { requireAppPermission } from "@/lib/handoff/server-auth";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireAppPermission("operations:configure"); const { id } = await params;
  try {
    const user = await (await clerkClient()).users.getUser(id);
    if (user.banned || user.locked || !parseAppRole(user.publicMetadata.role)) throw new Error("Inactive user");
    const form = await request.formData(); const capacity = Number(form.get("capacity"));
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100) throw new Error("Invalid capacity");
    await saveWorkforceConfiguration({ userId: id, capacity,
      skills: String(form.get("skills") ?? "").split(",") });
    return NextResponse.redirect(new URL("/admin/workforce?saved=settings", request.url), 303);
  } catch {
    return NextResponse.redirect(new URL("/admin/workforce?error=settings", request.url), 303);
  }
}
