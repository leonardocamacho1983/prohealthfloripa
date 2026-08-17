import { NextResponse } from "next/server";

import { previewConversationRevisionRepair, repairConversationRevisions } from "@/lib/conversations/repair-conversation-revisions";
import { isAppAuthorizationError, requireAppUser } from "@/lib/handoff/server-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    await requireAppUser(["owner", "admin"]);
    return NextResponse.json({ ok: true, mode: "dry-run", ...(await previewConversationRevisionRepair()) });
  } catch (error) {
    if (isAppAuthorizationError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Maintenance check unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    await requireAppUser(["owner", "admin"]);
    const body = await request.json().catch(() => null) as { confirm?: unknown } | null;
    if (body?.confirm !== "repair-orphaned-inbound-revisions") {
      return NextResponse.json({ error: "Explicit repair confirmation is required" }, { status: 400 });
    }
    const result = await repairConversationRevisions();
    return NextResponse.json({ ok: result.queueFailures === 0, mode: "apply", ...result },
      { status: result.queueFailures === 0 ? 200 : 503 });
  } catch (error) {
    if (isAppAuthorizationError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Maintenance repair unavailable" }, { status: 503 });
  }
}
