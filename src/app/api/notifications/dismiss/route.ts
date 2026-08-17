import { NextResponse } from "next/server";

import { isAppAuthorizationError, requireAppUser } from "@/lib/handoff/server-auth";
import { parseMetricPeriodDays } from "@/lib/metrics/calculations";
import { dismissNotification } from "@/lib/notifications/repository";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    await requireAppUser(["admin", "owner"] as const);
    const formData = await request.formData();
    const id = String(formData.get("id") ?? "");
    const days = parseMetricPeriodDays(String(formData.get("days") ?? "7"));
    if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: "Invalid notification" }, { status: 400 });
    await dismissNotification(id);
    return NextResponse.redirect(new URL(`/metrics?days=${days}`, request.url), 303);
  } catch (error) {
    if (isAppAuthorizationError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Notification dismissal unavailable", { error: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }
}
