import { NextResponse } from "next/server";
import { HANDOFF_COOKIE } from "@/lib/handoff/auth";

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/handoff/login", request.url), 303);
  response.cookies.set(HANDOFF_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "strict", path: "/", maxAge: 0 });
  return response;
}
