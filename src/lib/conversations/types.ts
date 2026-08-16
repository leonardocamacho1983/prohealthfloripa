export type RelationshipStatus = "unknown" | "prospect" | "lead" | "customer" | "former_customer";
export type ConversationStatus = "active" | "human_requested" | "human_active" | "closed";

export type ConversationMessage = {
  id: string; conversationId: string; providerMessageId?: string;
  direction: "inbound" | "outbound"; role: "user" | "assistant" | "system";
  content: string; createdAt: Date;
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
export interface ConversationRepository {
  recordInbound(input: { phoneNumber: string; providerMessageId: string; content: string }): Promise<{ identity: ConversationIdentity; inserted: boolean }>;
  recordOutbound(input: { conversationId: string; content: string }): Promise<void>;
  getRecentMessages(conversationId: string, limit: number): Promise<ConversationMessage[]>;
  getCustomerProfile(contactId: string): Promise<CustomerProfile | undefined>;
}

export interface CustomerProfileStore {
  getProfileSyncState(contactId: string): Promise<{ syncedAt?: string; externalCustomerId?: string }>;
  saveCustomerSnapshot(input: {
    contactId: string; firstName?: string; relationshipStatus: RelationshipStatus;
    profile: CustomerProfile & { externalCustomerId?: string; source: "nextfit" };
  }): Promise<ConversationIdentity>;
}
