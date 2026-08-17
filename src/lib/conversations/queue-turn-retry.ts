import type { TurnProcessingResult } from "./process-conversation-turn.ts";

type QueueRetryDirective = { afterSeconds: number } | { acknowledge: true };

const RETRY_DELAYS = {
  not_due: 1,
  busy: 5,
} as const;

export class RetryableTurnStateError extends Error {
  readonly retryAfterSeconds: number;
  readonly state: keyof typeof RETRY_DELAYS;

  constructor(state: keyof typeof RETRY_DELAYS) {
    super(`Conversation turn is temporarily ${state}`);
    this.name = "RetryableTurnStateError";
    this.state = state;
    this.retryAfterSeconds = RETRY_DELAYS[state];
  }
}

export function isRetryableTurnStateError(error: unknown): error is RetryableTurnStateError {
  return error instanceof RetryableTurnStateError;
}

/**
 * Returning normally from a Vercel Queue callback acknowledges and deletes the
 * message. Temporary acquisition states must therefore throw so the message is
 * made visible again instead of being lost.
 */
export function requireSettledQueueTurn(result: TurnProcessingResult): TurnProcessingResult {
  if (result === "not_due" || result === "busy") {
    throw new RetryableTurnStateError(result);
  }
  return result;
}

export function queueTurnRetryDirective(error: unknown, deliveryCount: number): QueueRetryDirective {
  if (isRetryableTurnStateError(error)) {
    return { afterSeconds: error.retryAfterSeconds };
  }
  if (deliveryCount >= 7) return { acknowledge: true };
  return { afterSeconds: Math.min(60, 2 ** deliveryCount * 3) };
}
