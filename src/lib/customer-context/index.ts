import type { ConversationIdentity, ConversationMessage, ConversationRepository, CustomerProfile } from "../conversations/types.ts";

export type CustomerContext = {
  identity: { relationshipStatus: ConversationIdentity["relationshipStatus"]; firstName?: string };
  conversation: { recentMessages: ConversationMessage[]; summary?: string; openIntent?: string };
  customer: CustomerProfile;
};

function detectOpenIntent(messages: ConversationMessage[]): string | undefined {
  const userText = messages.filter((item) => item.role === "user").map((item) => item.content.toLowerCase()).join(" ");
  return ["pilates", "massagem", "fisioterapia", "recovery", "termoterapia"].find((item) => userText.includes(item));
}

export async function buildCustomerContext(repository: ConversationRepository, identity: ConversationIdentity, recentMessageLimit=12): Promise<CustomerContext> {
  const [recentMessages, profile] = await Promise.all([
    repository.getRecentMessages(identity.conversationId, recentMessageLimit),
    repository.getCustomerProfile(identity.contactId),
  ]);
  const openIntent = detectOpenIntent(recentMessages);
  return {
    identity: { relationshipStatus: identity.relationshipStatus, ...(identity.firstName ? { firstName: identity.firstName } : {}) },
    conversation: { recentMessages, ...(openIntent ? { openIntent } : {}) },
    customer: profile ?? {},
  };
}

export function prepareConversationSummary(messages: ConversationMessage[]): string | undefined {
  if (!messages.length) return undefined;
  return messages.slice(-6).map((item) => `${item.role}: ${item.content}`).join("\n");
}

export function customerContextForModel(context: CustomerContext): string {
  return JSON.stringify({
    identity: context.identity,
    conversation: { ...(context.conversation.summary ? { summary: context.conversation.summary } : {}), ...(context.conversation.openIntent ? { openIntent: context.conversation.openIntent } : {}) },
    customer: context.customer,
  });
}
