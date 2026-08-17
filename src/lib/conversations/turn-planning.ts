import type { ConversationMessage } from "./types.ts";
import { classifySocialMessage, isGreetingMessage, type SocialMessageKind } from "./social-message.ts";

export type TurnPlan = {
  messages: ConversationMessage[];
  consolidatedMessage: string;
  suppressReply: boolean;
  resetRequested: boolean;
  repairRequested: boolean;
  socialKind?: SocialMessageKind;
};

const COMPLETE_CANCELLATION = /^(?:n[aã]o\s+)?(?:precisa|preciso)\s+(?:me\s+)?responder(?:\s+(?:mais|isso))?$|^(?:n[aã]o\s+responda|pode\s+ignorar|deixa\s+pra\s+l[aá])$/i;
const RESET = /\b(?:(?:vamos|quero|pode|podemos)\s+)?(?:come[cç]ar|recome[cç]ar)\s+(?:do\s+zero|de\s+novo)\b/i;
const CONTRADICTION_REPAIR = /\b(?:u[eé]+(?=\W|$)|mas\s+(?:voc[eê]|vc|o\s+agente)\s+(?:disse|falou|informou)|n[aã]o\s+entendi|(?:voc[eê]|vc)\s+(?:se\s+)?contradisse|isso\s+n[aã]o\s+faz\s+sentido)/i;
const CONTINUATION_ENDING = /\b(?:e|tamb[eé]m|ah|pera|ali[aá]s|porque|que|sobre|com|pra|para)$/i;

function normalized(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function isExplicitResetMessage(text: string): boolean {
  return RESET.test(normalized(text));
}

export function isRepairSignal(text: string): boolean {
  return CONTRADICTION_REPAIR.test(normalized(text));
}

function resolveSocialKind(kinds: Array<SocialMessageKind | undefined>): SocialMessageKind | undefined {
  if (!kinds.length || kinds.some((kind) => !kind)) return undefined;
  const socialKinds = kinds as SocialMessageKind[];
  if (socialKinds.includes("farewell")) return "farewell";
  if (socialKinds.includes("gratitude")) return "gratitude";
  if (socialKinds.includes("greeting")) return "greeting";
  return "acknowledgement";
}

export function adaptiveBatchDelaySeconds(text: string): number {
  const message = normalized(text);
  if (!message) return 4;
  // A greeting can be acknowledged quickly. If a substantive message follows,
  // its newer revision invalidates this draft before it is sent.
  if (isGreetingMessage(message)) return 2;
  // Short WhatsApp fragments are the strongest signal that the customer is
  // composing a burst across several bubbles. Every new inbound resets this
  // window through conversations.next_process_at.
  if (message.length <= 80 && (!/[.?!]$/.test(message) || CONTINUATION_ENDING.test(message))) return 9;
  if (message.length > 3 && /[?!]$/.test(message)) return 5;
  return 6;
}

export function planConversationTurn(messages: ConversationMessage[]): TurnPlan {
  const chronological = [...messages].sort((left, right) => {
    const revisionDelta = (left.inputRevision ?? 0) - (right.inputRevision ?? 0);
    return revisionDelta || left.createdAt.getTime() - right.createdAt.getTime();
  });
  const lastReset = chronological.findLastIndex((message) => isExplicitResetMessage(message.content));
  const active = lastReset >= 0 ? chronological.slice(lastReset) : chronological;
  const texts = active.map((message) => normalized(message.content)).filter(Boolean);
  const lastText = texts.at(-1) ?? "";
  // A final "oi", "?" or "travou" means the customer is still waiting; it
  // is not evidence that a fact was wrong. Treating it as a repair caused a
  // correct multi-topic answer to be replaced by a one-topic fallback.
  const repairRequested = texts.some(isRepairSignal);
  const socialKinds = texts.map(classifySocialMessage);
  const socialKind = resolveSocialKind(socialKinds);
  const consolidatedMessage = texts.map((text, index) => `Mensagem ${index + 1}: ${text}`).join("\n");
  return {
    messages: active,
    consolidatedMessage,
    suppressReply: COMPLETE_CANCELLATION.test(lastText),
    resetRequested: lastReset >= 0,
    repairRequested,
    ...(socialKind ? { socialKind } : {}),
  };
}

export function applyResetToHistory(messages: ConversationMessage[], resetRequested: boolean): ConversationMessage[] {
  if (!resetRequested) return messages;
  const lastReset = messages.findLastIndex((message) => message.role === "user" && isExplicitResetMessage(message.content));
  return lastReset >= 0 ? messages.slice(lastReset) : messages;
}
