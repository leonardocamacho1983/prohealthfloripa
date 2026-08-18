import { proHealthKnowledge } from "./prohealth.ts";

export type MassageCategory = "traditional" | "special";
export type CatalogMatchType = "exact" | "alias" | "fuzzy";
export type CatalogMatchConfidence = "high" | "medium";

export type MassageTechniqueMention = {
  canonicalName: string;
  requestedTerm: string;
  category: MassageCategory;
  categoryLabel: "tradicional/clássica" | "especial";
  singlePrice: string;
  duration?: string;
  matchType: CatalogMatchType;
  confidence: CatalogMatchConfidence;
  needsClarification: boolean;
};

export type MassageRequestAnalysis = {
  massageRelated: boolean;
  mentions: MassageTechniqueMention[];
  needsClarification: boolean;
  repairRequested: boolean;
  grounding?: string;
};

export type MassageAnalysisOptions = {
  previousAssistantMessages?: readonly string[];
};

type TechniqueDefinition = {
  canonicalName: string;
  category: MassageCategory;
  duration?: string;
  aliases: readonly AliasDefinition[];
};

type AliasDefinition = {
  value: string;
  type: Exclude<CatalogMatchType, "fuzzy">;
};

type CatalogCandidate = {
  definition: TechniqueDefinition;
  alias: AliasDefinition;
  start: number;
  end: number;
  requestedTerm: string;
  matchType: CatalogMatchType;
  confidence: CatalogMatchConfidence;
  needsClarification: boolean;
  distance: number;
};

const MASSAGE_KNOWLEDGE = proHealthKnowledge.massages;

function exact(value: string): AliasDefinition {
  return { value, type: "exact" };
}

function alias(value: string): AliasDefinition {
  return { value, type: "alias" };
}

const TECHNIQUES: readonly TechniqueDefinition[] = [
  {
    canonicalName: "Miofascial",
    category: "traditional",
    aliases: [
      exact("miofascial"),
      alias("mio-fascial"),
      alias("miofacial"),
      alias("mio-facial"),
      alias("liberação"),
      alias("liberação miofascial"),
      alias("liberação mio-fascial"),
      alias("liberação miofacial"),
      alias("liberação mio-facial"),
    ],
  },
  {
    canonicalName: "Relaxante",
    category: "traditional",
    aliases: [exact("relaxante")],
  },
  {
    canonicalName: "Drenagem linfática",
    category: "traditional",
    aliases: [exact("drenagem linfática"), alias("drenagem")],
  },
  {
    canonicalName: "Shiatsu",
    category: "traditional",
    aliases: [exact("shiatsu")],
  },
  {
    canonicalName: "Desportiva",
    category: "traditional",
    aliases: [exact("desportiva")],
  },
  {
    canonicalName: "Sueca",
    category: "traditional",
    aliases: [exact("sueca")],
  },
  {
    canonicalName: "Lomi-Lomi",
    category: "traditional",
    aliases: [exact("lomi-lomi"), exact("lomi lomi"), alias("lomilomi")],
  },
  {
    canonicalName: "Tuiná",
    category: "traditional",
    aliases: [exact("tuiná")],
  },
  {
    canonicalName: "Ayurvédica",
    category: "special",
    duration: "1h",
    aliases: [exact("ayurvédica")],
  },
  {
    canonicalName: "Thai / Thai Yoga",
    category: "special",
    duration: "1h",
    aliases: [exact("thai yoga"), exact("thai")],
  },
  {
    canonicalName: "Shiro Abhyanga",
    category: "special",
    duration: "30 min",
    aliases: [exact("shiro abhyanga")],
  },
  {
    canonicalName: "Pada Abhyanga",
    category: "special",
    duration: "30 min",
    aliases: [exact("pada abhyanga")],
  },
  {
    canonicalName: "Abhyanga",
    category: "special",
    duration: "1h",
    aliases: [exact("abhyanga")],
  },
  {
    canonicalName: "Shirodhara",
    category: "special",
    duration: "50 min",
    aliases: [exact("shirodhara")],
  },
  {
    canonicalName: "Bastis localizados",
    category: "special",
    duration: "1h",
    aliases: [exact("bastis localizados"), alias("basti localizado"), alias("bastis"), alias("basti")],
  },
  {
    canonicalName: "Massagem Indiana, método tatame",
    category: "special",
    duration: "1h",
    aliases: [
      exact("massagem indiana, método tatame"),
      alias("massagem indiana"),
      alias("método tatame"),
    ],
  },
] as const;

const MASSAGE_RELATED = /\b(?:massag\w*|massoterap\w*|miofa\w*|shiatsu|lomi|tuin[aá]|thai|ayurv[eé]d\w*|abhyanga|shiro\w*|basti\w*|drenagem|desportiva|relaxante|sueca)\b/i;
const MASSAGE_OR_COMMERCIAL_CONTEXT = /\b(?:massag\w*|massoterap\w*|sess[aã]o|muscular|cervical|pesco[cç]o|ombro|costas|lombar|dor|tens[aã]o|desconforto|quero|queria|gostaria|preciso|quanto|custa|pre[cç]o|valor|agend\w*|marc\w*|hor[aá]rio|disponibilidade|avuls\w*|pacote)\b|\b(?:voces|pro\s*health|clinica)\s+(?:tem(?:os)?|oferec\w*|faz\w*|trabalh\w*)\b|\b(?:tem(?:os)?|oferec\w*|faz\w*|trabalh\w*)\s+(?:com\s+)?(?:a\s+|essa\s+)?liberacao\b/i;
const NON_MASSAGE_LIBERATION_CONTEXT = /\b(?:financeir\w*|pagament\w*|cobranc\w*|contrat\w*|document\w*|alvara\w*|reembols\w*|medic\w*|hospital\w*|cirurg\w*|exame\w*|atestado\w*|alta|judicial\w*|trabalhista\w*|credito\w*|exerc\w*|treino\w*|atividade\w*)\b/i;
const KNOWN_FALSE_FUZZY_TERM = /\brelev\w*\b/i;
const REPAIR_SIGNAL = /\b(?:ue|contradi\w*|mas\s+(?:voce|vc|vcs)\s+(?:disse|falou)|(?:voce|vc|vcs)\s+(?:disse|falou)\s+que|primeiro\s+\w*(?:\s+|$).*\bdepois|nao\s+tem\s+(?:liberacao|miofa\w*))\b/i;
const CONFIRMED_CATALOG_DENIAL = /\b(?:nome\s+exato\s+nao\s+(?:aparece|consta|existe)|nao\s+(?:temos|existe|consta|aparece|trabalhamos)(?:\s+com)?\s+(?:essa|esta|a|o)?\s*(?:massagem|tecnica|liberacao|miofascial|miofacial))\b/i;
const AVAILABILITY_CAVEAT = /\bnao\s+(?:temos|tem|ha)\s+(?:como\s+)?(?:confirmar\s+)?(?:horari\w*|agenda|vaga\w*|disponibilidade)\b/i;

/** Normalization shared by exact aliases, hyphen variants and typo matching. */
export function normalizeMassageCatalogText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[‐‑‒–—―/_,.;:!?()[\]{}'"`´-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findPhrase(normalizedText: string, normalizedPhrase: string): Array<{ start: number; end: number }> {
  const matches: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  while (cursor <= normalizedText.length - normalizedPhrase.length) {
    const start = normalizedText.indexOf(normalizedPhrase, cursor);
    if (start < 0) break;
    const end = start + normalizedPhrase.length;
    const leftBoundary = start === 0 || normalizedText[start - 1] === " ";
    const rightBoundary = end === normalizedText.length || normalizedText[end] === " ";
    if (leftBoundary && rightBoundary) matches.push({ start, end });
    cursor = start + 1;
  }
  return matches;
}

function levenshtein(left: string, right: string): number {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length] ?? Math.max(left.length, right.length);
}

function allowedDistance(value: string): number {
  const compactLength = value.replace(/\s/g, "").length;
  if (compactLength < 6) return 0;
  return compactLength >= 9 ? 2 : 1;
}

function exactCandidates(text: string): CatalogCandidate[] {
  const candidates: CatalogCandidate[] = [];
  for (const definition of TECHNIQUES) {
    for (const aliasDefinition of definition.aliases) {
      const normalizedAlias = normalizeMassageCatalogText(aliasDefinition.value);
      const bareLiberation = normalizedAlias === "liberacao";
      if (bareLiberation && (
        !MASSAGE_OR_COMMERCIAL_CONTEXT.test(text)
        || NON_MASSAGE_LIBERATION_CONTEXT.test(text)
      )) continue;
      for (const match of findPhrase(text, normalizedAlias)) {
        candidates.push({
          definition,
          alias: aliasDefinition,
          ...match,
          requestedTerm: text.slice(match.start, match.end),
          matchType: aliasDefinition.type,
          confidence: "high",
          needsClarification: false,
          distance: 0,
        });
      }
    }
  }
  return candidates;
}

function fuzzyCandidates(text: string): CatalogCandidate[] {
  if (!MASSAGE_OR_COMMERCIAL_CONTEXT.test(text)) return [];
  const tokens = text.split(" ").filter(Boolean);
  const offsets: number[] = [];
  let offset = 0;
  for (const token of tokens) {
    offsets.push(text.indexOf(token, offset));
    offset = (offsets.at(-1) ?? 0) + token.length;
  }

  const candidates: CatalogCandidate[] = [];
  for (const definition of TECHNIQUES) {
    for (const aliasDefinition of definition.aliases) {
      const normalizedAlias = normalizeMassageCatalogText(aliasDefinition.value);
      const maximumDistance = allowedDistance(normalizedAlias);
      if (!maximumDistance) continue;
      const wordCount = normalizedAlias.split(" ").length;
      for (let index = 0; index <= tokens.length - wordCount; index += 1) {
        const phrase = tokens.slice(index, index + wordCount).join(" ");
        if (KNOWN_FALSE_FUZZY_TERM.test(phrase)) continue;
        const lengthDelta = Math.abs(phrase.length - normalizedAlias.length);
        if (lengthDelta > maximumDistance) continue;
        const distance = levenshtein(phrase, normalizedAlias);
        if (distance === 0 || distance > maximumDistance) continue;
        const start = offsets[index] ?? 0;
        const endTokenIndex = index + wordCount - 1;
        const end = (offsets[endTokenIndex] ?? start) + (tokens[endTokenIndex]?.length ?? 0);
        candidates.push({
          definition,
          alias: aliasDefinition,
          start,
          end,
          requestedTerm: phrase,
          matchType: "fuzzy",
          confidence: "medium",
          needsClarification: false,
          distance,
        });
      }
    }
  }
  return candidates;
}

function selectNonOverlappingCandidates(candidates: CatalogCandidate[]): CatalogCandidate[] {
  const sorted = [...candidates].sort((left, right) =>
    left.start - right.start
    || (right.end - right.start) - (left.end - left.start)
    || left.distance - right.distance
    || left.definition.canonicalName.localeCompare(right.definition.canonicalName),
  );
  const selected: CatalogCandidate[] = [];
  for (const candidate of sorted) {
    const overlaps = selected.some((item) => candidate.start < item.end && item.start < candidate.end);
    const duplicate = selected.some((item) => item.definition.canonicalName === candidate.definition.canonicalName);
    if (!overlaps && !duplicate) selected.push(candidate);
  }
  return selected.sort((left, right) => left.start - right.start);
}

function toMention(candidate: CatalogCandidate): MassageTechniqueMention {
  const special = candidate.definition.category === "special";
  return {
    canonicalName: candidate.definition.canonicalName,
    requestedTerm: candidate.requestedTerm,
    category: candidate.definition.category,
    categoryLabel: special ? "especial" : "tradicional/clássica",
    singlePrice: special ? MASSAGE_KNOWLEDGE.single.special : MASSAGE_KNOWLEDGE.single.traditional,
    ...(candidate.definition.duration ? { duration: candidate.definition.duration } : {}),
    matchType: candidate.matchType,
    confidence: candidate.confidence,
    needsClarification: candidate.needsClarification,
  };
}

function analyzeCandidates(text: string): CatalogCandidate[] {
  const normalized = normalizeMassageCatalogText(text);
  if (!normalized) return [];
  const exact = exactCandidates(normalized);
  const occupiedCanonicals = new Set(exact.map((candidate) => candidate.definition.canonicalName));
  const fuzzy = fuzzyCandidates(normalized).filter(
    (candidate) => !occupiedCanonicals.has(candidate.definition.canonicalName),
  );

  const bestBySpan = new Map<string, CatalogCandidate[]>();
  for (const candidate of [...exact, ...fuzzy]) {
    const key = `${candidate.start}:${candidate.end}`;
    const current = bestBySpan.get(key) ?? [];
    const bestDistance = current[0]?.distance;
    if (bestDistance === undefined || candidate.distance < bestDistance) bestBySpan.set(key, [candidate]);
    else if (candidate.distance === bestDistance) current.push(candidate);
  }

  const unambiguous = [...bestBySpan.values()].flatMap((sameSpan) => {
    const canonicals = new Set(sameSpan.map((candidate) => candidate.definition.canonicalName));
    if (canonicals.size === 1) return [sameSpan[0]!];
    return [];
  });
  return selectNonOverlappingCandidates(unambiguous);
}

function analyzeText(text: string): MassageTechniqueMention[] {
  return analyzeCandidates(text).map(toMention);
}

function splitCatalogClaims(message: string): string[] {
  return message
    .split(/(?:\r?\n+|[.!?;]+|\bmas\b)/i)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function canonicalsInClaim(segment: string): Set<string> {
  return new Set(analyzeText(segment).map((mention) => mention.canonicalName));
}

function claimWindowsForMention(
  message: string,
  mention: MassageTechniqueMention,
): string[] {
  const windows: string[] = [];
  for (const segment of splitCatalogClaims(message)) {
    const normalized = normalizeMassageCatalogText(segment);
    const candidates = analyzeCandidates(normalized);
    for (const [index, candidate] of candidates.entries()) {
      if (candidate.definition.canonicalName !== mention.canonicalName) continue;
      const start = index === 0 ? 0 : candidate.start;
      const end = candidates[index + 1]?.start ?? normalized.length;
      windows.push(normalized.slice(start, end).trim());
    }
  }
  return windows;
}

function explicitlyDeniesCatalogService(segment: string): boolean {
  const normalized = normalizeMassageCatalogText(segment);
  if (!normalized || AVAILABILITY_CAVEAT.test(normalized)) return false;
  return CONFIRMED_CATALOG_DENIAL.test(normalized)
    || /\bnome\s+exato\s+nao\s+(?:aparece|consta|existe)\b/i.test(normalized)
    || /\bnao\s+(?:temos|tem|oferecemos|fazemos|trabalhamos(?:\s+com)?|atendemos)\s+(?!(?:como|horari\w*|agenda|vaga\w*|disponibilidade)\b)/i.test(normalized)
    || /\bnao\s+(?:existe|consta|aparece)\b/i.test(normalized)
    || /\bnao\s+esta\s+(?:no|em)\s+catalogo\b/i.test(normalized);
}

function messageDeniesMention(
  message: string,
  mention: MassageTechniqueMention,
  allowImplicitDenial: boolean,
): boolean | undefined {
  const segments = splitCatalogClaims(message);
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]!;
    const canonicals = canonicalsInClaim(segment);
    const namesCurrentTechnique = canonicals.has(mention.canonicalName);
    const implicitCurrentTechnique = allowImplicitDenial && canonicals.size === 0;
    if (!namesCurrentTechnique && !implicitCurrentTechnique) continue;
    return explicitlyDeniesCatalogService(segment);
  }
  return undefined;
}

function isRepairRequested(
  userText: string,
  mentions: readonly MassageTechniqueMention[],
  previousAssistantMessages: readonly string[],
): boolean {
  if (!mentions.length) return false;
  const normalizedUserText = normalizeMassageCatalogText(userText);
  if (REPAIR_SIGNAL.test(normalizedUserText)) {
    const userDeniedCurrentTechnique = mentions.some(
      (mention) => messageDeniesMention(userText, mention, false) === true,
    );
    if (userDeniedCurrentTechnique) return true;
  }

  for (let index = previousAssistantMessages.length - 1; index >= 0; index -= 1) {
    const assistantMessage = previousAssistantMessages[index]!;
    const isLatestAssistantMessage = index === previousAssistantMessages.length - 1;
    for (const mention of mentions) {
      const denied = messageDeniesMention(
        assistantMessage,
        mention,
        isLatestAssistantMessage && mentions.length === 1,
      );
      if (denied !== undefined) return denied;
    }
  }
  return false;
}

export function buildMassageCatalogGrounding(
  analysis: Pick<MassageRequestAnalysis, "massageRelated" | "mentions" | "needsClarification" | "repairRequested">,
): string | undefined {
  if (!analysis.massageRelated) return undefined;
  const lines = ["INTERPRETAÇÃO DETERMINÍSTICA DO CATÁLOGO DE MASSAGENS:"];
  for (const mention of analysis.mentions) {
    const aliasInstruction = mention.canonicalName === "Miofascial" && /liberacao|miofacial/.test(normalizeMassageCatalogText(mention.requestedTerm))
      ? " O termo do cliente é um alias confirmado; nunca diga que essa técnica não existe."
      : "";
    lines.push(
      `- “${mention.requestedTerm}” corresponde a “${mention.canonicalName}”; categoria ${mention.categoryLabel}; avulsa ${mention.singlePrice}${mention.duration ? `; duração ${mention.duration}` : ""}; confiança ${mention.confidence}.${aliasInstruction}`,
    );
  }
  if (analysis.needsClarification) {
    lines.push("- Nenhuma técnica confirmada pôde ser identificada com segurança. Não invente nem negue uma técnica; faça uma pergunta curta de clarificação.");
  }
  if (analysis.repairRequested) {
    lines.push("- O cliente sinalizou uma contradição. Comece reconhecendo o erro, corrija a informação canônica e não defenda a resposta anterior.");
  }
  return lines.join("\n");
}

/**
 * Recognizes only techniques present in the confirmed ProHealth knowledge.
 * Fuzzy matching is deliberately narrow and only accepts one or two edits in
 * a known name, preventing an unknown technique from becoming a catalog fact.
 */
export function analyzeMassageRequest(
  input: string | readonly string[],
  options: MassageAnalysisOptions = {},
): MassageRequestAnalysis {
  const messages = typeof input === "string" ? [input] : [...input];
  const text = messages.join("\n");
  const mentions = messages.flatMap(analyzeText).filter((mention, index, all) =>
    all.findIndex((candidate) => candidate.canonicalName === mention.canonicalName) === index,
  );
  const massageRelated = MASSAGE_RELATED.test(text) || mentions.length > 0;
  const needsClarification = massageRelated && mentions.length === 0;
  const repairRequested = isRepairRequested(
    text,
    mentions,
    options.previousAssistantMessages ?? [],
  );
  const analysis: MassageRequestAnalysis = {
    massageRelated,
    mentions,
    needsClarification,
    repairRequested,
  };
  return {
    ...analysis,
    ...(massageRelated ? { grounding: buildMassageCatalogGrounding(analysis) } : {}),
  };
}

export function buildConfirmedMassageAnswer(analysis: MassageRequestAnalysis): string | undefined {
  if (!analysis.mentions.length || analysis.mentions.some((mention) => mention.needsClarification)) {
    return undefined;
  }

  if (analysis.mentions.length > 1) {
    const facts = analysis.mentions.map((mention) => {
      const normalizedRequest = normalizeMassageCatalogText(mention.requestedTerm);
      const subject = normalizedRequest === "thai" ? "Thai" : mention.canonicalName;
      return `${subject}: ${mention.categoryLabel}, ${mention.singlePrice} no avulso${mention.duration ? `, duração de ${mention.duration}` : ""}`;
    });
    const answer = `${facts.join("; ")}.`;
    return analysis.repairRequested
      ? `Você tem razão — eu me expressei mal. ${answer}`
      : answer;
  }

  const mention = analysis.mentions[0]!;

  const normalizedRequest = normalizeMassageCatalogText(mention.requestedTerm);
  let fact: string;
  if (mention.canonicalName === "Miofascial" && normalizedRequest.includes("liberacao")) {
    fact = `Temos sim a massagem miofascial, também chamada de liberação miofascial. Ela é da categoria ${mention.categoryLabel} e custa ${mention.singlePrice} no avulso.`;
  } else if (mention.matchType === "fuzzy" || normalizedRequest === "miofacial") {
    fact = `Entendi “${mention.requestedTerm}” como ${mention.canonicalName}. Ela é da categoria ${mention.categoryLabel} e custa ${mention.singlePrice} no avulso.`;
  } else {
    const subject = normalizedRequest === "thai" ? "Thai" : mention.canonicalName;
    fact = `${subject} é da categoria ${mention.categoryLabel} e custa ${mention.singlePrice} no avulso${mention.duration ? `, com duração de ${mention.duration}` : ""}.`;
  }
  return analysis.repairRequested
    ? `Você tem razão — eu me expressei mal. ${fact}`
    : fact;
}

function claimedCategories(segment: string): MassageCategory[] {
  const normalized = normalizeMassageCatalogText(segment);
  const claims: MassageCategory[] = [];
  const categoryPattern = /\b(?:e|eh)\s+(?:uma\s+massagem\s+)?(?:da\s+categoria\s+)?(tradicional|classica|especial)\b|\b(?:categoria(?:\s+comercial)?|classificad[ao]s?\s+como|faz(?:em)?\s+parte\s+da\s+categoria)\s+(tradicional|classica|especial)\b/gi;
  for (const match of normalized.matchAll(categoryPattern)) {
    const prefix = normalized.slice(Math.max(0, (match.index ?? 0) - 8), match.index);
    if (/\bnao\s*$/.test(prefix)) continue;
    const category = match[1] ?? match[2];
    claims.push(category === "especial" ? "special" : "traditional");
  }
  return claims;
}

function claimedPrices(segment: string): number[] {
  const normalized = normalizeMassageCatalogText(segment);
  const prices = new Set<number>();
  for (const match of normalized.matchAll(/\br\s*\$\s*(\d{2,4})(?:\s+00)?\b/gi)) {
    prices.add(Number(match[1]));
  }
  for (const match of normalized.matchAll(/\b(?:custa|valor(?:\s+avulso)?(?:\s+de|\s+e)?|avuls[ao](?:\s+custa|\s+por|\s+de)?)\s+(?:r\s*\$\s*)?(\d{2,4})\b/gi)) {
    prices.add(Number(match[1]));
  }
  return [...prices].filter(Number.isFinite);
}

function durationToMinutes(value: string): number | undefined {
  const normalized = normalizeMassageCatalogText(value);
  const match = normalized.match(/^(\d{1,3})\s*(h|hora|horas|min|minuto|minutos)$/i);
  if (!match) return undefined;
  const amount = Number(match[1]);
  return match[2]?.startsWith("h") ? amount * 60 : amount;
}

function claimedDurations(segment: string): number[] {
  const normalized = normalizeMassageCatalogText(segment);
  const durations = new Set<number>();
  if (/\b(?:uma|1)\s+hora\b/i.test(normalized)) durations.add(60);
  if (/\b(?:meia\s+hora|30\s+minutos?)\b/i.test(normalized)) durations.add(30);
  for (const match of normalized.matchAll(/\b(\d{1,3})\s*(h|hora|horas|min|minuto|minutos)\b/gi)) {
    const minutes = durationToMinutes(`${match[1]} ${match[2]}`);
    if (minutes !== undefined) durations.add(minutes);
  }
  return [...durations];
}

function claimContradictsMention(segment: string, mention: MassageTechniqueMention): boolean {
  if (explicitlyDeniesCatalogService(segment)) return true;

  const categoryClaims = claimedCategories(segment);
  if (categoryClaims.some((category) => category !== mention.category)) return true;

  const priceClaims = claimedPrices(segment);
  if (priceClaims.length) {
    const expectedPrice = Number(mention.singlePrice.replace(/\D/g, ""));
    const normalized = normalizeMassageCatalogText(segment);
    const explicitlySingle = /\b(?:avuls\w*|sessao\s+avulsa|valor\s+avulso)\b/i.test(normalized);
    const packageOnly = /\b(?:pacote|\d+\s+sessoes)\b/i.test(normalized) && !explicitlySingle;
    if (!packageOnly && !priceClaims.includes(expectedPrice)) return true;
  }

  const durationClaims = claimedDurations(segment);
  if (durationClaims.length) {
    const expectedDuration = mention.duration ? durationToMinutes(mention.duration) : undefined;
    if (expectedDuration === undefined || !durationClaims.includes(expectedDuration)) return true;
  }
  return false;
}

function implicitClaimCanReferToMassage(segment: string): boolean {
  const normalized = normalizeMassageCatalogText(segment);
  if (/\b(?:ela|essa|esta|a\s+massagem|essa\s+t[eé]cnica)\b/i.test(segment)) return true;
  // Facts explicitly attached to another service must not be validated as if
  // they described the only massage mentioned by the customer.
  return !/\b(?:pilates|fisioterapia|fisio\w*|crioterapia|crio\w*|banheira|termoterapia|recovery)\b/i.test(normalized);
}

export function massageReplyContradictsConfirmedCatalog(
  analysis: MassageRequestAnalysis,
  reply: string,
): boolean {
  if (!analysis.mentions.length) return false;
  const normalizedReply = normalizeMassageCatalogText(reply);
  const segments = splitCatalogClaims(reply);
  const contradiction = analysis.mentions.some((mention) => {
    const claimWindows = claimWindowsForMention(reply, mention);
    const relevant = claimWindows.length
      ? claimWindows
      : analysis.mentions.length === 1
        ? segments.filter((segment) => canonicalsInClaim(segment).size === 0
          && implicitClaimCanReferToMassage(segment))
        : [];
    return relevant.some((segment) => claimContradictsMention(segment, mention));
  });
  if (contradiction) return true;

  return analysis.mentions.some((mention) => {
    if (mention.canonicalName !== "Miofascial") return false;
    const requested = normalizeMassageCatalogText(mention.requestedTerm);
    const usedAlias = requested.includes("liberacao") || requested.includes("miofacial");
    return usedAlias && !normalizedReply.includes("miofascial");
  });
}

/**
 * Returns confirmed techniques requested by the customer that the reply did
 * not name using a canonical spelling or a confirmed alias. Fuzzy echoes are
 * intentionally excluded so the assistant cannot repeat a typo as a fact.
 */
export function missingConfirmedMassageMentions(
  analysis: Pick<MassageRequestAnalysis, "mentions">,
  reply: string,
): MassageTechniqueMention[] {
  const coveredCanonicals = new Set(
    analyzeText(reply)
      .filter((mention) => mention.matchType !== "fuzzy")
      .map((mention) => mention.canonicalName),
  );
  return analysis.mentions.filter((mention) => !coveredCanonicals.has(mention.canonicalName));
}

export function massageReplyCoversConfirmedMentions(
  analysis: Pick<MassageRequestAnalysis, "mentions">,
  reply: string,
): boolean {
  return missingConfirmedMassageMentions(analysis, reply).length === 0;
}
