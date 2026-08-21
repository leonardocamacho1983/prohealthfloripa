import { NextResponse } from "next/server";

import { recordAuditEvent } from "@/lib/audit";
import { isAppAuthorizationError, requireAppUser } from "@/lib/handoff/server-auth";
import { isReasonCategory } from "@/lib/reasons/catalog";
import { createConversationReason, updateConversationOperationSettings,
  updateConversationReason } from "@/lib/reasons/repository";

export async function POST(request: Request) {
  let actor;
  try { actor = await requireAppUser(["owner", "admin"]); }
  catch (error) {
    if (isAppAuthorizationError(error)) return new NextResponse(error.message, { status: error.status });
    throw error;
  }
  const form = await request.formData();
  const operation = form.get("operation");
  const label = form.get("label");
  try {
    if (operation === "create") {
      if (typeof label !== "string") throw new Error("Invalid label");
      const category = form.get("category");
      if (!isReasonCategory(category)) throw new Error("Invalid category");
      const id = await createConversationReason({ category, label });
      await recordAuditEvent({ actorUserId: actor.userId, actorRole: actor.role,
        action: "reasons.create", resourceType: "conversation_reason", resourceId: id, outcome: "success" });
    } else if (operation === "update") {
      if (typeof label !== "string") throw new Error("Invalid label");
      const id = form.get("id");
      const currentActive = form.get("active") === "true";
      const requestedActive = form.get("nextActive");
      if (typeof id !== "string") throw new Error("Invalid id");
      const active = requestedActive === "true" ? true : requestedActive === "false" ? false : currentActive;
      const updated = await updateConversationReason({ id, label, active });
      if (!updated) throw new Error("Reason not found");
      await recordAuditEvent({ actorUserId: actor.userId, actorRole: actor.role,
        action: "reasons.update", resourceType: "conversation_reason", resourceId: id, outcome: "success" });
    } else if (operation === "settings") {
      const minutes = Number(form.get("customerInactivityMinutes"));
      await updateConversationOperationSettings({
        automaticInactivityEnabled: form.get("automaticInactivityEnabled") === "on",
        customerInactivityMinutes: minutes,
        actorUserId: actor.userId,
      });
      await recordAuditEvent({ actorUserId: actor.userId, actorRole: actor.role,
        action: "conversation_settings.update", resourceType: "conversation_settings",
        resourceId: "default", outcome: "success" });
    } else throw new Error("Invalid operation");
    return NextResponse.redirect(new URL("/admin/reasons?success=1", request.url), 303);
  } catch (error) {
    await recordAuditEvent({ actorUserId: actor.userId, actorRole: actor.role,
      action: "reasons.write", resourceType: "conversation_reason", outcome: "failure",
      metadata: { errorType: error instanceof Error ? error.name : "UnknownError", statusCode: 400 } });
    return NextResponse.redirect(new URL("/admin/reasons?error=1", request.url), 303);
  }
}
