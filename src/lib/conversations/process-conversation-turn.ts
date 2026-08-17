import { randomUUID } from "node:crypto";

import type { WhatsAppReplyPlan } from "../ai/generate-whatsapp-reply.ts";
import { buildCustomerContext, replaceConversationHistory, type CustomerContext } from "../customer-context/index.ts";
import { isPossiblePersonalAccountFollowUp } from "../customer-context/personal-intent.ts";
import { detectHandoffConsent, detectHandoffRequest, HANDOFF_ACKNOWLEDGEMENT,
  isPossibleHandoffConsent } from "../handoff/detection.ts";
import { buildHandoffSummary } from "../handoff/summary.ts";
import type { HandoffStore } from "../handoff/types.ts";
import type { WhatsAppProvider } from "../whatsapp/provider.ts";
import { needsNextfitEnrichment } from "../nextfit/sync-customer.ts";
import { buildSocialReply } from "./social-message.ts";
import { applyEpisodeBoundaryToHistory } from "./episode-boundary.ts";
import { applyResetToHistory, planConversationTurn } from "./turn-planning.ts";
import type { ConversationIdentity, ConversationMessage, ConversationTurnRepository } from "./types.ts";

export type TurnProcessingResult = "replied" | "suppressed" | "handoff_requested" | "stale"
  | "human_silent" | "busy" | "complete" | "not_due" | "missing";

type EnrichCustomer = (input: { identity: ConversationIdentity; phoneNumber: string; message: string }) => Promise<ConversationIdentity>;

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

export async function processConversationTurn(input: {
  conversationId: string;
  observedRevision: number;
  repository: ConversationTurnRepository & HandoffStore;
  provider: WhatsAppProvider;
  generateReply: (input: { message: string; context: CustomerContext; repairRequested?: boolean;
    currentTurnMessageIds?: readonly string[] }) => Promise<WhatsAppReplyPlan>;
  enrichCustomer?: EnrichCustomer;
  notifyHandoff?: (input: { conversationId: string; firstName?: string; reason: string; summary: string;
    idempotencyKey: string; accountId: string }) => Promise<void>;
  preSendGraceMs?: number;
}): Promise<TurnProcessingResult> {
  const token = randomUUID();
  const acquisition = await input.repository.acquireTurn({ conversationId: input.conversationId,
    observedRevision: input.observedRevision, token, leaseSeconds: 60 });
  if (acquisition.kind !== "acquired") {
    if (acquisition.kind === "human") return "human_silent";
    return acquisition.kind;
  }
  const { turn } = acquisition;
  const plan = planConversationTurn(turn.messages);
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
  let handoff = detectHandoffRequest(rawTurnText);
  let handoffHistory: ConversationMessage[] | undefined;
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
    return "handoff_requested";
  }

  if (input.provider.sendTypingIndicator) {
    try {
      await input.provider.sendTypingIndicator({ accountId: turn.accountId, conversationId: turn.providerConversationId });
    } catch (error) {
      console.warn("WhatsApp typing indicator failed", { error: error instanceof Error ? error.name : "UnknownError" });
    }
  }

  try {
    let identity = turn.identity;
    let previousUserMessage: string | undefined;
    if (input.enrichCustomer && !plan.socialKind && !plan.resetRequested
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
    if (input.enrichCustomer && !plan.socialKind
      && needsNextfitEnrichment(rawTurnText, previousUserMessage)) {
      try {
        identity = await input.enrichCustomer({ identity, phoneNumber: turn.phoneNumber,
          message: rawTurnText });
      } catch (error) {
        console.warn("Customer enrichment failed", { error: error instanceof Error ? error.name : "UnknownError" });
      }
    }
    let context = await buildCustomerContext(input.repository, identity, 20);
    const episode = applyEpisodeBoundaryToHistory({
      history: context.conversation.recentMessages,
      currentTurn: plan.messages,
    });
    context = replaceConversationHistory(context,
      applyResetToHistory(episode.messages, plan.resetRequested));
    let generationFailed = false;
    let responsePlan: WhatsAppReplyPlan;
    if (plan.socialKind) {
      responsePlan = { messages: [buildSocialReply(plan.socialKind, context.identity.firstName)],
        answeredTopics: [plan.socialKind], needsClarification: false, handoffRecommended: false };
    } else {
      try {
        responsePlan = await input.generateReply({ message: plan.consolidatedMessage, context,
          repairRequested: plan.repairRequested,
          currentTurnMessageIds: plan.messages.map((message) => message.id) });
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
      }
    }
    const messages = responsePlan.messages.map((message) => message.trim()).filter(Boolean).slice(0, 2);
    if (!messages.length) throw new Error("Empty response plan");
    if ((input.preSendGraceMs ?? 0) > 0) {
      await new Promise((resolve) => setTimeout(resolve, input.preSendGraceMs));
    }
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
    const locallyValidatedHandoff = responsePlan.handoffRecommended
      && responsePlan.handoffValidated === true;
    if (generationFailed || locallyValidatedHandoff) {
      const reason = generationFailed
        ? "O atendimento automático encontrou uma instabilidade ao preparar a resposta."
        : "Uma parte do pedido precisa de continuidade com a equipe.";
      const history = await input.repository.getRecentMessages(turn.conversationId, 12);
      const summary = buildHandoffSummary(history, reason);
      await input.repository.requestHandoff({ conversationId: turn.conversationId,
        providerAccountId: turn.accountId, providerConversationId: turn.providerConversationId,
        reason, source: generationFailed ? "system_failure" : "safety_rule", summary });
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
      return "handoff_requested";
    }
    const completed = await input.repository.completeTurn({ conversationId: turn.conversationId,
      revision: turn.revision, token, state: "replied",
      analysis: { inboundCount: plan.messages.length, repairRequested: plan.repairRequested,
        resetRequested: plan.resetRequested, socialKind: plan.socialKind ?? null,
        episodeBoundary: episode.boundary.startsNewEpisode ? episode.boundary.reason : null }, responsePlan });
    return completed ? "replied" : "stale";
  } catch (error) {
    await input.repository.releaseTurn({ conversationId: turn.conversationId, token, state: "failed" });
    throw error;
  }
}
