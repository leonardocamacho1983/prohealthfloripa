import { generateText, jsonSchema, Output } from "ai";

import {
  customerContextForModel,
  type CustomerContext,
} from "@/lib/customer-context";
import { getNextfitCatalogContext } from "@/lib/catalog/nextfit-catalog";
import { buildProHealthInstructions } from "@/lib/knowledge/prohealth-context";
import { buildSchedulingInstructions } from "@/lib/nextfit/scheduling";

const MODEL = "openai/gpt-5.4-mini";

export type WhatsAppReplyPlan = {
  messages: string[];
  answeredTopics: string[];
  needsClarification: boolean;
  handoffRecommended: boolean;
};

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

export async function generateWhatsAppReplyPlan(input: {
  message: string;
  context: CustomerContext;
  repairRequested?: boolean;
}): Promise<WhatsAppReplyPlan> {
  const catalogContext = await getNextfitCatalogContext();
  const schedulingInstructions = buildSchedulingInstructions(input.message);
  const latestAssistantReply = input.context.conversation.recentMessages
    .filter((message) => message.role === "assistant").at(-1)?.content;
  const relevantText = input.context.conversation.recentMessages
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join("\n");
  const { output } = await generateText({
    model: process.env.WHATSAPP_AI_MODEL ?? MODEL,
    output: Output.object({ schema: replyPlanSchema }),
    instructions: `${buildProHealthInstructions(`${relevantText}\n${input.message}`)}

REGRAS DO TURNO ATUAL:
- O cliente pode escrever em vários balões curtos. Trate as mensagens numeradas abaixo como um único turno, em ordem.
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
${input.repairRequested ? "- Houve sinal de reparo: reconheça brevemente e responda imediatamente ao pedido pendente." : ""}

${latestAssistantReply ? `ÚLTIMA RESPOSTA JÁ ENVIADA — NÃO REPETIR SEM NECESSIDADE:\n${latestAssistantReply}` : ""}

${schedulingInstructions ?? ""}

${catalogContext ?? "CATÁLOGO NEXTFIT: cache ainda indisponível; use somente a base comercial confirmada acima."}

TURNO CONSOLIDADO:
${input.message}

CONTEXTO NORMALIZADO (campos ausentes são desconhecidos; nunca invente; use dados pessoais apenas quando ajudarem; contractTotal é o valor total registrado do contrato e não deve ser descrito como último pagamento):
${customerContextForModel(input.context)}`,
    messages: input.context.conversation.recentMessages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    maxOutputTokens: 350,
    abortSignal: AbortSignal.timeout(20_000),
  });
  const messages = output.messages.map((message) => message.trim()).filter(Boolean).slice(0, 2);
  if (!messages.length) throw new Error("Empty AI response plan");
  return { ...output, messages };
}

export async function generateWhatsAppReply(input: {
  message: string;
  context: CustomerContext;
}): Promise<string> {
  const plan = await generateWhatsAppReplyPlan(input);
  return plan.messages.join("\n\n");
}
