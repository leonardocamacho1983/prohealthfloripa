export type ConversationWorkflowEventType =
  | "handoff_requested"
  | "assigned"
  | "assumed"
  | "transferred"
  | "awaiting_customer_started"
  | "awaiting_customer_cancelled"
  | "closed_human"
  | "closed_automatic"
  | "reopened"
  | "sla_warning"
  | "sla_breached"
  | "promise_created"
  | "promise_completed"
  | "promise_cancelled"
  | "promise_rescheduled"
  | "survey_sent"
  | "survey_answered"
  | "returned_to_agent";

export type ConversationWorkflowEvent = {
  id: string;
  conversationId: string;
  eventType: ConversationWorkflowEventType;
  actorLabel?: string;
  fromUserLabel?: string;
  toUserLabel?: string;
  reasonLabel?: string;
  internalNote?: string;
  occurredAt: Date;
};

export function workflowEventText(event: Omit<ConversationWorkflowEvent, "id" | "conversationId" | "occurredAt">): string {
  if (event.eventType === "transferred") {
    const target = event.toUserLabel ? ` para ${event.toUserLabel}` : "";
    const reason = event.reasonLabel ? ` Motivo: ${event.reasonLabel}.` : "";
    const note = event.internalNote ? ` Nota: ${event.internalNote}` : "";
    return `Atendimento transferido${target}.${reason}${note}`.replace("..", ".");
  }
  if (event.eventType === "awaiting_customer_started") {
    return "Atendimento marcado como aguardando resposta do cliente.";
  }
  if (event.eventType === "awaiting_customer_cancelled") {
    return "O cliente respondeu e o atendimento voltou ao estado em andamento.";
  }
  if (event.eventType === "assumed") return `Atendimento assumido${event.actorLabel ? ` por ${event.actorLabel}` : ""}.`;
  if (event.eventType === "closed_human") return "Atendimento encerrado pela equipe.";
  if (event.eventType === "closed_automatic") return "Atendimento encerrado automaticamente.";
  if (event.eventType === "reopened") return "Novo atendimento aberto após uma conversa encerrada.";
  if (event.eventType === "assigned") return `Atendimento atribuído${event.toUserLabel ? ` a ${event.toUserLabel}` : ""}.`;
  if (event.eventType === "sla_warning") return "O prazo de atendimento entrou em atenção.";
  if (event.eventType === "sla_breached") return "O prazo de atendimento foi ultrapassado.";
  if (event.eventType === "promise_created") return "Compromisso de retorno registrado para a equipe.";
  if (event.eventType === "promise_completed") return "Compromisso de retorno concluído.";
  if (event.eventType === "promise_cancelled") return "Compromisso de retorno cancelado com motivo.";
  if (event.eventType === "promise_rescheduled") return "Prazo do compromisso de retorno alterado.";
  if (event.eventType === "survey_sent") return "Pesquisa de experiência enviada.";
  if (event.eventType === "survey_answered") return "Pesquisa de experiência respondida.";
  if (event.eventType === "returned_to_agent") return "Atendimento devolvido ao agente automático.";
  return "Atendimento transferido para a equipe.";
}
