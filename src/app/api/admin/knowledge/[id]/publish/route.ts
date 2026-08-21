import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { isFeatureEnabled } from "@/lib/feature-flags/repository";
import { isAppAuthorizationError, requireAppPermission } from "@/lib/handoff/server-auth";
import { publishKnowledgeChangeSet } from "@/lib/knowledge/governance";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor; try { actor = await requireAppPermission("operations:configure"); }
  catch (error) { if (isAppAuthorizationError(error)) return new NextResponse(error.message, { status: error.status }); throw error; }
  if (!await isFeatureEnabled("knowledge_publishing")) return new NextResponse("Feature disabled", { status: 404 });
  const id = (await params).id;
  try { const version = await publishKnowledgeChangeSet(id, actor.userId);
    await recordAuditEvent({ actorUserId: actor.userId, actorRole: actor.role, action: "knowledge.publish",
      resourceType: "knowledge_change_set", resourceId: id, outcome: "success", metadata: { reason: `v${version}` } });
    return NextResponse.redirect(new URL(`/admin/knowledge?published=${version}`, request.url), 303);
  } catch (error) {
    await recordAuditEvent({ actorUserId: actor.userId, actorRole: actor.role, action: "knowledge.publish",
      resourceType: "knowledge_change_set", resourceId: id, outcome: "failure",
      metadata: { errorType: error instanceof Error ? error.name : "UnknownError" } });
    return NextResponse.redirect(new URL("/admin/knowledge?error=blocked", request.url), 303);
  }
}
