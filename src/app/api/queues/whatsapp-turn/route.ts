import { handleCallback } from "@vercel/queue";
import { randomUUID } from "node:crypto";

import { generateWhatsAppReplyPlan } from "@/lib/ai/generate-whatsapp-reply";
import { NeonConversationRepository } from "@/lib/conversations/neon-repository";
import { processConversationTurn } from "@/lib/conversations/process-conversation-turn";
import type { WhatsAppTurnQueueMessage } from "@/lib/conversations/turn-queue";
import { HANDOFF_ACKNOWLEDGEMENT } from "@/lib/handoff/detection";
import { buildHandoffSummary } from "@/lib/handoff/summary";
import { NextfitClient } from "@/lib/nextfit/client";
import { createNextfitEnricher } from "@/lib/nextfit/sync-customer";
import { enqueueInAppNotification } from "@/lib/notifications/repository";
import { buildHandoffRequestedNotification } from "@/lib/notifications/rules";
import { logProcessingEvent } from "@/lib/observability/safe-log";
import { ZernioWhatsAppProvider } from "@/lib/whatsapp/zernio-provider";

export const runtime = "nodejs";
export const maxDuration = 60;

function notification(provider: ZernioWhatsAppProvider) {
  return async (input: { conversationId: string; firstName?: string; reason: string; summary: string;
    idempotencyKey: string; accountId: string }) => {
    await enqueueInAppNotification(buildHandoffRequestedNotification({
      conversationId: input.conversationId,
      firstName: input.firstName,
      dedupeKey: input.idempotencyKey,
    }));
    if (!process.env.HANDOFF_ATTENDANT_PHONE || !process.env.ZERNIO_HANDOFF_TEMPLATE_NAME) return;
    const baseUrl = process.env.APP_URL ?? "https://prohealthfloripa.vercel.app";
    await provider.sendTemplate({ accountId: input.accountId,
      participantId: process.env.HANDOFF_ATTENDANT_PHONE!,
      templateName: process.env.ZERNIO_HANDOFF_TEMPLATE_NAME!,
      templateLanguage: process.env.ZERNIO_HANDOFF_TEMPLATE_LANGUAGE ?? "pt_BR",
      templateParams: [input.firstName ?? "Cliente", input.reason, input.summary,
        `${baseUrl}/handoff?conversation=${input.conversationId}`],
      idempotencyKey: input.idempotencyKey });
  };
}

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
  await repository.requestHandoff({ conversationId: turn.conversationId,
    providerAccountId: turn.accountId, providerConversationId: turn.providerConversationId,
    reason, source: "system_failure", summary });
  await provider.sendText({ accountId: turn.accountId, conversationId: turn.providerConversationId,
    idempotencyKey: `zernio-failure-handoff-${turn.conversationId}-${turn.revision}`,
    text: HANDOFF_ACKNOWLEDGEMENT });
  await repository.recordOutbound({ conversationId: turn.conversationId, content: HANDOFF_ACKNOWLEDGEMENT });
  const notify = notification(provider);
  if (notify) await notify({ conversationId: turn.conversationId, firstName: turn.identity.firstName,
    reason, summary, idempotencyKey: `handoff-failure-notification-${turn.conversationId}-${turn.revision}`,
    accountId: turn.accountId });
}

export const POST = handleCallback<WhatsAppTurnQueueMessage>(async (message, metadata) => {
  const apiKey = process.env.ZERNIO_API_KEY;
  if (!apiKey || !process.env.DATABASE_URL || !process.env.AI_GATEWAY_API_KEY) {
    throw new Error("Queue worker configuration is incomplete");
  }
  const repository = new NeonConversationRepository();
  const provider = new ZernioWhatsAppProvider(apiKey);
  const notifyHandoff = notification(provider);
  try {
    const nextfitApiKey = process.env.NEXTFIT_API_KEY;
    const result = await processConversationTurn({ conversationId: message.conversationId,
      observedRevision: message.observedRevision, repository, provider,
      generateReply: generateWhatsAppReplyPlan,
      ...(nextfitApiKey ? { enrichCustomer: createNextfitEnricher({ api: new NextfitClient(nextfitApiKey),
        store: repository }) } : {}),
      notifyHandoff });
    logProcessingEvent("info", { event: "WhatsApp turn processing completed",
      eventId: metadata.messageId, messageId: metadata.messageId, result });
  } catch (error) {
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
  retry: (_error, metadata) => metadata.deliveryCount >= 7
    ? { acknowledge: true }
    : { afterSeconds: Math.min(60, 2 ** metadata.deliveryCount * 3) },
});
