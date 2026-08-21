export const JOURNEY_STATE_SCHEMA_VERSION = 1;

export type JourneyStage =
  | "discovery"
  | "recommendation"
  | "service_selected"
  | "collecting_schedule"
  | "ready_for_handoff"
  | "human_handoff"
  | "completed";

export type JourneyGoal =
  | "localized_tension"
  | "relaxation"
  | "post_exercise_recovery"
  | "general_recovery";

export type JourneyFact =
  | "service_price"
  | "service_duration"
  | "service_category"
  | "hot_bath_amenities";

export type JourneyOfferId = "hot_bath" | "cold_bath" | "contrast";
export type JourneyOfferStatus = "offered" | "accepted" | "declined";

export type JourneyIntent =
  | "symptom_or_goal"
  | "service_discovery"
  | "service_question"
  | "scheduling"
  | "social"
  | "other";

export type JourneyDialogueState = {
  safetyStatus: "not_asked" | "asked" | "cleared" | "flagged";
  lastQuestion?: "safety" | "path_choice" | "service_choice" | "service_explanation"
    | "hot_bath" | "schedule_day" | "schedule_period" | "schedule_time";
  pendingCommitment?: "explain_service_options";
  latestSignal?: "short_acceptance" | "safety_cleared";
  latestIntent?: JourneyIntent;
  addressSent?: boolean;
  professionalAdjustmentMentioned?: boolean;
  thermotherapyMentioned?: boolean;
};

export type JourneySchedulingState = {
  status: "not_started" | "collecting" | "complete" | "handed_off";
  dayText?: string;
  period?: "morning" | "afternoon" | "evening";
  time?: string;
};

export type ConversationJourneyState = {
  schemaVersion: number;
  stage: JourneyStage;
  goals: JourneyGoal[];
  latestGoals: JourneyGoal[];
  serviceFamily?: "massage" | "pilates" | "physiotherapy" | "recovery";
  recommendedServices: string[];
  selectedService?: string;
  factsSent: JourneyFact[];
  offers: Partial<Record<JourneyOfferId, JourneyOfferStatus>>;
  scheduling: JourneySchedulingState;
  dialogue: JourneyDialogueState;
  activePilates: boolean;
  lastAction?: JourneyAction["type"];
  updatedFromRevision: number;
};

export type JourneyAction =
  | { type: "assisted"; reason: string }
  | { type: "recommend_integrated_paths"; goal: "localized_tension" | "relaxation" | "both" }
  | { type: "recommend_service"; goal: "localized_tension" | "relaxation" | "both" }
  | { type: "clarify_path_choice" }
  | { type: "clarify_service_choice" }
  | {
      type: "present_selected_service";
      service: string;
      includePrice: boolean;
      includeDuration: boolean;
      offerHotBath: boolean;
      activePilates: boolean;
      nextQuestion?: "day" | "period" | "time";
    }
  | { type: "ask_schedule"; service?: string; missing: "day" | "period" | "time" }
  | {
      type: "schedule_handoff";
      service: string;
      day: string;
      time: string;
      includePrice: boolean;
      includeDuration: boolean;
      offerHotBath: boolean;
      activePilates: boolean;
      hotBathAccepted?: boolean;
    };

export type JourneyDecision = {
  action: JourneyAction;
  nextState: ConversationJourneyState;
};

export function initialJourneyState(revision = 0): ConversationJourneyState {
  return {
    schemaVersion: JOURNEY_STATE_SCHEMA_VERSION,
    stage: "discovery",
    goals: [],
    latestGoals: [],
    recommendedServices: [],
    factsSent: [],
    offers: {},
    scheduling: { status: "not_started" },
    dialogue: { safetyStatus: "not_asked" },
    activePilates: false,
    updatedFromRevision: revision,
  };
}
