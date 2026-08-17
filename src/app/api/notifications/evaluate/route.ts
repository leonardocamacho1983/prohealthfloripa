import { NextResponse } from "next/server";

import { isAppAuthorizationError, requireAppUser } from "@/lib/handoff/server-auth";
import { parseMetricPeriodDays } from "@/lib/metrics/calculations";
import { evaluateAndEnqueueAlerts } from "@/lib/notifications/repository";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireAppUser(["admin", "owner"] as const);
    const formData = await request.formData();
    const days = parseMetricPeriodDays(String(formData.get("days") ?? "7"));
    await evaluateAndEnqueueAlerts(days);
    return NextResponse.redirect(new URL(`/metrics?days=${days}`, request.url), 303);
  } catch (error) {
    if (isAppAuthorizationError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Notification evaluation unavailable", { error: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }
}
