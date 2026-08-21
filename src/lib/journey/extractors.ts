import type { JourneyGoal, JourneySchedulingState } from "./types.ts";

const normalize = (value: string) => value.normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();

export function extractJourneyGoals(message: string): JourneyGoal[] {
  const text = normalize(message);
  const goals: JourneyGoal[] = [];
  const bodyRegion = /\b(?:lombar|costas?|pescoco|cervical|ombros?|peito|peitoral|quadril|gluteos?|pernas?|panturrilhas?|bracos?)\b/;
  const localizedDiscomfort = /\b(?:tensao|tenso|tensa|rigidez|contratura|travou|travado|travada|desconforto)\b/;
  if (/\b(?:torcicolo|tensao\s+localizada)\b/.test(text)
    || (bodyRegion.test(text) && localizedDiscomfort.test(text))
    || /\b(?:tensao|rigidez)\s+muscular\b/.test(text)) {
    goals.push("localized_tension");
  }
  if (/\b(?:relaxar|relaxamento|estressad|estresse|ansios|desacelerar|tenso|tensa)\w*\b/.test(text)) {
    goals.push("relaxation");
  }
  if (/\b(?:pos[- ]?treino|depois\s+do\s+treino|dor\s+muscular\s+tardia|recovery\s+do\s+treino)\b/.test(text)) {
    goals.push("post_exercise_recovery");
  }
  if (/\b(?:recovery|recuperacao|banheira|crioterapia|termoterapia|contraste)\b/.test(text)) {
    goals.push("general_recovery");
  }
  return [...new Set(goals)];
}

export function extractServiceFamily(message: string): "massage" | "pilates" | "physiotherapy" | "recovery" | undefined {
  const text = normalize(message);
  if (/\b(?:massag|miofascial|miofacial|relaxante|drenagem|shiatsu|thai|lomi)\w*/.test(text)) return "massage";
  if (/\bpilates\b/.test(text)) return "pilates";
  if (/\b(?:fisioterapia|fisio)\w*/.test(text)) return "physiotherapy";
  if (/\b(?:recovery|banheira|crioterapia|termoterapia|contraste)\w*/.test(text)) return "recovery";
  return undefined;
}

export type MassageServiceName = "Relaxante" | "Miofascial";

export type ServiceSelectionChange = {
  selectedService?: MassageServiceName;
  rejectedServices: MassageServiceName[];
};

const SELECTION_VERB = /\b(?:quero|queria|gostaria|vou\s+de|pode\s+ser|vamos\s+com|seguir\s+com|agendar|marcar)\b/g;
const SERVICE_MENTION = /\b(relaxante|miofascial|miofacial|liberacao\s+miofascial)\b/g;

function canonicalMassageService(value: string): MassageServiceName {
  return value === "relaxante" ? "Relaxante" : "Miofascial";
}

function clauseStart(text: string, index: number): number {
  const boundary = Math.max(
    text.lastIndexOf(";", index - 1),
    text.lastIndexOf(",", index - 1),
    text.lastIndexOf(".", index - 1),
    text.lastIndexOf("!", index - 1),
    text.lastIndexOf("?", index - 1),
  );
  return boundary + 1;
}

function hasAffirmativeSelectionVerb(text: string, mentionIndex: number): boolean {
  const prefix = text.slice(clauseStart(text, mentionIndex), mentionIndex);
  const lastVerb = [...prefix.matchAll(SELECTION_VERB)].at(-1);
  if (lastVerb?.index === undefined) return false;
  const beforeVerb = prefix.slice(0, lastVerb.index);
  return !/\b(?:nao|nem)\s*$/.test(beforeVerb);
}

/**
 * Resolves explicit massage choices in their written order. A negated option
 * is never promoted to a selection, and the last affirmative correction wins.
 */
export function extractServiceSelectionChange(message: string): ServiceSelectionChange {
  const text = normalize(message);
  const rejectedServices: MassageServiceName[] = [];
  let selectedService: MassageServiceName | undefined;
  const answerOnly = text.match(/^(?:a\s+)?(relaxante|miofascial|miofacial)(?:\s+mesmo)?[.!\s]*$/)?.[1];
  if (answerOnly) selectedService = canonicalMassageService(answerOnly);
  const positiveEvaluation = text.match(
    /\b(relaxante|miofascial|miofacial|liberacao\s+miofascial)\b[^.!?]{0,40}\b(?:me\s+parece\s+(?:bom|boa)|parece\s+(?:bom|boa)|faz\s+sentido)\b/,
  )?.[1];
  if (positiveEvaluation) selectedService = canonicalMassageService(positiveEvaluation);

  for (const mention of text.matchAll(SERVICE_MENTION)) {
    const rawService = mention[1];
    const mentionIndex = mention.index;
    if (!rawService || mentionIndex === undefined) continue;
    const service = canonicalMassageService(rawService);
    const start = clauseStart(text, mentionIndex);
    const prefix = text.slice(start, mentionIndex);
    const verbs = [...prefix.matchAll(SELECTION_VERB)];
    const lastVerb = verbs.at(-1);
    const beforeVerb = lastVerb?.index === undefined ? prefix : prefix.slice(0, lastVerb.index);
    const directNegation = /\b(?:nao|nem|sem|dispenso)\s+(?:a\s+)?(?:massagem\s+)?$/.test(prefix);
    const negatedVerb = Boolean(lastVerb && /\b(?:nao|nem)\s*$/.test(beforeVerb));
    if (directNegation || negatedVerb) {
      rejectedServices.push(service);
      continue;
    }
    if (lastVerb) selectedService = service;
  }

  return {
    ...(selectedService ? { selectedService } : {}),
    rejectedServices: [...new Set(rejectedServices)],
  };
}

export function extractSelectedService(message: string): string | undefined {
  return extractServiceSelectionChange(message).selectedService;
}

export function extractExplicitServiceFamilyChange(
  message: string,
): "massage" | "pilates" | "physiotherapy" | "recovery" | undefined {
  const text = normalize(message);
  const affirmative = /\b(?:quero|queria|gostaria|vou\s+de|pode\s+ser|vamos\s+com|seguir\s+com|agendar|marcar)\b/;
  if (!affirmative.test(text)) return undefined;
  const candidates: Array<{ family: "massage" | "pilates" | "physiotherapy" | "recovery"; index: number }> = [];
  for (const [family, pattern] of [
    ["massage", /\b(?:massag\w*|miofascial|miofacial|relaxante|drenagem|shiatsu|thai|lomi)\b/g],
    ["pilates", /\bpilates\b/g],
    ["physiotherapy", /\b(?:fisioterapia|fisio)\w*\b/g],
    // "Quero a banheira" is normally an add-on acceptance, not a request to
    // discard the massage journey. Literal recovery techniques do represent a
    // primary-family change.
    ["recovery", /\b(?:recovery|crioterapia|termoterapia|contraste)\w*\b/g],
  ] as const) {
    for (const match of text.matchAll(pattern)) {
      if (match.index !== undefined && hasAffirmativeSelectionVerb(text, match.index)) {
        candidates.push({ family, index: match.index });
      }
    }
  }
  return candidates.sort((left, right) => left.index - right.index).at(-1)?.family;
}

export function isShortCommercialAcceptance(message: string): boolean {
  return /^(?:(?:opa|ah|aí|ai|beleza),?\s+)?(?:sim|quero\s+sim|pode\s+ser|vamos|claro|fechado|legal,?\s+quero|ok)\s*[.!]*$/i.test(message.trim());
}

export function acceptsIntegratedPath(message: string): boolean {
  const text = normalize(message);
  return /\b(?:combinar|combino|quero\s+(?:as\s+)?duas|as\s+duas|os\s+dois|ambos)\b/.test(text);
}

export function isFactualServiceQuestion(message: string): boolean {
  const text = normalize(message);
  return /\b(?:quanto\s+custa|preco|valor|duracao|categoria|qual\s+a\s+diferenca|diferenca\s+entre|como\s+(?:funciona|seria))\b/.test(text);
}

function normalizeTime(hour: string, minute?: string): string | undefined {
  const h = Number(hour);
  const m = Number(minute ?? "0");
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return undefined;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function displayDay(day: string): string {
  return day
    .replace(/^amanha$/, "amanhã")
    .replace(/^depois de amanha$/, "depois de amanhã")
    .replace(/^terca(?:-feira)?$/, "terça-feira")
    .replace(/^sabado$/, "sábado");
}

function isNegatedCandidate(text: string, index: number, length: number): boolean {
  const start = clauseStart(text, index);
  const before = text.slice(start, index);
  const after = text.slice(index + length);
  return /\b(?:nao|nem)\b[^,;.!?]{0,30}$/.test(before)
    || /^\s*(?:nao|nem)\b/.test(after);
}

function timeCandidates(text: string): Array<{ index: number; length: number; time: string }> {
  const candidates: Array<{ index: number; length: number; time: string }> = [];
  const pattern = /\b([01]?\d|2[0-3]):([0-5]\d)\b|\b([01]?\d|2[0-3])h(?:([0-5]\d))?\b|(?:^|\s)(?:as|a)\s*([01]?\d|2[0-3])(?=\s|[?!.,;]|$)/g;
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue;
    const time = match[1]
      ? normalizeTime(match[1], match[2])
      : match[3]
        ? normalizeTime(match[3], match[4])
        : match[5]
          ? normalizeTime(match[5])
          : undefined;
    if (time) candidates.push({ index: match.index, length: match[0].length, time });
  }
  return candidates;
}

export type ScheduleExtraction = {
  scheduling: Partial<JourneySchedulingState>;
  rejectedDayTexts: string[];
  rejectedTimes: string[];
  invalidatesCurrentDay: boolean;
  invalidatesCurrentTime: boolean;
};

/**
 * Extracts exact scheduling choices and separately reports corrections or
 * constraints. The reducer uses the latter to prevent a previously captured
 * exact slot from surviving phrases such as "não às 15:30" or "antes das 16h".
 */
export function extractScheduleChange(message: string): ScheduleExtraction {
  const text = normalize(message);
  const dayPattern = /\b(hoje|amanha|depois\s+de\s+amanha|segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado|domingo|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/g;
  const dayCandidates = [...text.matchAll(dayPattern)]
    .filter((match) => match.index !== undefined)
    .map((match) => ({
      dayText: displayDay(match[1]!),
      negated: isNegatedCandidate(text, match.index!, match[0].length),
    }));
  const positiveDays = dayCandidates.filter((candidate) => !candidate.negated)
    .map((candidate) => candidate.dayText);
  const rejectedDayTexts = dayCandidates.filter((candidate) => candidate.negated)
    .map((candidate) => candidate.dayText);
  const day = positiveDays.length === 1 ? positiveDays[0] : undefined;

  const candidates = timeCandidates(text);
  const hasExplicitRange = /\bentre\s+(?:[01]?\d|2[0-3])(?::[0-5]\d|h(?:[0-5]\d)?)?\s+e\s+(?:[01]?\d|2[0-3])(?::[0-5]\d|h(?:[0-5]\d)?)?\b|\bd(?:a|e)s?\s+(?:[01]?\d|2[0-3])(?::[0-5]\d|h(?:[0-5]\d)?)?\s+(?:as|a|ate)\s+(?:[01]?\d|2[0-3])(?::[0-5]\d|h(?:[0-5]\d)?)?\b|\b(?:[01]?\d|2[0-3])(?::[0-5]\d|h(?:[0-5]\d)?)?\s*[-–]\s*(?:[01]?\d|2[0-3])(?::[0-5]\d|h(?:[0-5]\d)?)?\b/.test(text);
  const relationalTime = /\b(?:antes|depois|apos|ate)\s+d[aoe]s?\s+(?:[01]?\d|2[0-3])(?::[0-5]\d|h(?:[0-5]\d)?)?\b/.test(text);
  const classifiedTimes = candidates.map((candidate) => {
    const start = clauseStart(text, candidate.index);
    const before = text.slice(start, candidate.index);
    const ranged = /\b(?:antes|depois|apos|ate|entre)(?:\s+d[aoe]s?)?\s*$/.test(before);
    const negated = isNegatedCandidate(text, candidate.index, candidate.length);
    return { ...candidate, constrained: ranged, negated };
  });
  const rejectedTimes = classifiedTimes.filter((candidate) => candidate.negated)
    .map((candidate) => candidate.time);
  const positiveTimes = hasExplicitRange ? [] : classifiedTimes.filter((candidate) =>
    !candidate.constrained && !candidate.negated);
  const time = positiveTimes.length === 1 ? positiveTimes[0]?.time : undefined;
  const period = /\bmanha\b/.test(text)
    ? "morning" as const
    : /\btarde\b/.test(text)
      ? "afternoon" as const
      : /\bnoite\b/.test(text)
        ? "evening" as const
        : undefined;
  return {
    scheduling: {
      ...(day ? { dayText: day } : {}),
      ...(time ? { time } : {}),
      ...(period ? { period } : {}),
    },
    rejectedDayTexts: [...new Set(rejectedDayTexts)],
    rejectedTimes: [...new Set(rejectedTimes)],
    invalidatesCurrentDay: positiveDays.length > 1,
    invalidatesCurrentTime: hasExplicitRange
      || relationalTime
      || classifiedTimes.some((candidate) => candidate.constrained)
      || positiveTimes.length > 1,
  };
}

export function extractSchedule(message: string): Partial<JourneySchedulingState> {
  return extractScheduleChange(message).scheduling;
}

export function declinesHotBath(message: string): boolean {
  const text = normalize(message);
  return /\b(?:nao\s+quero|sem|dispenso|so\s+a\s+massagem)\b[^.!?]{0,40}\b(?:banheira|banho\s+quente)\b|\bso\s+a\s+massagem\b/.test(text);
}

export function acceptsHotBath(message: string): boolean {
  const text = normalize(message);
  return /\b(?:quero|aceito|pode\s+ser|vamos\s+com)\b[^.!?]{0,40}\b(?:banheira|banho\s+quente)\b/.test(text);
}

export function isJourneyReset(message: string): boolean {
  return /\b(?:comecar|recomecar)\s+(?:do\s+zero|de\s+novo)\b/i.test(normalize(message));
}
