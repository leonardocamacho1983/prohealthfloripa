import { auth } from "@clerk/nextjs/server";

export async function isHandoffAuthenticated(): Promise<boolean> {
  const { userId } = await auth();
  return Boolean(userId);
}
