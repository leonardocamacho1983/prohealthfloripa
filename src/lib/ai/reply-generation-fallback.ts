import { summarizeAiError, type SafeAiErrorSummary } from "./error-summary.ts";

export type WhatsAppReplyGenerationMode =
  | "structured"
  | "plain_text_fallback"
  | "deterministic_fallback";

export type WhatsAppReplyPlan = {
  messages: string[];
  answeredTopics: string[];
  needsClarification: boolean;
  handoffRecommended: boolean;
  handoffValidated?: boolean;
  generationMode?: WhatsAppReplyGenerationMode;
};

export type ReplyGenerationAttempt = "structured" | "plain_text_fallback";

export class WhatsAppReplyGenerationError extends Error {
  readonly structuredError: SafeAiErrorSummary;
  readonly plainTextError: SafeAiErrorSummary;

  constructor(input: {
    structuredError: SafeAiErrorSummary;
    plainTextError: SafeAiErrorSummary;
  }) {
    super("Both structured and plain-text WhatsApp reply generation failed");
    this.name = "WhatsAppReplyGenerationError";
    this.structuredError = input.structuredError;
    this.plainTextError = input.plainTextError;
  }
}

function truncateAtWordBoundary(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const candidate = value.slice(0, maxLength - 1);
  const lastBoundary = candidate.lastIndexOf(" ");
  const truncated = (lastBoundary >= Math.floor(maxLength * 0.7)
    ? candidate.slice(0, lastBoundary)
    : candidate).trimEnd();
  return `${truncated}…`;
}

export function plainTextReplyToMessages(text: string): string[] {
  const withoutFences = text.trim()
    .replace(/^```(?:text|markdown)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  if (!withoutFences) return [];

  const explicitBubbles = withoutFences
    .split(/\n\s*(?:---|<BOLHA>|\[NOVA_MENSAGEM\])\s*\n/iu)
    .map((message) => message.trim())
    .filter(Boolean);
  const selected = explicitBubbles.length > 1
    ? explicitBubbles.slice(0, 2)
    : [withoutFences];
  return selected.map((message) => truncateAtWordBoundary(message, 700));
}

export async function generateReplyPlanWithFallback(input: {
  generateStructured: () => Promise<WhatsAppReplyPlan>;
  generateDeterministicFallback?: (structuredError: SafeAiErrorSummary) => WhatsAppReplyPlan | undefined;
  generatePlainText: () => Promise<string>;
  onAttemptFailure?: (attempt: ReplyGenerationAttempt, summary: SafeAiErrorSummary) => void;
}): Promise<WhatsAppReplyPlan> {
  let structuredError: SafeAiErrorSummary;
  try {
    const structured = await input.generateStructured();
    return { ...structured, generationMode: "structured" };
  } catch (error) {
    structuredError = summarizeAiError(error);
    input.onAttemptFailure?.("structured", structuredError);
  }

  const deterministic = input.generateDeterministicFallback?.(structuredError);
  if (deterministic) {
    return { ...deterministic, generationMode: "deterministic_fallback" };
  }

  try {
    const messages = plainTextReplyToMessages(await input.generatePlainText());
    if (!messages.length) {
      const error = new Error("Plain-text fallback returned no usable messages");
      error.name = "EmptyPlainTextFallbackError";
      throw error;
    }
    return {
      messages,
      answeredTopics: [],
      needsClarification: false,
      handoffRecommended: false,
      generationMode: "plain_text_fallback",
    };
  } catch (error) {
    const plainTextError = summarizeAiError(error);
    input.onAttemptFailure?.("plain_text_fallback", plainTextError);
    throw new WhatsAppReplyGenerationError({ structuredError, plainTextError });
  }
}
