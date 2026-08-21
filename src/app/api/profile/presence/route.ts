import { NextResponse } from "next/server";
import { isFeatureEnabled } from "@/lib/feature-flags/repository";
import { isAppAuthorizationError, requireAppUser } from "@/lib/handoff/server-auth";
import { setWorkforceState } from "@/lib/attendants/workforce";

export async function POST(request: Request) {
  let actor; try { actor = await requireAppUser(); }
  catch (error) { if (isAppAuthorizationError(error)) return new NextResponse(error.message, { status: error.status }); throw error; }
  if (!await isFeatureEnabled("workforce_routing")) return new NextResponse("Feature disabled", { status: 404 });
  const form = await request.formData(); const action = form.get("action");
  if (action !== "pause" && action !== "resume") return new NextResponse("Invalid presence", { status: 400 });
  const minutes = Math.min(480, Math.max(5, Number(form.get("minutes") ?? 30)));
  const reason = form.get("reason");
  await setWorkforceState({ userId: actor.userId, state: action === "pause" ? "paused" : "available",
    ...(action === "pause" && typeof reason === "string" ? { reason } : {}),
    ...(action === "pause" ? { untilAt: new Date(Date.now() + minutes * 60000) } : {}) });
  return NextResponse.redirect(new URL(`/profile?presence=${action === "pause" ? "paused" : "available"}`, request.url), 303);
}
