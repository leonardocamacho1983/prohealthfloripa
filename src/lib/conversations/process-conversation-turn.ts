import { randomUUID } from "node:crypto";

import type { WhatsAppReplyPlan } from "../ai/generate-whatsapp-reply.ts";
import { buildCustomerContext, type CustomerContext } from "../customer-context/index.ts";
import { detectHandoffRequest, HANDOFF_ACKNOWLEDGEMENT } from "../handoff/detection.ts";
import { buildHandoffSummary } from "../handoff/summary.ts";
import type { HandoffStore } from "../handoff/types.ts";
import type { WhatsAppProvider } from "../whatsapp/provider.ts";
import { needsNextfitEnrichment } from "../nextfit/sync-customer.ts";
import { buildSocialReply } from "./social-message.ts";
import { applyResetToHistory, planConversationTurn } from "./turn-planning.ts";
import type { ConversationIdentity, ConversationTurnRepository } from "./types.ts";

export type TurnProcessingResult = "replied" | "suppressed" | "handoff_requested" | "stale"
  | "human_silent" | "busy" | "complete" | "not_due" | "missing";

type EnrichCustomer = (input: { identity: ConversationIdentity; phoneNumber: string; message: string }) => Promise<ConversationIdentity>;

export async function processConversationTurn(input: {
  conversationId: string;
  observedRevision: number;
  repository: ConversationTurnRepository & HandoffStore;
  provider: WhatsAppProvider;
  generateReply: (input: { message: string; context: CustomerContext; repairRequested?: boolean }) => Promise<WhatsAppReplyPlan>;
  enrichCustomer?: EnrichCustomer;
  notifyHandoff?: (input: { conversationId: string; firstName?: string; reason: string; summary: string;
    idempotencyKey: string; accountId: string }) => Promise<void>;
}): Promise<TurnProcessingResult> {
  const token = randomUUID();
  const acquisition = await input.repository.acquireTurn({ conversationId: input.conversationId,
    observedRevision: input.observedRevision, token, leaseSeconds: 60 });
  if (acquisition.kind !== "acquired") {
    if (acquisition.kind === "human") return "human_silent";
    return acquisition.kind;
  }
  const { turn } = acquisition;
  const plan = planConversationTurn(turn.messages);
  if (!plan.messages.length || plan.suppressReply) {
    const completed = await input.repository.completeTurn({ conversationId: turn.conversationId,
      revision: turn.revision, token, state: "suppressed",
      analysis: { inboundCount: plan.messages.length, suppressReply: true } });
    return completed ? "suppressed" : "stale";
  }

  const handoff = detectHandoffRequest(plan.messages.map((message) => message.content).join(" "));
  if (handoff) {
    const history = await input.repository.getRecentMessages(turn.conversationId, 12);
    const summary = buildHandoffSummary(history, handoff.reason);
    await input.repository.requestHandoff({ conversationId: turn.conversationId,
      providerAccountId: turn.accountId, providerConversationId: turn.providerConversationId,
      reason: handoff.reason, source: handoff.source, summary });
    const idempotencyKey = `zernio-handoff-${turn.conversationId}-${turn.revision}`;
    await input.provider.sendText({ accountId: turn.accountId, conversationId: turn.providerConversationId,
      idempotencyKey, text: HANDOFF_ACKNOWLEDGEMENT });
    await input.repository.recordOutbound({ conversationId: turn.conversationId, content: HANDOFF_ACKNOWLEDGEMENT });
    if (input.notifyHandoff) {
      try {
        await input.notifyHandoff({ conversationId: turn.conversationId,
          firstName: turn.identity.firstName, reason: handoff.reason, summary,
          idempotencyKey: `handoff-notification-${turn.conversationId}-${turn.revision}`,
          accountId: turn.accountId });
      } catch (error) {
        console.warn("Handoff notification failed", { error: error instanceof Error ? error.name : "UnknownError" });
      }
    }
    return "handoff_requested";
  }

  if (input.provider.sendTypingIndicator) {
    try {
      await input.provider.sendTypingIndicator({ accountId: turn.accountId, conversationId: turn.providerConversationId });
    } catch (error) {
      console.warn("WhatsApp typing indicator failed", { error: error instanceof Error ? error.name : "UnknownError" });
    }
  }

  try {
    let identity = turn.identity;
    if (input.enrichCustomer && !plan.socialKind && needsNextfitEnrichment(plan.consolidatedMessage)) {
      try {
        identity = await input.enrichCustomer({ identity, phoneNumber: turn.phoneNumber,
          message: plan.consolidatedMessage });
      } catch (error) {
        console.warn("Customer enrichment failed", { error: error instanceof Error ? error.name : "UnknownError" });
      }
    }
    const context = await buildCustomerContext(input.repository, identity, 20);
    context.conversation.recentMessages = applyResetToHistory(context.conversation.recentMessages, plan.resetRequested);
    const responsePlan: WhatsAppReplyPlan = plan.socialKind
      ? { messages: [buildSocialReply(plan.socialKind, context.identity.firstName)],
        answeredTopics: [plan.socialKind], needsClarification: false, handoffRecommended: false }
      : await input.generateReply({ message: plan.consolidatedMessage, context,
        repairRequested: plan.repairRequested });
    // A single outbound operation keeps the reply atomic if another customer message arrives mid-send.
    const text = responsePlan.messages.join("\n\n").trim();
    if (!text) throw new Error("Empty response plan");
    const idempotencyKey = `zernio-turn-${turn.conversationId}-${turn.revision}`;
    const reservation = await input.repository.reserveOutbound({ conversationId: turn.conversationId,
      revision: turn.revision, token, bubbleIndex: 0, content: text, idempotencyKey });
    if (reservation === "stale") {
      await input.repository.releaseTurn({ conversationId: turn.conversationId, token, state: "stale" });
      return "stale";
    }
    if (reservation === "reserved") {
      try {
        await input.provider.sendText({ accountId: turn.accountId, conversationId: turn.providerConversationId,
          idempotencyKey, text });
        await input.repository.markOutboundSent({ idempotencyKey });
      } catch (error) {
        await input.repository.markOutboundFailed({ idempotencyKey });
        throw error;
      }
    }
    const completed = await input.repository.completeTurn({ conversationId: turn.conversationId,
      revision: turn.revision, token, state: "replied",
      analysis: { inboundCount: plan.messages.length, repairRequested: plan.repairRequested,
        resetRequested: plan.resetRequested, socialKind: plan.socialKind ?? null }, responsePlan });
    return completed ? "replied" : "stale";
  } catch (error) {
    await input.repository.releaseTurn({ conversationId: turn.conversationId, token, state: "failed" });
    throw error;
  }
}
