const PERSONAL_POSSESSIVE_ACCOUNT = /\b(?:meu|minha|meus|minhas)\s+(?:(?:pr[oó]xim[oa]s?|[uú]ltim[oa]s?)\s+)?(?:cadastro|planos?|contratos?|vencimentos?|pagamentos?|cobran[cç]as?|mensalidades?|pend[eê]ncias?|situa[cç][aã]o|aulas?|visitas?|consultas?|servi[cç]os?|sess(?:[aã]o|[oõ]es)|frequ[eê]ncia|presen[cç]a)\b/i;
const PERSONAL_ACTION = /\b(?:paguei|contratei|assinei|frequentei|usei|consumi|faltei|sou\s+(?:cliente|alun[oa])|(?:eu\s+)?tenho\s+(?:(?:um|uma)\s+)?(?:plano|contrato|servi[cç]o)|(?:plano|contrato|servi[cç]o)\s+que\s+(?:eu\s+)?tenho|estou\s+(?:com\s+)?(?:alguma\s+)?(?:pend[eê]ncia|inadimplente)|fiz\s+(?:(?:um|uma)\s+)?(?:pagamento|sess[aã]o|aula))\b/i;
const ACCOUNT_SUBJECT = /\b(?:cliente|cadastro|plano|contrato|venc\w*|pag\w*|cobran[cç]\w*|mensalidade|pend[eê]ncia|situa[cç][aã]o|pr[oó]xima\s+(?:aula|visita|consulta)|[uú]ltim[oa]\s+(?:servi[cç]o|visita|pagamento)|servi[cç]os?|frequ[eê]ncia|presen[cç]a)\b/i;
const ACCOUNT_FOLLOW_UP = /^(?:e\s+)?(?:quando\s+(?:vence|come[cç]a)|qual\s+(?:foi\s+)?(?:o\s+)?valor|quanto\s+(?:foi|paguei)|(?:qual|quando)\s+(?:[ée]\s+)?(?:a\s+)?pr[oó]xim[oa]|a\s+pr[oó]xim[oa]|e\s+depois|e\s+agora)[?!.\s]*$/i;

/** True only when the speaker asks about their own operational account. */
export function isPersonalAccountQuery(text: string): boolean {
  const personal = PERSONAL_POSSESSIVE_ACCOUNT.test(text) || PERSONAL_ACTION.test(text);
  return personal && ACCOUNT_SUBJECT.test(text);
}

export function isPossiblePersonalAccountFollowUp(text: string): boolean {
  return text.trim().length <= 100 && ACCOUNT_FOLLOW_UP.test(text.trim());
}

/** Resolves a short pronoun/ellipsis only from the immediately preceding own-account request. */
export function isPersonalAccountFollowUp(text: string, previousUserText?: string): boolean {
  return Boolean(previousUserText)
    && isPossiblePersonalAccountFollowUp(text)
    && isPersonalAccountQuery(previousUserText ?? "");
}

export function isPersonalPaymentAmountQuery(text: string): boolean {
  return isPersonalAccountQuery(text)
    && /(?:quanto|valor).*(?:paguei|pagamento|cobran[cç]a|mensalidade)|(?:paguei|pagamento|cobran[cç]a|mensalidade).*(?:quanto|valor)/i.test(text);
}
