import type { ConversationMessage } from "./types.ts";
import { isGreetingMessage } from "./social-message.ts";
import { isExplicitResetMessage } from "./turn-planning.ts";

export const DEFAULT_EPISODE_INACTIVITY_MS = 30 * 60 * 1000;

export type EpisodeBoundary =
  | { startsNewEpisode: false }
  | { startsNewEpisode: true; reason: "explicit_reset" | "greeting_after_inactivity";
      boundaryMessageId: string; boundaryAt: Date };

function chronological(messages: ConversationMessage[]): ConversationMessage[] {
  return [...messages].sort((left, right) => {
    const timeDelta = left.createdAt.getTime() - right.createdAt.getTime();
    return timeDelta || (left.inputRevision ?? 0) - (right.inputRevision ?? 0);
  });
}

function mergeHistoryAndCurrentTurn(
  history: ConversationMessage[],
  currentTurn: ConversationMessage[],
): ConversationMessage[] {
  const messages = new Map(history.map((message) => [message.id, message]));
  for (const message of currentTurn) {
    if (!messages.has(message.id)) messages.set(message.id, message);
  }
  return chronological([...messages.values()]);
}

/**
 * Detects a topical episode boundary. Identity and the Nextfit profile are not
 * inputs, so this operation can only discard conversational context.
 */
export function detectEpisodeBoundary(input: {
  history: ConversationMessage[];
  currentTurn: ConversationMessage[];
  inactivityMs?: number;
}): EpisodeBoundary {
  const timeline = mergeHistoryAndCurrentTurn(input.history, input.currentTurn);
  const inactivityMs = input.inactivityMs ?? DEFAULT_EPISODE_INACTIVITY_MS;
  let latestBoundary: Extract<EpisodeBoundary, { startsNewEpisode: true }> | undefined;

  for (const [index, message] of timeline.entries()) {
    if (message.role !== "user") continue;
    if (isExplicitResetMessage(message.content)) {
      latestBoundary = { startsNewEpisode: true, reason: "explicit_reset",
        boundaryMessageId: message.id, boundaryAt: message.createdAt };
      continue;
    }
    const previous = timeline[index - 1];
    const priorTimeline = timeline.slice(0, index);
    const lastInboundIndex = priorTimeline.findLastIndex((item) => item.role === "user");
    const previousInboundWasAnswered = lastInboundIndex < 0
      || priorTimeline.slice(lastInboundIndex + 1).some((item) => item.role === "assistant");
    if (previous && previousInboundWasAnswered && isGreetingMessage(message.content)
      && message.createdAt.getTime() - previous.createdAt.getTime() >= inactivityMs) {
      latestBoundary = { startsNewEpisode: true, reason: "greeting_after_inactivity",
        boundaryMessageId: message.id, boundaryAt: message.createdAt };
    }
  }

  return latestBoundary ?? { startsNewEpisode: false };
}

/**
 * Keeps the current episode in chronological order. Current-turn messages are
 * appended if a repository snapshot did not contain them yet.
 */
export function applyEpisodeBoundaryToHistory(input: {
  history: ConversationMessage[];
  currentTurn: ConversationMessage[];
  inactivityMs?: number;
}): { messages: ConversationMessage[]; boundary: EpisodeBoundary } {
  const boundary = detectEpisodeBoundary(input);
  if (!boundary.startsNewEpisode) return { messages: input.history, boundary };

  const timeline = mergeHistoryAndCurrentTurn(input.history, input.currentTurn);
  const boundaryIndex = timeline.findIndex((message) => message.id === boundary.boundaryMessageId);
  return { messages: boundaryIndex >= 0 ? timeline.slice(boundaryIndex) : timeline, boundary };
}
