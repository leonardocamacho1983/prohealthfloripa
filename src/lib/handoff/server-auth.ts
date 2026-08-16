import { cookies } from "next/headers";
import { HANDOFF_COOKIE, isValidHandoffSession } from "./auth";

export async function isHandoffAuthenticated(): Promise<boolean> {
  const store = await cookies();
  return isValidHandoffSession(store.get(HANDOFF_COOKIE)?.value, process.env.HANDOFF_ACCESS_SECRET);
}
