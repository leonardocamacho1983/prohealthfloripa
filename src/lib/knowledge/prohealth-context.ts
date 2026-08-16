import { proHealthKnowledge as knowledge } from "./prohealth.ts";

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function includesAny(message: string, terms: string[]): boolean {
  return terms.some((term) => message.includes(term));
}

function institutionalContext(): string {
  const item = knowledge.institutional;
  return `INSTITUCIONAL CONFIRMADO:
- Nome: ${item.name}
- Endereço: ${item.address}
- WhatsApp: ${item.whatsapp}
- E-mail: ${item.email}
- Instagram: ${item.instagram}
- CNPJ: ${item.cnpj}`;
}

function scheduleContext(): string {
  const item = knowledge.schedule;
  return `FUNCIONAMENTO CONFIRMADO:
- Atendimento: ${item.hours}.
- Pilates: ${item.agendas.pilates}.
- Atendimento/Massagem: ${item.agendas.atendimentoMassagem}.
- Termoterapias: ${item.agendas.termoterapias}.
- Fim de semana: ${item.weekend}.
- Nunca prometer disponibilidade específica sem confirmação.`;
}

function pilatesContext(): string {
  const item = knowledge.pilates;
  return `PILATES — VALORES CONFIRMADOS:
- Avulso: ${item.single}.
- Mensal: 1x/semana ${item.monthly.oncePerWeek}; 2x/semana ${item.monthly.twicePerWeek}; 3x/semana ${item.monthly.threeTimesPerWeek}.
- Semestral: 1x/semana ${item.semiannual.oncePerWeek}; 2x/semana ${item.semiannual.twicePerWeek}; 3x/semana ${item.semiannual.threeTimesPerWeek}.
- Anual: 1x/semana ${item.annual.oncePerWeek}; 2x/semana ${item.annual.twicePerWeek}; 3x/semana ${item.annual.threeTimesPerWeek}.
- ${item.experimentalClass}
- Congelamento anual: ${item.freezing.annual}; semestral: ${item.freezing.semiannual}.
- ${item.recurrenceNote}`;
}

function policyContext(): string {
  const item = knowledge.policies;
  return `POLÍTICAS CONFIRMADAS:
- ${item.cancellation}
- ${item.unannouncedAbsence}
- ${item.refund}`;
}

function massageContext(): string {
  const item = knowledge.massages;
  return `MASSAGENS — FATOS CONFIRMADOS:
- Categoria tradicional/clássica: ${item.traditionalTechniques.join(", ")}.
- Valor avulso tradicional/clássica: ${item.single.traditional}.
- Pacotes tradicional/clássica: ${item.packages.traditional.fiveSessions}; ${item.packages.traditional.tenSessions}.
- Categoria especial: ${item.specialTechniques.map((technique) => `${technique.name} (${technique.duration})`).join(", ")}.
- Valor avulso especial: ${item.single.special}.
- Pacotes especial: ${item.packages.special.fiveSessions}; ${item.packages.special.tenSessions}.
- Massagem Express: ${item.expressDuration}.
- Responder diretamente qual é a categoria das técnicas listadas acima.
- Thai e Ayurvédica pertencem à categoria especial e custam ${item.single.special} no avulso.
- Não inventar técnicas, classificações, durações ou benefícios além dos fatos confirmados.
- Descrever benefícios de forma geral e prudente, sem promessa clínica absoluta.`;
}

function recoveryContext(): string {
  const item = knowledge.recovery;
  return `TERMOTERAPIAS / RECOVERY — VALORES CONFIRMADOS:
- ${item.iceBath}.
- ${item.hotBath}.
- ${item.contrast}.
- ${item.cryotherapyTraditionalMassage}.
- ${item.cryotherapySpecialMassage}.
- ${item.twicePerWeek}.`;
}

function physiotherapyContext(): string {
  return `FISIOTERAPIA — VALOR CONFIRMADO:
- Atendimento de fisioterapia: ${knowledge.physiotherapy.appointment}.`;
}

function durationContext(): string {
  return `DURAÇÃO:
- ${knowledge.duration.general}
- ${knowledge.duration.massageExpress}`;
}

function positioningContext(): string {
  const item = knowledge.positioning;
  return `POSICIONAMENTO:
- A ProHealth integra performance, recuperação e bem-estar para ${item.audience}
- Atua com ${item.services.join(", ")}.
- Filosofia: ${item.philosophy}
- Não transformar o posicionamento em promessa médica ou garantia de resultado.`;
}

const RESPONSE_RULES = `REGRAS DE RESPOSTA:
- Responder em português brasileiro como representante da PRO HEALTH Saúde e Performance.
- Ser cordial, natural, objetivo, curto por padrão, útil comercialmente e factual.
- Usar normalmente 1 a 4 frases curtas, sem tabelas ou Markdown complexo.
- Responder apenas ao que foi perguntado; não despejar todos os planos sem necessidade.
- Nunca inventar informação ausente, disponibilidade ou ação realizada.
- Não diagnosticar, prescrever, afirmar aptidão clínica nem prometer resultado médico.
- Informações pendentes: ${knowledge.pendingInformation.join("; ") || "nenhuma informação comercial pendente cadastrada"}.
- Para qualquer informação pendente, dizer naturalmente que precisa confirmar com a equipe.
- Segurança clínica: ${knowledge.clinicalSafety.guidance}`;

export function buildProHealthInstructions(userMessage: string): string {
  const message = normalize(userMessage);
  const contexts: string[] = [RESPONSE_RULES];

  if (
    includesAny(message, [
      "onde",
      "endereco",
      "localizacao",
      "contato",
      "whatsapp",
      "email",
      "instagram",
      "cnpj",
    ])
  ) {
    contexts.push(institutionalContext());
  }

  if (
    includesAny(message, [
      "horario",
      "funcionamento",
      "abre",
      "abrem",
      "sabado",
      "domingo",
      "agenda",
      "disponibilidade",
    ])
  ) {
    contexts.push(scheduleContext());
  }

  if (message.includes("pilates")) contexts.push(pilatesContext());
  if (includesAny(message, ["experimental", "congel", "pausar", "suspender"])) contexts.push(pilatesContext());
  if (
    includesAny(message, [
      "massag",
      "thai",
      "shiatsu",
      "lomi",
      "drenagem",
      "miofascial",
      "ayurvedica",
      "abhyanga",
      "shirodhara",
      "basti",
      "tuina",
      "indiana",
      "tradicional",
      "especial",
    ])
  ) {
    contexts.push(massageContext());
  }
  if (
    includesAny(message, [
      "termoterapia",
      "recovery",
      "banheira",
      "crioterapia",
      "contraste",
    ])
  ) {
    contexts.push(recoveryContext());
  }
  if (message.includes("fisio")) contexts.push(physiotherapyContext());
  if (
    includesAny(message, ["duracao", "quanto tempo", "minuto", "express"])
  ) {
    contexts.push(durationContext());
  }
  if (includesAny(message, ["cancel", "remarc", "falta", "faltei", "reembolso", "atestado", "forca maior"])) {
    contexts.push(policyContext());
  }
  if (
    includesAny(message, [
      "o que voces fazem",
      "servicos",
      "performance",
      "bem-estar",
      "atleta",
    ])
  ) {
    contexts.push(positioningContext());
  }

  if (
    includesAny(message, [
      "contratar",
      "comprar",
      "assinar",
      "fechar",
      "quero o plano",
      "quero plano",
    ])
  ) {
    contexts.push(
      `COMPRA: diante da clara intenção de contratar, fornecer o link oficial: ${knowledge.purchase.plansUrl}`,
    );
  }

  if (contexts.length === 1) {
    contexts.push(institutionalContext(), positioningContext());
  }

  return contexts.join("\n\n");
}
