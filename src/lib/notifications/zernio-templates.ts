import "server-only";

const ZERNIO_API_BASE_URL = "https://zernio.com/api";

export const HANDOFF_TEMPLATE_NAME = "prohealth_handoff_alert_v1";
export const SHIFT_DIGEST_TEMPLATE_NAME = "prohealth_shift_digest_v1";
export const NOTIFICATION_TEMPLATE_LANGUAGE = "pt_BR";

export type ZernioTemplateResult = {
  name: string;
  status: string;
  created: boolean;
};

const templates = [
  {
    name: HANDOFF_TEMPLATE_NAME,
    body: "Oi, {{1}}. Tem um cliente que foi transferido para você atender.\n\nEle precisa de: {{2}}\nEstá aguardando há: {{3}}\n\nAbra o atendimento: {{4}}\n\nAo terminar, clique em \"Encerrar atendimento\", escolha o motivo e devolva a conversa para o atendimento automático.",
  },
  {
    name: SHIFT_DIGEST_TEMPLATE_NAME,
    body: "Oi, {{1}}. Seu horário de atendimento começou e há {{2}} conversa(s) pendente(s), da maior para a menor espera:\n\n{{3}}\n\nAbra a fila: {{4}}\n\nAo terminar cada conversa, clique em \"Encerrar atendimento\", escolha o motivo e devolva-a para o atendimento automático.",
  },
] as const;

async function responseError(response: Response): Promise<Error> {
  let code = `HTTP_${response.status}`;
  try {
    const payload = await response.json() as { code?: unknown };
    if (typeof payload.code === "string") code = payload.code.slice(0, 80);
  } catch {
    // The status is enough for a safe operational error.
  }
  const error = new Error(`Zernio template request failed: ${code}`);
  error.name = code;
  return error;
}

export async function ensureZernioNotificationTemplates(input: {
  apiKey: string;
  accountId: string;
  fetcher?: typeof fetch;
}): Promise<ZernioTemplateResult[]> {
  const fetcher = input.fetcher ?? fetch;
  const results: ZernioTemplateResult[] = [];
  for (const template of templates) {
    const path = `${ZERNIO_API_BASE_URL}/v1/whatsapp/templates/${encodeURIComponent(template.name)}?accountId=${encodeURIComponent(input.accountId)}`;
    const existing = await fetcher(path, {
      headers: { Authorization: `Bearer ${input.apiKey}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (existing.ok) {
      const payload = await existing.json() as { template?: { status?: unknown } };
      results.push({ name: template.name,
        status: typeof payload.template?.status === "string" ? payload.template.status : "UNKNOWN",
        created: false });
      continue;
    }
    if (existing.status !== 404) throw await responseError(existing);

    const created = await fetcher(`${ZERNIO_API_BASE_URL}/v1/whatsapp/templates`, {
      method: "POST",
      headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: input.accountId,
        name: template.name,
        category: "UTILITY",
        language: NOTIFICATION_TEMPLATE_LANGUAGE,
        components: [{ type: "BODY", text: template.body }],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!created.ok) throw await responseError(created);
    const payload = await created.json() as { template?: { status?: unknown } };
    results.push({ name: template.name,
      status: typeof payload.template?.status === "string" ? payload.template.status : "PENDING",
      created: true });
  }
  return results;
}
