import type { NotificationCandidate } from "./types.ts";

export const OPERATIONAL_NOTIFICATION_TYPES = [
  "handoff_waiting_too_long",
  "outbound_delivery_failure",
  "turn_failure_rate_high",
  "first_response_p95_slow",
  "catalog_stale",
  "catalog_failed",
  "catalog_unavailable",
  "intent_coverage_low",
  "repair_success_low",
  "reply_integrity_failure",
] as const;

export type OperationalNotificationType = (typeof OPERATIONAL_NOTIFICATION_TYPES)[number];

export type OperationalReconciliation = {
  type: OperationalNotificationType;
  activeDedupeKey: string | null;
};

export function buildOperationalReconciliationPlan(
  activeNotifications: readonly NotificationCandidate[],
): OperationalReconciliation[] {
  const activeKeys = new Map(activeNotifications.map((notification) => [
    notification.type,
    notification.dedupeKey,
  ]));
  return OPERATIONAL_NOTIFICATION_TYPES.map((type) => ({
    type,
    activeDedupeKey: activeKeys.get(type) ?? null,
  }));
}

export function isPendingHandoffRequest(conversationStatus: string | null | undefined): boolean {
  return conversationStatus === "human_requested";
}
