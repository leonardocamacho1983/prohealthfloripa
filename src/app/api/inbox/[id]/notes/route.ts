import { NextResponse } from "next/server";

import { isAppAuthorizationError, requireAppUser } from "@/lib/handoff/server-auth";
import { createInboxInternalNote } from "@/lib/inbox/repository";
import { safeInboxReturnPath } from "@/lib/inbox/productivity";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let appUser;
  try {
    appUser = await requireAppUser(["owner", "admin", "attendant"]);
  } catch (error) {
    if (isAppAuthorizationError(error)) return new NextResponse(error.message, { status: error.status });
    throw error;
  }

  const { id } = await params;
  const form = await request.formData();
  const content = form.get("content");
  if (typeof content !== "string" || !content.trim() || content.trim().length > 1000) {
    return new NextResponse("Invalid note", { status: 400 });
  }

  try {
    await createInboxInternalNote({ conversationId: id,
      authorLabel: appUser.name?.trim() || "Atendimento", content });
  } catch {
    return new NextResponse("Conversation not found", { status: 404 });
  }

  const returnTo = safeInboxReturnPath(form.get("returnTo"));
  return NextResponse.redirect(new URL(returnTo, request.url), 303);
}
