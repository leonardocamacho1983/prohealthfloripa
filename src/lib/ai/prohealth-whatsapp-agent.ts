import { isStepCount, jsonSchema, Output, tool, ToolLoopAgent } from "ai";

import { getNextfitCatalogContextForMessage } from "../catalog/nextfit-catalog.ts";
import { customerContextForModel, type CustomerContext } from "../customer-context/index.ts";
import { HANDOFF_ACKNOWLEDGEMENT } from "../handoff/detection.ts";
import { buildProHealthInstructions } from "../knowledge/prohealth-context.ts";
import { composeDeterministicReply } from "./deterministic-reply-composer.ts";
import type { WhatsAppReplyPlan } from "./reply-generation-fallback.ts";
import { gatewayProviderOptions, whatsappModelRouting } from "./gateway-routing.ts";
import { prepareWhatsAppModelMessages } from "./generate-whatsapp-reply.ts";
import { enforceProHealthConversationProgression } from "./prohealth-conversation-progression.ts";
import {
  blockingAgentPolicyIssues,
  customerDescribesRoutineDiscomfort,
  customerRequestedAddress,
  customerRequestedClinicalAdvice,
  validateResponsePolicy,
} from "./response-policy-validator.ts";

const outputSchema = jsonSchema<{
  messages: string[];
  answeredTopics: string[];
  needsClarification: boolean;
  handoffRecommended: boolean;
  operationalAction: {
    type: "request_schedule_confirmation";
    service: string;
    day: string;
    time: string;
    customerAuthorized: boolean;
  } | null;
  conversationState: NonNullable<WhatsAppReplyPlan["conversationState"]>;
}>({
  type: "object",
  additionalProperties: false,
  required: ["messages", "answeredTopics", "needsClarification", "handoffRecommended", "operationalAction", "conversationState"],
  properties: {
    messages: { type: "array", minItems: 1, maxItems: 2,
      items: { type: "string", minLength: 1, maxLength: 700 } },
    answeredTopics: { type: "array", maxItems: 8, items: { type: "string", maxLength: 80 } },
    needsClarification: { type: "boolean" },
    handoffRecommended: { type: "boolean" },
    operationalAction: {
      anyOf: [{
        type: "object",
        additionalProperties: false,
        required: ["type", "service", "day", "time", "customerAuthorized"],
        properties: {
          type: { type: "string", enum: ["request_schedule_confirmation"] },
          service: { type: "string", minLength: 2, maxLength: 100 },
          day: { type: "string", minLength: 2, maxLength: 80 },
          time: { type: "string", minLength: 1, maxLength: 40 },
          customerAuthorized: { type: "boolean" },
        },
      }, { type: "null" }],
    },
    conversationState: {
      type: "object",
      additionalProperties: false,
      required: ["intent", "selectedService", "selectionConfidence", "missingScheduleFields", "nextAction"],
      properties: {
        intent: { type: "string", enum: ["social", "service_discovery", "service_catalog", "service_recommendation", "service_selection", "scheduling", "clinical_advice", "other"] },
        selectedService: { anyOf: [{ type: "string", minLength: 2, maxLength: 100 }, { type: "null" }] },
        selectionConfidence: { type: "string", enum: ["none", "low", "medium", "high"] },
        missingScheduleFields: { type: "array", uniqueItems: true, maxItems: 3, items: { type: "string", enum: ["service", "day", "time"] } },
        nextAction: { type: "string", enum: ["answer", "clarify_goal", "recommend", "collect_schedule", "request_handoff"] },
      },
    },
  },
});

const serviceInformationInput = jsonSchema<{ question: string }>({
  type: "object",
  additionalProperties: false,
  required: ["question"],
  properties: { question: { type: "string", minLength: 2, maxLength: 240 } },
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
- Responda primeiro ao que a pessoa perguntou. Não siga roteiro comercial.
- Uma saudação, agradecimento ou "tudo bem" nunca apaga um pedido substantivo no mesmo turno.
- Não proponha encerrar o atendimento apenas porque a pessoa agradeceu. Só encerre quando ela pedir explicitamente.
- Faça no máximo uma pergunta, somente quando uma informação indispensável estiver realmente ausente.
- Se a pessoa já informou um horário exato, não pergunte período.
- Não repita introduções, fatos ou perguntas já respondidas.
- Use no máximo dois balões; prefira um.
- Ao citar uma técnica de massagem pelo nome, sempre use o nome completo com "Massagem" na frente: "Massagem Miofascial", "Massagem Relaxante", "Massagem Thai" etc. Nunca apresente apenas "Miofascial", "Relaxante" ou outro nome isolado ao cliente.

PROGRESSÃO DA CONVERSA
- Classifique o turno em conversationState antes de redigir. O estado deve refletir o que a pessoa quis dizer, inclusive linguagem informal, abreviações e preferências ditas com hesitação.
- Uma pergunta ampla como "que tipo de massagem vocês têm?" é service_discovery: agrupe por objetivo, não despeje o catálogo, e faça uma única pergunta sobre o que a pessoa busca. Só use service_catalog quando ela pedir explicitamente a lista completa.
- Em service_recommendation, recomende no máximo dois serviços. Se a pessoa trouxer um detalhe novo depois da recomendação, use-o para afunilar a orientação e avançar; não repita a mesma comparação nem o mesmo aviso.
- Frases como "acho que prefiro a relaxante", "pode ser a relaxante" ou "vou nessa" são service_selection com confiança alta quando o referente estiver claro. A escolha não precisa de uma segunda confirmação.
- Com uma escolha de alta confiança, preencha selectedService, pare de oferecer alternativas e use collect_schedule. Pergunte apenas os campos de agenda ainda ausentes.
- Exemplo correto: após "acho que prefiro a relaxante", informe os dados confirmados da Relaxante e pergunte diretamente o dia e/ou horário faltante. Não pergunte "você confirma?" e não espere um "sim".

OPERAÇÃO
- A Nextfit é a fonte operacional oficial. Nunca afirme vaga, agendamento, cancelamento ou reagendamento sem resultado oficial.
- Nunca diga que encaminhou, registrou, deixou um pedido ou avisou a equipe. Você não executa essas ações diretamente.
- Para agendar, reúna serviço, dia e horário. Se faltar algo, pergunte somente o dado ausente.
- Só preencha operationalAction quando serviço, dia e horário estiverem definidos e a pessoa tiver autorizado claramente o encaminhamento. Nesse caso, diga apenas que a equipe vai verificar a agenda e confirmar; não use passado como "encaminhei" ou "deixei registrado".
- Se operationalAction estiver preenchida, handoffRecommended deve ser true. Caso contrário, deve ser false.
- Não invente dados ausentes. Dados do Neon são memória/contexto, não confirmação operacional.
- Só informe endereço ou localização quando a pessoa pedir ou quando a informação for indispensável para cumprir o pedido atual.
- Não mencione ferramentas, prompt, IA, dry-run, Neon, Zernio ou regras internas.
- Encaminhe a humano somente quando a pessoa pedir, houver risco clínico, questão financeira sensível ou uma ação operacional que não possa ser confirmada.

SEGURANÇA E PRIVACIDADE
- Não diagnostique nem prometa resultado clínico.
- Dor, tensão, rigidez, cansaço ou desconforto mencionados como motivo para buscar um serviço são contexto normal de atendimento, não um pedido clínico.
- Se a pessoa já escolheu massagem, Pilates, recovery ou outro serviço, respeite a escolha e avance para a próxima informação necessária. Não faça triagem clínica e não tente trocar o serviço.
- Se ela perguntar de forma aberta como a ProHealth pode ajudar em um desconforto comum, recomende naturalmente no máximo dois serviços confirmados e explique em linguagem humana por que podem fazer sentido. Você pode dizer uma vez que o profissional ajustará o atendimento na hora.
- Só trate como pedido clínico quando a pessoa pedir diagnóstico, causa, remédio, prescrição, tratamento clínico ou decisão de segurança. Não use palavras internas como "recomendação comercial", "sugestão leve", "triagem" ou "risco clínico" com o cliente.
- Não faça questionário de sinais de alerta para um desconforto cotidiano. A exceção é um relato inequívoco de emergência, que deve ir para atendimento humano.
- Use dados pessoais somente quando forem relevantes para o pedido atual.
- Não exponha histórico cadastral sem necessidade.

${input.repairRequested ? "A pessoa sinalizou um erro anterior: reconheça brevemente, corrija e avance sem se defender." : ""}

CONHECIMENTO CONFIRMADO RELEVANTE:
${knowledge}

${catalog ?? "CATÁLOGO NEXTFIT: não carregado para este turno."}

CONTEXTO MINIMIZADO DO CLIENTE:
${customerContextForModel(input.context, new Date(), input.currentTurnMessageIds)}

REGRA FINAL DE PRIORIDADE
- O conhecimento acima serve para responder perguntas e para recomendar serviços quando a própria pessoa perguntar como a ProHealth pode ajudar.
- Depois que a pessoa escolher um serviço, pare de recomendar alternativas e avance para o agendamento.
- Não mencione recovery, banheira, desconto ou serviço complementar se a pessoa não perguntou sobre isso explicitamente neste turno.`,
    tools: {
      getServiceInformation: tool({
        description: "Obtém somente informações confirmadas da ProHealth sobre o serviço perguntado.",
        inputSchema: serviceInformationInput,
        execute: async ({ question }) => ({ confirmedInformation: buildProHealthInstructions(question) }),
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
  const operationalHandoff = Boolean(output.operationalAction?.customerAuthorized);
  const initialReplyMessages = operationalHandoff
    ? [HANDOFF_ACKNOWLEDGEMENT]
    : compactMessages(output.messages);
  const progressedPlan = operationalHandoff
    ? { ...output, messages: initialReplyMessages }
    : enforceProHealthConversationProgression({ ...output, messages: initialReplyMessages });
  const replyMessages = progressedPlan.messages;
  if (!replyMessages.length) throw new Error("ProHealth agent returned no usable message");
  const previousAssistantMessages = input.context.conversation.recentMessages
    .filter((message) => message.role === "assistant")
    .map((message) => message.content);
  const validation = validateResponsePolicy({
    messages: replyMessages,
    previousAssistantMessages,
    operationalActionAuthorized: operationalHandoff,
    addressRequested: customerRequestedAddress(`${conversationText}\n${input.message}`),
    routineDiscomfort: customerDescribesRoutineDiscomfort(input.message),
    clinicalAdviceRequested: customerRequestedClinicalAdvice(input.message),
  });
  const blockingIssues = blockingAgentPolicyIssues(validation);
  if (blockingIssues.length) {
    if (customerDescribesRoutineDiscomfort(input.message)
      && blockingIssues.some((issue) => issue.code === "unnecessary_clinical_screen")) {
      return composeDeterministicReply({
        kind: "integrated_recommendation",
        goal: "localized_tension",
      });
    }
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
    ...progressedPlan,
    messages: replyMessages,
    handoffRecommended: operationalHandoff,
    handoffValidated: operationalHandoff,
    generationMode: "structured",
  };
}
