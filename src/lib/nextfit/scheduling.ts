const SCHEDULING_ACTION = /\b(?:agend(?:ar|amento|a|e|o)|marc(?:ar|a[cç][aã]o)|reserv(?:ar|a|e)|disponibilidade|vaga)\w*/i;
const SLOT_TERM = /\bhor[aá]rio\w*/i;
const SERVICE = /\b(?:massag|pilates|fisio|recovery|termoterapia|crioterapia|banheira|drenagem|shiatsu|lomi|thai|ayurv[eé]dica|libera[cç][aã]o|miofascial|miofacial)\w*/i;
const DAY_PREFERENCE = /\b(?:hoje|amanh[aã]|segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo|\d{1,2}(?:\/\d{1,2})?)\b/i;
const PERIOD_PREFERENCE = /\b(?:manh[aã]|tarde|noite)\b/i;

export type SchedulingIntent = {
  requested: boolean;
  hasService: boolean;
  hasDatePreference: boolean;
  hasDayPreference: boolean;
  hasPeriodPreference: boolean;
};

export function detectSchedulingIntent(message: string): SchedulingIntent {
  const hasService = SERVICE.test(message);
  const hasDayPreference = DAY_PREFERENCE.test(message);
  const hasPeriodPreference = PERIOD_PREFERENCE.test(message);
  const hasDatePreference = hasDayPreference || hasPeriodPreference;
  return {
    requested: SCHEDULING_ACTION.test(message) || (hasService && (hasDatePreference || SLOT_TERM.test(message))),
    hasService,
    hasDatePreference,
    hasDayPreference,
    hasPeriodPreference,
  };
}

function safeBookingUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function buildSchedulingInstructions(message: string, bookingUrl = process.env.NEXTFIT_BOOKING_URL): string | undefined {
  const intent = detectSchedulingIntent(message);
  if (!intent.requested) return undefined;
  const url = safeBookingUrl(bookingUrl);
  const missing = [!intent.hasService ? "serviço" : undefined,
    !intent.hasDayPreference ? "dia" : undefined,
    !intent.hasPeriodPreference ? "período (manhã, tarde ou noite)" : undefined]
    .filter(Boolean).join(" e ");

  if (url) {
    return `AGENDAMENTO NEXTFIT:
- A API contratada é somente leitura; não declare que uma reserva foi criada.
- A disponibilidade e a conclusão devem ocorrer no site oficial: ${url}
- ${missing ? `Antes do link, faça uma única pergunta curta para descobrir: ${missing}.` : "O pedido já contém serviço, dia e período; conduza diretamente ao link oficial em vez de oferecer confirmação manual."}
- Diga claramente que o horário só fica reservado após a confirmação no site.
- Nunca invente horários, vagas, profissional ou confirmação.`;
  }

  return `AGENDAMENTO NEXTFIT:
- A API contratada é somente leitura e o link oficial de agendamento ainda não está configurado.
- ${missing ? `Faça uma única pergunta curta para descobrir: ${missing}.` : "O pedido já contém serviço, dia e período."}
- Não invente horários e não diga que consultou ou reservou uma vaga.
- Quando já houver serviço, dia e período, ofereça encaminhar a conversa para a equipe pelo handoff interno.
- Não encaminhe o cliente para o mesmo número de WhatsApp em que ele já está falando.`;
}
