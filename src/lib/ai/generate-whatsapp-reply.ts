import { generateText } from "ai";

const MODEL = "openai/gpt-5.4-mini";

const INSTRUCTIONS = `Você é um assistente virtual de teste da ProHealth Floripa no WhatsApp.
Responda em português do Brasil, de forma clara, cordial e concisa, em no máximo três frases curtas.
Você ainda não tem acesso a agenda, preços, dados de pacientes, Nextfit, ferramentas, banco de dados ou histórico da conversa.
Não invente informações e não afirme que realizou ações. Quando uma solicitação depender desses recursos, informe com clareza que essa capacidade ainda não está disponível neste teste.`;

export async function generateWhatsAppReply(message: string): Promise<string> {
  const { text } = await generateText({
    model: MODEL,
    instructions: INSTRUCTIONS,
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
