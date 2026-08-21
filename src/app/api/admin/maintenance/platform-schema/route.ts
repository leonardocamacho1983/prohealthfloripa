import { NextRequest, NextResponse } from "next/server";
import { requireAppPermission } from "@/lib/handoff/server-auth";
import { ensurePlatformSchema, PLATFORM_SCHEMA_VERSION } from "@/lib/maintenance/platform-schema";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  await requireAppPermission("operations:configure");
  try {
    await ensurePlatformSchema();
    return NextResponse.redirect(new URL(`/admin/maintenance?schema=${PLATFORM_SCHEMA_VERSION}`, request.url), 303);
  } catch {
    return NextResponse.redirect(new URL("/admin/maintenance?schema=error", request.url), 303);
  }
}
