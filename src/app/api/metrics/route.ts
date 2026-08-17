import { NextResponse } from "next/server";

import { isAppAuthorizationError, requireAppUser } from "@/lib/handoff/server-auth";
import { parseMetricPeriodDays } from "@/lib/metrics/calculations";
import { METRIC_DEFINITIONS } from "@/lib/metrics/definitions";
import { getMetricSnapshot } from "@/lib/metrics/repository";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireAppUser(["admin", "owner"] as const);
    const days = parseMetricPeriodDays(new URL(request.url).searchParams.get("days"));
    const snapshot = await getMetricSnapshot(days);
    return NextResponse.json({ snapshot, definitions: METRIC_DEFINITIONS });
  } catch (error) {
    if (isAppAuthorizationError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Metrics API unavailable", { error: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }
}
