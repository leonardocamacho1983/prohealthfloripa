import type { ConversationStatus } from "@/lib/conversations/types";
import { workflowStatusLabel } from "@/lib/ui/state-labels";
import { StatusBadge } from "@/components/ui/status-badge";

export function ConversationStatusBadge({ status, awaitingCustomer, className }: {
  status: ConversationStatus; awaitingCustomer?: boolean; className?: string }) {
  return <StatusBadge className={className}>{workflowStatusLabel({ status, awaitingCustomer })}</StatusBadge>;
}
