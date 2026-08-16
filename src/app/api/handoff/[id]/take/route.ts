import { NextResponse } from "next/server";
import { NeonConversationRepository } from "@/lib/conversations/neon-repository";
import { isHandoffAuthenticated } from "@/lib/handoff/server-auth";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isHandoffAuthenticated())) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params; await new NeonConversationRepository().takeHandoff(id);
  return NextResponse.redirect(new URL(`/handoff?conversation=${id}`, request.url), 303);
}
