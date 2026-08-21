import { NextResponse } from "next/server";
import { isFeatureEnabled } from "@/lib/feature-flags/repository";
import { isAppAuthorizationError, requireAppPermission } from "@/lib/handoff/server-auth";
import { enqueuePromiseDeadline } from "@/lib/promises/queue";
import { updateConversationPromise } from "@/lib/promises/repository";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor; try { actor = await requireAppPermission("handoff:reply"); }
  catch (error) { if (isAppAuthorizationError(error)) return new NextResponse(error.message, { status: error.status }); throw error; }
  if (!await isFeatureEnabled("promises")) return new NextResponse("Feature disabled", { status: 404 });
  const form = await request.formData(); const reason = form.get("reason"); const dueAtValue = form.get("dueAt");
  try { const dueAt = new Date(String(dueAtValue)); const id = (await params).id;
    const updated = await updateConversationPromise({ promiseId: id, actorUserId: actor.userId,
      action: "reschedule", dueAt, ...(typeof reason === "string" ? { reason } : {}) });
    if (updated.token && updated.dueAt) await enqueuePromiseDeadline({ promiseId: id, token: updated.token }, updated.dueAt);
    return NextResponse.json({ ok: true }); } catch { return new NextResponse("Promise changed", { status: 409 }); }
}
