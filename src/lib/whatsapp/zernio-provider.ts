import type {
  SendTextMessage,
  WhatsAppProvider,
} from "./provider";

const ZERNIO_API_BASE_URL = "https://zernio.com/api";

export class ZernioWhatsAppProvider implements WhatsAppProvider {
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;

  constructor(apiKey: string, fetcher: typeof fetch = fetch) {
    this.apiKey = apiKey;
    this.fetcher = fetcher;
  }

  async sendTypingIndicator({ accountId, conversationId }: { accountId: string; conversationId: string }): Promise<void> {
    const response = await this.fetcher(
      `${ZERNIO_API_BASE_URL}/v1/inbox/conversations/${encodeURIComponent(conversationId)}/typing`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
        signal: AbortSignal.timeout(3_500),
      },
    );
    if (!response.ok) throw new Error(`Zernio typing indicator failed with HTTP ${response.status}`);
  }

  async sendText({
    accountId,
    conversationId,
    idempotencyKey,
    text,
  }: SendTextMessage): Promise<void> {
    const response = await this.fetcher(
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
