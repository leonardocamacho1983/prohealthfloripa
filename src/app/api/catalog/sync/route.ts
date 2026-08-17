import { NextResponse } from "next/server";

import { syncNextfitCatalog } from "@/lib/catalog/nextfit-catalog";
import { isAppAuthorizationError, requireAppUser } from "@/lib/handoff/server-auth";
import { NextfitClient } from "@/lib/nextfit/client";

export const runtime = "nodejs";
export const maxDuration = 60;

async function runSync() {
  const apiKey = process.env.NEXTFIT_API_KEY;
  if (!apiKey || !process.env.DATABASE_URL) throw new Error("Catalog sync configuration is incomplete");
  return syncNextfitCatalog(new NextfitClient(apiKey));
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const count = await runSync();
    return NextResponse.json({ ok: true, count });
  } catch {
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    await requireAppUser(["owner", "admin"]);
    await runSync();
    return NextResponse.redirect(new URL("/handoff", request.url), 303);
  } catch (error) {
    if (isAppAuthorizationError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }
}
