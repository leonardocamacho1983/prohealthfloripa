import type { InboxConversation } from "@/lib/handoff/types";

export const INBOX_STALLED_AFTER_MINUTES = 15;

export type InboxFilter = "all" | "agent" | "waiting" | "human" | "closed" | "unread" | "stalled";
export type InboxSort = "longest_waiting" | "recent";

export type SearchableInboxConversation = InboxConversation & {
  searchablePhone?: string;
};

const normalizeText = (value: string) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .trim()
  .toLocaleLowerCase("pt-BR");

const digits = (value: string) => value.replace(/\D/g, "");

export function matchesInboxSearch(item: SearchableInboxConversation, query: string): boolean {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return true;

  if (normalizeText(item.firstName ?? "Cliente").includes(normalizedQuery)) return true;

  const phoneQuery = digits(query);
  if (!phoneQuery) return false;
  const phone = digits(item.searchablePhone ?? item.maskedPhone);
  return phone.includes(phoneQuery) || phone.endsWith(phoneQuery);
}

export function isInboxConversationStalled(
  item: Pick<InboxConversation, "status" | "lastActivityAt">,
  now = new Date(),
  thresholdMinutes = INBOX_STALLED_AFTER_MINUTES,
): boolean {
  if (item.status === "closed") return false;
  return now.getTime() - item.lastActivityAt.getTime() >= thresholdMinutes * 60_000;
}

export function matchesInboxFilter(
  item: SearchableInboxConversation,
  filter: InboxFilter,
  now = new Date(),
): boolean {
  if (filter === "all") return true;
  if (filter === "agent") return item.status === "active";
  if (filter === "waiting") return item.status === "human_requested";
  if (filter === "human") return item.status === "human_active";
  if (filter === "closed") return item.status === "closed";
  if (filter === "unread") return item.unreadCount > 0;
  return isInboxConversationStalled(item, now);
}

export function waitingSince(item: Pick<InboxConversation, "status" | "requestedAt" | "lastActivityAt">): Date {
  return item.status === "human_requested" && item.requestedAt ? item.requestedAt : item.lastActivityAt;
}

export function filterAndSortInbox<T extends SearchableInboxConversation>(
  items: readonly T[],
  options: { filter: InboxFilter; query?: string; sort: InboxSort; now?: Date },
): T[] {
  const now = options.now ?? new Date();
  const result = items.filter((item) => matchesInboxFilter(item, options.filter, now)
    && matchesInboxSearch(item, options.query ?? ""));

  return result.sort((left, right) => options.sort === "recent"
    ? right.lastActivityAt.getTime() - left.lastActivityAt.getTime()
    : waitingSince(left).getTime() - waitingSince(right).getTime());
}

export function formatElapsed(date: Date, now = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60_000));
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  return `há ${Math.floor(hours / 24)}d`;
}

export function safeInboxReturnPath(value: FormDataEntryValue | null): string {
  if (typeof value !== "string" || (value !== "/handoff" && !value.startsWith("/handoff?"))) return "/handoff";
  return value;
}
