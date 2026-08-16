export type SendTextMessage = {
  accountId: string;
  conversationId: string;
  idempotencyKey: string;
  text: string;
};

export interface WhatsAppProvider {
  sendText(message: SendTextMessage): Promise<void>;
  sendTypingIndicator?(input: { accountId: string; conversationId: string }): Promise<void>;
}
