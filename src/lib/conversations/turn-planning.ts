import type { ConversationMessage } from "./types.ts";
import { classifySocialMessage, type SocialMessageKind } from "./social-message.ts";

export type TurnPlan = {
  messages: ConversationMessage[];
  consolidatedMessage: string;
  suppressReply: boolean;
  resetRequested: boolean;
  repairRequested: boolean;
  socialKind?: SocialMessageKind;
};

const COMPLETE_CANCELLATION = /^(?:n[aã]o\s+)?(?:precisa|preciso)\s+(?:me\s+)?responder(?:\s+(?:mais|isso))?$|^(?:n[aã]o\s+responda|pode\s+ignorar|deixa\s+pra\s+l[aá])$/i;
const RESET = /\b(?:vamos|quero|pode)\s+(?:come[cç]ar|recome[cç]ar)\s+(?:do\s+zero|de\s+novo)\b/i;
const REPAIR = /^(?:oi+|ol[aá]|al[oô]|travou|funcionou|est[aá]\s+a[ií]|\?+)$/i;

function normalized(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function adaptiveBatchDelaySeconds(text: string): number {
  const message = normalized(text);
  if (!message) return 2;
  if (message.length > 3 && /[?!]$/.test(message)) return 2;
  if (message.length <= 24 || !/[.]$/.test(message) || /\b(?:e|tamb[eé]m|ah|pera|ali[aá]s)$/i.test(message)) return 3;
  return 2;
}

export function planConversationTurn(messages: ConversationMessage[]): TurnPlan {
  const chronological = [...messages].sort((left, right) => {
    const revisionDelta = (left.inputRevision ?? 0) - (right.inputRevision ?? 0);
    return revisionDelta || left.createdAt.getTime() - right.createdAt.getTime();
  });
  const lastReset = chronological.findLastIndex((message) => RESET.test(message.content));
  const active = lastReset >= 0 ? chronological.slice(lastReset) : chronological;
  const texts = active.map((message) => normalized(message.content)).filter(Boolean);
  const lastText = texts.at(-1) ?? "";
  const substantiveBeforeRepair = texts.slice(0, -1).some((text) => !REPAIR.test(text));
  const repairRequested = REPAIR.test(lastText) && substantiveBeforeRepair;
  const socialKinds = texts.map(classifySocialMessage);
  const socialKind = texts.length > 0 && socialKinds.every(Boolean)
    && socialKinds.every((kind) => kind === socialKinds[0]) ? socialKinds[0] : undefined;
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
  const lastReset = messages.findLastIndex((message) => message.role === "user" && RESET.test(message.content));
  return lastReset >= 0 ? messages.slice(lastReset) : messages;
}
