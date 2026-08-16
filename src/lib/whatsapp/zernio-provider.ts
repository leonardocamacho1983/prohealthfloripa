import type {
  SendTextMessage,
  WhatsAppProvider,
} from "./provider";

const ZERNIO_API_BASE_URL = "https://zernio.com/api";

export class ZernioWhatsAppProvider implements WhatsAppProvider {
  constructor(private readonly apiKey: string) {}

  async sendText({
    accountId,
    conversationId,
    idempotencyKey,
    text,
  }: SendTextMessage): Promise<void> {
    const response = await fetch(
      `${ZERNIO_API_BASE_URL}/v1/inbox/conversations/${encodeURIComponent(conversationId)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ accountId, message: text }),
        signal: AbortSignal.timeout(3_500),
      },
    );

    if (!response.ok) {
      throw new Error(`Zernio send failed with HTTP ${response.status}`);
    }
  }
}
