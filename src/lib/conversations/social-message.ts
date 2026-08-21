import { analyzeMassageRequest } from "../knowledge/massage-catalog-semantics.ts";

export type SocialMessageKind = "greeting" | "gratitude" | "acknowledgement" | "farewell" | "satisfaction";
export type GreetingDaypart = "morning" | "afternoon" | "evening";
export type GreetingContext = { daypart?: GreetingDaypart };

const BUSINESS_TERMS = /\b(?:plano|contrato|valor|pre[cç]o|pag\w*|cobran[cç]a|venc\w*|in[ií]cio|servi[cç]o|pilates|massagem|fisioterapia|recovery|agenda\w*|hor[aá]rio|aula|consulta|cancel\w*)\b/i;
const ACKNOWLEDGEMENTS = new Set(["ok", "okay", "blz", "beleza", "certo", "entendi", "combinado", "perfeito", "show"]);
const FAREWELLS = new Set(["tchau", "xau", "ate mais", "ate logo"]);
const GRATITUDE_WORDS = ["obrigado", "obrigada", "agradeco", "valeu"];
const COMMERCIAL_REQUEST = /\b(?:quero|queria|preciso|gostaria|procuro|busco)\b/i;
const SATISFACTION = /\b(?:estou|to|fiquei|muito)?\s*(?:satisfeit[oa]|resolvid[oa])\b|\b(?:era|e)\s+(?:so|isso)\b/i;
const NEGATED_SATISFACTION = /\b(?:nao|nunca)\b.{0,24}\b(?:satisfeit[oa]|resolvid[oa])\b/i;

export const CLOSURE_CONSENT_PROMPT = "Posso encerrar este atendimento por aqui?";
export const AUTOMATIC_CLOSURE_CONFIRMATION =
  "Perfeito! Vou encerrar este atendimento. Se precisar de algo depois, é só mandar uma nova mensagem 🙂";

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

export function detectGreetingContext(text: string): GreetingContext | undefined {
  const normalized = normalize(text);
  const greetingAtStart = /^(?:oi+|ola|alo|e ai|bom dia|boa tarde|boa noite)\b/.test(normalized);
  const standaloneCheckIn = /^(?:tudo bem|como vai)$/.test(normalized);
  if (!greetingAtStart && !standaloneCheckIn) {
    return undefined;
  }
  if (/\bbom dia\b/.test(normalized)) return { daypart: "morning" };
  if (/\bboa tarde\b/.test(normalized)) return { daypart: "afternoon" };
  if (/\bboa noite\b/.test(normalized)) return { daypart: "evening" };
  return {};
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

  if (SATISFACTION.test(normalized) && !NEGATED_SATISFACTION.test(normalized)) return "satisfaction";
  if (words.some(resemblesGratitude)) return "gratitude";
  if (ACKNOWLEDGEMENTS.has(normalized)) return "acknowledgement";
  if (FAREWELLS.has(normalized)) return "farewell";
  return undefined;
}

export function isClosureConsent(text: string, previousAssistantMessage?: string): boolean {
  if (!previousAssistantMessage?.includes(CLOSURE_CONSENT_PROMPT)) return false;
  const normalized = normalize(text);
  return new Set([
    "sim", "sim pode", "pode", "pode sim", "pode encerrar", "sim pode encerrar",
    "claro", "com certeza", "ok", "okay", "perfeito",
  ]).has(normalized);
}

function currentDaypart(now: Date): GreetingDaypart {
  const hour = Number(new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(now));
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function daypartLabel(daypart: GreetingDaypart): string {
  if (daypart === "morning") return "bom dia";
  if (daypart === "afternoon") return "boa tarde";
  return "boa noite";
}

export function buildGreetingAcknowledgement(context: GreetingContext, now = new Date()): string {
  return `Oi, ${daypartLabel(context.daypart ?? currentDaypart(now))}! Tudo ótimo por aqui 😊`;
}

export function prependGreetingAcknowledgement(
  message: string,
  context: GreetingContext | undefined,
  now = new Date(),
): string {
  if (!context || /^(?:oi|ol[aá]|bom dia|boa tarde|boa noite)\b/i.test(message.trim())) return message;
  return `${buildGreetingAcknowledgement(context, now)} ${message}`;
}

export function hasAssistantGreetingAcknowledgement(messages: readonly string[]): boolean {
  return messages.some((message) =>
    /^(?:oi|ol[aá]|bom\s+dia|boa\s+tarde|boa\s+noite)\b[\s\S]{0,140}\btudo\s+[oó]timo\s+por\s+aqui\b/i
      .test(message.trim()));
}

export function buildSocialReply(
  kind: SocialMessageKind,
  firstName?: string,
  greeting?: GreetingContext,
  now = new Date(),
): string {
  const name = firstName ? `, ${firstName}` : "";
  if (kind === "greeting") {
    const acknowledgement = buildGreetingAcknowledgement(greeting ?? {}, now);
    const personalized = firstName
      ? acknowledgement.replace(/^Oi, /, `Oi, ${firstName}, `)
      : acknowledgement;
    return `${personalized} E com você? Como podemos te ajudar hoje?`;
  }
  if (kind === "gratitude") return `De nada${name} 🙂 ${CLOSURE_CONSENT_PROMPT}`;
  if (kind === "satisfaction") return `Que bom${name} 🙂 ${CLOSURE_CONSENT_PROMPT}`;
  if (kind === "farewell") return `Até mais${name}! ${CLOSURE_CONSENT_PROMPT}`;
  return `Tudo certo${name} 🙂`;
}
