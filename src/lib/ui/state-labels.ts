import type { ConversationStatus } from "@/lib/conversations/types";

export const conversationStatusLabels: Record<ConversationStatus, string> = {
  active: "Atendimento automático",
  human_requested: "Aguardando atendente",
  human_active: "Com atendente",
  closed: "Encerrada",
};

export const workflowStatusLabel = (input: { status: ConversationStatus; awaitingCustomer?: boolean }) =>
  input.awaitingCustomer ? "Aguardando cliente" : conversationStatusLabels[input.status];

export const slaStatusLabels = {
  normal: "No prazo", warning: "SLA em atenção", breached: "SLA vencido",
  paused: "SLA pausado", completed: "SLA concluído",
} as const;
