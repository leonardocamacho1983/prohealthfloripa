import {
  buildConfirmedMassageAnswer,
  missingConfirmedMassageMentions,
  type MassageRequestAnalysis,
} from "../knowledge/massage-catalog-semantics.ts";
import { proHealthKnowledge } from "../knowledge/prohealth.ts";
import type { WhatsAppReplyPlan } from "./reply-generation-fallback.ts";

function appendSupplement(plan: WhatsAppReplyPlan, supplement: string): WhatsAppReplyPlan {
  const text = supplement.trim();
  if (!text) return plan;

  const messages = [...plan.messages];
  if (messages.length < 2) messages.push(text);
  else messages[1] = `${messages[1].trim()}\n\n${text}`;
  return { ...plan, messages };
}

function requestedFactSupplements(message: string, coverageEvidence: string): string[] {
  const supplements: string[] = [];
  if (/\b(?:endere[cç]o|onde\s+(?:fica|voc[eê]s\s+ficam)|localiza[cç][aã]o)\b/i.test(message)
    && !/Vera\s+Linhares|2063|C[oó]rrego\s+Grande/i.test(coverageEvidence)) {
    supplements.push(`O endereço é ${proHealthKnowledge.institutional.address}.`);
  }
  if (/\b(?:hor[aá]rio\s+de\s+funcionamento|que\s+horas|abre|fecha)\b/i.test(message)
    && !/primeiro\s+hor[aá]rio|[àa]s\s+0?8h|[àa]s\s+20h|segunda\s+a\s+sexta/i.test(coverageEvidence)) {
    supplements.push(`Funcionamos ${proHealthKnowledge.schedule.hours}.`);
  }
  if (/\binstagram\b/i.test(message)
    && !/prohealthfloripa/i.test(coverageEvidence)) {
    supplements.push(`Nosso Instagram é ${proHealthKnowledge.institutional.instagram}.`);
  }
  if (/\be-?mail\b/i.test(message)
    && !/prohealthfloripa@gmail\.com/i.test(coverageEvidence)) {
    supplements.push(`Nosso e-mail é ${proHealthKnowledge.institutional.email}.`);
  }
  return supplements;
}

const COMMERCIAL_MASSAGE_INTENT = /\b(?:quero|queria|gostaria|preciso|agend\w*|marc\w*|reserv\w*|quanto|custa|pre[cç]o|valor|ver\s+(?:a|uma)\s+massagem)\b/i;
const MASSAGE_EXPERIENCE_INTENT = /\b(?:agend\w*|marc\w*|reserv\w*)\b|\b(?:quero|queria|gostaria|preciso)\b[^.!?\n]{0,36}\b(?:massag\w*|relaxante|miofascial|drenagem|shiatsu|thai|lomi|ayurv[eé]dica)\b|\bver\s+(?:a|uma)\s+massagem\b/i;
const RELAXATION_MOTIVE = /\b(?:tens\w*|relaxar|relaxamento|estress\w*|cansad\w*)\b/i;

function massageCommercialSupplements(input: {
  message: string;
  coverageEvidence: string;
  massageAnalysis: MassageRequestAnalysis;
}): string[] {
  if (!COMMERCIAL_MASSAGE_INTENT.test(input.message) || input.massageAnalysis.mentions.length !== 1) {
    return [];
  }
  const mention = input.massageAnalysis.mentions[0]!;
  const supplements: string[] = [];
  const expectedPrice = mention.singlePrice.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
  const hasPrice = new RegExp(expectedPrice, "i").test(input.coverageEvidence);
  const hasDuration = /\b(?:1\s*h|1\s*hora|uma\s+hora|60\s*minutos?)\b/i.test(input.coverageEvidence);
  const needsDuration = MASSAGE_EXPERIENCE_INTENT.test(input.message);
  if (!hasPrice || (needsDuration && !hasDuration)) {
    const facts = [
      ...(needsDuration && !hasDuration ? ["O atendimento ocupa 1 hora completa"] : []),
      ...(!hasPrice ? [`o valor avulso é ${mention.singlePrice}`] : []),
    ];
    supplements.push(`${facts.join(" e ")}.`);
  }

  const shouldOfferHotBath = mention.canonicalName === "Relaxante"
    && (RELAXATION_MOTIVE.test(input.message) || MASSAGE_EXPERIENCE_INTENT.test(input.message))
    && !/banheira\s+quente|R\$\s*35/i.test(input.coverageEvidence);
  if (shouldOfferHotBath) {
    supplements.push(
      "Se ainda não experimentou, você também pode completar a experiência com a primeira banheira quente de R$ 70 por R$ 35. Basta trazer roupa de banho; temos toalhas macias, ducha e secador.",
    );
  }
  return supplements;
}

/**
 * Complements only objectively missing, confirmed facts. It never rewrites a
 * correct model answer, so distinct topics in a burst remain intact.
 */
export function ensureDeterministicReplyCoverage(input: {
  plan: WhatsAppReplyPlan;
  message: string;
  massageAnalysis: MassageRequestAnalysis;
  priorAssistantMessages?: readonly string[];
}): WhatsAppReplyPlan {
  const combinedReply = input.plan.messages.join("\n");
  const coverageEvidence = [
    ...(input.priorAssistantMessages ?? []),
    combinedReply,
  ].join("\n");
  const supplements: string[] = [];
  const missingMassageMentions = missingConfirmedMassageMentions(
    input.massageAnalysis,
    coverageEvidence,
  ).filter((mention) => !mention.needsClarification);
  if (missingMassageMentions.length) {
    const missingAnswer = buildConfirmedMassageAnswer({
      ...input.massageAnalysis,
      mentions: missingMassageMentions,
      needsClarification: false,
      repairRequested: false,
    });
    if (missingAnswer) supplements.push(missingAnswer);
  }
  supplements.push(...massageCommercialSupplements({
    message: input.message,
    coverageEvidence,
    massageAnalysis: input.massageAnalysis,
  }));
  supplements.push(...requestedFactSupplements(input.message, coverageEvidence));

  return supplements.length
    ? appendSupplement(input.plan, supplements.join(" "))
    : input.plan;
}
