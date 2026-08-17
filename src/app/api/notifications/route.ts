import { NextResponse } from "next/server";

import { isAppAuthorizationError, requireAppUser } from "@/lib/handoff/server-auth";
import { listNotificationChannels, listOpenNotifications } from "@/lib/notifications/repository";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireAppUser(["admin", "owner"] as const);
    const [notifications, channels] = await Promise.all([
      listOpenNotifications(),
      listNotificationChannels(),
    ]);
    return NextResponse.json({ notifications, channels });
  } catch (error) {
    if (isAppAuthorizationError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Notifications API unavailable", { error: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }
}
