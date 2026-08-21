import { handleCallback } from "@vercel/queue";
import { markSurveySent, reserveSurveyDelivery } from "@/lib/cx/surveys";
import { ZernioWhatsAppProvider } from "@/lib/whatsapp/zernio-provider";
export const runtime = "nodejs";
export const POST = handleCallback<{ surveyId: string }>(async ({ surveyId }) => {
  const apiKey = process.env.ZERNIO_API_KEY; if (!apiKey) throw new Error("CX survey provider unavailable");
  const survey = await reserveSurveyDelivery(surveyId); if (!survey) return;
  await new ZernioWhatsAppProvider(apiKey).sendText({ accountId: survey.accountId,
    conversationId: survey.providerConversationId, idempotencyKey: `cx-survey:${survey.id}`,
    text: "Para nos ajudar a melhorar: de 0 a 10, quanto você ficou satisfeito(a) com este atendimento? Responda somente com um número." });
  await markSurveySent(survey.id);
}, { visibilityTimeoutSeconds: 30,
  retry: (_error, metadata) => ({ afterSeconds: Math.min(900, 30 * 2 ** Math.min(metadata.deliveryCount, 5)) }) });
