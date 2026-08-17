export type SendTextMessage = {
  accountId: string;
  conversationId: string;
  idempotencyKey: string;
  text: string;
};

export interface WhatsAppProvider {
  sendText(message: SendTextMessage): Promise<void>;
  sendTypingIndicator?(input: { accountId: string; conversationId: string; signal?: AbortSignal }): Promise<void>;
  sendTemplate?(input: { accountId: string; participantId: string; templateName: string;
    templateLanguage: string; templateParams: string[]; idempotencyKey: string }): Promise<void>;
}
