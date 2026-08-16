export type TimelineEventType =
  | "registration" | "contract_start" | "contract_expiration" | "purchase"
  | "service" | "attendance" | "absence" | "payment" | "financial_due" | "birthday";

export type CustomerTimelineEvent = {
  type: TimelineEventType;
  occurredAt: string;
  service?: string;
  status?: string;
};

export type RelationshipState =
  | "neutral" | "new_lead" | "active_customer" | "engaged_customer"
  | "declining_engagement" | "at_risk" | "inactive" | "former_customer";

export type NextBestActionType =
  | "explain_current_plan" | "renewal_due" | "reengagement" | "pilates_upgrade"
  | "massage_package" | "recovery_offer" | "relationship_checkin" | "birthday_context"
  | "experimental_class" | "human_followup" | "no_action";

export type Evidence = { metric: string; value: string | number | boolean; source: "nextfit" };
export type NextBestAction = {
  type: NextBestActionType;
  reason: string;
  confidence: "high" | "medium";
  evidence: Evidence[];
};

export type CustomerIntelligence = {
  calculatedAt: string;
  metrics: {
    daysAsCustomer?: number;
    daysSinceLastVisit?: number;
    visitsLast30d?: number;
    visitsLast90d?: number;
    currentContractCount?: number;
    daysUntilContractExpiration?: number;
    contractExpiringSoon?: boolean;
    financialStatus?: string;
    overdueDays?: number;
    historicalServices?: string[];
    activeServices?: string[];
    birthdayProximity?: number;
    relationshipAnniversaryProximity?: number;
    inactivityDays?: number;
    attendanceRatio?: number;
    recentActivityTrend?: "increasing" | "stable" | "declining";
  };
  relationshipState: { value: RelationshipState; reason: string; evidence: Evidence[] };
  nextBestActions: NextBestAction[];
  recentActivitySummary?: string;
};

export type IntelligenceInput = {
  sourceRelationship: "unknown" | "lead" | "customer" | "former_customer";
  timeline: CustomerTimelineEvent[];
  activeServices: string[];
  financialStatus?: string;
  now?: Date;
};
