import { buildCustomerContext, type CustomerContext } from "../customer-context/index.ts";
import type { WhatsAppProvider } from "../whatsapp/provider.ts";
import { normalizeBrazilianPhoneNumber } from "./phone.ts";
import type { ConversationRepository } from "./types.ts";
import { buildSocialReply, classifySocialMessage } from "./social-message.ts";
import { detectHandoffRequest, HANDOFF_ACKNOWLEDGEMENT } from "../handoff/detection.ts";
import { buildHandoffSummary } from "../handoff/summary.ts";
import type { HandoffStore } from "../handoff/types.ts";

export async function handleIncomingMessage(input: {
  accountId: string; providerConversationId: string; providerEventId: string; providerMessageId: string;
  phoneNumber: string; text: string; repository: ConversationRepository & Partial<HandoffStore>; provider: WhatsAppProvider;
  generateReply: (input: { message: string; context: CustomerContext }) => Promise<string>;
  enrichCustomer?: (input: { identity: Awaited<ReturnType<ConversationRepository["recordInbound"]>>["identity"]; phoneNumber: string; message: string }) => Promise<Awaited<ReturnType<ConversationRepository["recordInbound"]>>["identity"]>;
  notifyHandoff?: (input: { conversationId: string; firstName?: string; reason: string; summary: string }) => Promise<void>;
}): Promise<"duplicate" | "replied" | "human_silent" | "handoff_requested"> {
  const inbound = await input.repository.recordInbound({
    phoneNumber: normalizeBrazilianPhoneNumber(input.phoneNumber), providerMessageId: input.providerMessageId,
    content: input.text, providerAccountId: input.accountId, providerConversationId: input.providerConversationId,
  });
  if (!inbound.inserted) return "duplicate";
  if (inbound.conversationStatus === "human_requested" || inbound.conversationStatus === "human_active") {
    return "human_silent";
  }

  const handoff = detectHandoffRequest(input.text);
  if (handoff) {
    if (!input.repository.requestHandoff) throw new Error("Handoff store unavailable");
    const messages = await input.repository.getRecentMessages(inbound.identity.conversationId, 8);
    const summary = buildHandoffSummary(messages, handoff.reason);
    await input.repository.requestHandoff({ conversationId: inbound.identity.conversationId,
      providerAccountId: input.accountId, providerConversationId: input.providerConversationId,
      reason: handoff.reason, source: handoff.source, summary });
    await input.provider.sendText({ accountId: input.accountId, conversationId: input.providerConversationId,
      idempotencyKey: `zernio-handoff-${input.providerEventId}`, text: HANDOFF_ACKNOWLEDGEMENT });
    await input.repository.recordOutbound({ conversationId: inbound.identity.conversationId, content: HANDOFF_ACKNOWLEDGEMENT });
    if (input.notifyHandoff) {
      try { await input.notifyHandoff({ conversationId: inbound.identity.conversationId,
        firstName: inbound.identity.firstName, reason: handoff.reason, summary }); }
      catch (error) { console.warn("Handoff notification failed", { error: error instanceof Error ? error.name : "UnknownError" }); }
    }
    return "handoff_requested";
  }
  if (input.provider.sendTypingIndicator) {
    try {
      await input.provider.sendTypingIndicator({ accountId: input.accountId, conversationId: input.providerConversationId });
    } catch (error) {
      console.warn("WhatsApp typing indicator failed", { error: error instanceof Error ? error.name : "UnknownError" });
    }
  }
  let identity = inbound.identity;
  const socialMessageKind = classifySocialMessage(input.text);
  if (input.enrichCustomer && !socialMessageKind) {
    try {
      identity = await input.enrichCustomer({ identity, phoneNumber: normalizeBrazilianPhoneNumber(input.phoneNumber), message: input.text });
    } catch (error) {
      // Nextfit is optional enrichment: messaging must remain available on provider failure.
      console.warn("Customer enrichment failed", { error: error instanceof Error ? error.name : "UnknownError" });
    }
  }
  const context = await buildCustomerContext(input.repository, identity);
  const reply = socialMessageKind
    ? buildSocialReply(socialMessageKind, context.identity.firstName)
    : await input.generateReply({ message: input.text, context });
  await input.provider.sendText({ accountId: input.accountId, conversationId: input.providerConversationId,
    idempotencyKey: `zernio-webhook-${input.providerEventId}`, text: reply });
  await input.repository.recordOutbound({ conversationId: inbound.identity.conversationId, content: reply });
  return "replied";
}
