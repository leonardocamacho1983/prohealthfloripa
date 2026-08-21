import "server-only";

import { clerkClient } from "@clerk/nextjs/server";

import { parseAppRole, type AppRole } from "@/lib/auth/permissions";

export type TransferCandidate = { userId: string; label: string; role: AppRole };

function userLabel(user: { firstName: string | null; lastName: string | null;
  primaryEmailAddress?: { emailAddress: string } | null; emailAddresses: Array<{ emailAddress: string }> }): string {
  return [user.firstName, user.lastName].filter(Boolean).join(" ")
    || user.primaryEmailAddress?.emailAddress
    || user.emailAddresses[0]?.emailAddress
    || "Atendente";
}

export async function listTransferCandidates(excludeUserId?: string): Promise<TransferCandidate[]> {
  const client = await clerkClient();
  const response = await client.users.getUserList({ limit: 100, orderBy: "+first_name" });
  return response.data.flatMap((user) => {
    const role = parseAppRole(user.publicMetadata.role);
    if (!role || user.id === excludeUserId || user.banned || user.locked) return [];
    return [{ userId: user.id, label: userLabel(user), role }];
  });
}

export async function getTransferCandidate(userId: string): Promise<TransferCandidate | undefined> {
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const role = parseAppRole(user.publicMetadata.role);
  if (!role || user.banned || user.locked) return undefined;
  return { userId: user.id, label: userLabel(user), role };
}
