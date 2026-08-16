import { buildCustomerContext, type CustomerContext } from "../customer-context/index.ts";
import type { WhatsAppProvider } from "../whatsapp/provider.ts";
import { normalizeBrazilianPhoneNumber } from "./phone.ts";
import type { ConversationRepository } from "./types.ts";
import { buildSocialReply, classifySocialMessage } from "./social-message.ts";

export async function handleIncomingMessage(input: {
  accountId: string; providerConversationId: string; providerEventId: string; providerMessageId: string;
  phoneNumber: string; text: string; repository: ConversationRepository; provider: WhatsAppProvider;
  generateReply: (input: { message: string; context: CustomerContext }) => Promise<string>;
  enrichCustomer?: (input: { identity: Awaited<ReturnType<ConversationRepository["recordInbound"]>>["identity"]; phoneNumber: string; message: string }) => Promise<Awaited<ReturnType<ConversationRepository["recordInbound"]>>["identity"]>;
}): Promise<"duplicate" | "replied"> {
  const inbound = await input.repository.recordInbound({
    phoneNumber: normalizeBrazilianPhoneNumber(input.phoneNumber), providerMessageId: input.providerMessageId, content: input.text,
  });
  if (!inbound.inserted) return "duplicate";
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
