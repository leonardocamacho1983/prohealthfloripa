import { requireAppUser, isAppAuthorizationError } from "@/lib/handoff/server-auth";
import { TrainingRepository } from "@/lib/training/repository";

export async function POST(request: Request) {
  try {
    const user = await requireAppUser(["owner", "admin"]);
    const body = await request.json() as { conversationId?: unknown; displayName?: unknown };
    if (typeof body.conversationId !== "string") return Response.json({ error: "Invalid conversation" }, { status: 400 });
    const displayName = typeof body.displayName === "string" && body.displayName.trim() ? body.displayName.trim().slice(0, 80) : "João";
    const profile = await new TrainingRepository().enrollConversation(body.conversationId, displayName, user.userId);
    return Response.json({ enrolled: true, profileId: profile.id });
  } catch (error) {
    if (isAppAuthorizationError(error)) return Response.json({ error: "Unauthorized" }, { status: error.status });
    console.error("Trainer enrollment failed", { error: error instanceof Error ? error.name : "UnknownError" });
    return Response.json({ error: "Enrollment failed" }, { status: 500 });
  }
}
