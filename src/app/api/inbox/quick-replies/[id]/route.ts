import { NextResponse } from "next/server";

import { isAppAuthorizationError, requireAppUser } from "@/lib/handoff/server-auth";
import { safeInboxReturnPath } from "@/lib/inbox/productivity";
import { updateInboxQuickReply } from "@/lib/inbox/repository";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAppUser(["owner", "admin", "attendant"]);
  } catch (error) {
    if (isAppAuthorizationError(error)) return new NextResponse(error.message, { status: error.status });
    throw error;
  }

  const { id } = await params;
  const form = await request.formData();
  const label = form.get("label");
  const content = form.get("content");
  if (typeof label !== "string" || !label.trim() || label.trim().length > 60
    || typeof content !== "string" || !content.trim() || content.trim().length > 1500) {
    return new NextResponse("Invalid quick reply", { status: 400 });
  }

  const updated = await updateInboxQuickReply({ id, label, content });
  if (!updated) return new NextResponse("Quick reply not found", { status: 404 });
  const returnTo = safeInboxReturnPath(form.get("returnTo"));
  return NextResponse.redirect(new URL(returnTo, request.url), 303);
}
