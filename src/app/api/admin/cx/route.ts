import { NextResponse } from "next/server";
import { isAppAuthorizationError, requireAppPermission } from "@/lib/handoff/server-auth";
import { updateCxSettings } from "@/lib/cx/repository";
export async function POST(request: Request) {
  let actor; try { actor = await requireAppPermission("operations:configure"); }
  catch (error) { if (isAppAuthorizationError(error)) return new NextResponse(error.message, { status: error.status }); throw error; }
  const form = await request.formData();
  try { await updateCxSettings({ enabled: form.get("enabled") === "on",
      sampleRate: Number(form.get("sampleRate")) / 100, delayMinutes: Number(form.get("delayMinutes")),
      expiresHours: Number(form.get("expiresHours")), actorUserId: actor.userId });
    return NextResponse.redirect(new URL("/admin/cx?saved=1", request.url), 303);
  } catch { return NextResponse.redirect(new URL("/admin/cx?error=1", request.url), 303); }
}
