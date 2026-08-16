import type { HandoffSource } from "./types.ts";

export type HandoffDecision = { reason: string; source: HandoffSource } | undefined;

const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function detectHandoffRequest(text: string): HandoffDecision {
  const message = normalize(text);
  if (/(?:falar|conversar|atendimento).{0,24}(?:pessoa|humano|atendente|recepcao|bia)|(?:chama|chamar).{0,16}(?:alguem|atendente|bia)|nao quero.{0,16}(?:robo|bot|ia)/i.test(message)) {
    return { reason: "Cliente solicitou atendimento humano.", source: "customer" };
  }
  if (/(?:medicamento|remedio|diagnostico|prescricao|apto|gravida|gestante|cirurgia|trombose|pressao).*(?:posso|devo|pode|suspender|tomar|fazer)|(?:posso|devo).*(?:medicamento|remedio|crioterapia|exercicio|massagem)/i.test(message)) {
    return { reason: "Solicitação requer avaliação humana por segurança clínica.", source: "safety_rule" };
  }
  if (/(?:contesto|contestar|discordo|cobranca indevida|valor errado|cobraram errado|reembolso).*(?:pag|cobran|valor|plano)?/i.test(message)) {
    return { reason: "Solicitação financeira requer acompanhamento humano.", source: "safety_rule" };
  }
  if (/forca maior/i.test(message)) {
    return { reason: "Situação de força maior requer confirmação humana.", source: "safety_rule" };
  }
  return undefined;
}

export const HANDOFF_ACKNOWLEDGEMENT = "Claro. Já avisei nossa equipe. A Bia continuará esta conversa por aqui assim que possível.";
