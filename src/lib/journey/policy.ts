import type { ConversationJourneyState, JourneyDecision, JourneyGoal } from "./types.ts";

function withAction(state: ConversationJourneyState, action: JourneyDecision["action"]): JourneyDecision {
  return { action, nextState: { ...state, lastAction: action.type } };
}

function missingSchedule(state: ConversationJourneyState): "day" | "time" | undefined {
  if (!state.scheduling.dayText) return "day";
  if (!state.scheduling.time) return "time";
  return undefined;
}

function recommendationGoal(goals: JourneyGoal[]): "localized_tension" | "relaxation" | "both" | undefined {
  const localized = goals.includes("localized_tension");
  const relaxation = goals.includes("relaxation");
  if (localized && relaxation) return "both";
  if (localized) return "localized_tension";
  if (relaxation) return "relaxation";
  return undefined;
}

export function decideJourneyAction(state: ConversationJourneyState): JourneyDecision {
  const currentRecommendationGoal = recommendationGoal(state.latestGoals)
    ?? (state.lastAction === "recommend_integrated_paths"
      || state.dialogue.latestIntent === "symptom_or_goal"
      || state.dialogue.latestIntent === "service_discovery"
      || state.dialogue.pendingCommitment === "explain_service_options"
      ? recommendationGoal(state.goals)
      : undefined);
  const thermotherapyAlreadyPresented = Boolean(state.dialogue.thermotherapyMentioned)
    || Object.values(state.offers)
      .some((status) => status === "offered" || status === "accepted" || status === "declined");
  const shouldOfferHotBath = Boolean(state.selectedService
    && (/^relaxante$/i.test(state.selectedService)
      || state.goals.includes("localized_tension")
      || state.goals.includes("relaxation"))
    && state.offers.hot_bath === undefined);

  if (state.dialogue.latestIntent === "service_question") {
    return withAction(state, { type: "assisted", reason: "O cliente pediu uma explicação factual do serviço." });
  }

  if (state.dialogue.lastQuestion === "path_choice"
    && state.dialogue.latestSignal === "short_acceptance") {
    return withAction(state, { type: "clarify_path_choice" });
  }

  if (state.dialogue.lastQuestion === "service_choice"
    && state.dialogue.latestSignal === "short_acceptance"
    && state.recommendedServices.length > 1) {
    return withAction(state, { type: "clarify_service_choice" });
  }

  if (state.selectedService && state.scheduling.dayText && state.scheduling.time
    && shouldOfferHotBath) {
    const action = {
      type: "present_selected_service" as const,
      service: state.selectedService,
      includePrice: !state.factsSent.includes("service_price"),
      includeDuration: !state.factsSent.includes("service_duration"),
      offerHotBath: true,
      activePilates: state.activePilates,
    };
    return {
      action,
      nextState: {
        ...state,
        stage: "service_selected",
        scheduling: { ...state.scheduling, status: "complete" },
        lastAction: action.type,
      },
    };
  }

  if (state.selectedService && state.scheduling.dayText && state.scheduling.time) {
    const action = {
      type: "schedule_handoff" as const,
      service: state.selectedService,
      day: state.scheduling.dayText,
      time: state.scheduling.time,
      includePrice: !state.factsSent.includes("service_price"),
      includeDuration: !state.factsSent.includes("service_duration"),
      offerHotBath: false,
      activePilates: state.activePilates,
      ...(state.offers.hot_bath === "accepted" ? { hotBathAccepted: true } : {}),
    };
    return {
      action,
      nextState: {
        ...state,
        stage: "ready_for_handoff",
        scheduling: { ...state.scheduling, status: "complete" },
        lastAction: action.type,
      },
    };
  }

  if (state.selectedService) {
    const includePrice = !state.factsSent.includes("service_price");
    const includeDuration = !state.factsSent.includes("service_duration");
    const offerHotBath = shouldOfferHotBath;
    const missing = missingSchedule(state);
    if (includePrice || includeDuration || offerHotBath) {
      const action = {
        type: "present_selected_service" as const,
        service: state.selectedService,
        includePrice,
        includeDuration,
        offerHotBath,
        activePilates: state.activePilates,
        // The cross-sell gets one clear acceptance question. Scheduling is
        // collected on the next turn unless the customer volunteers it.
        ...(missing && !offerHotBath ? { nextQuestion: missing } : {}),
      };
      return {
        action,
        nextState: {
          ...state,
          stage: "collecting_schedule",
          scheduling: { ...state.scheduling, status: "collecting" },
          lastAction: action.type,
        },
      };
    }
    if (missing) {
      return withAction(state, { type: "ask_schedule", service: state.selectedService, missing });
    }
  }

  if (state.serviceFamily === "massage"
    || (state.dialogue.pendingCommitment === "explain_service_options"
      && state.dialogue.latestSignal === "short_acceptance")) {
    const goal = currentRecommendationGoal;
    if (goal) {
      const recommendedServices = goal === "relaxation" ? ["Relaxante"] : ["Miofascial", "Relaxante"];
      const action = { type: "recommend_service" as const, goal };
      return {
        action,
        nextState: {
          ...state,
          stage: "recommendation",
          recommendedServices,
          lastAction: action.type,
        },
      };
    }
  }

  if (!state.serviceFamily && currentRecommendationGoal) {
    if (thermotherapyAlreadyPresented) {
      const recommendedServices = currentRecommendationGoal === "relaxation"
        ? ["Relaxante"]
        : ["Miofascial", "Relaxante"];
      const action = { type: "recommend_service" as const, goal: currentRecommendationGoal };
      return {
        action,
        nextState: {
          ...state,
          stage: "recommendation",
          serviceFamily: "massage",
          recommendedServices,
          lastAction: action.type,
        },
      };
    }
    const action = { type: "recommend_integrated_paths" as const, goal: currentRecommendationGoal };
    return {
      action,
      nextState: {
        ...state,
        stage: "recommendation",
        lastAction: action.type,
      },
    };
  }

  return withAction(state, { type: "assisted", reason: "A intenção exige conhecimento ou interpretação adicional." });
}
