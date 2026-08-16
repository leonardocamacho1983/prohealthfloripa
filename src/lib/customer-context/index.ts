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

export function buildModelCustomerContext(context: CustomerContext, now = new Date()): string {
  const profile = context.customer;
  const fresh = profile.syncedAt ? now.getTime() - new Date(profile.syncedAt).getTime() <= 24 * 3_600_000 : false;
  const latestUserMessage = context.conversation.recentMessages.filter((message) => message.role === "user").at(-1)?.content ?? "";
  const asksForPaymentAmount = /(quanto|valor).*(paguei|pagamento|cobran[cç]a|mensalidade)|(?:paguei|pagamento|cobran[cç]a|mensalidade).*(quanto|valor)/i.test(latestUserMessage);
  const relationshipMetrics = profile.relationshipMetrics && typeof profile.relationshipMetrics === "object"
    ? { ...(profile.relationshipMetrics as Record<string, unknown>) } : undefined;
  const lastPayment = relationshipMetrics?.lastPayment;
  if (relationshipMetrics) delete relationshipMetrics.lastPayment;
  return JSON.stringify({
    identity: context.identity,
    conversation: { ...(context.conversation.summary ? { summary: context.conversation.summary } : {}), ...(context.conversation.openIntent ? { openIntent: context.conversation.openIntent } : {}) },
    customer: {
      ...(profile.customerSince ? { customerSince: profile.customerSince } : {}),
      ...(fresh && profile.financialStatus ? { financialStatus: profile.financialStatus } : {}),
      ...(profile.lastVisitAt ? { lastVisitAt: profile.lastVisitAt } : {}),
      ...(fresh && profile.nextVisitAt ? { nextVisitAt: profile.nextVisitAt } : {}),
      ...(fresh && profile.activeContracts ? { activeContracts: profile.activeContracts } : {}),
      ...(profile.consumedServicesSummary ? { consumedServicesSummary: profile.consumedServicesSummary } : {}),
      ...(profile.attendanceMetrics ? { attendanceMetrics: profile.attendanceMetrics } : {}),
      ...(fresh && relationshipMetrics ? { relationshipMetrics } : {}),
      ...(fresh && asksForPaymentAmount && lastPayment ? { requestedFinancialDetail: { lastPayment } } : {}),
    },
  });
}

export const customerContextForModel = buildModelCustomerContext;
