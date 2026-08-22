import { randomUUID } from "node:crypto";

import { composeDeterministicReply } from "../ai/deterministic-reply-composer.ts";
import { repairAssistedReplyMessages } from "../ai/assisted-reply-repair.ts";
import { qualifyMassageServiceNames } from "../ai/massage-service-display.ts";
import type { WhatsAppReplyPlan } from "../ai/generate-whatsapp-reply.ts";
import { validateResponsePolicy } from "../ai/response-policy-validator.ts";
import { shouldLoadNextfitCatalogContext } from "../catalog/nextfit-catalog.ts";
import { buildCustomerContext, replaceConversationHistory, type CustomerContext } from "../customer-context/index.ts";
import { isPossiblePersonalAccountFollowUp } from "../customer-context/personal-intent.ts";
import { detectHandoffConsent, detectHandoffRequest, HANDOFF_ACKNOWLEDGEMENT,
  isPossibleHandoffConsent } from "../handoff/detection.ts";
import { buildHandoffSummary } from "../handoff/summary.ts";
import type { HandoffStore } from "../handoff/types.ts";
import type { WhatsAppProvider } from "../whatsapp/provider.ts";
import { startTypingPresence } from "../whatsapp/typing-presence.ts";
import { needsNextfitEnrichment } from "../nextfit/sync-customer.ts";
import {
  isExplicitSchedulingAuthorization,
  shouldHandoffSchedulingRequest,
} from "../nextfit/scheduling.ts";
import { hasActivePilates } from "../journey/customer-signals.ts";
import { extractJourneyGoals, extractSelectedService } from "../journey/extractors.ts";
import { journeyEngineMode, type JourneyEngineMode } from "../journey/mode.ts";
import { decideJourneyAction } from "../journey/policy.ts";
import { logProcessingEvent } from "../observability/safe-log.ts";
import {
  applyDeliveredJourneyOutcome,
  applySemanticJourneyEvidence,
  observeAssistantJourneyFacts,
  reduceJourneyState,
} from "../journey/reducer.ts";
import type {
  ConversationJourneyState,
  JourneyAction,
} from "../journey/types.ts";
import type { SemanticTurnInterpretation } from "../ai/semantic-turn-interpreter.ts";
import type { SemanticTurnPlan } from "../ai/semantic-turn-plan.ts";
import { validateSemanticTurnPlan } from "../ai/semantic-turn-plan.ts";
import { semanticPlannerMode, type SemanticPlannerMode } from "../ai/semantic-planner-mode.ts";
import { AUTOMATIC_CLOSURE_CONFIRMATION, buildSocialReply, hasAssistantGreetingAcknowledgement,
  isClosureConsent, prependGreetingAcknowledgement } from "./social-message.ts";
import { applyEpisodeBoundaryToHistory } from "./episode-boundary.ts";
import { applyResetToHistory, isExplicitResetMessage, planConversationTurn } from "./turn-planning.ts";
import type {
  ConversationIdentity,
  ConversationJourneyStateStore,
  ConversationMessage,
  ConversationTurnRepository,
} from "./types.ts";

export type TurnProcessingResult = "replied" | "suppressed" | "handoff_requested" | "stale"
  | "human_silent" | "busy" | "complete" | "not_due" | "missing";

export type JourneyTurnObservation = {
  conversationId: string;
  revision: number;
  mode: Exclude<JourneyEngineMode, "off">;
  candidateAction: JourneyAction["type"] | "none";
  deliveredAction: JourneyAction["type"] | "none";
  replySource: "social" | "model" | "deterministic_journey" | "legacy_handoff";
  validationIssues: string[];
  planningMs: number;
  totalMs: number;
  result: TurnProcessingResult;
};

type EnrichCustomer = (input: { identity: ConversationIdentity; phoneNumber: string; message: string }) => Promise<ConversationIdentity>;
type InterpretTurn = (input: { message: string }) => Promise<SemanticTurnInterpretation>;
type PlanSemanticTurn = (input: { currentTurn: string; history: readonly ConversationMessage[] }) => Promise<SemanticTurnPlan>;

export class EmptyTurnInvariantError extends Error {
  readonly conversationId: string;
  readonly revision: number;
  readonly processedRevision: number;

  constructor(input: { conversationId: string; revision: number; processedRevision: number }) {
    super("An acquired conversation revision has no persisted inbound messages");
    this.name = "EmptyTurnInvariantError";
    this.conversationId = input.conversationId;
    this.revision = input.revision;
    this.processedRevision = input.processedRevision;
  }
}

const GENERATION_FAILURE_REPLY =
  "Recebi sua mensagem, mas tive uma instabilidade para concluir a resposta. Já deixei tudo registrado para nossa equipe continuar por aqui sem você precisar repetir.";
const MODEL_POLICY_FALLBACK_REPLY =
  "Quero te responder com precisão. Vou encaminhar essa parte para a equipe continuar por aqui, sem você precisar repetir.";

function normalizeReplyBubble(message: string): string {
  return message
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1");
}

function replyBubbleDedupeKey(message: string): string {
  return normalizeReplyBubble(message).toLocaleLowerCase("pt-BR");
}

export function prepareReplyMessages(messages: string[], limit = 2): {
  messages: string[];
  duplicateCount: number;
} {
  const unique: string[] = [];
  const seen = new Set<string>();
  let duplicateCount = 0;

  for (const candidate of messages) {
    const message = normalizeReplyBubble(candidate);
    if (!message) continue;
    const key = replyBubbleDedupeKey(message);
    if (seen.has(key)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(key);
    unique.push(message);
    if (unique.length >= limit) break;
  }

  return { messages: unique, duplicateCount };
}

const BLOCKING_ASSISTED_POLICY_ISSUES = new Set([
  "empty",
  "too_many_bubbles",
  "bubble_too_long",
  "too_many_questions",
  "false_booking_confirmation",
  "hot_bath_before_pilates",
  "internal_language_leak",
  "deferred_value",
  "repeated_safety_screen",
  "repeated_professional_disclaimer",
  "address_permission_gate",
  "asks_known_schedule_field",
  "premature_optional_offer",
  "unverified_availability_claim",
]);

type JourneyCapableRepository = ConversationTurnRepository & HandoffStore & ConversationJourneyStateStore;

function isJourneyCapableRepository(
  repository: ConversationTurnRepository & HandoffStore,
): repository is JourneyCapableRepository {
  return typeof repository.getJourneyState === "function"
    && typeof repository.saveJourneyState === "function";
}

function composeJourneyReply(
  action: JourneyAction,
  options: { includeVisitorAddress?: boolean } = {},
): WhatsAppReplyPlan | undefined {
  if (action.type === "assisted") return undefined;
  if (action.type === "recommend_integrated_paths") {
    return composeDeterministicReply({
      kind: "integrated_recommendation",
      goal: action.goal,
      ...(options.includeVisitorAddress ? { includeAddress: true } : {}),
    });
  }
  if (action.type === "recommend_service") {
    return composeDeterministicReply({ kind: "service_recommendation", goal: action.goal });
  }
  if (action.type === "clarify_path_choice") {
    return composeDeterministicReply({ kind: "path_choice_clarification" });
  }
  if (action.type === "clarify_service_choice") {
    return composeDeterministicReply({ kind: "service_choice_clarification" });
  }
  if (action.type === "present_selected_service") {
    return composeDeterministicReply({
      kind: "selected_service",
      service: action.service,
      includePrice: action.includePrice,
      includeDuration: action.includeDuration,
      offerHotBath: action.offerHotBath,
      activePilates: action.activePilates,
      ...(action.nextQuestion ? { nextQuestion: action.nextQuestion } : {}),
    });
  }
  if (action.type === "ask_schedule") {
    return composeDeterministicReply({
      kind: "schedule_question",
      ...(action.service ? { service: action.service } : {}),
      missing: action.missing,
    });
  }
  return composeDeterministicReply({
    kind: "schedule_handoff",
    service: action.service,
    day: action.day,
    time: action.time,
    includePrice: action.includePrice,
    includeDuration: action.includeDuration,
    offerHotBath: action.offerHotBath,
    activePilates: action.activePilates,
    ...(action.hotBathAccepted ? { hotBathAccepted: true } : {}),
  });
}

function composeResetReply(firstName?: string): WhatsAppReplyPlan {
  const acknowledgement = firstName ? `Fechado, ${firstName}.` : "Fechado.";
  return {
    messages: [`${acknowledgement} Vamos do zero: o que está te incomodando ou o que você busca hoje?`],
    answeredTopics: ["conversation_reset"],
    needsClarification: true,
    handoffRecommended: false,
    generationMode: "deterministic_journey",
  };
}

async function saveJourneyState(
  repository: JourneyCapableRepository,
  conversationId: string,
  state: ConversationJourneyState,
): Promise<void> {
  try {
    const result = await repository.saveJourneyState({
      conversationId,
      state,
    });
    void result;
  } catch (error) {
    console.warn("Conversation journey state persistence failed", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

async function loadJourneyState(
  repository: JourneyCapableRepository | undefined,
  conversationId: string,
): Promise<ConversationJourneyState | undefined> {
  if (!repository) return undefined;
  try {
    return await repository.getJourneyState(conversationId);
  } catch (error) {
    console.warn("Conversation journey state load failed", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
    return undefined;
  }
}

function normalizedScheduleEvidence(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function matchingDeliveredScheduleSummary(
  messages: readonly ConversationMessage[],
  action: Extract<JourneyAction, { type: "schedule_handoff" }>,
): ConversationMessage | undefined {
  const service = normalizedScheduleEvidence(action.service);
  const day = normalizedScheduleEvidence(action.day);
  return [...messages].reverse().find((message) => {
    if (message.role !== "assistant" || message.responseRevision === undefined) return false;
    const text = normalizedScheduleEvidence(message.content);
    return text.includes(service)
      && text.includes(day)
      && text.includes(action.time)
      && text.includes("confirmar a disponibilidade")
      && text.includes("so fica reservado depois");
  });
}

async function emitJourneyObservation(
  observer: ((observation: JourneyTurnObservation) => Promise<void> | void) | undefined,
  observation: JourneyTurnObservation,
): Promise<void> {
  if (!observer) return;
  try {
    await observer(observation);
  } catch (error) {
    console.warn("Conversation journey observation failed", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

export async function processConversationTurn(input: {
  conversationId: string;
  observedRevision: number;
  repository: ConversationTurnRepository & HandoffStore;
  provider: WhatsAppProvider;
  generateReply: (input: { message: string; context: CustomerContext; repairRequested?: boolean;
    currentTurnMessageIds?: readonly string[]; semanticPlan?: SemanticTurnPlan }) => Promise<WhatsAppReplyPlan>;
  enrichCustomer?: EnrichCustomer;
  interpretTurn?: InterpretTurn;
  planSemanticTurn?: PlanSemanticTurn;
  notifyHandoff?: (input: { conversationId: string; firstName?: string; reason: string; summary: string;
    idempotencyKey: string; accountId: string }) => Promise<void>;
  preSendGraceMs?: number;
  journeyMode?: JourneyEngineMode;
  semanticPlannerMode?: SemanticPlannerMode;
  agentOwnsConversation?: boolean;
  observeJourney?: (observation: JourneyTurnObservation) => Promise<void> | void;
}): Promise<TurnProcessingResult> {
  const processingStartedAt = Date.now();
  const resolvedJourneyMode = input.journeyMode ?? journeyEngineMode();
  const resolvedSemanticPlannerMode = input.semanticPlannerMode ?? semanticPlannerMode();
  const journeyRepository = resolvedJourneyMode !== "off" && isJourneyCapableRepository(input.repository)
    ? input.repository
    : undefined;
  const activeJourney = resolvedJourneyMode === "active" && Boolean(journeyRepository);
  const token = randomUUID();
  const acquisition = await input.repository.acquireTurn({ conversationId: input.conversationId,
    observedRevision: input.observedRevision, token, leaseSeconds: 60 });
  if (acquisition.kind !== "acquired") {
    if (acquisition.kind === "human") return "human_silent";
    return acquisition.kind;
  }
  const { turn } = acquisition;
  const plan = planConversationTurn(turn.messages);
  const socialKind = input.agentOwnsConversation ? undefined : plan.socialKind;
  if (!plan.messages.length) {
    await input.repository.releaseTurn({ conversationId: turn.conversationId, token, state: "failed" });
    throw new EmptyTurnInvariantError({ conversationId: turn.conversationId,
      revision: turn.revision, processedRevision: turn.processedRevision });
  }
  if (plan.suppressReply) {
    const completed = await input.repository.completeTurn({ conversationId: turn.conversationId,
      revision: turn.revision, token, state: "suppressed",
      analysis: { inboundCount: plan.messages.length, suppressReply: true, reason: "customer_cancelled" } });
    return completed ? "suppressed" : "stale";
  }

  const rawTurnText = plan.messages.map((message) => message.content).join(" ");
  // Start this independent read before any optional Nextfit enrichment and
  // reuse it in the scheduling fast path and the ordinary journey planner.
  const journeyStatePromise = socialKind
    ? Promise.resolve(undefined)
    : loadJourneyState(journeyRepository, turn.conversationId);
  let earlyShadowObservation: {
    candidateAction: JourneyAction["type"];
    validationIssues: string[];
    planningMs: number;
  } | undefined;
  let handoff = detectHandoffRequest(rawTurnText);
  let handoffHistory: ConversationMessage[] | undefined;
  if (!input.agentOwnsConversation && !handoff && isExplicitSchedulingAuthorization(rawTurnText)) {
    const schedulingHistory = await input.repository.getRecentMessages(turn.conversationId, 20);
    const currentIds = new Set(plan.messages.map((message) => message.id));
    const schedulingEpisode = applyEpisodeBoundaryToHistory({
      history: schedulingHistory,
      currentTurn: plan.messages,
    });
    const activeSchedulingHistory = applyResetToHistory(
      schedulingEpisode.messages,
      plan.resetRequested,
    );
    const previousUserMessages = activeSchedulingHistory
      .filter((message) => message.role === "user" && !currentIds.has(message.id))
      .map((message) => message.content);
    if (shouldHandoffSchedulingRequest(rawTurnText, previousUserMessages)) {
      const persistedJourneyState = await journeyStatePromise;
      if (resolvedJourneyMode === "shadow" && journeyRepository) {
        const planningStartedAt = Date.now();
        const priorAssistantMessages = activeSchedulingHistory
          .filter((message) => message.role === "assistant")
          .map((message) => message.content);
        const persistedStateIsCurrent = persistedJourneyState
          && persistedJourneyState.updatedFromRevision >= turn.processedRevision;
        let observedState = persistedStateIsCurrent
          ? persistedJourneyState
          : reduceJourneyState(undefined, {
            messages: previousUserMessages,
            revision: Math.min(turn.processedRevision, turn.revision),
            activePilates: persistedJourneyState?.activePilates ?? false,
          });
        observedState = observeAssistantJourneyFacts(observedState, priorAssistantMessages);
        observedState = reduceJourneyState(observedState, {
          messages: plan.messages.map((message) => message.content),
          revision: turn.revision,
          activePilates: observedState.activePilates,
        });
        const decision = decideJourneyAction(observedState);
        const candidate = composeJourneyReply(decision.action);
        const validation = candidate
          ? validateResponsePolicy({ messages: candidate.messages, previousAssistantMessages: priorAssistantMessages })
          : { issues: [] };
        earlyShadowObservation = {
          candidateAction: decision.action.type,
          validationIssues: validation.issues.map((issue) => issue.code),
          planningMs: Date.now() - planningStartedAt,
        };
      }
      const journeyCanSummarizeSchedule = activeJourney && Boolean(
        persistedJourneyState?.selectedService
        || activeSchedulingHistory
          .filter((message) => message.role === "user")
          .some((message) => Boolean(extractSelectedService(message.content))),
      );
      if (!journeyCanSummarizeSchedule) {
        handoff = {
          reason: "Cliente autorizou encaminhar um pedido de agendamento com serviço, dia e horário informados.",
          source: "customer",
        };
        handoffHistory = schedulingHistory;
      }
    }
  }
  if (!handoff && isPossibleHandoffConsent(rawTurnText)) {
    handoffHistory = await input.repository.getRecentMessages(turn.conversationId, 12);
    const currentIds = new Set(plan.messages.map((message) => message.id));
    const immediatelyPrevious = handoffHistory
      .filter((message) => !currentIds.has(message.id))
      .at(-1);
    const firstCurrentAt = plan.messages[0]?.createdAt.getTime() ?? 0;
    const followsRecentAssistant = immediatelyPrevious?.role === "assistant"
      && firstCurrentAt >= immediatelyPrevious.createdAt.getTime()
      && firstCurrentAt - immediatelyPrevious.createdAt.getTime() <= 30 * 60_000;
    handoff = detectHandoffConsent(rawTurnText,
      followsRecentAssistant ? immediatelyPrevious.content : undefined);
  }
  if (handoff) {
    const history = handoffHistory
      ?? await input.repository.getRecentMessages(turn.conversationId, 12);
    const summary = buildHandoffSummary(history, handoff.reason);
    const idempotencyKey = `zernio-handoff-${turn.conversationId}-${turn.revision}`;
    try {
      // Acknowledge before switching to human mode. A provider failure keeps
      // the active turn retryable instead of creating a silent handoff.
      const reservation = await input.repository.reserveOutbound({
        conversationId: turn.conversationId,
        revision: turn.revision,
        token,
        bubbleIndex: 0,
        content: HANDOFF_ACKNOWLEDGEMENT,
        idempotencyKey,
      });
      if (reservation === "stale") {
        await input.repository.releaseTurn({ conversationId: turn.conversationId, token, state: "stale" });
        return "stale";
      }
      if (reservation === "reserved") {
        try {
          await input.provider.sendText({ accountId: turn.accountId,
            conversationId: turn.providerConversationId,
            idempotencyKey, text: HANDOFF_ACKNOWLEDGEMENT });
          await input.repository.markOutboundSent({ idempotencyKey });
        } catch (error) {
          await input.repository.markOutboundFailed({ idempotencyKey });
          throw error;
        }
      }
      await input.repository.requestHandoff({ conversationId: turn.conversationId,
        providerAccountId: turn.accountId, providerConversationId: turn.providerConversationId,
        reason: handoff.reason, source: handoff.source, summary });
    } catch (error) {
      await input.repository.releaseTurn({ conversationId: turn.conversationId, token, state: "failed" });
      throw error;
    }
    if (input.notifyHandoff) {
      try {
        await input.notifyHandoff({ conversationId: turn.conversationId,
          firstName: turn.identity.firstName, reason: handoff.reason, summary,
          idempotencyKey: `handoff-notification-${turn.conversationId}-${turn.revision}`,
          accountId: turn.accountId });
      } catch (error) {
        console.warn("Handoff notification failed", {
          error: error instanceof Error ? error.name : "UnknownError",
        });
      }
    }
    if (earlyShadowObservation) {
      await emitJourneyObservation(input.observeJourney, {
        conversationId: turn.conversationId,
        revision: turn.revision,
        mode: "shadow",
        candidateAction: earlyShadowObservation.candidateAction,
        deliveredAction: "none",
        replySource: "legacy_handoff",
        validationIssues: earlyShadowObservation.validationIssues,
        planningMs: earlyShadowObservation.planningMs,
        totalMs: Date.now() - processingStartedAt,
        result: "handoff_requested",
      });
    }
    return "handoff_requested";
  }

  const typingPresence = startTypingPresence({
    provider: input.provider,
    accountId: turn.accountId,
    conversationId: turn.providerConversationId,
    onFailure: (error) => {
      console.warn("WhatsApp typing indicator failed", {
        error: error instanceof Error ? error.name : "UnknownError",
      });
    },
  });

  try {
    let identity = turn.identity;
    let semanticInterpretation: SemanticTurnInterpretation | undefined;
    let previousUserMessage: string | undefined;
    if (input.enrichCustomer && !socialKind && !plan.resetRequested
      && !needsNextfitEnrichment(rawTurnText)
      && isPossiblePersonalAccountFollowUp(rawTurnText)) {
      const currentIds = new Set(plan.messages.map((message) => message.id));
      const previous = (await input.repository.getRecentMessages(turn.conversationId, 20))
        .filter((message) => message.role === "user" && !currentIds.has(message.id))
        .at(-1);
      const firstCurrentAt = plan.messages[0]?.createdAt.getTime() ?? 0;
      if (previous && firstCurrentAt >= previous.createdAt.getTime()
        && firstCurrentAt - previous.createdAt.getTime() <= 30 * 60_000) {
        previousUserMessage = previous.content;
      }
    }
    if (input.enrichCustomer && !socialKind
      && (needsNextfitEnrichment(rawTurnText, previousUserMessage)
        || (identity.relationshipStatus === "unknown"
          && extractJourneyGoals(rawTurnText).length > 0))) {
      try {
        identity = await input.enrichCustomer({ identity, phoneNumber: turn.phoneNumber,
          message: rawTurnText });
      } catch (error) {
        console.warn("Customer enrichment failed", { error: error instanceof Error ? error.name : "UnknownError" });
      }
    }
    const [baseContext, persistedJourneyState] = await Promise.all([
      socialKind
        ? Promise.resolve<CustomerContext>({
          identity: {
            relationshipStatus: identity.relationshipStatus,
            ...(identity.firstName ? { firstName: identity.firstName } : {}),
          },
          conversation: { recentMessages: plan.messages },
          customer: {},
        })
        : buildCustomerContext(input.repository, identity, 20),
      journeyStatePromise,
    ]);
    let context = baseContext;
    const episode = applyEpisodeBoundaryToHistory({
      history: context.conversation.recentMessages,
      currentTurn: plan.messages,
    });
    context = replaceConversationHistory(context,
      applyResetToHistory(episode.messages, plan.resetRequested));
    const activeMessages = context.conversation.recentMessages;
    const currentIds = new Set(plan.messages.map((message) => message.id));
    const priorAssistantMessageRecords = activeMessages
      .filter((message) => message.role === "assistant");
    const priorAssistantMessages = priorAssistantMessageRecords.map((message) => message.content);
    const previousMessage = activeMessages.filter((message) => !currentIds.has(message.id)).at(-1);
    const closureConsent = !input.agentOwnsConversation && previousMessage?.role === "assistant"
      && isClosureConsent(rawTurnText, previousMessage.content);
    let generationFailed = false;
    let responsePlan: WhatsAppReplyPlan | undefined;
    let journeyStateBeforeDelivery: ConversationJourneyState | undefined;
    let candidateJourneyAction: JourneyAction | undefined;
    let deliveredJourneyAction: JourneyAction | undefined;
    let journeyValidationIssues: string[] = [];
    let replySource: "social" | "model" | "deterministic_journey" = "model";
    let journeyPlanningMs: number | undefined;
    let previouslyDeliveredScheduleSummary: ConversationMessage | undefined;
    let semanticPlan: SemanticTurnPlan | undefined;
    let semanticPlanIssues: string[] = [];

    if (!socialKind && input.planSemanticTurn && resolvedSemanticPlannerMode !== "off") {
      try {
        semanticPlan = await input.planSemanticTurn({
          currentTurn: plan.consolidatedMessage,
          history: activeMessages.filter((message) => !currentIds.has(message.id)),
        });
        semanticPlanIssues = validateSemanticTurnPlan(semanticPlan);
        if (semanticPlanIssues.length > 0) semanticPlan = undefined;
      } catch (error) {
        console.warn("Semantic turn planning failed", {
          error: error instanceof Error ? error.name : "UnknownError",
        });
      }
    }
    const semanticPlannerControlsReply = resolvedSemanticPlannerMode === "active" && Boolean(semanticPlan);

    if (journeyRepository && !socialKind) {
      const planningStartedAt = Date.now();
      const priorUserMessages = activeMessages
        .filter((message) => message.role === "user" && !currentIds.has(message.id))
        .map((message) => message.content);
      const boundaryMessageId = episode.boundary.startsNewEpisode
        ? episode.boundary.boundaryMessageId
        : undefined;
      const boundaryRevision = boundaryMessageId
        ? activeMessages.find((message) => message.id === boundaryMessageId)?.inputRevision
        : undefined;
      const persistedStateAlreadyIncludesBoundary = Boolean(
        persistedJourneyState
        && boundaryRevision
        && persistedJourneyState.updatedFromRevision >= boundaryRevision,
      );
      const mustStartFresh = plan.resetRequested
        || (episode.boundary.startsNewEpisode && !persistedStateAlreadyIncludesBoundary);
      // A snapshot behind processed_revision means an older deployment may
      // have completed the turn before saving its state. Rebuild that bounded
      // history instead of trusting the stale snapshot and losing selections.
      const persistedStateIsCurrent = persistedJourneyState
        && persistedJourneyState.updatedFromRevision >= turn.processedRevision;
      let observedState = !mustStartFresh && persistedStateIsCurrent
        ? persistedJourneyState
        : undefined;
      if (!observedState) {
        observedState = reduceJourneyState(undefined, {
          messages: priorUserMessages,
          revision: Math.min(turn.processedRevision, turn.revision),
          activePilates: hasActivePilates(context.customer),
        });
      }
      observedState = observeAssistantJourneyFacts(observedState, priorAssistantMessages);
      observedState = reduceJourneyState(observedState, {
        messages: plan.messages.map((message) => message.content),
        revision: turn.revision,
        activePilates: hasActivePilates(context.customer),
      });
      let decision = decideJourneyAction(observedState);
      const semanticMessages = plan.messages
        .filter((message) => !isExplicitResetMessage(message.content));
      const semanticTurnText = semanticMessages
        .map((message, index) => `Mensagem ${index + 1}: ${message.content.trim()}`)
        .join("\n");
      const resetOnly = plan.resetRequested && semanticMessages.length === 0;
      if (decision.action.type === "assisted" && input.interpretTurn && semanticTurnText
        && !semanticPlannerControlsReply
        && observedState.dialogue.latestIntent !== "service_question"
        && !needsNextfitEnrichment(semanticTurnText)
        && !shouldLoadNextfitCatalogContext(semanticTurnText)) {
        try {
          semanticInterpretation = await input.interpretTurn({ message: semanticTurnText });
          observedState = applySemanticJourneyEvidence(observedState, semanticInterpretation);
          decision = decideJourneyAction(observedState);
          if (semanticInterpretation.goals.length > 0
            && identity.relationshipStatus === "unknown" && input.enrichCustomer) {
            try {
              identity = await input.enrichCustomer({
                identity,
                phoneNumber: turn.phoneNumber,
                message: semanticTurnText,
              });
              context = {
                ...context,
                identity: {
                  relationshipStatus: identity.relationshipStatus,
                  ...(identity.firstName ? { firstName: identity.firstName } : {}),
                },
              };
            } catch (error) {
              console.warn("Customer enrichment failed", {
                error: error instanceof Error ? error.name : "UnknownError",
              });
            }
          }
        } catch (error) {
          // A failed semantic enhancement must never silence the existing
          // grounded generator or expose provider details to the customer.
          console.warn("Semantic turn interpretation failed", {
            error: error instanceof Error ? error.name : "UnknownError",
          });
        }
      }
      journeyStateBeforeDelivery = observedState;
      candidateJourneyAction = decision.action;
      const candidateReply = resetOnly
        ? composeResetReply(context.identity.firstName)
        : composeJourneyReply(decision.action, {
          includeVisitorAddress: context.identity.relationshipStatus !== "customer"
            && !observedState.dialogue.addressSent,
        });
      if (candidateReply) {
        const validation = validateResponsePolicy({
          messages: candidateReply.messages,
          previousAssistantMessages: priorAssistantMessages,
        });
        journeyValidationIssues = validation.issues.map((issue) => issue.code);
        if (activeJourney && (resetOnly || !semanticPlannerControlsReply) && validation.valid) {
          responsePlan = candidateReply;
          deliveredJourneyAction = resetOnly
            ? { type: "assisted", reason: "Reinício conversacional confirmado." }
            : decision.action;
          replySource = "deterministic_journey";
          if (decision.action.type === "schedule_handoff") {
            previouslyDeliveredScheduleSummary = matchingDeliveredScheduleSummary(
              priorAssistantMessageRecords,
              decision.action,
            );
          }
        }
      }
      journeyPlanningMs = Date.now() - planningStartedAt;
    }

    if (closureConsent) {
      responsePlan = { messages: [AUTOMATIC_CLOSURE_CONFIRMATION],
        answeredTopics: ["closure_consent"], needsClarification: false, handoffRecommended: false };
      replySource = "social";
    } else if (socialKind) {
      responsePlan = { messages: [buildSocialReply(socialKind, context.identity.firstName, plan.greeting)],
        answeredTopics: [socialKind], needsClarification: false, handoffRecommended: false };
      replySource = "social";
    } else if (!responsePlan) {
      try {
        responsePlan = await input.generateReply({ message: plan.consolidatedMessage, context,
          repairRequested: plan.repairRequested,
          currentTurnMessageIds: plan.messages.map((message) => message.id),
          ...(semanticPlannerControlsReply && semanticPlan ? { semanticPlan } : {}) });
        if (journeyRepository) {
          if (journeyStateBeforeDelivery) {
            responsePlan = {
              ...responsePlan,
              messages: repairAssistedReplyMessages({
                messages: responsePlan.messages,
                safetyStatus: journeyStateBeforeDelivery.dialogue.safetyStatus,
                professionalAdjustmentMentioned: Boolean(
                  journeyStateBeforeDelivery.dialogue.professionalAdjustmentMentioned,
                ),
                includeVisitorAddress: context.identity.relationshipStatus !== "customer",
                addressSent: Boolean(journeyStateBeforeDelivery.dialogue.addressSent),
              }),
            };
          }
          const assistedValidation = validateResponsePolicy({
            messages: responsePlan.messages,
            previousAssistantMessages: priorAssistantMessages,
            ...(semanticPlan ? { semanticPlan } : {}),
            safetyStatus: journeyStateBeforeDelivery?.dialogue.safetyStatus,
            professionalAdjustmentMentioned: Boolean(
              journeyStateBeforeDelivery?.dialogue.professionalAdjustmentMentioned,
            ),
          });
          journeyValidationIssues = [...new Set([
            ...journeyValidationIssues,
            ...assistedValidation.issues.map((issue) => issue.code),
          ])];
          if (assistedValidation.issues.some((issue) => BLOCKING_ASSISTED_POLICY_ISSUES.has(issue.code))) {
            responsePlan = {
              messages: [MODEL_POLICY_FALLBACK_REPLY],
              answeredTopics: [],
              needsClarification: false,
              handoffRecommended: true,
              handoffValidated: true,
            };
          }
        }
        deliveredJourneyAction = journeyStateBeforeDelivery
          ? { type: "assisted", reason: "Resposta entregue pelo gerador assistido." }
          : undefined;
      } catch (error) {
        generationFailed = true;
        console.warn("WhatsApp reply generation exhausted fallbacks", {
          error: error instanceof Error ? error.name : "UnknownError",
        });
        responsePlan = {
          messages: [GENERATION_FAILURE_REPLY],
          answeredTopics: [],
          needsClarification: false,
          handoffRecommended: true,
        };
        deliveredJourneyAction = journeyStateBeforeDelivery
          ? { type: "assisted", reason: "Falha do gerador assistido." }
          : undefined;
      }
    }
    if (!responsePlan) throw new Error("Missing response plan");
    if (!socialKind && !input.agentOwnsConversation && plan.greeting
      && !hasAssistantGreetingAcknowledgement(priorAssistantMessages)) {
      responsePlan = {
        ...responsePlan,
        messages: responsePlan.messages.map((message, index) => index === 0
          ? prependGreetingAcknowledgement(message, plan.greeting)
          : message),
      };
    }
    const preparedMessages = prepareReplyMessages(responsePlan.messages);
    const messages = preparedMessages.messages.map(qualifyMassageServiceNames);
    if (preparedMessages.duplicateCount > 0) {
      logProcessingEvent("info", {
        event: "Duplicate AI reply bubble dropped",
        conversationId: turn.conversationId,
        result: `revision:${turn.revision};duplicates:${preparedMessages.duplicateCount}`,
      });
    }
    if (!messages.length) throw new Error("Empty response plan");
    if ((input.preSendGraceMs ?? 0) > 0) {
      await new Promise((resolve) => setTimeout(resolve, input.preSendGraceMs));
    }
    typingPresence.stop();
    const responseWasAlreadyDelivered = Boolean(previouslyDeliveredScheduleSummary);
    if (!responseWasAlreadyDelivered) {
      for (const [bubbleIndex, text] of messages.entries()) {
        const idempotencyKey = `zernio-turn-${turn.conversationId}-${turn.revision}-${bubbleIndex}`;
        const reservation = await input.repository.reserveOutbound({ conversationId: turn.conversationId,
          revision: turn.revision, token, bubbleIndex, content: text, idempotencyKey });
        if (reservation === "stale") {
          await input.repository.releaseTurn({ conversationId: turn.conversationId, token, state: "stale" });
          return "stale";
        }
        if (reservation === "reserved") {
          try {
            await input.provider.sendText({ accountId: turn.accountId, conversationId: turn.providerConversationId,
              idempotencyKey, text });
            await input.repository.markOutboundSent({ idempotencyKey });
          } catch (error) {
            await input.repository.markOutboundFailed({ idempotencyKey });
            throw error;
          }
        }
        // A newer inbound revision makes the next reservation stale. The next
        // turn sees the bubble already sent and answers only what remains.
      }
    }
    const deliveredMessages = previouslyDeliveredScheduleSummary
      ? [previouslyDeliveredScheduleSummary.content]
      : messages;
    const deliveredJourneyState = journeyStateBeforeDelivery && deliveredJourneyAction
      ? applyDeliveredJourneyOutcome(journeyStateBeforeDelivery, {
        action: deliveredJourneyAction,
        messages: deliveredMessages,
      })
      : undefined;
    const analysis = {
      inboundCount: plan.messages.length,
      repairRequested: plan.repairRequested,
      resetRequested: plan.resetRequested,
      socialKind: socialKind ?? null,
      semanticInterpretation: semanticInterpretation ? {
        intent: semanticInterpretation.intent,
        goals: semanticInterpretation.goals,
        serviceFamily: semanticInterpretation.serviceFamily ?? null,
        confidence: semanticInterpretation.confidence,
      } : null,
      semanticPlan: semanticPlan ? {
        mode: resolvedSemanticPlannerMode,
        primaryIntent: semanticPlan.primaryIntent,
        conversationAct: semanticPlan.conversationAct,
        nextAction: semanticPlan.nextAction,
        serviceFamily: semanticPlan.requestedService?.family ?? null,
        hasDay: Boolean(semanticPlan.scheduling.dayText),
        hasTime: Boolean(semanticPlan.scheduling.time),
        optionalOfferAppropriate: semanticPlan.optionalOffer?.appropriateNow ?? false,
        confidence: semanticPlan.confidence,
      } : null,
      semanticPlanIssues,
      episodeBoundary: episode.boundary.startsNewEpisode ? episode.boundary.reason : null,
      ...(journeyRepository ? {
        journey: {
          mode: resolvedJourneyMode,
          candidateAction: candidateJourneyAction?.type ?? "none",
          deliveredAction: deliveredJourneyAction?.type ?? "none",
          replySource,
          generationMode: responsePlan.generationMode ?? replySource,
          validationIssues: journeyValidationIssues,
          planningMs: journeyPlanningMs ?? 0,
          previousStateRevision: persistedJourneyState?.updatedFromRevision ?? null,
        },
      } : {}),
    };
    const observeJourneyResult = async (result: TurnProcessingResult) => {
      if (!journeyRepository) return;
      await emitJourneyObservation(input.observeJourney, {
        conversationId: turn.conversationId,
        revision: turn.revision,
        mode: resolvedJourneyMode === "active" ? "active" : "shadow",
        candidateAction: candidateJourneyAction?.type ?? "none",
        deliveredAction: deliveredJourneyAction?.type ?? "none",
        replySource,
        validationIssues: journeyValidationIssues,
        planningMs: journeyPlanningMs ?? 0,
        totalMs: Date.now() - processingStartedAt,
        result,
      });
    };
    if (replySource === "deterministic_journey"
      && deliveredJourneyAction?.type === "schedule_handoff"
      && deliveredJourneyState
      && journeyRepository) {
      const reason = "Cliente informou serviço, dia e horário para a equipe confirmar a disponibilidade.";
      const history = await input.repository.getRecentMessages(turn.conversationId, 12);
      const summary = buildHandoffSummary(history, reason);
      const handedOffJourneyState = applyDeliveredJourneyOutcome(deliveredJourneyState, {
        action: deliveredJourneyAction,
        messages: deliveredMessages,
        handoffCompleted: true,
      });
      const outboundRevision = previouslyDeliveredScheduleSummary?.responseRevision ?? turn.revision;
      const outboundIdempotencyKey = `zernio-turn-${turn.conversationId}-${outboundRevision}-0`;
      let completed = true;
      if (journeyRepository.completeJourneyHandoff) {
        completed = await journeyRepository.completeJourneyHandoff({
          conversationId: turn.conversationId,
          revision: turn.revision,
          token,
          outboundRevision,
          outboundIdempotencyKey,
          providerAccountId: turn.accountId,
          providerConversationId: turn.providerConversationId,
          reason,
          source: "customer",
          summary,
          journeyState: handedOffJourneyState,
          analysis,
          responsePlan,
        });
      } else {
        await input.repository.requestHandoff({
          conversationId: turn.conversationId,
          providerAccountId: turn.accountId,
          providerConversationId: turn.providerConversationId,
          reason,
          source: "customer",
          summary,
        });
        await saveJourneyState(journeyRepository, turn.conversationId, handedOffJourneyState);
      }
      if (!completed) {
        await input.repository.releaseTurn({
          conversationId: turn.conversationId,
          token,
          state: "stale",
        });
        await observeJourneyResult("stale");
        return "stale";
      }
      if (input.notifyHandoff) {
        try {
          await input.notifyHandoff({
            conversationId: turn.conversationId,
            firstName: identity.firstName,
            reason,
            summary,
            idempotencyKey: `journey-schedule-handoff-${turn.conversationId}-${turn.revision}`,
            accountId: turn.accountId,
          });
        } catch (error) {
          console.warn("Handoff notification failed", {
            error: error instanceof Error ? error.name : "UnknownError",
          });
        }
      }
      await observeJourneyResult("handoff_requested");
      return "handoff_requested";
    }
    const locallyValidatedHandoff = responsePlan.handoffRecommended
      && responsePlan.handoffValidated === true;
    if (generationFailed || locallyValidatedHandoff) {
      const reason = generationFailed
        ? "O atendimento automático encontrou uma instabilidade ao preparar a resposta."
        : responsePlan.operationalAction?.type === "request_schedule_confirmation"
          ? `Cliente autorizou a equipe a verificar ${responsePlan.operationalAction.service}, ${responsePlan.operationalAction.day}, ${responsePlan.operationalAction.time} na agenda oficial.`
          : "Uma parte do pedido precisa de continuidade com a equipe.";
      const history = await input.repository.getRecentMessages(turn.conversationId, 12);
      const summary = buildHandoffSummary(history, reason);
      await input.repository.requestHandoff({ conversationId: turn.conversationId,
        providerAccountId: turn.accountId, providerConversationId: turn.providerConversationId,
        reason, source: generationFailed
          ? "system_failure"
          : responsePlan.operationalAction?.type === "request_schedule_confirmation"
            ? "customer"
            : "safety_rule",
        summary });
      if (input.notifyHandoff) {
        try {
          await input.notifyHandoff({ conversationId: turn.conversationId,
            firstName: identity.firstName, reason, summary,
            idempotencyKey: `handoff-recommendation-${turn.conversationId}-${turn.revision}`,
            accountId: turn.accountId });
        } catch (error) {
          console.warn("Handoff notification failed", {
            error: error instanceof Error ? error.name : "UnknownError",
          });
        }
      }
      await observeJourneyResult("handoff_requested");
      return "handoff_requested";
    }
    const completed = closureConsent && input.repository.completeAutomaticClosure
      ? await input.repository.completeAutomaticClosure({ conversationId: turn.conversationId,
        revision: turn.revision, token, reasonId: "customer_satisfied", analysis, responsePlan })
      : journeyRepository?.completeTurnWithJourneyState && deliveredJourneyState
      ? await journeyRepository.completeTurnWithJourneyState({
        conversationId: turn.conversationId,
        revision: turn.revision,
        token,
        journeyState: deliveredJourneyState,
        analysis,
        responsePlan,
      })
      : await input.repository.completeTurn({ conversationId: turn.conversationId,
        revision: turn.revision, token, state: "replied",
        analysis, responsePlan });
    if (completed && journeyRepository && deliveredJourneyState
      && !journeyRepository.completeTurnWithJourneyState) {
      await saveJourneyState(journeyRepository, turn.conversationId, deliveredJourneyState);
    }
    const result = completed ? "replied" : "stale";
    await observeJourneyResult(result);
    return result;
  } catch (error) {
    typingPresence.stop();
    await input.repository.releaseTurn({ conversationId: turn.conversationId, token, state: "failed" });
    throw error;
  }
}
