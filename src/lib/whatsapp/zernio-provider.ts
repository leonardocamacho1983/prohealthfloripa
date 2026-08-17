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

  async sendTypingIndicator({ accountId, conversationId, signal }: {
    accountId: string;
    conversationId: string;
    signal?: AbortSignal;
  }): Promise<void> {
    const timeoutSignal = AbortSignal.timeout(2_000);
    const response = await this.fetcher(
      `${ZERNIO_API_BASE_URL}/v1/inbox/conversations/${encodeURIComponent(conversationId)}/typing`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
        signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
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

  async sendTemplate(input: { accountId: string; participantId: string; templateName: string;
    templateLanguage: string; templateParams: string[]; idempotencyKey: string }): Promise<void> {
    const response = await this.fetcher(`${ZERNIO_API_BASE_URL}/v1/inbox/conversations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey },
      body: JSON.stringify({ accountId: input.accountId, participantId: input.participantId,
        templateName: input.templateName, templateLanguage: input.templateLanguage,
        templateParams: input.templateParams }),
      signal: AbortSignal.timeout(3_500),
    });
    if (!response.ok) throw new Error(`Zernio template send failed with HTTP ${response.status}`);
  }
}
