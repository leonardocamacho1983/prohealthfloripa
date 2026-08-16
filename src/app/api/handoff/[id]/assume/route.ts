import { NextResponse } from "next/server";
import { NeonConversationRepository } from "@/lib/conversations/neon-repository";
import { isHandoffAuthenticated } from "@/lib/handoff/server-auth";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isHandoffAuthenticated())) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  try {
    await new NeonConversationRepository().assumeAgentConversation(id);
  } catch {
    return new NextResponse("Conversation is no longer available", { status: 409 });
  }
  return NextResponse.redirect(new URL(`/handoff?filter=human&conversation=${id}`, request.url), 303);
}
