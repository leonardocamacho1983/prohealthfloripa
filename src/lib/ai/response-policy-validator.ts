export type ResponsePolicyIssueCode =
  | "empty"
  | "too_many_bubbles"
  | "bubble_too_long"
  | "too_many_questions"
  | "false_booking_confirmation"
  | "hot_bath_before_pilates"
  | "robotic_relaxation_language"
  | "internal_language_leak"
  | "deferred_value"
  | "repeated_safety_screen"
  | "repeated_professional_disclaimer"
  | "address_permission_gate"
  | "repeated_fact";

export type ResponsePolicyValidation = {
  valid: boolean;
  issues: Array<{ code: ResponsePolicyIssueCode; detail: string }>;
};

const BOOKING_CONFIRMATION = /\b(?:agendei|reservei|confirmei|marquei)|\b(?:est[aá]|ficou|foi)\s+(?:agendad[oa]|reservad[oa]|confirmad[oa]|marcad[oa])\b|\b(?:j[aá]\s+)?deixei\s+marcad[oa]\b|\b(?:hor[aá]rio|vaga)\s+(?:est[aá]\s+)?garantid[oa]\b|\bj[aá]\s+est[aá]\s+na\s+agenda\b/i;
const HOT_BEFORE_PILATES = /banheira\s+quente[^.!?]{0,80}\bantes\b[^.!?]{0,40}\bpilates\b|\bantes\b[^.!?]{0,80}banheira\s+quente/i;

const FACT_PATTERNS = {
  massage_price: /R\$\s*270\b/i,
  massage_duration: /\b(?:uma|1)\s+hora(?:\s+completa)?\b|\b60\s+minutos?\b/i,
  hot_bath_offer: /banheira\s+quente[^.!?]{0,120}R\$\s*35|R\$\s*35[^.!?]{0,120}banheira\s+quente/i,
} as const;

export function validateResponsePolicy(input: {
  messages: readonly string[];
  previousAssistantMessages?: readonly string[];
  allowRepeatedFacts?: readonly (keyof typeof FACT_PATTERNS)[];
  safetyStatus?: "not_asked" | "asked" | "cleared" | "flagged";
  professionalAdjustmentMentioned?: boolean;
}): ResponsePolicyValidation {
  const issues: ResponsePolicyValidation["issues"] = [];
  const messages = input.messages.map((message) => message.trim()).filter(Boolean);
  if (!messages.length) issues.push({ code: "empty", detail: "A resposta não contém texto utilizável." });
  if (messages.length > 2) issues.push({ code: "too_many_bubbles", detail: "A resposta excede dois balões." });
  for (const message of messages) {
    if (message.length > 700) issues.push({ code: "bubble_too_long", detail: "Um balão excede 700 caracteres." });
  }

  const text = messages.join("\n");
  if ((text.match(/\?/g) ?? []).length > 1) {
    issues.push({ code: "too_many_questions", detail: "A resposta contém mais de uma pergunta." });
  }
  if (BOOKING_CONFIRMATION.test(text) && !/n[aã]o\s+(?:est[aá]|foi|ficou)\s+(?:agendad|reservad|confirmad)/i.test(text)) {
    issues.push({ code: "false_booking_confirmation", detail: "A resposta afirma uma reserva sem confirmação oficial." });
  }
  if (HOT_BEFORE_PILATES.test(text)) {
    issues.push({ code: "hot_bath_before_pilates", detail: "A banheira quente não pode ser oferecida antes do Pilates." });
  }
  if (/percep[cç][aã]o\s+de\s+relaxamento|(?:para|e)\s+(?:a\s+)?sensa[cç][aã]o\s+de\s+tens[aã]o/i.test(text)) {
    issues.push({ code: "robotic_relaxation_language", detail: "A formulação de relaxamento está mecânica ou ambígua." });
  }
  if (/\b(?:comercial|jornada|convers[aã]o|lead|funil|roteamento|pipeline)\b/i.test(text)) {
    issues.push({ code: "internal_language_leak", detail: "A resposta expõe vocabulário interno ao cliente." });
  }
  if (/\bse\s+(?:voc[eê]\s+)?quiser\b[^.!?]{0,100}\b(?:posso|passo|explico|mostro|oriento)\b|\bposso\s+(?:te|lhe)\s+(?:passar|explicar|mostrar|orientar)\b/i.test(text)) {
    issues.push({ code: "deferred_value", detail: "A resposta pede permissão para entregar valor em vez de responder e avançar." });
  }
  const safetySignals = text.match(/\b(?:dor\s+(?:muito\s+)?forte|formigamento|perda\s+de\s+for[cç]a|trauma)\b/gi) ?? [];
  if ((input.safetyStatus === "asked" || input.safetyStatus === "cleared")
    && safetySignals.length >= 2 && text.includes("?")) {
    issues.push({ code: "repeated_safety_screen", detail: "A resposta repete uma triagem de segurança já feita." });
  }
  if (input.professionalAdjustmentMentioned
    && /\bprofissional\b[^.!?]{0,140}\b(?:ajusta|avalia|define|conversa)\b|\bavalia[cç][aã]o\s+profissional\s+(?:no\s+)?in[ií]cio\b/i.test(text)) {
    issues.push({ code: "repeated_professional_disclaimer", detail: "A resposta repete a mesma ressalva profissional." });
  }
  if (/\bquer(?:\s+que)?\s+eu\b[^.!?]{0,100}\b(?:diga|passe|mostre|explique)\b[^.!?]{0,100}\b(?:chegar|endere[cç]o|unidade|localiza[cç][aã]o)\b/i.test(text)) {
    issues.push({ code: "address_permission_gate", detail: "A resposta pede permissão para informar o endereço." });
  }

  const prior = (input.previousAssistantMessages ?? []).join("\n");
  const allowed = new Set(input.allowRepeatedFacts ?? []);
  for (const [fact, pattern] of Object.entries(FACT_PATTERNS) as Array<[keyof typeof FACT_PATTERNS, RegExp]>) {
    if (!allowed.has(fact) && pattern.test(prior) && pattern.test(text)) {
      issues.push({ code: "repeated_fact", detail: `O fato ${fact} já havia sido informado.` });
    }
  }
  return { valid: issues.length === 0, issues };
}
