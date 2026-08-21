import { NextRequest, NextResponse } from "next/server";
import { isFeatureEnabled } from "@/lib/feature-flags/repository";
import { requireAppPermission } from "@/lib/handoff/server-auth";
import { rollbackKnowledgeVersion } from "@/lib/knowledge/governance";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAppPermission("operations:configure");
  if (!await isFeatureEnabled("knowledge_publishing")) return new NextResponse("Feature disabled", { status: 404 });
  const form = await request.formData();
  try {
    const version = await rollbackKnowledgeVersion({ targetVersionId: (await params).id,
      reason: String(form.get("reason") ?? ""), actorUserId: actor.userId });
    return NextResponse.redirect(new URL(`/admin/knowledge?rolledBack=${version}`, request.url), 303);
  } catch {
    return NextResponse.redirect(new URL("/admin/knowledge?error=rollback", request.url), 303);
  }
}
