import type { HandoffSource } from "./types.ts";

export type HandoffDecision = { reason: string; source: HandoffSource } | undefined;

const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const HUMAN_HANDOFF_NEGATION = /\b(?:nao\s+(?:quero|preciso|gostaria|prefiro)|prefiro\s+nao|nao\s+precisa)\b[^,;.!?]{0,40}\b(?:pessoa|humano|atendente|recepcao|bia)\b/i;
const CLINICAL_CONDITION = /\b(?:medicamento|remedio|diagnostico|prescricao|apto|gravida|gestante|cirurgia|trombose|pressao)\w*\b/i;
const CLINICAL_DECISION = /\b(?:posso|devo|pode|suspender|tomar|fazer|realizar|praticar|quero|queria|gostaria|preciso|agendar|marcar|segur[oa]|indicad[oa])\w*\b/i;
const CLINICAL_SERVICE = /\b(?:massag\w*|crioterapia|crio\w*|exerc[ií]cio\w*|pilates|fisioterapia|fisio\w*|termoterapia|recovery)\b/i;
const MEDICATION_DECISION = /\b(?:medicamento|remedio)\w*\b/i;
const EXPLICIT_FINANCIAL_DISPUTE = /\b(?:cobranca(?:\s+(?:e|esta))?\s+indevida|valor(?:\s+(?:e|esta))?\s+errado|cobraram\s+errado|reembolso)\b/i;
const GENERIC_DISPUTE = /\b(?:contesto|contestar|discordo)\b/i;
const FINANCIAL_SUBJECT = /\b(?:pag\w*|cobran[cç]\w*|valor|preco|plano|mensalidade|financ\w*)\b/i;

export function detectHandoffRequest(text: string): HandoffDecision {
  const message = normalize(text);
  if (!HUMAN_HANDOFF_NEGATION.test(message)
    && /(?:falar|conversar|atendimento).{0,24}(?:pessoa|humano|atendente|recepcao|bia)|(?:chama|chamar).{0,16}(?:alguem|atendente|bia)|nao quero.{0,16}(?:robo|bot|ia)/i.test(message)) {
    return { reason: "Cliente solicitou atendimento humano.", source: "customer" };
  }
  const requestsClinicalDecision = CLINICAL_CONDITION.test(message)
    && CLINICAL_DECISION.test(message)
    && (CLINICAL_SERVICE.test(message) || MEDICATION_DECISION.test(message));
  if (requestsClinicalDecision) {
    return { reason: "Solicitação requer avaliação humana por segurança clínica.", source: "safety_rule" };
  }
  if (/\b(?:dor no peito|falta de ar|perda de forca|perdi a forca|perda de sensibilidade|sem sensibilidade|trauma recente|febre|suspeita de trombose)\b/i.test(message)) {
    return { reason: "Relato contém sinal que requer avaliação humana por segurança clínica.", source: "safety_rule" };
  }
  if (EXPLICIT_FINANCIAL_DISPUTE.test(message)
    || (GENERIC_DISPUTE.test(message) && FINANCIAL_SUBJECT.test(message))) {
    return { reason: "Solicitação financeira requer acompanhamento humano.", source: "safety_rule" };
  }
  if (/forca maior/i.test(message)) {
    return { reason: "Situação de força maior requer confirmação humana.", source: "safety_rule" };
  }
  return undefined;
}

const SHORT_AFFIRMATIVE = /^(?:sim|pode|pode\s+sim|quero|claro|por\s+favor|vamos|ok|t[aá]\s+bom|isso)$/i;
const ASSISTANT_HANDOFF_OFFER = /\b(?:encaminhar|transferir|chamar|acionar|passar)\b[^.!?]{0,100}\b(?:equipe|atendente|bia|pessoa|humano)\b|\b(?:equipe|atendente|bia|pessoa|humano)\b[^.!?]{0,100}\b(?:continuar|atender|verificar|confirmar)\b/i;

export function isPossibleHandoffConsent(customerText: string): boolean {
  return SHORT_AFFIRMATIVE.test(normalize(customerText).replace(/[.!?]+$/g, "").trim());
}

/** Turns a short "sim" into consent only when it immediately follows a clear human handoff offer. */
export function detectHandoffConsent(
  customerText: string,
  latestAssistantText?: string,
): HandoffDecision {
  const customer = normalize(customerText).replace(/[.!?]+$/g, "").trim();
  const assistant = latestAssistantText ? normalize(latestAssistantText) : "";
  if (!isPossibleHandoffConsent(customer) || !ASSISTANT_HANDOFF_OFFER.test(assistant)) return undefined;
  return { reason: "Cliente confirmou o encaminhamento oferecido pela agente.", source: "customer" };
}

export const HANDOFF_ACKNOWLEDGEMENT = "Boa! Estou passando sua conversa para nosso atendimento humano, que dará continuidade por aqui dentro do nosso horário de atendimento: de segunda a sexta, das 14h às 20h.";
