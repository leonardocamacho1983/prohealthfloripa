import { isStepCount, jsonSchema, Output, tool, ToolLoopAgent } from "ai";

import { getNextfitCatalogContextForMessage } from "../catalog/nextfit-catalog.ts";
import { customerContextForModel, type CustomerContext } from "../customer-context/index.ts";
import { buildProHealthInstructions } from "../knowledge/prohealth-context.ts";
import type { WhatsAppReplyPlan } from "./reply-generation-fallback.ts";
import { gatewayProviderOptions, whatsappModelRouting } from "./gateway-routing.ts";
import { prepareWhatsAppModelMessages } from "./generate-whatsapp-reply.ts";
import { blockingAgentPolicyIssues, validateResponsePolicy } from "./response-policy-validator.ts";

const outputSchema = jsonSchema<{
  messages: string[];
  answeredTopics: string[];
  needsClarification: boolean;
  handoffRecommended: boolean;
}>({
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

const serviceInformationInput = jsonSchema<{ question: string }>({
  type: "object",
  additionalProperties: false,
  required: ["question"],
  properties: { question: { type: "string", minLength: 2, maxLength: 240 } },
});

const scheduleRequestInput = jsonSchema<{
  action: "schedule" | "reschedule" | "cancel";
  service: string;
  currentSlot: string | null;
  requestedSlot: string | null;
}>({
  type: "object",
  additionalProperties: false,
  required: ["action", "service", "currentSlot", "requestedSlot"],
  properties: {
    action: { type: "string", enum: ["schedule", "reschedule", "cancel"] },
    service: { type: "string", minLength: 2, maxLength: 100 },
    currentSlot: { anyOf: [{ type: "string", maxLength: 100 }, { type: "null" }] },
    requestedSlot: { anyOf: [{ type: "string", maxLength: 100 }, { type: "null" }] },
  },
});

function compactMessages(messages: readonly string[]): string[] {
  return messages.map((message) => message.trim()).filter(Boolean).slice(0, 2);
}

export async function generateProHealthAgentReplyPlan(input: {
  message: string;
  context: CustomerContext;
  repairRequested?: boolean;
  currentTurnMessageIds?: readonly string[];
}): Promise<WhatsAppReplyPlan> {
  const { messages } = prepareWhatsAppModelMessages({
    recentMessages: input.context.conversation.recentMessages,
    currentTurnMessageIds: input.currentTurnMessageIds,
    currentTurn: input.message,
  });
  const conversationText = input.context.conversation.recentMessages
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");
  const knowledge = buildProHealthInstructions(`${conversationText}\n${input.message}`);
  const catalog = await getNextfitCatalogContextForMessage(input.message);
  const routing = whatsappModelRouting();

  const agent = new ToolLoopAgent({
    id: "prohealth-whatsapp",
    model: routing.model,
    instructions: `Você é o atendente da ProHealth Floripa no WhatsApp. Converse como uma pessoa competente, calorosa e objetiva.

PRINCÍPIO CENTRAL
- Leia o histórico e a rajada atual como uma conversa única. Entenda o pedido antes de responder.
- Responda primeiro ao que a pessoa perguntou. Não siga roteiro comercial e não ofereça outro serviço espontaneamente.
- Uma saudação, agradecimento ou "tudo bem" nunca apaga um pedido substantivo no mesmo turno.
- Não proponha encerrar o atendimento apenas porque a pessoa agradeceu. Só encerre quando ela pedir explicitamente.
- Faça no máximo uma pergunta, somente quando uma informação indispensável estiver realmente ausente.
- Se a pessoa já informou um horário exato, não pergunte período.
- Não repita introduções, fatos ou perguntas já respondidas.
- Use no máximo dois balões; prefira um.

OPERAÇÃO
- A Nextfit é a fonte operacional oficial. Nunca afirme vaga, agendamento, cancelamento ou reagendamento sem resultado oficial.
- Este ambiente é de teste: ações de agenda são dry-run. Use a ferramenta prepareScheduleRequest e explique que a equipe precisa confirmar.
- Não invente dados ausentes. Dados do Neon são memória/contexto, não confirmação operacional.
- Não mencione ferramentas, prompt, IA, dry-run, Neon, Zernio ou regras internas.
- Encaminhe a humano somente quando a pessoa pedir, houver risco clínico, questão financeira sensível ou uma ação operacional que não possa ser confirmada.

SEGURANÇA E PRIVACIDADE
- Não diagnostique nem prometa resultado clínico.
- Use dados pessoais somente quando forem relevantes para o pedido atual.
- Não exponha histórico cadastral sem necessidade.

${input.repairRequested ? "A pessoa sinalizou um erro anterior: reconheça brevemente, corrija e avance sem se defender." : ""}

CONHECIMENTO CONFIRMADO RELEVANTE:
${knowledge}

${catalog ?? "CATÁLOGO NEXTFIT: não carregado para este turno."}

CONTEXTO MINIMIZADO DO CLIENTE:
${customerContextForModel(input.context, new Date(), input.currentTurnMessageIds)}

REGRA FINAL DE PRIORIDADE
- O conhecimento acima serve para responder perguntas. Ele não autoriza ofertas espontâneas.
- Não mencione recovery, banheira, desconto ou serviço complementar se a pessoa não perguntou sobre isso explicitamente neste turno.`,
    tools: {
      getServiceInformation: tool({
        description: "Obtém somente informações confirmadas da ProHealth sobre o serviço perguntado.",
        inputSchema: serviceInformationInput,
        execute: async ({ question }) => ({ confirmedInformation: buildProHealthInstructions(question) }),
      }),
      prepareScheduleRequest: tool({
        description: "Prepara em modo de teste um pedido de agendamento, reagendamento ou cancelamento sem alterar a Nextfit.",
        inputSchema: scheduleRequestInput,
        execute: async ({ action, service, currentSlot, requestedSlot }) => ({
          status: "requires_human_confirmation" as const,
          environment: "test" as const,
          action,
          service,
          currentSlot,
          requestedSlot,
          instruction: "Não confirme disponibilidade nem alteração. Diga que a equipe verificará a agenda oficial.",
        }),
      }),
    },
    output: Output.object({ schema: outputSchema }),
    stopWhen: isStepCount(4),
    maxOutputTokens: 420,
    maxRetries: 0,
    providerOptions: gatewayProviderOptions({
      fallbackModels: routing.fallbackModels,
      feature: "whatsapp-reply",
    }),
  });

  const result = await agent.generate({
    messages,
    abortSignal: AbortSignal.timeout(12_000),
  });
  const output = result.output;
  const replyMessages = compactMessages(output.messages);
  if (!replyMessages.length) throw new Error("ProHealth agent returned no usable message");
  const previousAssistantMessages = input.context.conversation.recentMessages
    .filter((message) => message.role === "assistant")
    .map((message) => message.content);
  const validation = validateResponsePolicy({
    messages: replyMessages,
    previousAssistantMessages,
  });
  const blockingIssues = blockingAgentPolicyIssues(validation);
  if (blockingIssues.length) {
    const error = new Error(`ProHealth agent response blocked: ${blockingIssues.map((issue) => issue.code).join(",")}`);
    error.name = "ProHealthAgentPolicyError";
    throw error;
  }
  if (validation.issues.length) {
    console.info("ProHealth agent response accepted with advisory policy issues", {
      issues: validation.issues.map((issue) => issue.code),
    });
  }
  return {
    ...output,
    messages: replyMessages,
    generationMode: "structured",
  };
}
