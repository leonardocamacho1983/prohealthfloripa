import { generateText, jsonSchema, Output, type ModelMessage } from "ai";

import {
  customerContextForModel,
  type CustomerContext,
} from "../customer-context/index.ts";
import { getNextfitCatalogContextForMessage } from "../catalog/nextfit-catalog.ts";
import type { ConversationMessage } from "../conversations/types.ts";
import { buildProHealthInstructions } from "../knowledge/prohealth-context.ts";
import { proHealthKnowledge } from "../knowledge/prohealth.ts";
import {
  analyzeMassageRequest,
  buildConfirmedMassageAnswer,
  massageReplyContradictsConfirmedCatalog,
  missingConfirmedMassageMentions,
  type MassageRequestAnalysis,
} from "../knowledge/massage-catalog-semantics.ts";
import { buildSchedulingInstructions } from "../nextfit/scheduling.ts";
import {
  generateReplyPlanWithFallback,
  type WhatsAppReplyPlan,
} from "./reply-generation-fallback.ts";
import { gatewayProviderOptions, whatsappModelRouting } from "./gateway-routing.ts";
import { ensureDeterministicReplyCoverage } from "./reply-coverage.ts";
import type { SemanticTurnPlan } from "./semantic-turn-plan.ts";

export type { WhatsAppReplyPlan } from "./reply-generation-fallback.ts";

async function loadPublishedKnowledgeInstructions(): Promise<string> {
  try {
    const { getActiveKnowledgeInstructions } = await import("../knowledge/governance.ts");
    return await getActiveKnowledgeInstructions();
  } catch {
    // The embedded, reviewed knowledge remains the safe runtime fallback.
    return "";
  }
}

export const WHATSAPP_GENERATION_TIMEOUTS_MS = {
  structured: 7_000,
  plainText: 3_000,
} as const;

export function prepareWhatsAppModelMessages(input: {
  recentMessages: readonly ConversationMessage[];
  currentTurnMessageIds?: readonly string[];
  currentTurn: string;
}): { priorMessages: ConversationMessage[]; messages: ModelMessage[] } {
  const currentIds = new Set(input.currentTurnMessageIds ?? []);
  const implicitCurrentMessage = currentIds.size === 0
    ? [...input.recentMessages].reverse().find((message) =>
      message.role === "user" && message.content.trim() === input.currentTurn.trim())
    : undefined;
  const priorMessages = input.recentMessages.filter((message) =>
    !currentIds.has(message.id) && message.id !== implicitCurrentMessage?.id);
  const messages: ModelMessage[] = [];
  for (const message of priorMessages) {
    if (message.role === "user" || message.role === "assistant") {
      messages.push({ role: message.role, content: message.content });
    }
  }
  messages.push({ role: "user", content: input.currentTurn });
  return { priorMessages, messages };
}

const replyPlanSchema = jsonSchema<WhatsAppReplyPlan>({
  type: "object",
  additionalProperties: false,
  required: ["messages", "answeredTopics", "needsClarification", "handoffRecommended"],
  properties: {
    messages: { type: "array", minItems: 1, maxItems: 2,
      items: { type: "string", minLength: 1, maxLength: 700 } },
    answeredTopics: { type: "array", maxItems: 8, items: { type: "string", maxLength: 80 } },
    needsClarification: { type: "boolean" },
    handoffRecommended: { type: "boolean" },
  },
});

export function buildGroundedMassageFallback(
  analysis: MassageRequestAnalysis,
  message: string,
  options: { allowPartial: boolean },
): WhatsAppReplyPlan | undefined {
  const confirmed = buildConfirmedMassageAnswer(analysis);
  if (!confirmed) return undefined;
  const detailedRequest = /\b(?:como\s+funciona|benef[ií]cios?|diferen[cç]a|explique|explica|indicad[ao]|serve\s+para|recomenda)\w*/i.test(message);
  const unhandledAdditionalTopic = /\b(?:pilates|fisio\w*|crio\w*|banheira|termoterapia|recovery|plano|contrato|pagamento|cobran[cç]a|reembolso|telefone|contato)\w*/i.test(message);
  const unresolvedTopic = detailedRequest || unhandledAdditionalTopic;
  if (unresolvedTopic && !options.allowPartial) return undefined;

  const ordinaryDiscomfort = /\b(?:dor|dolorid|tens[aã]o|desconforto|travada)\w*/i.test(message)
    || /\b(?:cervical|pesco[cç]o|ombro|costas|lombar)\b.{0,24}\btravou\b|\btravou\b.{0,24}\b(?:cervical|pesco[cç]o|ombro|costas|lombar)\b/i.test(message);
  const commercialIntent = /\b(?:quero|queria|preciso|gostaria|agend|marc|hor[aá]rio|hoje|amanh[aã])\w*/i.test(message);
  const greeting = /\bbom\s+dia\b/i.test(message)
    ? "Bom dia!"
    : /\bboa\s+tarde\b/i.test(message)
      ? "Boa tarde!"
      : /\bboa\s+noite\b/i.test(message)
        ? "Boa noite!"
        : /\b(?:oi|ol[aá])\b/i.test(message)
          ? "Oi!"
          : undefined;
  const commercialParts = [...(greeting ? [greeting] : []), confirmed];
  const followUpParts: string[] = [];
  if (ordinaryDiscomfort) {
    followUpParts.push("Como você relatou dor ou desconforto, o profissional avalia no início se essa é a técnica mais adequada para você.");
  }
  if (commercialIntent) {
    followUpParts.push(/\b(?:hoje|amanh[aã]|segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo)\b/i.test(message)
      ? "Você prefere atendimento de manhã, à tarde ou à noite?"
      : "Para qual dia e período você prefere o atendimento?");
  }

  const additionalAnswers: string[] = [];
  if (/\b(?:endere[cç]o|onde\s+(?:fica|voc[eê]s\s+ficam)|localiza[cç][aã]o)\b/i.test(message)) {
    additionalAnswers.push(`O endereço é ${proHealthKnowledge.institutional.address}.`);
  }
  if (/\b(?:hor[aá]rio\s+de\s+funcionamento|que\s+horas|abre|fecha)\b/i.test(message)) {
    additionalAnswers.push(`Funcionamos ${proHealthKnowledge.schedule.hours}.`);
  }
  if (/\binstagram\b/i.test(message)) {
    additionalAnswers.push(`Nosso Instagram é ${proHealthKnowledge.institutional.instagram}.`);
  }
  if (/\be-?mail\b/i.test(message)) {
    additionalAnswers.push(`Nosso e-mail é ${proHealthKnowledge.institutional.email}.`);
  }
  commercialParts.push(...additionalAnswers);
  if (unresolvedTopic && options.allowPartial) {
    followUpParts.push("Também recebi seu outro pedido e já o deixei para nossa equipe continuar por aqui, sem você precisar repetir.");
  }

  return {
    messages: [commercialParts.join(" "), ...(followUpParts.length ? [followUpParts.join(" ")] : [])],
    answeredTopics: ["massagem_confirmada"],
    needsClarification: false,
    handoffRecommended: unresolvedTopic && options.allowPartial,
    ...(unresolvedTopic && options.allowPartial ? { handoffValidated: true } : {}),
  };
}

export async function generateWhatsAppReplyPlan(input: {
  message: string;
  context: CustomerContext;
  repairRequested?: boolean;
  currentTurnMessageIds?: readonly string[];
  semanticPlan?: SemanticTurnPlan;
}): Promise<WhatsAppReplyPlan> {
  const currentTurnMessageIds = new Set(input.currentTurnMessageIds ?? []);
  const { priorMessages, messages } = prepareWhatsAppModelMessages({
    recentMessages: input.context.conversation.recentMessages,
    currentTurnMessageIds: input.currentTurnMessageIds,
    currentTurn: input.message,
  });
  const catalogContext = await getNextfitCatalogContextForMessage(input.message);
  const latestAssistantReply = priorMessages
    .filter((message) => message.role === "assistant").at(-1)?.content;
  const previousAssistantMessages = priorMessages
    .filter((message) => message.role === "assistant")
    .map((message) => message.content);
  const massageAnalysis = analyzeMassageRequest(input.message, { previousAssistantMessages });
  const currentTurnRecords = input.context.conversation.recentMessages
    .filter((message) => currentTurnMessageIds.has(message.id));
  const latestPriorResponseRevision = priorMessages
    .filter((message) => message.role === "assistant" && message.responseRevision !== undefined)
    .reduce((latest, message) => Math.max(latest, message.responseRevision ?? 0), 0);
  const replaysPartiallyAnsweredTurn = latestPriorResponseRevision > 0
    && currentTurnRecords.some((message) => (message.inputRevision ?? Number.MAX_SAFE_INTEGER)
      <= latestPriorResponseRevision)
    && currentTurnRecords.some((message) => (message.inputRevision ?? 0) > latestPriorResponseRevision);
  const fallbackMassageAnalysis = replaysPartiallyAnsweredTurn
    ? {
      ...massageAnalysis,
      mentions: missingConfirmedMassageMentions(
        massageAnalysis,
        previousAssistantMessages.join("\n"),
      ),
    }
    : massageAnalysis;
  const repairRequested = Boolean(input.repairRequested || massageAnalysis.repairRequested);
  const relevantText = priorMessages
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join("\n");
  const schedulingInstructions = buildSchedulingInstructions(
    input.message,
    process.env.NEXTFIT_BOOKING_URL,
    priorMessages
      .filter((message) => message.role === "user")
      .map((message) => message.content),
  );
  const activeKnowledgeInstructions = await loadPublishedKnowledgeInstructions();
  const instructions = `${buildProHealthInstructions(`${relevantText}\n${input.message}`)}

${activeKnowledgeInstructions}

REGRAS DO TURNO ATUAL:
- O cliente pode escrever em vários balões curtos. Trate as mensagens numeradas na mensagem do usuário como um único turno, em ordem.
- Responda a todos os pedidos ainda válidos uma única vez, em no máximo 2 balões curtos.
- Se houver saudação junto de um pedido, acolha em poucas palavras e já resolva o pedido no mesmo fluxo.
- Se os assuntos forem diferentes, organize a resposta em parágrafos curtos; não repita uma introdução para cada assunto.
- Compare com a última resposta do agente. Não repita preço, categoria, endereço ou explicação que acabou de ser dada, salvo se o cliente pedir novamente ou corrigir o assunto.
- Se uma nova mensagem apenas acrescentar contexto (por exemplo, um sintoma), responda ao contexto novo e avance a conversa; não recomece a resposta anterior.
- Uma correção como "na verdade X" substitui somente o assunto corrigido; não descarte pedidos adicionais.
- Um cancelamento específico elimina somente o assunto cancelado.
- Mensagens como "oi", "?" ou "travou" no fim do turno indicam que o cliente espera a resposta pendente; não responda apenas com uma saudação.
- Se o cliente reiniciar a conversa, ignore objetivos anteriores, mas preserve identidade e dados cadastrais.
- Não mencione processamento, fila, modelo, sistema ou demora interna.
- Nunca direcione a pessoa ao mesmo número de WhatsApp em que ela já está conversando.
- Prefira uma próxima ação concreta. Faça no máximo uma pergunta objetiva por resposta.
- Entregue a orientação pedida imediatamente. Não use "se quiser", "posso te explicar" nem peça permissão para passar opções.
- Se o cliente já negou dor forte, formigamento, perda de força ou trauma, não repita essa triagem.
- Ao recomendar, cite no máximo duas opções reais e explique em uma frase a diferença prática entre elas; evite listas vagas de modalidades.
- Mencione que o profissional ajusta a abordagem no máximo uma vez por conversa, salvo se o cliente perguntar sobre segurança ou avaliação.
- Nunca pergunte se a pessoa quer o endereço. Quando for útil para um visitante, informe diretamente o endereço confirmado no contexto.
- Depois de uma resposta curta como "sim" ou "quero sim", cumpra a pergunta ou promessa imediatamente usando a última fala do agente como contexto.
- O PLANO SEMÂNTICO abaixo orienta significado e próxima ação, mas não comprova fatos nem disponibilidade.
- Responda primeiro ao pedido principal. Só inclua oferta opcional quando appropriateNow=true.
- Se nextAction=check_availability, não diga que o horário funciona ou está disponível: informe que o pedido será confirmado pela equipe ou pela integração oficial.
- Nunca peça período quando o plano já contém horário exato.
${repairRequested ? "- Houve sinal de reparo: reconheça o erro em uma frase, corrija o fato confirmado e avance; não defenda a resposta anterior." : ""}

PLANO SEMÂNTICO VALIDADO:
${input.semanticPlan ? JSON.stringify(input.semanticPlan) : "indisponível; interprete o turno com cautela"}

${massageAnalysis.grounding ?? ""}

${latestAssistantReply ? `ÚLTIMA RESPOSTA JÁ ENVIADA — NÃO REPETIR SEM NECESSIDADE:\n${latestAssistantReply}` : ""}

${schedulingInstructions ?? ""}

${catalogContext ?? "CATÁLOGO NEXTFIT: cache ainda indisponível; use somente a base confirmada acima."}

CONTEXTO NORMALIZADO (campos ausentes são desconhecidos; nunca invente; use dados pessoais apenas quando ajudarem; contractTotal é o valor total registrado do contrato e não deve ser descrito como último pagamento):
${customerContextForModel(input.context, new Date(), input.currentTurnMessageIds)}`;
  const routing = whatsappModelRouting();
  const model = routing.model;
  const providerOptions = gatewayProviderOptions({
    fallbackModels: routing.fallbackModels,
    feature: "whatsapp-reply",
  });
  const plainTextModel = routing.fallbackModels[0] ?? model;
  const plainTextProviderOptions = gatewayProviderOptions({
    fallbackModels: routing.fallbackModels.slice(1),
    feature: "whatsapp-reply-fallback",
  });

  let replyPlan: WhatsAppReplyPlan;
  try {
    replyPlan = await generateReplyPlanWithFallback({
      generateStructured: async () => {
        const result = await generateText({
          model,
          output: Output.object({ schema: replyPlanSchema }),
          instructions,
          messages,
          maxOutputTokens: 350,
          maxRetries: 0,
          providerOptions,
          abortSignal: AbortSignal.timeout(WHATSAPP_GENERATION_TIMEOUTS_MS.structured),
        });
        const output = result.output;
        const replyMessages = output.messages.map((message) => message.trim()).filter(Boolean).slice(0, 2);
        if (!replyMessages.length) {
          const error = new Error("Structured generation returned no usable messages");
          error.name = "EmptyStructuredReplyPlanError";
          throw error;
        }
        return { ...output, messages: replyMessages };
      },
      generateDeterministicFallback: () => buildGroundedMassageFallback(
        fallbackMassageAnalysis,
        input.message,
        { allowPartial: false },
      ),
      generatePlainText: async () => {
        const result = await generateText({
          model: plainTextModel,
          instructions: `${instructions}

MODO DE CONTINGÊNCIA:
- Responda somente com o texto final para o cliente, sem JSON, rótulos ou explicações internas.
- Use no máximo 600 caracteres no total.
- Se realmente precisar de dois balões para assuntos diferentes, separe-os com uma linha contendo apenas ---.
- Não repita fatos já respondidos e faça no máximo uma pergunta objetiva.`,
          messages,
          maxOutputTokens: 260,
          maxRetries: 0,
          providerOptions: plainTextProviderOptions,
          abortSignal: AbortSignal.timeout(WHATSAPP_GENERATION_TIMEOUTS_MS.plainText),
        });
        return result.text;
      },
      onAttemptFailure: (attempt, error) => {
        console.warn("WhatsApp reply generation attempt failed", { attempt, error });
      },
    });
  } catch (error) {
    const deterministic = buildGroundedMassageFallback(
      fallbackMassageAnalysis,
      input.message,
      { allowPartial: true },
    );
    if (deterministic) {
      return ensureDeterministicReplyCoverage({
        plan: deterministic,
        message: input.message,
        massageAnalysis: fallbackMassageAnalysis,
        ...(replaysPartiallyAnsweredTurn ? { priorAssistantMessages: previousAssistantMessages } : {}),
      });
    }
    throw error;
  }

  const combinedReply = replyPlan.messages.join("\n");
  if (repairRequested || massageReplyContradictsConfirmedCatalog(massageAnalysis, combinedReply)) {
    const repaired = buildGroundedMassageFallback(
      massageAnalysis,
      input.message,
      { allowPartial: true },
    ) ?? replyPlan;
    return ensureDeterministicReplyCoverage({
      plan: repaired,
      message: input.message,
      massageAnalysis: fallbackMassageAnalysis,
      ...(replaysPartiallyAnsweredTurn ? { priorAssistantMessages: previousAssistantMessages } : {}),
    });
  }
  return ensureDeterministicReplyCoverage({
    plan: replyPlan,
    message: input.message,
    massageAnalysis: fallbackMassageAnalysis,
    ...(replaysPartiallyAnsweredTurn ? { priorAssistantMessages: previousAssistantMessages } : {}),
  });
}

export async function generateWhatsAppReply(input: {
  message: string;
  context: CustomerContext;
}): Promise<string> {
  const plan = await generateWhatsAppReplyPlan(input);
  return plan.messages.join("\n\n");
}
