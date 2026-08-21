import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { isFeatureEnabled } from "@/lib/feature-flags/repository";
import { isAppAuthorizationError, requireAppPermission } from "@/lib/handoff/server-auth";
import { createConversationPromise } from "@/lib/promises/repository";
import { enqueuePromiseDeadline } from "@/lib/promises/queue";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; let actor;
  try { actor = await requireAppPermission("handoff:reply"); }
  catch (error) {
    if (isAppAuthorizationError(error)) return new NextResponse(error.message, { status: error.status });
    throw error;
  }
  if (!await isFeatureEnabled("promises")) return new NextResponse("Feature disabled", { status: 404 });
  const form = await request.formData(); const description = form.get("description"); const dueAtValue = form.get("dueAt");
  if (typeof description !== "string" || typeof dueAtValue !== "string") return new NextResponse("Invalid promise", { status: 400 });
  try {
    const dueAt = new Date(dueAtValue);
    const created = await createConversationPromise({ conversationId: id, actorUserId: actor.userId, description, dueAt });
    await enqueuePromiseDeadline({ promiseId: created.id, token: created.token }, dueAt);
    await recordAuditEvent({ actorUserId: actor.userId, actorRole: actor.role, action: "promise.create",
      resourceType: "conversation_promise", resourceId: created.id, outcome: "success" });
    return NextResponse.json({ ok: true });
  } catch (error) {
    await recordAuditEvent({ actorUserId: actor.userId, actorRole: actor.role, action: "promise.create",
      resourceType: "conversation", resourceId: id, outcome: "failure",
      metadata: { errorType: error instanceof Error ? error.name : "UnknownError" } });
    return new NextResponse("Promise could not be created", { status: 409 });
  }
}
