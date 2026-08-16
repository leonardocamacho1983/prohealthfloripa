import { buildCustomerContext, type CustomerContext } from "../customer-context/index.ts";
import type { WhatsAppProvider } from "../whatsapp/provider.ts";
import { normalizePhoneNumber } from "./phone.ts";
import type { ConversationRepository } from "./types.ts";

export async function handleIncomingMessage(input: {
  accountId: string; providerConversationId: string; providerEventId: string; providerMessageId: string;
  phoneNumber: string; text: string; repository: ConversationRepository; provider: WhatsAppProvider;
  generateReply: (input: { message: string; context: CustomerContext }) => Promise<string>;
}): Promise<"duplicate" | "replied"> {
  const inbound = await input.repository.recordInbound({
    phoneNumber: normalizePhoneNumber(input.phoneNumber), providerMessageId: input.providerMessageId, content: input.text,
  });
  if (!inbound.inserted) return "duplicate";
  const context = await buildCustomerContext(input.repository, inbound.identity);
  const reply = await input.generateReply({ message: input.text, context });
  await input.provider.sendText({ accountId: input.accountId, conversationId: input.providerConversationId,
    idempotencyKey: `zernio-webhook-${input.providerEventId}`, text: reply });
  await input.repository.recordOutbound({ conversationId: inbound.identity.conversationId, content: reply });
  return "replied";
}
