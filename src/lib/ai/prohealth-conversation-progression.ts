import { analyzeMassageRequest, buildConfirmedMassageAnswer } from "../knowledge/massage-catalog-semantics.ts";
import type { WhatsAppReplyPlan } from "./reply-generation-fallback.ts";

const MASSAGE_DISCOVERY_REPLY =
  "Temos massagens voltadas para relaxamento, tensões musculares, recuperação esportiva e também algumas técnicas especiais. Você busca mais relaxar, aliviar alguma região específica ou recuperar o corpo depois de atividade física?";

function schedulingQuestion(missingFields: readonly ("service" | "day" | "time")[]): string | undefined {
  const missing = new Set(missingFields);
  if (missing.has("day") && missing.has("time")) return "Qual dia e horário funcionam melhor para você?";
  if (missing.has("day")) return "Qual dia funciona melhor para você?";
  if (missing.has("time")) return "Qual horário funciona melhor para você?";
  return undefined;
}

/** Intent and selection come from the AI; this layer only prevents UX regressions. */
export function enforceProHealthConversationProgression(plan: WhatsAppReplyPlan): WhatsAppReplyPlan {
  const state = plan.conversationState;
  if (!state) return plan;

  if (state.intent === "service_discovery" && state.nextAction === "clarify_goal") {
    return { ...plan, messages: [MASSAGE_DISCOVERY_REPLY], needsClarification: true };
  }

  const confidentSelection = state.intent === "service_selection"
    && state.selectionConfidence === "high"
    && state.selectedService
    && state.nextAction === "collect_schedule";
  if (!confidentSelection) return plan;

  const analysis = analyzeMassageRequest(state.selectedService!);
  const confirmedAnswer = buildConfirmedMassageAnswer(analysis);
  const question = schedulingQuestion(state.missingScheduleFields);
  if (!confirmedAnswer || !question) return plan;

  return {
    ...plan,
    messages: [`Perfeito, seguimos com a ${state.selectedService}. ${confirmedAnswer}${analysis.mentions[0]?.duration ? "" : " O atendimento ocupa 1 hora completa."} ${question}`],
    answeredTopics: [...new Set([...plan.answeredTopics, "serviço escolhido"])],
    needsClarification: true,
  };
}
