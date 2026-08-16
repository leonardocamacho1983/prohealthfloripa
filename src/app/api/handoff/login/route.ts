import { NextResponse } from "next/server";
import { HANDOFF_COOKIE, handoffSessionValue } from "@/lib/handoff/auth";

export async function POST(request: Request) {
  const form = await request.formData();
  const submitted = form.get("accessKey");
  const secret = process.env.HANDOFF_ACCESS_SECRET;
  if (!secret || typeof submitted !== "string" || submitted !== secret) {
    return NextResponse.redirect(new URL("/handoff/login?error=1", request.url), 303);
  }
  const response = NextResponse.redirect(new URL("/handoff", request.url), 303);
  response.cookies.set(HANDOFF_COOKIE, handoffSessionValue(secret), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 60 * 60 * 12,
  });
  return response;
}
