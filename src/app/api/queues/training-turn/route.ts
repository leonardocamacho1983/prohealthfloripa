import { handleCallback } from "@vercel/queue";

import { hasAiGatewayCredential } from "@/lib/ai/gateway-auth";
import { NeonConversationRepository } from "@/lib/conversations/neon-repository";
import { normalizeBrazilianPhoneNumber } from "@/lib/conversations/phone";
import { logProcessingEvent } from "@/lib/observability/safe-log";
import { analyzeTrainingInput, buildTrainingAcknowledgement, isTrainingCompleteCommand } from "@/lib/training/analyzer";
import { downloadZernioAudio, transcribeTrainingAudio } from "@/lib/training/audio";
import type { TrainingQueueMessage } from "@/lib/training/queue";
import { TrainingRepository } from "@/lib/training/repository";
import { ZernioWhatsAppProvider } from "@/lib/whatsapp/zernio-provider";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = handleCallback<TrainingQueueMessage>(async (message, metadata) => {
  const apiKey = process.env.ZERNIO_API_KEY;
  if (!apiKey || !process.env.DATABASE_URL || !hasAiGatewayCredential()) {
    throw new Error("Training worker configuration is incomplete");
  }
  const phoneNumber = normalizeBrazilianPhoneNumber(message.phoneNumber);
  const training = new TrainingRepository();
  const profile = await training.findProfile(phoneNumber, message.accountId);
  if (!profile) return;

  let text = message.text;
  if (message.kind === "audio") {
    if (!message.mediaId) throw new Error("Training audio media id is missing");
    const audio = await downloadZernioAudio({ apiKey, accountId: message.accountId, mediaId: message.mediaId });
    text = await transcribeTrainingAudio(audio.bytes);
  }
  if (!text?.trim()) throw new Error("Training message is empty");

  const conversations = new NeonConversationRepository();
  const inbound = await conversations.recordInbound({ phoneNumber, providerMessageId: message.providerMessageId,
    content: message.kind === "audio" ? `[Áudio transcrito] ${text}` : text,
    providerAccountId: message.accountId, providerConversationId: message.providerConversationId });
  if (!inbound.messageId && !inbound.inserted) return;

  let reply: string;
  if (isTrainingCompleteCommand(text)) {
    const submission = await training.submit(profile.id);
    reply = submission.alreadySubmitted
      ? "Este treinamento já foi enviado para revisão."
      : `Treinamento concluído: ${submission.count} ${submission.count === 1 ? "item enviado" : "itens enviados"} para revisão. Leonardo terá até 8 horas para revisar. Até a aprovação, o agente continua usando a base atual.`;
  } else {
    if (!inbound.messageId) throw new Error("Training inbound message id is missing");
    const analysis = await analyzeTrainingInput(text);
    const item = await training.addItem({ profileId: profile.id, inboundMessageId: inbound.messageId,
      summary: analysis.summary, itemType: analysis.itemType, needsClarification: analysis.needsClarification,
      ...(analysis.clarificationQuestion ? { clarificationQuestion: analysis.clarificationQuestion } : {}),
      riskFlags: analysis.riskFlags, sourceKind: message.kind });
    reply = buildTrainingAcknowledgement(item.sequence, analysis);
  }

  const idempotencyKey = `training-reply-${message.providerMessageId}`;
  const provider = new ZernioWhatsAppProvider(apiKey);
  await provider.sendText({ accountId: message.accountId, conversationId: message.providerConversationId,
    idempotencyKey, text: reply });
  await training.recordOutbound(inbound.identity.conversationId, reply, idempotencyKey);
  logProcessingEvent("info", { event: "Training message processed", messageId: metadata.messageId,
    eventId: metadata.messageId, result: message.kind });
}, { visibilityTimeoutSeconds: 90 });
