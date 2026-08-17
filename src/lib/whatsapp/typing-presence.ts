import type { WhatsAppProvider } from "./provider.ts";

type TypingPresenceInput = {
  provider: WhatsAppProvider;
  accountId: string;
  conversationId: string;
  refreshAfterMs?: number;
  onFailure?: (error: unknown) => void;
};

export type TypingPresence = { stop: () => void };

/**
 * Starts the official provider typing signal without holding up the turn.
 *
 * The same documented signal is refreshed at most once for a long-running
 * turn. Stopping aborts in-flight best-effort requests so a late response
 * cannot make "typing..." appear after the actual message was sent.
 */
export function startTypingPresence(input: TypingPresenceInput): TypingPresence {
  const sendTypingIndicator = input.provider.sendTypingIndicator;
  if (!sendTypingIndicator) return { stop() {} };

  let stopped = false;
  const activeRequests = new Set<AbortController>();

  const signal = () => {
    if (stopped) return;
    const controller = new AbortController();
    activeRequests.add(controller);
    void sendTypingIndicator.call(input.provider, {
      accountId: input.accountId,
      conversationId: input.conversationId,
      signal: controller.signal,
    }).catch((error) => {
      if (!controller.signal.aborted) input.onFailure?.(error);
    }).finally(() => {
      activeRequests.delete(controller);
    });
  };

  signal();
  const refreshTimer = setTimeout(signal, input.refreshAfterMs ?? 5_000);
  refreshTimer.unref?.();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout(refreshTimer);
      for (const controller of activeRequests) controller.abort();
      activeRequests.clear();
    },
  };
}
