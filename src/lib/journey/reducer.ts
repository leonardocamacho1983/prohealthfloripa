import {
  acceptsIntegratedPath,
  acceptsHotBath,
  declinesHotBath,
  extractExplicitServiceFamilyChange,
  extractJourneyGoals,
  extractScheduleChange,
  extractServiceSelectionChange,
  extractServiceFamily,
  isFactualServiceQuestion,
  isJourneyReset,
  isShortCommercialAcceptance,
} from "./extractors.ts";
import {
  initialJourneyState,
  type ConversationJourneyState,
  type JourneyAction,
  type JourneyFact,
} from "./types.ts";
import type { SemanticTurnInterpretation } from "../ai/semantic-turn-interpreter.ts";

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function isShortHotBathDecline(message: string): boolean {
  return /^(?:n[aã]o|nao\s+quero)\s*[.!]*$/i.test(message.trim());
}

function isAdjacentSafetyClearance(message: string): boolean {
  const text = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return /\b(?:nada\s+disso|nao\s+(?:tenho|sinto)|sem\s+(?:formigamento|perda\s+de\s+forca|trauma))\b/.test(text)
    || /\b(?:e|eh|é)?\s*so\s+(?:um\s+)?(?:mal[- ]?jeito|mal[- ]?estar|tensao|desconforto|incomodo)\b/.test(text);
}

function adjacentServicePreference(message: string): "Relaxante" | "Miofascial" | undefined {
  const text = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/\b(?:mais\s+)?(?:relaxante|relaxamento|desacelerar)\b/.test(text)) return "Relaxante";
  if (/\b(?:mais\s+)?(?:direcionad[ao]|localizad[ao]|tensao|rigidez|liberacao)\b/.test(text)) return "Miofascial";
  return undefined;
}

function clearPrimaryServiceJourney(state: ConversationJourneyState): void {
  state.stage = "discovery";
  state.recommendedServices = [];
  state.selectedService = undefined;
  state.factsSent = [];
  state.scheduling = { status: "not_started" };
}

export function reduceJourneyState(
  previous: ConversationJourneyState | undefined,
  input: {
    messages: readonly string[];
    revision: number;
    activePilates?: boolean;
  },
): ConversationJourneyState {
  let state: ConversationJourneyState = structuredClone(previous ?? initialJourneyState());
  state.dialogue ??= { safetyStatus: "not_asked" };
  delete state.dialogue.latestSignal;
  delete state.dialogue.latestIntent;
  state.latestGoals = unique(input.messages.flatMap((message) =>
    isFactualServiceQuestion(message) ? [] : extractJourneyGoals(message)));
  for (const message of input.messages) {
    if (isJourneyReset(message)) {
      state = initialJourneyState(state.updatedFromRevision);
      state.activePilates = Boolean(input.activePilates);
      state.latestGoals = [];
      continue;
    }
    if (isShortCommercialAcceptance(message)) {
      state.dialogue.latestSignal = "short_acceptance";
    }
    if (isFactualServiceQuestion(message)) {
      state.dialogue.latestIntent = "service_question";
    }
    if ((state.dialogue.lastQuestion === "safety" || state.dialogue.safetyStatus === "asked")
      && isAdjacentSafetyClearance(message)) {
      state.dialogue.safetyStatus = "cleared";
      state.dialogue.latestSignal = "safety_cleared";
      delete state.dialogue.lastQuestion;
    }
    state.goals = unique([...state.goals, ...extractJourneyGoals(message)]);
    if (state.lastAction === "recommend_integrated_paths" && acceptsIntegratedPath(message)) {
      state.serviceFamily = "massage";
      state.offers.hot_bath = "accepted";
    }
    const explicitFamilyChange = extractExplicitServiceFamilyChange(message);
    if (explicitFamilyChange && state.serviceFamily && explicitFamilyChange !== state.serviceFamily) {
      clearPrimaryServiceJourney(state);
    }
    state.serviceFamily = explicitFamilyChange ?? extractServiceFamily(message) ?? state.serviceFamily;

    const selectionChange = extractServiceSelectionChange(message);
    const explicitSelection = selectionChange.selectedService;
    const rejectedCurrentSelection = Boolean(state.selectedService
      && selectionChange.rejectedServices.includes(state.selectedService as "Relaxante" | "Miofascial")
      && explicitSelection !== state.selectedService);
    if (rejectedCurrentSelection) {
      state.selectedService = undefined;
      state.factsSent = [];
    }
    if (!explicitSelection || explicitSelection !== state.selectedService) {
      state.recommendedServices = state.recommendedServices.filter((service) =>
        !selectionChange.rejectedServices.some((rejected) => rejected.toLowerCase() === service.toLowerCase()));
    }
    if (explicitSelection && explicitSelection !== state.selectedService) {
      const confirmsOnlyRecommendation = !state.selectedService
        && state.recommendedServices.length === 1
        && state.recommendedServices[0]?.toLowerCase() === explicitSelection.toLowerCase();
      state.selectedService = explicitSelection;
      if (!confirmsOnlyRecommendation) {
        state.factsSent = [];
      }
    }
    if (!state.selectedService && isShortCommercialAcceptance(message)
      && state.recommendedServices.length === 1) {
      state.selectedService = state.recommendedServices[0];
    }
    if (!state.selectedService && state.dialogue.lastQuestion === "service_choice") {
      const adjacentPreference = adjacentServicePreference(message);
      if (adjacentPreference && state.recommendedServices.some((service) =>
        service.toLowerCase() === adjacentPreference.toLowerCase())) {
        state.selectedService = adjacentPreference;
      }
    }
    if (state.offers.hot_bath === "offered") {
      if (declinesHotBath(message)) state.offers.hot_bath = "declined";
      else if (acceptsHotBath(message)) state.offers.hot_bath = "accepted";
      else if (state.lastAction === "present_selected_service" && isShortHotBathDecline(message)) {
        state.offers.hot_bath = "declined";
      } else if (state.lastAction === "present_selected_service" && isShortCommercialAcceptance(message)) {
        state.offers.hot_bath = "accepted";
      }
    }

    const scheduleChange = extractScheduleChange(message);
    if (scheduleChange.invalidatesCurrentDay
      || (state.scheduling.dayText
        && scheduleChange.rejectedDayTexts.includes(state.scheduling.dayText))) {
      delete state.scheduling.dayText;
    }
    if (scheduleChange.invalidatesCurrentTime
      || (state.scheduling.time && scheduleChange.rejectedTimes.includes(state.scheduling.time))) {
      delete state.scheduling.time;
    }
    state.scheduling = { ...state.scheduling, ...scheduleChange.scheduling };
  }

  state.activePilates = Boolean(input.activePilates ?? state.activePilates);
  if (state.selectedService) state.stage = "service_selected";
  const hasSchedule = Boolean(state.scheduling.dayText || state.scheduling.time || state.scheduling.period);
  if (hasSchedule) {
    state.scheduling.status = state.selectedService && state.scheduling.dayText && state.scheduling.time
      ? "complete"
      : "collecting";
    state.stage = state.scheduling.status === "complete" ? "ready_for_handoff" : "collecting_schedule";
  }
  state.updatedFromRevision = Math.max(state.updatedFromRevision, input.revision);
  return state;
}

export function applySemanticJourneyEvidence(
  state: ConversationJourneyState,
  interpretation: SemanticTurnInterpretation | undefined,
): ConversationJourneyState {
  if (!interpretation || interpretation.confidence === "low") return state;
  const next = structuredClone(state);
  next.dialogue.latestIntent = interpretation.intent;
  next.latestGoals = unique([...next.latestGoals, ...interpretation.goals]);
  next.goals = unique([...next.goals, ...interpretation.goals]);
  if (!next.serviceFamily && interpretation.serviceFamily) {
    next.serviceFamily = interpretation.serviceFamily;
  }
  return next;
}

export function observeAssistantJourneyFacts(
  state: ConversationJourneyState,
  messages: readonly string[],
): ConversationJourneyState {
  const next = structuredClone(state);
  const evidence = messages.join("\n");
  const latestMessage = messages.at(-1) ?? "";
  const facts: JourneyFact[] = [...next.factsSent];
  if (/R\$\s*270\b/i.test(evidence)) facts.push("service_price");
  if (/\b(?:uma|1)\s+hora(?:\s+completa)?\b|\b60\s+minutos?\b/i.test(evidence)) facts.push("service_duration");
  if (/banheira\s+quente[^.!?]{0,140}R\$\s*35|R\$\s*35[^.!?]{0,140}banheira\s+quente/i.test(evidence)) {
    next.offers.hot_bath = next.offers.hot_bath ?? "offered";
  }
  if (/termoterapias?[^.!?]{0,180}banheira\s+quente|banheira\s+quente[^.!?]{0,180}termoterapias?/i.test(evidence)
    && /\b(?:combinar|combinadas|complementar|trabalhamos)\b/i.test(evidence)) {
    next.dialogue.thermotherapyMentioned = true;
  }
  if (/roupa\s+de\s+banho/i.test(evidence) && /toalhas?/i.test(evidence)) facts.push("hot_bath_amenities");
  if (/Rua\s+Vera\s+Linhares\s+de\s+Andrade\s*,?\s*2063/i.test(evidence)) {
    next.dialogue.addressSent = true;
  }
  if (/\bprofissional\b[^.!?]{0,120}\b(?:ajusta|avalia|define|conversa)\b|\bavalia[cç][aã]o\s+(?:profissional\s+)?(?:no\s+)?in[ií]cio\b/i.test(evidence)) {
    next.dialogue.professionalAdjustmentMentioned = true;
  }
  const safetyQuestion = /\b(?:dor\s+forte|formigamento|perda\s+de\s+for[cç]a|trauma)\b/i.test(latestMessage)
    && latestMessage.includes("?");
  if (safetyQuestion && next.dialogue.safetyStatus !== "cleared") {
    next.dialogue.safetyStatus = "asked";
    next.dialogue.lastQuestion = "safety";
  }
  if (/\b(?:quer(?:\s+que)?\s+eu|posso)\b[^.!?]{0,100}\b(?:pass(?:e|ar)|explic(?:o|ar)|mostrar|contar)\b/i.test(latestMessage)
    && /\b(?:servi[cç]os?|op[cç][oõ]es|atendimento|funciona)\b/i.test(latestMessage)) {
    next.dialogue.pendingCommitment = "explain_service_options";
    next.dialogue.lastQuestion = "service_explanation";
  }
  const latestRelevantServiceMessage = [...messages].reverse().find((message) =>
    /\brelaxante\b|\bmiofascial\b|libera[cç][aã]o\s+miofascial/i.test(message));
  const mentionedRelaxante = latestRelevantServiceMessage
    ? /\brelaxante\b/i.test(latestRelevantServiceMessage)
    : false;
  const mentionedMiofascial = latestRelevantServiceMessage
    ? /\bmiofascial\b|libera[cç][aã]o\s+miofascial/i.test(latestRelevantServiceMessage)
    : false;
  if (!next.selectedService && next.serviceFamily === "massage"
    && next.recommendedServices.length === 0) {
    if (mentionedRelaxante && mentionedMiofascial) next.recommendedServices = ["Miofascial", "Relaxante"];
    else if (mentionedRelaxante) next.recommendedServices = ["Relaxante"];
    else if (mentionedMiofascial) next.recommendedServices = ["Miofascial"];
    if (next.recommendedServices.length) next.stage = "recommendation";
  }
  next.factsSent = unique(facts);
  return next;
}

/**
 * Applies only effects supported by text that was actually delivered. Planning
 * a reply must never mark a price or offer as sent before the provider confirms it.
 */
export function applyDeliveredJourneyOutcome(
  state: ConversationJourneyState,
  input: {
    action: JourneyAction;
    messages: readonly string[];
    handoffCompleted?: boolean;
  },
): ConversationJourneyState {
  const next = observeAssistantJourneyFacts(state, input.messages);
  next.lastAction = input.action.type;

  if (input.action.type === "recommend_service") {
    next.serviceFamily = "massage";
    next.recommendedServices = input.action.goal === "relaxation"
      ? ["Relaxante"]
      : ["Miofascial", "Relaxante"];
    next.stage = "recommendation";
    next.dialogue.lastQuestion = "service_choice";
    delete next.dialogue.pendingCommitment;
  } else if (input.action.type === "recommend_integrated_paths") {
    next.dialogue.thermotherapyMentioned = true;
    next.stage = "recommendation";
    next.dialogue.lastQuestion = "path_choice";
    delete next.dialogue.pendingCommitment;
  } else if (input.action.type === "clarify_path_choice") {
    next.dialogue.lastQuestion = "path_choice";
  } else if (input.action.type === "clarify_service_choice") {
    next.dialogue.lastQuestion = "service_choice";
    delete next.dialogue.pendingCommitment;
  } else if (input.action.type === "present_selected_service"
    || input.action.type === "ask_schedule") {
    const scheduleIsComplete = Boolean(next.scheduling.dayText && next.scheduling.time);
    next.stage = scheduleIsComplete ? "service_selected" : "collecting_schedule";
    next.scheduling.status = scheduleIsComplete ? "complete" : "collecting";
    if (input.action.type === "present_selected_service" && input.action.offerHotBath) {
      next.dialogue.lastQuestion = "hot_bath";
    } else {
      const missing = input.action.type === "ask_schedule"
        ? input.action.missing
        : input.action.nextQuestion;
      next.dialogue.lastQuestion = missing === "day"
        ? "schedule_day"
        : missing === "period"
          ? "schedule_period"
          : "schedule_time";
    }
    delete next.dialogue.pendingCommitment;
  } else if (input.action.type === "schedule_handoff") {
    next.stage = input.handoffCompleted ? "human_handoff" : "ready_for_handoff";
    next.scheduling.status = input.handoffCompleted ? "handed_off" : "complete";
    delete next.dialogue.lastQuestion;
    delete next.dialogue.pendingCommitment;
  }

  return next;
}
