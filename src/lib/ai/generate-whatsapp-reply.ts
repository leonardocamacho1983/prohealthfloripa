import { generateText } from "ai";

import {
  customerContextForModel,
  type CustomerContext,
} from "@/lib/customer-context";
import { buildProHealthInstructions } from "@/lib/knowledge/prohealth-context";

const MODEL = "openai/gpt-5.4-mini";

export async function generateWhatsAppReply(input: {
  message: string;
  context: CustomerContext;
}): Promise<string> {
  const relevantText = input.context.conversation.recentMessages
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join("\n");
  const { text } = await generateText({
    model: MODEL,
    instructions: `${buildProHealthInstructions(relevantText)}\n\nCONTEXTO NORMALIZADO (campos ausentes são desconhecidos; nunca invente; use dados pessoais de modo natural e somente quando ajudarem a resposta; contractTotal é o valor total registrado do contrato e não deve ser descrito como último pagamento):\n${customerContextForModel(input.context)}`,
    messages: input.context.conversation.recentMessages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    maxOutputTokens: 200,
    abortSignal: AbortSignal.timeout(20_000),
  });

  const reply = text.trim();
  if (!reply) {
    throw new Error("Empty AI response");
  }

  return reply;
}
