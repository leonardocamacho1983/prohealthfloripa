import type { ConversationIdentity, ConversationMessage, ConversationRepository, CustomerProfile } from "../conversations/types.ts";
import type { CustomerIntelligence, NextBestAction } from "../customer-intelligence/types.ts";
import { analyzeMassageRequest } from "../knowledge/massage-catalog-semantics.ts";
import { isPersonalAccountFollowUp, isPersonalAccountQuery,
  isPersonalPaymentAmountQuery } from "./personal-intent.ts";

export type CustomerContext = {
  identity: { relationshipStatus: ConversationIdentity["relationshipStatus"]; firstName?: string };
  conversation: { recentMessages: ConversationMessage[]; summary?: string; openIntent?: string };
  customer: CustomerProfile;
};

const CONVERSATION_INTENTS = ["pilates", "massagem", "fisioterapia", "recovery", "termoterapia"] as const;

function detectMessageIntent(content: string): string | undefined {
  const text = content.toLowerCase();
  const massage = analyzeMassageRequest(content);
  if (massage.mentions.length > 0 || /\b(?:massag|massoterap)\w*/i.test(content)) {
    return "massagem";
  }
  return CONVERSATION_INTENTS.find((candidate) => candidate !== "massagem" && text.includes(candidate));
}

export function detectOpenIntent(messages: ConversationMessage[]): string | undefined {
  // The most recent user intent wins. Looking at the whole transcript as one
  // string allowed an old Pilates question to override a new massage request.
  for (const message of [...messages].reverse()) {
    if (message.role !== "user") continue;
    const intent = detectMessageIntent(message.content);
    if (intent) return intent;
  }
  return undefined;
}

export function replaceConversationHistory(
  context: CustomerContext,
  recentMessages: ConversationMessage[],
): CustomerContext {
  const openIntent = detectOpenIntent(recentMessages);
  const { openIntent: _staleIntent, ...conversation } = context.conversation;
  void _staleIntent;
  return {
    ...context,
    conversation: {
      ...conversation,
      recentMessages,
      ...(openIntent ? { openIntent } : {}),
    },
  };
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

function currentTurnUserText(
  context: CustomerContext,
  currentTurnMessageIds?: readonly string[],
): string {
  const userMessages = context.conversation.recentMessages.filter((message) => message.role === "user");
  if (!currentTurnMessageIds?.length) return userMessages.at(-1)?.content ?? "";
  const currentIds = new Set(currentTurnMessageIds);
  return userMessages
    .filter((message) => currentIds.has(message.id))
    .map((message) => message.content)
    .join("\n");
}

function previousUserText(
  context: CustomerContext,
  currentTurnMessageIds?: readonly string[],
): string | undefined {
  const userMessages = context.conversation.recentMessages.filter((message) => message.role === "user");
  if (!currentTurnMessageIds?.length) {
    const current = userMessages.at(-1);
    const previous = userMessages.at(-2);
    if (!current || !previous) return undefined;
    const gap = current.createdAt.getTime() - previous.createdAt.getTime();
    return gap >= 0 && gap <= 30 * 60_000 ? previous.content : undefined;
  }
  const currentIds = new Set(currentTurnMessageIds);
  const current = userMessages.find((message) => currentIds.has(message.id));
  const previous = [...userMessages].reverse().find((message) => !currentIds.has(message.id));
  if (!current || !previous) return undefined;
  const gap = current.createdAt.getTime() - previous.createdAt.getTime();
  return gap >= 0 && gap <= 30 * 60_000 ? previous.content : undefined;
}

export function buildModelCustomerContext(
  context: CustomerContext,
  now = new Date(),
  currentTurnMessageIds?: readonly string[],
): string {
  const profile = context.customer;
  const fresh = profile.syncedAt ? now.getTime() - new Date(profile.syncedAt).getTime() <= 24 * 3_600_000 : false;
  const currentTurnText = currentTurnUserText(context, currentTurnMessageIds);
  const previousAccountText = previousUserText(context, currentTurnMessageIds);
  const personalFollowUp = isPersonalAccountFollowUp(currentTurnText, previousAccountText);
  const asksAboutCustomerAccount = isPersonalAccountQuery(currentTurnText)
    || personalFollowUp;
  const asksForPaymentAmount = isPersonalPaymentAmountQuery(currentTurnText)
    || (personalFollowUp && /\b(?:quanto|valor)\b/i.test(currentTurnText)
      && /\b(?:pag\w*|cobran[cç]\w*|mensalidade)\b/i.test(previousAccountText ?? ""));
  const asksAboutFinancial = asksAboutCustomerAccount
    && /\b(?:pag\w*|finan[cç]\w*|cobran[cç]a|mensalidade|valor)\b/i.test(currentTurnText);
  const relationshipMetrics = profile.relationshipMetrics && typeof profile.relationshipMetrics === "object"
    ? { ...(profile.relationshipMetrics as Record<string, unknown>) } : undefined;
  const lastPayment = relationshipMetrics?.lastPayment;
  const activeContractValues = relationshipMetrics?.activeContractValues;
  const intelligence = relationshipMetrics?.customerIntelligence as CustomerIntelligence | undefined;
  if (relationshipMetrics) delete relationshipMetrics.lastPayment;
  if (relationshipMetrics) delete relationshipMetrics.activeContractValues;
  if (relationshipMetrics) delete relationshipMetrics.customerIntelligence;
  const safeActions = asksAboutCustomerAccount ? intelligence?.nextBestActions.filter((action: NextBestAction) =>
    action.type !== "human_followup" || asksAboutFinancial).map((action) => ({
      type: action.type, reason: action.reason, confidence: action.confidence,
      evidence: action.evidence.map((item) => ({ metric: item.metric, value: item.value })),
    })) : undefined;
  return JSON.stringify({
    identity: {
      ...(context.identity.firstName ? { firstName: context.identity.firstName } : {}),
      ...(asksAboutCustomerAccount ? { relationshipStatus: context.identity.relationshipStatus } : {}),
      ...(asksAboutCustomerAccount && intelligence ? { relationshipState: intelligence.relationshipState.value } : {}),
    },
    conversation: { ...(context.conversation.summary ? { summary: context.conversation.summary } : {}), ...(context.conversation.openIntent ? { openIntent: context.conversation.openIntent } : {}) },
    customer: {
      ...(asksAboutCustomerAccount && intelligence?.metrics.daysAsCustomer !== undefined ? { relationshipDurationDays: intelligence.metrics.daysAsCustomer } : {}),
      ...(fresh && asksAboutCustomerAccount && profile.nextVisitAt ? { nextVisitAt: profile.nextVisitAt } : {}),
      ...(fresh && asksAboutCustomerAccount && profile.activeContracts ? { activeContracts: profile.activeContracts } : {}),
      ...(asksAboutCustomerAccount && intelligence?.metrics.activeServices ? { activeServices: intelligence.metrics.activeServices } : {}),
      ...(asksAboutCustomerAccount && intelligence?.recentActivitySummary ? { recentActivitySummary: intelligence.recentActivitySummary } : {}),
      ...(safeActions?.length ? { nextBestActions: safeActions } : {}),
      ...(fresh && asksAboutFinancial && profile.financialStatus ? { financialStatus: profile.financialStatus } : {}),
      ...(fresh && asksForPaymentAmount && (lastPayment || activeContractValues) ? { requestedFinancialDetail: {
        ...(lastPayment ? { lastPayment } : {}), ...(activeContractValues ? { activeContractValues } : {}) } } : {}),
    },
  });
}

export const customerContextForModel = buildModelCustomerContext;
