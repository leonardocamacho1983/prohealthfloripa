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
  const guidance = knowledge.serviceGuidance;
  return `PILATES — VALORES CONFIRMADOS:
- Avulso: ${item.single}.
- Mensal: 1x/semana ${item.monthly.oncePerWeek}; 2x/semana ${item.monthly.twicePerWeek}; 3x/semana ${item.monthly.threeTimesPerWeek}.
- Semestral: 1x/semana ${item.semiannual.oncePerWeek}; 2x/semana ${item.semiannual.twicePerWeek}; 3x/semana ${item.semiannual.threeTimesPerWeek}.
- Anual: 1x/semana ${item.annual.oncePerWeek}; 2x/semana ${item.annual.twicePerWeek}; 3x/semana ${item.annual.threeTimesPerWeek}.
- ${item.experimentalClass}
- Congelamento anual: ${item.freezing.annual}; semestral: ${item.freezing.semiannual}.
- ${item.recurrenceNote}
- Avaliação inicial possível: ${knowledge.assessments.pilates.join(", ")}.
- Pilates Performance: ${guidance.pilatesPerformance.description}
- Recursos possíveis: ${guidance.pilatesPerformance.resources.join(", ")}.
- ${guidance.pilatesPerformance.adaptation}
- Comunicação segura: ${guidance.pilatesEvidence}
- Não prometer prevenção de lesões, performance, cura, correção postural ou retorno ao esporte em prazo determinado; não dizer que Pilates substitui fisioterapia.`;
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
- Thai/Thai Yoga e Ayurvédica são técnicas diferentes; ambas pertencem à categoria especial e custam ${item.single.special} no avulso.
- Orientação científica geral: ${knowledge.massageGuidance.general}
- Descrições seguras das tradicionais: ${Object.entries(knowledge.massageGuidance.traditional).map(([name, description]) => `${name}: ${description}`).join(" ")}
- Ayurvédica: ${knowledge.massageGuidance.special.Ayurvédica}
- Thai: ${knowledge.massageGuidance.special.Thai}
- ${knowledge.massageGuidance.special.validationPending}
- Não inventar técnicas, classificações, durações ou benefícios além dos fatos confirmados.
- Não afirmar desintoxicação, emagrecimento, prevenção de lesões, tratamento de ansiedade, aumento de performance ou reparação muscular acelerada; não apresentar conceitos energéticos como benefício clínico comprovado.`;
}

function recoveryContext(): string {
  const item = knowledge.recovery;
  const safety = knowledge.clinicalSafety.thermotherapyProtocol;
  return `TERMOTERAPIAS / RECOVERY — VALORES CONFIRMADOS:
- ${item.iceBath}.
- ${item.hotBath}.
- ${item.contrast}.
- ${item.cryotherapyTraditionalMassage}.
- ${item.cryotherapySpecialMassage}.
- ${item.twicePerWeek}.
- Há triagem/anamnese antes das termoterapias. A decisão de segurança clínica cabe ao fisioterapeuta responsável.
- Protocolo interno PRO HEALTH — condições impeditivas: ${safety.impediments.join("; ")}.
- ${safety.relativeRisk}
- ${safety.framing}
- Quando a pessoa mencionar uma condição de saúde, usar como base: "Antes das termoterapias fazemos uma triagem de saúde. Algumas condições exigem avaliação prévia ou podem impedir o procedimento. Como você mencionou uma condição de saúde, o ideal é a equipe avaliar seu caso."
- Imersão fria: ${knowledge.recoveryGuidance.coldWater}
- Imersão quente: ${knowledge.recoveryGuidance.hotWater}
- Contraste: ${knowledge.recoveryGuidance.contrast}
- Não dizer que frio desinflama/elimina inflamação, acelera reparação ou previne lesões; não atribuir hipertrofia ou síntese muscular ao calor; não dizer que contraste remove toxinas/ácido lático ou recupera a performance imediatamente.`;
}

function assessmentContext(): string {
  return `AVALIAÇÃO INICIAL:
- Pilates pode incluir: ${knowledge.assessments.pilates.join(", ")}.
- Fisioterapia pode incluir: ${knowledge.assessments.physiotherapy.join(", ")}.
- Termoterapias e contraste: ${knowledge.assessments.thermotherapies}
- Se o serviço não estiver claro, explicar brevemente que a avaliação varia conforme o atendimento e perguntar qual serviço interessa.`;
}

function physiotherapyContext(): string {
  return `FISIOTERAPIA — VALOR CONFIRMADO:
- Atendimento de fisioterapia: ${knowledge.physiotherapy.appointment}.
- Avaliação possível: ${knowledge.assessments.physiotherapy.join(", ")}.
- ${knowledge.serviceGuidance.physiotherapy}
- Não diagnosticar, prescrever, definir prazo de recuperação, liberar para o esporte nem garantir retorno rápido.`;
}

function teamContext(): string {
  const item = knowledge.team;
  return `RESPONSÁVEL TÉCNICO E EQUIPE:
- Responsável técnico principal: ${item.technicalLead}.
- Pilates, fisioterapia e preparação física: Maciel Henrique Lopes.
- Termoterapias: ${item.serviceProviders.thermotherapies}.
- Massagens tradicionais: ${item.serviceProviders.traditionalMassages.join(", ")}.
- Massagens especiais: ${item.serviceProviders.specialMassages.join(", ")}.
- ${item.referrals}`;
}

function preparationContext(): string {
  return `PREPARAÇÃO FÍSICA E RETORNO AO ESPORTE:
- ${knowledge.serviceGuidance.physicalPreparation}
- ${knowledge.serviceGuidance.returnToSport}
- Continuidade possível: ${knowledge.serviceGuidance.continuity}
- Não afirmar que todos percorrem todas as etapas nem prometer volta mais rápida ao esporte.`;
}

function sourcesContext(): string {
  const refs = knowledge.scientificReferences;
  return `REFERÊNCIAS CIENTÍFICAS INTERNAS:
- Pilates: ${refs.pilates.join("; ")}.
- Imersão fria: ${refs.coldWaterImmersion.join("; ")}.
- Calor: ${refs.heat.join("; ")}.
- Massagem: ${refs.massage.join("; ")}.
- ${refs.usage}`;
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
- Metodologia: ${item.methodology}
- Ambiente: ${item.environment.join("; ")}.
- Formulação segura: "O espaço foi pensado para integrar recuperação, movimento e bem-estar em um ambiente acolhedor."
- Evitar a expressão "espaço de cura".
- Não transformar o posicionamento em promessa médica ou garantia de resultado.`;
}

const RESPONSE_RULES = `REGRAS DE RESPOSTA:
- Responder em português brasileiro como representante da PRO HEALTH Saúde e Performance.
- Ser cordial, natural, objetivo, curto por padrão, útil comercialmente e factual.
- Usar normalmente 1 a 4 frases curtas, sem tabelas ou Markdown complexo.
- Responder apenas ao que foi perguntado; não despejar todos os planos sem necessidade.
- Nunca inventar informação ausente, disponibilidade ou ação realizada.
- Não diagnosticar, prescrever, afirmar aptidão clínica nem prometer resultado médico.
- Princípio metodológico central: ${knowledge.positioning.methodology}
- Preferir "pode contribuir", "pode auxiliar", "é utilizado em contextos de", "pode favorecer", "dependendo do objetivo" e "conforme avaliação profissional".
- Evitar "cura", "garante", "elimina", "previne", "corrige", "desintoxica" e "desinflama" como afirmação genérica. Só usar "trata" quando claramente validado dentro do contexto profissional da fisioterapia.
- Um relato comum de tensão ou dor muscular não deve interromper a jornada comercial nem gerar uma resposta defensiva. Explique a opção pedida, informe que o profissional avalia e ajusta a técnica no início e avance para uma próxima ação concreta.
- Só interrompa o fluxo comercial por segurança diante de sinal de alarme ou pedido de decisão clínica individual. Nesses casos, seja claro e acolhedor, sem diagnosticar.
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
  if (includesAny(message, ["avaliacao inicial", "avaliacao postural", "anamnese", "triagem"])) {
    contexts.push(assessmentContext());
  }
  if (
    includesAny(message, [
      "responsavel tecnico",
      "quem atende",
      "profissional",
      "equipe",
      "maciel",
      "angela",
      "catia",
      "juliana",
    ])
  ) {
    contexts.push(teamContext());
  }
  if (
    includesAny(message, [
      "preparacao fisica",
      "fortalecimento",
      "retorno ao esporte",
      "voltar ao esporte",
      "volta ao esporte",
      "modalidade esportiva",
    ])
  ) {
    contexts.push(preparationContext());
  }
  if (includesAny(message, ["fonte", "estudo", "evidencia", "literatura", "doi", "artigo cientifico"])) {
    contexts.push(sourcesContext());
  }
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
      "ambiente",
      "espaco",
      "cabine",
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
