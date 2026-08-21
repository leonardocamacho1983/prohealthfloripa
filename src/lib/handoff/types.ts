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
  assignedAttendantUserId?: string;
  assignedAttendantName?: string;
  assignmentVersion: number;
  awaitingCustomerSince?: Date;
  awaitingCustomerDeadlineAt?: Date;
  slaStatus?: "normal" | "warning" | "breached" | "paused" | "completed";
  nextDeadlineAt?: Date;
  notificationFailure?: boolean;
  openPromiseCount?: number;
  actionPriority?: number;
};

export type InboxConversation = Omit<HandoffConversation, "status" | "reason" | "source" | "requestedAt"> & {
  status: ConversationStatus;
  reason?: string;
  source?: HandoffSource;
  requestedAt?: Date;
  ownerScope?: "mine" | "unassigned" | "team";
};

export interface HandoffStore {
  getConversationState(conversationId: string): Promise<{ status: ConversationStatus; expiresAt?: Date }>;
  requestHandoff(input: { conversationId: string; providerAccountId: string; providerConversationId: string;
    reason: string; source: HandoffSource; summary: string; now?: Date }): Promise<void>;
  listHandoffs(): Promise<HandoffConversation[]>;
  takeHandoff(conversationId: string, actor: { userId: string; label: string }): Promise<void>;
  touchHandoff(conversationId: string, actorUserId: string): Promise<void>;
  closeHandoff(input: { conversationId: string; actorUserId: string; actorLabel: string;
    reasonId: string; reasonLabel: string; note?: string }): Promise<void>;
  returnToAgent?(input: { conversationId: string; actorUserId: string; actorLabel: string }): Promise<void>;
  transferHandoff?(input: { conversationId: string; actorUserId: string; actorLabel: string;
    actorCanForce: boolean; expectedAssignmentVersion: number; targetUserId: string;
    targetLabel: string; reasonId: string; reasonLabel: string; note?: string;
    idempotencyKey: string }): Promise<void>;
  setAwaitingCustomer?(input: { conversationId: string; actorUserId: string; actorLabel: string;
    expectedAssignmentVersion: number; enabled: boolean; inactivityMinutes?: number;
    idempotencyKey: string }): Promise<{ inactivityToken?: string; delaySeconds?: number }>;
  markHandoffViewed(conversationId: string, viewerUserId: string): Promise<void>;
  recordHandoffEvent(conversationId: string, eventType: string): Promise<void>;
}
