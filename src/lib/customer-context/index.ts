import type { ConversationIdentity, ConversationMessage, ConversationRepository, CustomerProfile } from "../conversations/types.ts";
import type { CustomerIntelligence, NextBestAction } from "../customer-intelligence/types.ts";

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
  const asksForPaymentAmount = /(quanto|valor).*(paguei|pagamento|cobran[cç]a|mensalidade|plano)|(?:paguei|pagamento|cobran[cç]a|mensalidade|plano).*(quanto|valor)/i.test(latestUserMessage);
  const asksAboutCustomerAccount = /\b(meu|minha|plano|contrato|venc|servi[cç]o|agenda|frequ[eê]ncia|presen[cç]a|pag|cobran[cç]a)\w*/i.test(latestUserMessage);
  const asksAboutFinancial = /\b(pag|finance|cobran[cç]a|mensalidade|valor)\w*/i.test(latestUserMessage);
  const relationshipMetrics = profile.relationshipMetrics && typeof profile.relationshipMetrics === "object"
    ? { ...(profile.relationshipMetrics as Record<string, unknown>) } : undefined;
  const lastPayment = relationshipMetrics?.lastPayment;
  const activeContractValues = relationshipMetrics?.activeContractValues;
  const intelligence = relationshipMetrics?.customerIntelligence as CustomerIntelligence | undefined;
  if (relationshipMetrics) delete relationshipMetrics.lastPayment;
  if (relationshipMetrics) delete relationshipMetrics.activeContractValues;
  if (relationshipMetrics) delete relationshipMetrics.customerIntelligence;
  const safeActions = intelligence?.nextBestActions.filter((action: NextBestAction) =>
    action.type !== "human_followup" || asksAboutFinancial).map((action) => ({
      type: action.type, reason: action.reason, confidence: action.confidence,
      evidence: action.evidence.map((item) => ({ metric: item.metric, value: item.value })),
    }));
  return JSON.stringify({
    identity: { ...context.identity, ...(intelligence ? { relationshipState: intelligence.relationshipState.value } : {}) },
    conversation: { ...(context.conversation.summary ? { summary: context.conversation.summary } : {}), ...(context.conversation.openIntent ? { openIntent: context.conversation.openIntent } : {}) },
    customer: {
      ...(intelligence?.metrics.daysAsCustomer !== undefined ? { relationshipDurationDays: intelligence.metrics.daysAsCustomer } : {}),
      ...(fresh && profile.nextVisitAt ? { nextVisitAt: profile.nextVisitAt } : {}),
      ...(fresh && asksAboutCustomerAccount && profile.activeContracts ? { activeContracts: profile.activeContracts } : {}),
      ...(intelligence?.metrics.activeServices ? { activeServices: intelligence.metrics.activeServices } : {}),
      ...(intelligence?.recentActivitySummary ? { recentActivitySummary: intelligence.recentActivitySummary } : {}),
      ...(safeActions?.length ? { nextBestActions: safeActions } : {}),
      ...(fresh && asksAboutFinancial && profile.financialStatus ? { financialStatus: profile.financialStatus } : {}),
      ...(fresh && asksForPaymentAmount && (lastPayment || activeContractValues) ? { requestedFinancialDetail: {
        ...(lastPayment ? { lastPayment } : {}), ...(activeContractValues ? { activeContractValues } : {}) } } : {}),
    },
  });
}

export const customerContextForModel = buildModelCustomerContext;
