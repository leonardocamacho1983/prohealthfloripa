import type { ConversationJourneyState } from "../journey/types";

export type RelationshipStatus = "unknown" | "prospect" | "lead" | "customer" | "former_customer";
export type ConversationStatus = "active" | "human_requested" | "human_active" | "closed";

export type ConversationMessage = {
  id: string; conversationId: string; providerMessageId?: string;
  direction: "inbound" | "outbound"; role: "user" | "assistant" | "system";
  content: string; createdAt: Date; inputRevision?: number; responseRevision?: number;
  actorUserId?: string; actorLabel?: string;
  kind?: "message" | "workflow_event";
  visibility?: "customer" | "internal";
};
export type ConversationIdentity = {
  contactId: string; conversationId: string; firstName?: string; relationshipStatus: RelationshipStatus;
};
export type CustomerProfile = {
  customerSince?: string; dateOfBirth?: string; financialStatus?: string;
  lastVisitAt?: string; nextVisitAt?: string; activeContracts?: unknown;
  consumedServicesSummary?: unknown; attendanceMetrics?: unknown;
  relationshipMetrics?: unknown; syncedAt?: string;
};

export type JourneyStateSaveResult = "saved" | "stale";

export type CompleteJourneyHandoffInput = {
  conversationId: string;
  revision: number;
  outboundRevision: number;
  token: string;
  outboundIdempotencyKey: string;
  providerAccountId: string;
  providerConversationId: string;
  reason: string;
  source: "customer" | "safety_rule" | "system_failure";
  summary: string;
  journeyState: ConversationJourneyState;
  analysis?: unknown;
  responsePlan?: unknown;
  now?: Date;
};

export type CompleteTurnWithJourneyStateInput = {
  conversationId: string;
  revision: number;
  token: string;
  journeyState: ConversationJourneyState;
  analysis?: unknown;
  responsePlan?: unknown;
};

export interface ConversationJourneyStateStore {
  getJourneyState(conversationId: string): Promise<ConversationJourneyState | undefined>;
  saveJourneyState(input: {
    conversationId: string;
    state: ConversationJourneyState;
  }): Promise<JourneyStateSaveResult>;
  completeJourneyHandoff?(input: CompleteJourneyHandoffInput): Promise<boolean>;
  completeTurnWithJourneyState?(input: CompleteTurnWithJourneyStateInput): Promise<boolean>;
}

export interface ConversationRepository {
  recordInbound(input: { phoneNumber: string; providerMessageId: string; content: string; providerAccountId?: string; providerConversationId?: string; settleAt?: Date }): Promise<{ identity: ConversationIdentity; inserted: boolean; messageId?: string; revision: number; conversationStatus?: ConversationStatus; humanExpiresAt?: Date }>;
  recordOutbound(input: { conversationId: string; content: string; actorUserId?: string; actorLabel?: string }): Promise<void>;
  getRecentMessages(conversationId: string, limit: number): Promise<ConversationMessage[]>;
  getCustomerProfile(contactId: string): Promise<CustomerProfile | undefined>;
  getJourneyState?: ConversationJourneyStateStore["getJourneyState"];
  saveJourneyState?: ConversationJourneyStateStore["saveJourneyState"];
  completeJourneyHandoff?: ConversationJourneyStateStore["completeJourneyHandoff"];
  completeTurnWithJourneyState?: ConversationJourneyStateStore["completeTurnWithJourneyState"];
}

export type PendingConversationTurn = {
  conversationId: string;
  revision: number;
  processedRevision: number;
  phoneNumber: string;
  accountId: string;
  providerConversationId: string;
  identity: ConversationIdentity;
  messages: ConversationMessage[];
};

export type TurnAcquisition =
  | { kind: "acquired"; turn: PendingConversationTurn }
  | { kind: "stale" | "not_due" | "busy" | "human" | "missing" | "complete" };

export type OutboundReservation = "reserved" | "already_sent" | "stale";
export type TurnCompletionState = "replied" | "suppressed" | "handoff" | "stale" | "failed";

export interface ConversationTurnRepository extends ConversationRepository {
  acquireTurn(input: { conversationId: string; observedRevision: number; token: string; leaseSeconds: number }): Promise<TurnAcquisition>;
  reserveOutbound(input: { conversationId: string; revision: number; token: string; bubbleIndex: number; content: string; idempotencyKey: string }): Promise<OutboundReservation>;
  markOutboundSent(input: { idempotencyKey: string }): Promise<void>;
  markOutboundFailed(input: { idempotencyKey: string }): Promise<void>;
  completeTurn(input: { conversationId: string; revision: number; token: string; state: TurnCompletionState; analysis?: unknown; responsePlan?: unknown }): Promise<boolean>;
  completeAutomaticClosure?(input: { conversationId: string; revision: number; token: string;
    reasonId: "customer_satisfied"; analysis?: unknown; responsePlan?: unknown }): Promise<boolean>;
  releaseTurn(input: { conversationId: string; token: string; state?: Extract<TurnCompletionState, "failed" | "stale"> }): Promise<void>;
}

export interface CustomerProfileStore {
  getProfileSyncState(contactId: string): Promise<{ syncedAt?: string; externalCustomerId?: string; snapshotVersion?: number }>;
  saveCustomerSnapshot(input: {
    contactId: string; firstName?: string; relationshipStatus: RelationshipStatus;
    profile: CustomerProfile & { externalCustomerId?: string; source: "nextfit" };
  }): Promise<ConversationIdentity>;
}
