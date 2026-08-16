import { generateText } from "ai";

import { buildProHealthInstructions } from "@/lib/knowledge/prohealth-context";

const MODEL = "openai/gpt-5.4-mini";

export async function generateWhatsAppReply(message: string): Promise<string> {
  const { text } = await generateText({
    model: MODEL,
    instructions: buildProHealthInstructions(message),
    prompt: message,
    maxOutputTokens: 200,
    abortSignal: AbortSignal.timeout(20_000),
  });

  const reply = text.trim();
  if (!reply) {
    throw new Error("Empty AI response");
  }

  return reply;
}
