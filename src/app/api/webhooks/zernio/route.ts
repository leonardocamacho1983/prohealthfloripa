import { after } from "next/server";

import { NeonConversationRepository } from "@/lib/conversations/neon-repository";
import { normalizeBrazilianPhoneNumber } from "@/lib/conversations/phone";
import { adaptiveBatchDelaySeconds, shouldResumePendingHandoff } from "@/lib/conversations/turn-planning";
import { enqueueWhatsAppTurn } from "@/lib/conversations/turn-queue";
import { logProcessingEvent } from "@/lib/observability/safe-log";
import { enqueueTrainingTurn } from "@/lib/training/queue";
import { TrainingRepository } from "@/lib/training/repository";
import { ZernioWhatsAppProvider } from "@/lib/whatsapp/zernio-provider";
import { buildHandoffSummary } from "@/lib/handoff/summary";
import { handoffNotifier } from "@/lib/notifications/handoff-delivery";
import { captureSurveyScore } from "@/lib/cx/surveys";
import {
  parseZernioWebhook,
  verifyZernioSignature,
} from "@/lib/whatsapp/zernio-webhook";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const apiKey = process.env.ZERNIO_API_KEY;
  const webhookSecret = process.env.ZERNIO_WEBHOOK_SECRET;
  const databaseUrl = process.env.DATABASE_URL;

  if (!apiKey || !webhookSecret || !databaseUrl) {
    console.error("Webhook configuration is incomplete");
    return Response.json({ error: "Webhook unavailable" }, { status: 503 });
  }

  const signature = request.headers.get("x-zernio-signature");
  const rawBody = await request.text();

  if (!signature || !verifyZernioSignature(rawBody, signature, webhookSecret)) {
    console.warn("Zernio webhook signature rejected");
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parseZernioWebhook(payload);

  if (parsed.kind === "invalid") {
    console.warn("Invalid Zernio webhook", { reason: parsed.reason });
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  if (parsed.kind === "ignored") {
    console.info("Zernio webhook ignored", { reason: parsed.reason });
    return Response.json({ received: true });
  }

  const { message } = parsed;
  logProcessingEvent("info", { event: `Zernio ${message.kind} message received`,
    eventId: message.eventId, messageId: message.messageId });

  const phoneNumber = normalizeBrazilianPhoneNumber(message.sender.phoneNumber ?? message.sender.id);
  try {
    const trainer = await new TrainingRepository().findProfile(phoneNumber, message.accountId);
    if (trainer) {
      if (message.kind === "media") {
        await new ZernioWhatsAppProvider(apiKey).sendText({ accountId: message.accountId,
          conversationId: message.conversationId, idempotencyKey: `training-media-${message.messageId}`,
          text: "Para este treinamento, envie a orientação em texto ou áudio, por favor." });
        return Response.json({ received: true });
      }
      await enqueueTrainingTurn({ kind: message.kind, accountId: message.accountId,
        providerConversationId: message.conversationId, providerMessageId: message.messageId,
        phoneNumber,
        ...(message.kind === "text" ? { text: message.text } : {
          mediaId: message.audio.mediaId, ...(message.audio.mediaType ? { mediaType: message.audio.mediaType } : {}),
        }) });
      logProcessingEvent("info", { event: "Trainer message durably queued", eventId: message.eventId,
        messageId: message.messageId, result: message.kind });
      return Response.json({ received: true });
    }
  } catch (error) {
    logProcessingEvent("error", { event: "Trainer routing failed", eventId: message.eventId,
      messageId: message.messageId, error: error instanceof Error ? error.name : "UnknownError" });
    return Response.json({ error: "Temporary ingestion failure" }, { status: 503 });
  }

  if (message.kind === "text") {
    try {
      if (await captureSurveyScore(phoneNumber, message.text)) {
        await new ZernioWhatsAppProvider(apiKey).sendText({ accountId: message.accountId,
          conversationId: message.conversationId, idempotencyKey: `cx-survey-thanks:${message.messageId}`,
          text: "Obrigado pela avaliação. Sua resposta foi registrada e ajuda a ProHealth a melhorar." });
        return Response.json({ received: true });
      }
    } catch (error) {
      logProcessingEvent("error", { event: "CX survey response routing failed", eventId: message.eventId,
        messageId: message.messageId, error: error instanceof Error ? error.name : "UnknownError" });
      return Response.json({ error: "Temporary ingestion failure" }, { status: 503 });
    }
  }

  if (message.kind !== "text") {
    const repository = new NeonConversationRepository();
    const mediaLabel = message.kind === "audio" ? "Áudio" : ({
      image: "Imagem", document: "Documento", video: "Vídeo", other: "Arquivo",
    } as const)[message.media.category];
    const content = `[${mediaLabel} recebido — conteúdo ainda não interpretado]`;
    try {
      const inbound = await repository.recordInbound({ phoneNumber, providerMessageId: message.messageId,
        content, providerAccountId: message.accountId, providerConversationId: message.conversationId });
      if (!inbound.inserted) return Response.json({ received: true });
      if (inbound.conversationStatus === "human_requested" || inbound.conversationStatus === "human_active") {
        logProcessingEvent("info", { event: "Customer media stored during human ownership",
          eventId: message.eventId, messageId: message.messageId, result: message.kind });
        return Response.json({ received: true });
      }
      const reason = `${mediaLabel} enviado pelo cliente precisa de atendimento humano.`;
      const history = await repository.getRecentMessages(inbound.identity.conversationId, 8);
      const summary = buildHandoffSummary(history, reason);
      await repository.requestHandoff({ conversationId: inbound.identity.conversationId,
        providerAccountId: message.accountId, providerConversationId: message.conversationId,
        reason, source: "customer", summary });
      const acknowledgement = `Recebi ${mediaLabel === "Imagem" ? "a imagem" : mediaLabel === "Áudio" ? "o áudio" : "o arquivo"}. Como ainda não consigo analisar esse conteúdo com segurança, encaminhei para nossa equipe continuar por aqui.`;
      const provider = new ZernioWhatsAppProvider(apiKey);
      await provider.sendText({ accountId: message.accountId, conversationId: message.conversationId,
        idempotencyKey: `media-handoff-${message.messageId}`, text: acknowledgement });
      await repository.recordOutbound({ conversationId: inbound.identity.conversationId, content: acknowledgement });
      try {
        await handoffNotifier(provider)({ conversationId: inbound.identity.conversationId,
          firstName: inbound.identity.firstName, reason, summary,
          idempotencyKey: `media-handoff-notification-${message.messageId}`, accountId: message.accountId });
      } catch (error) {
        console.warn("Media handoff notification failed", { error: error instanceof Error ? error.name : "UnknownError" });
      }
      return Response.json({ received: true });
    } catch (error) {
      logProcessingEvent("error", { event: "Customer media ingestion failed", eventId: message.eventId,
        messageId: message.messageId, error: error instanceof Error ? error.name : "UnknownError" });
      return Response.json({ error: "Temporary ingestion failure" }, { status: 503 });
    }
  }

  const delaySeconds = adaptiveBatchDelaySeconds(message.text);
  try {
    const repository = new NeonConversationRepository();
    const inbound = await repository.recordInbound({
      phoneNumber,
      providerMessageId: message.messageId,
      content: message.text,
      providerAccountId: message.accountId,
      providerConversationId: message.conversationId,
      settleAt: new Date(Date.now() + delaySeconds * 1000),
    });
    const resumedPendingHandoff = shouldResumePendingHandoff(inbound.conversationStatus, message.text)
      ? await repository.resumePendingHandoff(inbound.identity.conversationId)
      : false;
    const queuedForAgent = resumedPendingHandoff
      || (inbound.conversationStatus !== "human_requested" && inbound.conversationStatus !== "human_active");
    if (queuedForAgent) {
      const persistedDelaySeconds = Math.max(0,
        Math.ceil((inbound.processAt.getTime() - Date.now()) / 1000));
      await enqueueWhatsAppTurn({ conversationId: inbound.identity.conversationId,
        observedRevision: inbound.revision }, persistedDelaySeconds);
      if (inbound.inserted) {
        after(async () => {
          try {
            await new ZernioWhatsAppProvider(apiKey).sendTypingIndicator({ accountId: message.accountId,
              conversationId: message.conversationId });
          } catch (error) {
            console.warn("WhatsApp typing indicator failed", { error: error instanceof Error ? error.name : "UnknownError" });
          }
        });
      }
    }
    logProcessingEvent("info", {
      event: queuedForAgent ? "WhatsApp message durably queued" : "WhatsApp message stored during human ownership",
      eventId: message.eventId,
      messageId: message.messageId,
      result: queuedForAgent
        ? (resumedPendingHandoff ? "handoff_cancelled_and_queued" : inbound.inserted ? "queued" : "duplicate_requeued")
        : inbound.conversationStatus ?? "unknown",
    });
  } catch (error) {
    logProcessingEvent("error", { event: "WhatsApp message ingestion failed", eventId: message.eventId,
      messageId: message.messageId, error: error instanceof Error ? error.name : "UnknownError" });
    return Response.json({ error: "Temporary ingestion failure" }, { status: 503 });
  }

  return Response.json({ received: true });
}
