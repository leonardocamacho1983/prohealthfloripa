import { clerkClient } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { addScheduleException } from "@/lib/attendants/workforce";
import { parseSaoPauloDateTimeLocal } from "@/lib/attendants/schedule";
import { requireAppPermission } from "@/lib/handoff/server-auth";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAppPermission("operations:configure"); const { id } = await params;
  try {
    await (await clerkClient()).users.getUser(id);
    const form = await request.formData(); const kind = String(form.get("kind"));
    if (kind !== "coverage" && kind !== "unavailable") throw new Error("Invalid kind");
    const startsAt = parseSaoPauloDateTimeLocal(String(form.get("startsAt") ?? ""));
    const endsAt = parseSaoPauloDateTimeLocal(String(form.get("endsAt") ?? ""));
    if (!startsAt || !endsAt) throw new Error("Invalid date");
    await addScheduleException({ userId: id, kind, actorUserId: actor.userId,
      startsAt, endsAt, reason: String(form.get("reason") ?? "") });
    return NextResponse.redirect(new URL("/admin/workforce?saved=exception", request.url), 303);
  } catch {
    return NextResponse.redirect(new URL("/admin/workforce?error=exception", request.url), 303);
  }
}
