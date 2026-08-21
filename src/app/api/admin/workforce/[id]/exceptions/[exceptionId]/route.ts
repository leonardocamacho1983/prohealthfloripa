import { NextRequest, NextResponse } from "next/server";
import { deleteScheduleException } from "@/lib/attendants/workforce";
import { requireAppPermission } from "@/lib/handoff/server-auth";

export async function POST(request: NextRequest, { params }: {
  params: Promise<{ id: string; exceptionId: string }> }) {
  await requireAppPermission("operations:configure"); const { id, exceptionId } = await params;
  const removed = await deleteScheduleException({ id: exceptionId, userId: id });
  return NextResponse.redirect(new URL(`/admin/workforce?${removed ? "saved=removed" : "error=missing"}`, request.url), 303);
}
