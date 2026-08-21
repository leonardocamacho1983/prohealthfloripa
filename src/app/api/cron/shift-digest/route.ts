import { NextResponse } from "next/server";

import { sendShiftStartDigests } from "@/lib/notifications/handoff-delivery";
import { ZernioWhatsAppProvider } from "@/lib/whatsapp/zernio-provider";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const apiKey = process.env.ZERNIO_API_KEY;
  if (!apiKey || !process.env.DATABASE_URL) return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  try {
    const result = await sendShiftStartDigests({ provider: new ZernioWhatsAppProvider(apiKey) });
    return NextResponse.json({ ok: true, ...result });
  } catch {
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }
}
