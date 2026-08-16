import type { ConversationMessage, ConversationStatus } from "../conversations/types.ts";

export type HandoffSource = "customer" | "safety_rule" | "system_failure";

export type HandoffConversation = {
  id: string;
  contactId: string;
  firstName?: string;
  maskedPhone: string;
  status: Extract<ConversationStatus, "human_requested" | "human_active">;
  reason: string;
  source: HandoffSource;
  summary: string;
  requestedAt: Date;
  lastActivityAt: Date;
  humanStartedAt?: Date;
  expiresAt?: Date;
  unreadCount: number;
  messages: ConversationMessage[];
  providerAccountId: string;
  providerConversationId: string;
};

export type InboxConversation = Omit<HandoffConversation, "status" | "reason" | "source" | "requestedAt"> & {
  status: ConversationStatus;
  reason?: string;
  source?: HandoffSource;
  requestedAt?: Date;
};

export interface HandoffStore {
  getConversationState(conversationId: string): Promise<{ status: ConversationStatus; expiresAt?: Date }>;
  requestHandoff(input: { conversationId: string; providerAccountId: string; providerConversationId: string;
    reason: string; source: HandoffSource; summary: string; now?: Date }): Promise<void>;
  listHandoffs(): Promise<HandoffConversation[]>;
  takeHandoff(conversationId: string): Promise<void>;
  touchHandoff(conversationId: string): Promise<void>;
  closeHandoff(conversationId: string): Promise<void>;
  markHandoffViewed(conversationId: string): Promise<void>;
  recordHandoffEvent(conversationId: string, eventType: string): Promise<void>;
}
