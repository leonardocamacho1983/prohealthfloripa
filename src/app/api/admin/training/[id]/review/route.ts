import { NextResponse } from "next/server";

import { recordAuditEvent } from "@/lib/audit";
import { isAppAuthorizationError, requireAppUser } from "@/lib/handoff/server-auth";
import { TrainingRepository } from "@/lib/training/repository";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let actor;
  try { actor = await requireAppUser(["owner", "admin"]); }
  catch (error) {
    if (isAppAuthorizationError(error)) return new NextResponse(error.message, { status: error.status });
    throw error;
  }
  const form = await request.formData();
  const decision = form.get("decision");
  const note = form.get("note");
  if (decision !== "approved" && decision !== "rejected") return new NextResponse("Invalid decision", { status: 400 });
  const updated = await new TrainingRepository().reviewSession({ sessionId: id, decision,
    reviewedBy: actor.userId, ...(typeof note === "string" && note.trim() ? { note } : {}) });
  if (!updated) return new NextResponse("Session is no longer pending review", { status: 409 });
  await recordAuditEvent({ actorUserId: actor.userId, actorRole: actor.role,
    action: `training.${decision}`, resourceType: "training_session", resourceId: id, outcome: "success" });
  return NextResponse.redirect(new URL("/admin/training", request.url), 303);
}
