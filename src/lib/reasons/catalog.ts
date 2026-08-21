export const REASON_CATEGORIES = ["handoff", "human_closure", "automatic_closure"] as const;

export type ReasonCategory = (typeof REASON_CATEGORIES)[number];

export const DEFAULT_CONVERSATION_REASONS = [
  { id: "customer_requested_human", category: "handoff", label: "Cliente pediu atendimento humano", sortOrder: 10 },
  { id: "scheduling_request", category: "handoff", label: "Marcação ou alteração de horário", sortOrder: 20 },
  { id: "clinical_safety", category: "handoff", label: "Avaliação humana por segurança", sortOrder: 30 },
  { id: "financial_request", category: "handoff", label: "Solicitação financeira", sortOrder: 40 },
  { id: "automation_failure", category: "handoff", label: "Falha do atendimento automático", sortOrder: 50 },
  { id: "media_requires_human", category: "handoff", label: "Mídia precisa de atendimento humano", sortOrder: 60 },
  { id: "other_handoff", category: "handoff", label: "Outro motivo", sortOrder: 90 },
  { id: "resolved", category: "human_closure", label: "Necessidade resolvida", sortOrder: 10 },
  { id: "scheduled", category: "human_closure", label: "Agendamento concluído", sortOrder: 20 },
  { id: "guidance_completed", category: "human_closure", label: "Orientação concluída", sortOrder: 30 },
  { id: "client_withdrew", category: "human_closure", label: "Cliente desistiu", sortOrder: 40 },
  { id: "duplicate", category: "human_closure", label: "Atendimento duplicado", sortOrder: 50 },
  { id: "service_unavailable", category: "human_closure", label: "Atendimento não disponível", sortOrder: 60 },
  { id: "follow_up_later", category: "human_closure", label: "Cliente retornará depois", sortOrder: 70 },
  { id: "other_human_closure", category: "human_closure", label: "Outro motivo", sortOrder: 90 },
  { id: "customer_inactivity", category: "automatic_closure", label: "Inatividade do cliente", sortOrder: 10 },
  { id: "customer_satisfied", category: "automatic_closure", label: "Cliente satisfeito e autorizou encerrar", sortOrder: 20 },
  { id: "technical_duplicate", category: "automatic_closure", label: "Duplicidade técnica", sortOrder: 30 },
] as const satisfies ReadonlyArray<{ id: string; category: ReasonCategory; label: string; sortOrder: number }>;

export function isReasonCategory(value: unknown): value is ReasonCategory {
  return typeof value === "string" && REASON_CATEGORIES.includes(value as ReasonCategory);
}

export function inferHandoffReasonId(input: {
  source: "customer" | "safety_rule" | "system_failure";
  reason: string;
}): string {
  const reason = input.reason.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (input.source === "system_failure") return "automation_failure";
  if (/audio|imagem|documento|arquivo|midia|video/.test(reason)) return "media_requires_human";
  if (/financeir|cobranc|reembolso|pagamento/.test(reason)) return "financial_request";
  if (/agend|horario|marcacao|remarc/.test(reason)) return "scheduling_request";
  if (input.source === "safety_rule" || /seguranca|clinica|sintoma|gestante|gravida/.test(reason)) return "clinical_safety";
  if (/solicitou|pessoa|humano|atendente|equipe/.test(reason)) return "customer_requested_human";
  return "other_handoff";
}
