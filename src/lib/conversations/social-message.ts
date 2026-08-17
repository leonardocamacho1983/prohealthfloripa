import { analyzeMassageRequest } from "../knowledge/massage-catalog-semantics.ts";

export type SocialMessageKind = "greeting" | "gratitude" | "acknowledgement" | "farewell";

const BUSINESS_TERMS = /\b(?:plano|contrato|valor|pre[cç]o|pag\w*|cobran[cç]a|venc\w*|in[ií]cio|servi[cç]o|pilates|massagem|fisioterapia|recovery|agenda\w*|hor[aá]rio|aula|consulta|cancel\w*)\b/i;
const ACKNOWLEDGEMENTS = new Set(["ok", "okay", "blz", "beleza", "certo", "entendi", "combinado", "perfeito", "show"]);
const FAREWELLS = new Set(["tchau", "xau", "ate mais", "ate logo"]);
const GRATITUDE_WORDS = ["obrigado", "obrigada", "agradeco", "valeu"];
const COMMERCIAL_REQUEST = /\b(?:quero|queria|preciso|gostaria|procuro|busco)\b/i;

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isGreetingMessage(text: string): boolean {
  const normalized = normalize(text);
  return /^(?:(?:oi+|ola|alo|e ai)\s+)?(?:bom dia|boa tarde|boa noite)(?:\s+tudo bem)?$/.test(normalized)
    || /^(?:oi+|ola|alo|e ai)(?:\s+tudo bem)?$/.test(normalized)
    || /^(?:tudo bem|como vai)$/.test(normalized);
}

function editDistance(left: string, right: string): number {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = row[0] ?? 0;
    row[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const previous = row[rightIndex] ?? 0;
      row[rightIndex] = left[leftIndex - 1] === right[rightIndex - 1]
        ? diagonal
        : 1 + Math.min(diagonal, row[rightIndex - 1] ?? 0, previous);
      diagonal = previous;
    }
  }
  return row[right.length] ?? 0;
}

function resemblesGratitude(word: string): boolean {
  if (word === "obg" || word === "brigado" || word === "brigada") return true;
  return GRATITUDE_WORDS.some((candidate) =>
    word.length >= 5 && editDistance(word, candidate) <= (candidate.length >= 8 ? 2 : 1));
}

export function classifySocialMessage(text: string): SocialMessageKind | undefined {
  // Questions such as "tudo bem?" are still social. This exact-match check
  // must run before the generic question guard so a greeting-only burst never
  // wakes the business agent with stale conversational context.
  if (isGreetingMessage(text)) return "greeting";
  const confirmedMassageRequest = COMMERCIAL_REQUEST.test(text)
    && analyzeMassageRequest(text).mentions.length > 0;
  if (BUSINESS_TERMS.test(text) || confirmedMassageRequest || text.includes("?")) return undefined;
  const normalized = normalize(text);
  if (!normalized) return undefined;
  const words = normalized.split(" ");

  if (words.some(resemblesGratitude)) return "gratitude";
  if (ACKNOWLEDGEMENTS.has(normalized)) return "acknowledgement";
  if (FAREWELLS.has(normalized)) return "farewell";
  return undefined;
}

export function buildSocialReply(kind: SocialMessageKind, firstName?: string): string {
  const name = firstName ? `, ${firstName}` : "";
  if (kind === "greeting") return `Oi${name}! Tudo bem? Como posso ajudar?`;
  if (kind === "gratitude") return `De nada${name} 🙂 Se precisar, é só me chamar.`;
  if (kind === "farewell") return `Até mais${name}! Se precisar, é só me chamar.`;
  return `Tudo certo${name} 🙂`;
}
