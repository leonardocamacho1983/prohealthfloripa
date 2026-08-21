import { NextResponse } from "next/server";
import { isFeatureEnabled } from "@/lib/feature-flags/repository";
import { isAppAuthorizationError, requireAppPermission } from "@/lib/handoff/server-auth";
import { updateConversationPromise } from "@/lib/promises/repository";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor; try { actor = await requireAppPermission("handoff:reply"); }
  catch (error) { if (isAppAuthorizationError(error)) return new NextResponse(error.message, { status: error.status }); throw error; }
  if (!await isFeatureEnabled("promises")) return new NextResponse("Feature disabled", { status: 404 });
  const reason = (await request.formData()).get("reason");
  try { await updateConversationPromise({ promiseId: (await params).id, actorUserId: actor.userId,
      action: "cancel", ...(typeof reason === "string" ? { reason } : {}) });
    return NextResponse.json({ ok: true }); } catch { return new NextResponse("Promise changed", { status: 409 }); }
}
