import { NextResponse } from "next/server";

import { recordAuditEvent } from "@/lib/audit";
import { parseAppFeatureFlag } from "@/lib/feature-flags/types";
import { setFeatureFlag } from "@/lib/feature-flags/repository";
import { isAppAuthorizationError, requireAppPermission } from "@/lib/handoff/server-auth";

export async function POST(request: Request) {
  let actor;
  try { actor = await requireAppPermission("operations:configure"); }
  catch (error) {
    if (isAppAuthorizationError(error)) return new NextResponse(error.message, { status: error.status });
    throw error;
  }
  const form = await request.formData();
  const key = parseAppFeatureFlag(form.get("key"));
  if (!key) return NextResponse.redirect(new URL("/admin/features?error=invalid", request.url), 303);
  const enabled = form.get("enabled") === "true";
  try {
    await setFeatureFlag({ key, enabled, actorUserId: actor.userId });
    await recordAuditEvent({ actorUserId: actor.userId, actorRole: actor.role,
      action: "feature_flag.update", resourceType: "feature_flag", resourceId: key,
      outcome: "success", metadata: { enabled, featureFlag: key } });
    return NextResponse.redirect(new URL("/admin/features?success=1", request.url), 303);
  } catch (error) {
    await recordAuditEvent({ actorUserId: actor.userId, actorRole: actor.role,
      action: "feature_flag.update", resourceType: "feature_flag", resourceId: key,
      outcome: "failure", metadata: { errorType: error instanceof Error ? error.name : "UnknownError" } });
    return NextResponse.redirect(new URL("/admin/features?error=save", request.url), 303);
  }
}
