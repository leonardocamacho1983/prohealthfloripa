export type SemanticPrimaryIntent =
  | "service_information"
  | "service_discovery"
  | "scheduling"
  | "customer_account"
  | "handoff"
  | "social"
  | "other";

export type SemanticTurnPlan = {
  primaryIntent: SemanticPrimaryIntent;
  conversationAct: "new_request" | "continuation" | "answer" | "correction" | "reset" | "confirmation";
  requestedService?: {
    family: "massage" | "pilates" | "physiotherapy" | "recovery";
    name?: string;
    explicit: boolean;
  };
  scheduling: {
    requested: boolean;
    dayText?: string;
    period?: "morning" | "afternoon" | "evening";
    time?: string;
  };
  factsAlreadyProvided: string[];
  factsNeeded: string[];
  unresolvedQuestions: string[];
  nextAction: "answer" | "ask_missing_information" | "check_availability" | "request_handoff" | "acknowledge_only";
  optionalOffer?: {
    id: "hot_bath" | "cold_bath" | "contrast";
    appropriateNow: boolean;
    reason: string;
  };
  acknowledgeGreeting: boolean;
  confidence: "low" | "medium" | "high";
};

export type SemanticPlanIssue =
  | "exact_time_marked_missing"
  | "premature_optional_offer"
  | "availability_without_complete_request";

export function validateSemanticTurnPlan(plan: SemanticTurnPlan): SemanticPlanIssue[] {
  const issues: SemanticPlanIssue[] = [];
  if (plan.scheduling.time && plan.factsNeeded.some((fact) => /period|per[ií]odo|time|hor[aá]rio/i.test(fact))) {
    issues.push("exact_time_marked_missing");
  }
  if (plan.optionalOffer?.appropriateNow
    && (plan.nextAction === "ask_missing_information" || plan.unresolvedQuestions.length > 0)) {
    issues.push("premature_optional_offer");
  }
  if (plan.nextAction === "check_availability"
    && (!plan.requestedService || !plan.scheduling.dayText || !plan.scheduling.time)) {
    issues.push("availability_without_complete_request");
  }
  return issues;
}
