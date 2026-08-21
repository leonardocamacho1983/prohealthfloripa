import { handleCallback } from "@vercel/queue";
import { randomUUID } from "node:crypto";

import { generateWhatsAppReplyPlan } from "@/lib/ai/generate-whatsapp-reply";
import { hasAiGatewayCredential } from "@/lib/ai/gateway-auth";
import { interpretSemanticTurn } from "@/lib/ai/semantic-turn-interpreter";
import { NeonConversationRepository } from "@/lib/conversations/neon-repository";
import {
  EmptyTurnInvariantError,
  processConversationTurn,
  type JourneyTurnObservation,
} from "@/lib/conversations/process-conversation-turn";
import { isRetryableTurnStateError, queueTurnRetryDirective,
  requireSettledQueueTurn } from "@/lib/conversations/queue-turn-retry";
import type { WhatsAppTurnQueueMessage } from "@/lib/conversations/turn-queue";
import { HANDOFF_ACKNOWLEDGEMENT } from "@/lib/handoff/detection";
import { buildHandoffSummary } from "@/lib/handoff/summary";
import { recordOperationalMetric } from "@/lib/metrics/repository";
import { NextfitClient } from "@/lib/nextfit/client";
import { createNextfitEnricher } from "@/lib/nextfit/sync-customer";
import { handoffNotifier, sendShiftStartDigests } from "@/lib/notifications/handoff-delivery";
import { logProcessingEvent } from "@/lib/observability/safe-log";
import { ZernioWhatsAppProvider } from "@/lib/whatsapp/zernio-provider";

export const runtime = "nodejs";
export const maxDuration = 60;

async function escalatePermanentFailure(message: WhatsAppTurnQueueMessage, repository: NeonConversationRepository,
  provider: ZernioWhatsAppProvider) {
  const token = randomUUID();
  const acquisition = await repository.acquireTurn({ conversationId: message.conversationId,
    observedRevision: message.observedRevision, token, leaseSeconds: 60 });
  if (acquisition.kind !== "acquired") return;
  const { turn } = acquisition;
  const reason = "O atendimento automático encontrou uma falha persistente.";
  const history = await repository.getRecentMessages(turn.conversationId, 12);
  const summary = buildHandoffSummary(history, reason);
  const idempotencyKey = `zernio-failure-handoff-${turn.conversationId}-${turn.revision}`;
  try {
    const reservation = await repository.reserveOutbound({ conversationId: turn.conversationId,
      revision: turn.revision, token, bubbleIndex: 0, content: HANDOFF_ACKNOWLEDGEMENT, idempotencyKey });
    if (reservation === "stale") {
      await repository.releaseTurn({ conversationId: turn.conversationId, token, state: "stale" });
      return;
    }
    if (reservation === "reserved") {
      try {
        await provider.sendText({ accountId: turn.accountId, conversationId: turn.providerConversationId,
          idempotencyKey, text: HANDOFF_ACKNOWLEDGEMENT });
        await repository.markOutboundSent({ idempotencyKey });
      } catch (error) {
        await repository.markOutboundFailed({ idempotencyKey });
        throw error;
      }
    }
    await repository.requestHandoff({ conversationId: turn.conversationId,
      providerAccountId: turn.accountId, providerConversationId: turn.providerConversationId,
      reason, source: "system_failure", summary });
  } catch (error) {
    await repository.releaseTurn({ conversationId: turn.conversationId, token, state: "failed" });
    throw error;
  }
  try {
    const notify = handoffNotifier(provider);
    await notify({ conversationId: turn.conversationId, firstName: turn.identity.firstName,
      reason, summary, idempotencyKey: `handoff-failure-notification-${turn.conversationId}-${turn.revision}`,
      accountId: turn.accountId });
  } catch (error) {
    console.warn("Permanent failure handoff notification failed", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

async function recordTurnFailure(error: unknown, message: WhatsAppTurnQueueMessage, deliveryCount: number) {
  if (!(error instanceof EmptyTurnInvariantError)) return;
  try {
    await recordOperationalMetric({
      eventName: "empty_turn_invariant",
      outcome: "failure",
      conversationId: error.conversationId,
      metadata: {
        revision: error.revision,
        processedRevision: error.processedRevision,
        observedRevision: message.observedRevision,
        deliveryCount,
      },
      dedupeKey: `empty-turn-${error.conversationId}-${error.revision}-${deliveryCount}`,
    });
  } catch (metricError) {
    console.warn("Turn failure metric could not be recorded", {
      error: metricError instanceof Error ? metricError.name : "UnknownError",
    });
  }
}

async function recordJourneyTurn(observation: JourneyTurnObservation) {
  await recordOperationalMetric({
    eventName: "journey_turn",
    outcome: observation.result === "stale" ? "info" : "success",
    conversationId: observation.conversationId,
    durationMs: observation.totalMs,
    metadata: {
      revision: observation.revision,
      mode: observation.mode,
      candidateAction: observation.candidateAction,
      deliveredAction: observation.deliveredAction,
      replySource: observation.replySource,
      validationIssues: observation.validationIssues.join(","),
      planningMs: observation.planningMs,
      result: observation.result,
    },
    dedupeKey: `journey-turn-${observation.conversationId}-${observation.revision}-${observation.mode}`,
  });
}

export const POST = handleCallback<WhatsAppTurnQueueMessage>(async (message, metadata) => {
  const apiKey = process.env.ZERNIO_API_KEY;
  if (!apiKey || !process.env.DATABASE_URL || !hasAiGatewayCredential()) {
    throw new Error("Queue worker configuration is incomplete");
  }
  const repository = new NeonConversationRepository();
  const provider = new ZernioWhatsAppProvider(apiKey);
  const notifyHandoff = handoffNotifier(provider);
  try {
    await sendShiftStartDigests({ provider });
  } catch (error) {
    console.warn("Shift digest opportunistic check deferred", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
  }
  try {
    const nextfitApiKey = process.env.NEXTFIT_API_KEY;
    const result = requireSettledQueueTurn(await processConversationTurn({ conversationId: message.conversationId,
      observedRevision: message.observedRevision, repository, provider,
      generateReply: generateWhatsAppReplyPlan,
      interpretTurn: interpretSemanticTurn,
      preSendGraceMs: 300,
      observeJourney: recordJourneyTurn,
      ...(nextfitApiKey ? { enrichCustomer: createNextfitEnricher({ api: new NextfitClient(nextfitApiKey),
        store: repository }) } : {}),
      notifyHandoff }));
    logProcessingEvent("info", { event: "WhatsApp turn processing completed",
      eventId: metadata.messageId, messageId: metadata.messageId, result });
  } catch (error) {
    if (isRetryableTurnStateError(error)) {
      logProcessingEvent("info", { event: "WhatsApp turn processing deferred",
        eventId: metadata.messageId, messageId: metadata.messageId, result: error.state });
      throw error;
    }
    await recordTurnFailure(error, message, metadata.deliveryCount);
    logProcessingEvent("error", { event: "WhatsApp turn processing failed",
      eventId: metadata.messageId, messageId: metadata.messageId,
      error: error instanceof Error ? error.name : "UnknownError" });
    if (metadata.deliveryCount >= 5) {
      await escalatePermanentFailure(message, repository, provider);
      return;
    }
    throw error;
  }
}, {
  visibilityTimeoutSeconds: 90,
  retry: (error, metadata) => queueTurnRetryDirective(error, metadata.deliveryCount),
});
