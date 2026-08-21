import { NextResponse } from "next/server";

import { NeonConversationRepository } from "@/lib/conversations/neon-repository";
import { isAppAuthorizationError, requireAppPermission } from "@/lib/handoff/server-auth";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const actor = await requireAppPermission("handoff:view");
    await new NeonConversationRepository().markHandoffViewed(id, actor.userId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (isAppAuthorizationError(error)) return new NextResponse(error.message, { status: error.status });
    throw error;
  }
}
