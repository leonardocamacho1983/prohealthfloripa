import { proHealthKnowledge } from "../knowledge/prohealth.ts";

const SAFETY_SCREEN = /\b(?:dor\s+(?:muito\s+)?forte|formigamento|perda\s+de\s+for[cç]a|trauma)\b/gi;
const ADDRESS_GATE = /\bquer(?:\s+que)?\s+eu\b[^.!?]{0,100}\b(?:diga|passe|mostre|explique)\b[^.!?]{0,100}\b(?:chegar|endere[cç]o|unidade|localiza[cç][aã]o)\b/i;
const DEFERRED_VALUE = /\bse\s+(?:voc[eê]\s+)?quiser\b[^.!?]{0,100}\b(?:posso|passo|explico|mostro|oriento)\b|\bposso\s+(?:te|lhe)\s+(?:passar|explicar|mostrar|orientar)\b/i;
const PROFESSIONAL_SENTENCE = /^(?:O|A)\s+profissional\b[^.!?]{0,180}\b(?:ajusta|avalia|define|conversa)\b[^.!?]*[.!?]?$/i;
const PROFESSIONAL_CLAUSE = /,?\s*(?:e\s+)?(?:sempre\s+)?(?:de\s+acordo\s+com|conforme)\s+(?:a\s+)?avalia[cç][aã]o\s+profissional\s+(?:no\s+)?in[ií]cio/gi;

function splitSentences(message: string): string[] {
  return message
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function repairAssistedReplyMessages(input: {
  messages: readonly string[];
  safetyStatus: "not_asked" | "asked" | "cleared" | "flagged";
  professionalAdjustmentMentioned: boolean;
  includeVisitorAddress: boolean;
  addressSent: boolean;
}): string[] {
  let shouldAppendAddress = false;
  const repaired = input.messages.map((message) => splitSentences(message).flatMap((sentence) => {
    const safetySignals = sentence.match(SAFETY_SCREEN) ?? [];
    if ((input.safetyStatus === "asked" || input.safetyStatus === "cleared")
      && safetySignals.length >= 2 && sentence.includes("?")) {
      return [];
    }
    if (ADDRESS_GATE.test(sentence)) {
      shouldAppendAddress = input.includeVisitorAddress && !input.addressSent;
      return [];
    }
    if (DEFERRED_VALUE.test(sentence)) return [];
    if (input.professionalAdjustmentMentioned && PROFESSIONAL_SENTENCE.test(sentence)) return [];
    const withoutRepeatedClause = input.professionalAdjustmentMentioned
      ? sentence.replace(PROFESSIONAL_CLAUSE, "").replace(/\s+([,.!?])/g, "$1").trim()
      : sentence;
    return withoutRepeatedClause ? [withoutRepeatedClause] : [];
  }).join(" ").trim()).filter(Boolean).slice(0, 2);

  if (shouldAppendAddress) {
    const address = `Estamos na ${proHealthKnowledge.institutional.address}.`;
    const lastIndex = Math.max(0, repaired.length - 1);
    if (repaired[lastIndex] && repaired[lastIndex]!.length + address.length + 1 <= 700) {
      repaired[lastIndex] = `${repaired[lastIndex]} ${address}`;
    } else if (repaired.length < 2) {
      repaired.push(address);
    }
  }
  return repaired;
}
