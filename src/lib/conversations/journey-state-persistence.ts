import {
  JOURNEY_STATE_SCHEMA_VERSION,
  type ConversationJourneyState,
  type JourneyAction,
  type JourneyDialogueState,
  type JourneyFact,
  type JourneyGoal,
  type JourneyOfferId,
  type JourneyOfferStatus,
  type JourneySchedulingState,
  type JourneyStage,
} from "../journey/types.ts";

export type ConversationJourneyStateRow = {
  schema_version: unknown;
  stage: unknown;
  goals: unknown;
  latest_goals: unknown;
  service_family: unknown;
  recommended_services: unknown;
  selected_service: unknown;
  facts_sent: unknown;
  offers: unknown;
  scheduling: unknown;
  dialogue?: unknown;
  active_pilates: unknown;
  last_action: unknown;
  updated_from_revision: unknown;
};

export type SerializedConversationJourneyState = {
  schemaVersion: number;
  stage: JourneyStage;
  goalsJson: string;
  latestGoalsJson: string;
  serviceFamily: ConversationJourneyState["serviceFamily"] | null;
  recommendedServicesJson: string;
  selectedService: string | null;
  factsSentJson: string;
  offersJson: string;
  schedulingJson: string;
  dialogueJson: string;
  activePilates: boolean;
  lastAction: JourneyAction["type"] | null;
  updatedFromRevision: number;
};

const STAGES = new Set<JourneyStage>([
  "discovery", "recommendation", "service_selected", "collecting_schedule",
  "ready_for_handoff", "human_handoff", "completed",
]);
const GOALS = new Set<JourneyGoal>([
  "localized_tension", "relaxation", "post_exercise_recovery", "general_recovery",
]);
const FACTS = new Set<JourneyFact>([
  "service_price", "service_duration", "service_category", "hot_bath_amenities",
]);
const OFFER_IDS = new Set<JourneyOfferId>(["hot_bath", "cold_bath", "contrast"]);
const OFFER_STATUSES = new Set<JourneyOfferStatus>(["offered", "accepted", "declined"]);
const SCHEDULING_STATUSES = new Set<JourneySchedulingState["status"]>([
  "not_started", "collecting", "complete", "handed_off",
]);
const PERIODS = new Set<NonNullable<JourneySchedulingState["period"]>>([
  "morning", "afternoon", "evening",
]);
const SERVICE_FAMILIES = new Set<NonNullable<ConversationJourneyState["serviceFamily"]>>([
  "massage", "pilates", "physiotherapy", "recovery",
]);
const ACTIONS = new Set<JourneyAction["type"]>([
  "assisted", "recommend_integrated_paths", "recommend_service", "present_selected_service",
  "clarify_path_choice", "clarify_service_choice", "ask_schedule", "schedule_handoff",
]);
const SAFETY_STATUSES = new Set<JourneyDialogueState["safetyStatus"]>([
  "not_asked", "asked", "cleared", "flagged",
]);
const QUESTION_KINDS = new Set<NonNullable<JourneyDialogueState["lastQuestion"]>>([
  "safety", "path_choice", "service_choice", "service_explanation", "hot_bath",
  "schedule_day", "schedule_period", "schedule_time",
]);
const COMMITMENTS = new Set<NonNullable<JourneyDialogueState["pendingCommitment"]>>([
  "explain_service_options",
]);
const DIALOGUE_SIGNALS = new Set<NonNullable<JourneyDialogueState["latestSignal"]>>([
  "short_acceptance", "safety_cleared",
]);
const JOURNEY_INTENTS = new Set<NonNullable<JourneyDialogueState["latestIntent"]>>([
  "symptom_or_goal", "service_discovery", "service_question", "scheduling", "social", "other",
]);

function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function enumList<T extends string>(value: unknown, allowed: Set<T>): T[] {
  const parsed = jsonValue(value);
  if (!Array.isArray(parsed)) return [];
  return [...new Set(parsed.filter((item): item is T => typeof item === "string" && allowed.has(item as T)))];
}

function boundedText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text && text.length <= maxLength ? text : undefined;
}

function recommendedServices(value: unknown): string[] {
  const parsed = jsonValue(value);
  if (!Array.isArray(parsed)) return [];
  return [...new Set(parsed.map((item) => boundedText(item, 120)).filter((item): item is string => Boolean(item)))].slice(0, 20);
}

function offers(value: unknown): ConversationJourneyState["offers"] {
  const parsed = jsonValue(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const result: ConversationJourneyState["offers"] = {};
  for (const [key, status] of Object.entries(parsed)) {
    if (OFFER_IDS.has(key as JourneyOfferId) && OFFER_STATUSES.has(status as JourneyOfferStatus)) {
      result[key as JourneyOfferId] = status as JourneyOfferStatus;
    }
  }
  return result;
}

function scheduling(value: unknown): JourneySchedulingState {
  const parsed = jsonValue(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { status: "not_started" };
  const candidate = parsed as Record<string, unknown>;
  const status = SCHEDULING_STATUSES.has(candidate.status as JourneySchedulingState["status"])
    ? candidate.status as JourneySchedulingState["status"]
    : "not_started";
  const dayText = boundedText(candidate.dayText, 50);
  const time = typeof candidate.time === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(candidate.time)
    ? candidate.time
    : undefined;
  const period = PERIODS.has(candidate.period as NonNullable<JourneySchedulingState["period"]>)
    ? candidate.period as NonNullable<JourneySchedulingState["period"]>
    : undefined;
  return {
    status,
    ...(dayText ? { dayText } : {}),
    ...(period ? { period } : {}),
    ...(time ? { time } : {}),
  };
}

function dialogue(value: unknown): JourneyDialogueState {
  const parsed = jsonValue(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { safetyStatus: "not_asked" };
  }
  const candidate = parsed as Record<string, unknown>;
  const safetyStatus = SAFETY_STATUSES.has(candidate.safetyStatus as JourneyDialogueState["safetyStatus"])
    ? candidate.safetyStatus as JourneyDialogueState["safetyStatus"]
    : "not_asked";
  const lastQuestion = QUESTION_KINDS.has(candidate.lastQuestion as NonNullable<JourneyDialogueState["lastQuestion"]>)
    ? candidate.lastQuestion as NonNullable<JourneyDialogueState["lastQuestion"]>
    : undefined;
  const pendingCommitment = COMMITMENTS.has(candidate.pendingCommitment as NonNullable<JourneyDialogueState["pendingCommitment"]>)
    ? candidate.pendingCommitment as NonNullable<JourneyDialogueState["pendingCommitment"]>
    : undefined;
  const latestSignal = DIALOGUE_SIGNALS.has(candidate.latestSignal as NonNullable<JourneyDialogueState["latestSignal"]>)
    ? candidate.latestSignal as NonNullable<JourneyDialogueState["latestSignal"]>
    : undefined;
  const latestIntent = JOURNEY_INTENTS.has(candidate.latestIntent as NonNullable<JourneyDialogueState["latestIntent"]>)
    ? candidate.latestIntent as NonNullable<JourneyDialogueState["latestIntent"]>
    : undefined;
  return {
    safetyStatus,
    ...(lastQuestion ? { lastQuestion } : {}),
    ...(pendingCommitment ? { pendingCommitment } : {}),
    ...(latestSignal ? { latestSignal } : {}),
    ...(latestIntent ? { latestIntent } : {}),
    ...(candidate.addressSent === true ? { addressSent: true } : {}),
    ...(candidate.professionalAdjustmentMentioned === true ? { professionalAdjustmentMentioned: true } : {}),
    ...(candidate.thermotherapyMentioned === true ? { thermotherapyMentioned: true } : {}),
  };
}

function safeRevision(value: unknown): number | undefined {
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof parsed === "number" && Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

/**
 * Converts an untrusted database row into the current state schema. Unknown JSON
 * values are discarded, and a future schema version is never interpreted as the
 * current one.
 */
export function deserializeConversationJourneyState(
  row: ConversationJourneyStateRow,
): ConversationJourneyState | undefined {
  const schemaVersion = safeRevision(row.schema_version);
  const revision = safeRevision(row.updated_from_revision);
  if (schemaVersion !== JOURNEY_STATE_SCHEMA_VERSION || revision === undefined
    || typeof row.stage !== "string" || !STAGES.has(row.stage as JourneyStage)) {
    return undefined;
  }
  const serviceFamily = SERVICE_FAMILIES.has(row.service_family as NonNullable<ConversationJourneyState["serviceFamily"]>)
    ? row.service_family as NonNullable<ConversationJourneyState["serviceFamily"]>
    : undefined;
  const selectedService = boundedText(row.selected_service, 120);
  const lastAction = ACTIONS.has(row.last_action as JourneyAction["type"])
    ? row.last_action as JourneyAction["type"]
    : undefined;
  return {
    schemaVersion,
    stage: row.stage as JourneyStage,
    goals: enumList(row.goals, GOALS),
    latestGoals: enumList(row.latest_goals, GOALS),
    ...(serviceFamily ? { serviceFamily } : {}),
    recommendedServices: recommendedServices(row.recommended_services),
    ...(selectedService ? { selectedService } : {}),
    factsSent: enumList(row.facts_sent, FACTS),
    offers: offers(row.offers),
    scheduling: scheduling(row.scheduling),
    dialogue: dialogue(row.dialogue),
    activePilates: row.active_pilates === true,
    ...(lastAction ? { lastAction } : {}),
    updatedFromRevision: revision,
  };
}

/** Serializes only the privacy-minimized structured state persisted by migration 0010. */
export function serializeConversationJourneyState(
  state: ConversationJourneyState,
): SerializedConversationJourneyState {
  const normalized = deserializeConversationJourneyState({
    schema_version: state.schemaVersion,
    stage: state.stage,
    goals: state.goals,
    latest_goals: state.latestGoals,
    service_family: state.serviceFamily ?? null,
    recommended_services: state.recommendedServices,
    selected_service: state.selectedService ?? null,
    facts_sent: state.factsSent,
    offers: state.offers,
    scheduling: state.scheduling,
    dialogue: state.dialogue,
    active_pilates: state.activePilates,
    last_action: state.lastAction ?? null,
    updated_from_revision: state.updatedFromRevision,
  });
  if (!normalized) throw new TypeError("Invalid conversation journey state");
  return {
    schemaVersion: normalized.schemaVersion,
    stage: normalized.stage,
    goalsJson: JSON.stringify(normalized.goals),
    latestGoalsJson: JSON.stringify(normalized.latestGoals),
    serviceFamily: normalized.serviceFamily ?? null,
    recommendedServicesJson: JSON.stringify(normalized.recommendedServices),
    selectedService: normalized.selectedService ?? null,
    factsSentJson: JSON.stringify(normalized.factsSent),
    offersJson: JSON.stringify(normalized.offers),
    schedulingJson: JSON.stringify(normalized.scheduling),
    dialogueJson: JSON.stringify(normalized.dialogue),
    activePilates: normalized.activePilates,
    lastAction: normalized.lastAction ?? null,
    updatedFromRevision: normalized.updatedFromRevision,
  };
}

/**
 * Handoff completion is deliberately stricter than an ordinary snapshot save:
 * the caller must provide the state after the delivered handoff outcome and for
 * the exact inbound revision whose lease is being completed.
 */
export function serializeCompletedJourneyHandoffState(
  state: ConversationJourneyState,
  revision: number,
  outboundRevision: number,
  outboundIdempotencyKey: string,
): SerializedConversationJourneyState {
  const serialized = serializeConversationJourneyState(state);
  if (serialized.updatedFromRevision !== revision
    || serialized.stage !== "human_handoff"
    || state.scheduling.status !== "handed_off"
    || !Number.isSafeInteger(outboundRevision)
    || outboundRevision < 1
    || outboundRevision > revision
    || !outboundIdempotencyKey.trim()
    || outboundIdempotencyKey !== outboundIdempotencyKey.trim()
    || outboundIdempotencyKey.length > 240
    || /[\u0000-\u001f\u007f]/.test(outboundIdempotencyKey)) {
    throw new TypeError("Journey handoff state is not complete for this revision");
  }
  return serialized;
}

/** Requires an ordinary turn snapshot to belong to the exact leased revision. */
export function serializeJourneyStateForRevision(
  state: ConversationJourneyState,
  revision: number,
): SerializedConversationJourneyState {
  const serialized = serializeConversationJourneyState(state);
  if (serialized.updatedFromRevision !== revision) {
    throw new TypeError("Journey state does not belong to this revision");
  }
  return serialized;
}
