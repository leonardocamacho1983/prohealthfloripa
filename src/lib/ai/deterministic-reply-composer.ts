import { proHealthKnowledge } from "../knowledge/prohealth.ts";

export type ScheduleMissingField = "day" | "period" | "time";

export type DeterministicReplySpec =
  | {
      kind: "integrated_recommendation";
      goal: "localized_tension" | "relaxation" | "both";
      includeAddress?: boolean;
    }
  | {
      kind: "service_recommendation";
      goal: "localized_tension" | "relaxation" | "both";
    }
  | { kind: "path_choice_clarification" }
  | { kind: "service_choice_clarification" }
  | {
      kind: "selected_service";
      service: string;
      includePrice?: boolean;
      includeDuration?: boolean;
      offerHotBath?: boolean;
      activePilates?: boolean;
      nextQuestion?: ScheduleMissingField;
    }
  | {
      kind: "schedule_question";
      service?: string;
      missing: ScheduleMissingField;
    }
  | {
      kind: "schedule_handoff";
      service: string;
      day: string;
      time: string;
      includePrice?: boolean;
      includeDuration?: boolean;
      offerHotBath?: boolean;
      activePilates?: boolean;
      hotBathAccepted?: boolean;
    };

export type DeterministicReply = {
  messages: [string] | [string, string];
  answeredTopics: string[];
  needsClarification: boolean;
  handoffRecommended: boolean;
  handoffValidated?: boolean;
  generationMode: "deterministic_journey";
};

function integratedRecommendation(
  goal: "localized_tension" | "relaxation" | "both",
  includeAddress = false,
): [string, string] {
  const location = includeAddress
    ? ` Estamos na ${proHealthKnowledge.institutional.address}.`
    : "";
  if (goal === "relaxation") {
    return [
      `Perfeito. Para desacelerar e relaxar, temos massagens que podem ajudar bastante, como a Relaxante. Também trabalhamos com termoterapias — banheira quente, fria ou contraste. Para esse objetivo, a quente combina muito bem. As duas abordagens podem ser combinadas, e o profissional ajusta a técnica na chegada, se necessário.${location}`,
      "Qual caminho parece melhor para você: massagem, termoterapia ou combinar as duas?",
    ];
  }
  return [
    `Perfeito. Para tensão localizada, temos massagens que podem ajudar bastante: a Miofascial é mais direcionada; se o foco for relaxar, a Relaxante tende a combinar melhor. Também trabalhamos com termoterapias — banheira quente, fria ou contraste. Para relaxamento e tensão, a quente combina muito bem. As duas abordagens podem ser combinadas, e o profissional ajusta a técnica na chegada, se necessário.${location}`,
    "Qual caminho parece melhor para você: massagem, termoterapia ou combinar as duas?",
  ];
}

function scheduleQuestion(field: ScheduleMissingField): string {
  if (field === "day") return "Qual dia funciona melhor para você?";
  if (field === "time") return "Qual horário funciona melhor para você?";
  return "Você prefere atendimento de manhã, à tarde ou à noite?";
}

function recommendation(goal: "localized_tension" | "relaxation" | "both"): string {
  if (goal === "localized_tension") {
    return "Para uma tensão mais localizada e sensação de rigidez, a Miofascial pode fazer mais sentido. Se a prioridade for desacelerar e relaxar o corpo como um todo, a Relaxante tende a combinar melhor. O que pesa mais para você agora: a tensão localizada ou o relaxamento geral?";
  }
  if (goal === "relaxation") {
    return "Como seu foco é desacelerar e relaxar o corpo como um todo, a Relaxante tende a combinar melhor. Você quer seguir com essa opção?";
  }
  return "Para a tensão localizada, a Miofascial pode fazer mais sentido; para desacelerar e relaxar o corpo como um todo, a Relaxante tende a combinar melhor. O que pesa mais para você agora: a tensão localizada ou o relaxamento geral?";
}

function selectedService(
  spec: Extract<DeterministicReplySpec, { kind: "selected_service" }>,
  askHotBathAcceptance = false,
): string {
  const parts: string[] = [];
  if (/^relaxante$/i.test(spec.service)) {
    parts.push("Como seu foco é relaxar e diminuir a tensão, a Relaxante faz sentido.");
  } else {
    parts.push(`Podemos seguir com a ${spec.service}.`);
  }

  const facts: string[] = [];
  if (spec.includeDuration) facts.push("o atendimento ocupa uma hora completa");
  if (spec.includePrice) facts.push("o valor avulso é R$ 270");
  if (facts.length) {
    const sentence = facts.join(" e ");
    parts.push(`${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`);
  }

  if (spec.offerHotBath) {
    const introduction = spec.activePilates
      ? "Como você já faz Pilates conosco, também podemos tentar encaixar a primeira banheira quente depois de uma das suas aulas, de R$ 70 por R$ 35."
      : "Se ainda não experimentou, você também pode completar a experiência com a primeira banheira quente, de R$ 70 por R$ 35.";
    parts.push(introduction);
    parts.push("Basta trazer roupa de banho; temos toalhas macias, secas e cheirosas, ducha e secador.");
    if (askHotBathAcceptance && !spec.nextQuestion) {
      parts.push("Você quer incluir essa experiência?");
    }
  }

  if (spec.nextQuestion) parts.push(scheduleQuestion(spec.nextQuestion));
  return parts.join(" ");
}

export function composeDeterministicReply(spec: DeterministicReplySpec): DeterministicReply {
  if (spec.kind === "integrated_recommendation") {
    return {
      messages: integratedRecommendation(spec.goal, spec.includeAddress),
      answeredTopics: ["integrated_service_recommendation", "thermotherapy_complement"],
      needsClarification: true,
      handoffRecommended: false,
      generationMode: "deterministic_journey",
    };
  }
  if (spec.kind === "service_recommendation") {
    return {
      messages: [recommendation(spec.goal)],
      answeredTopics: ["service_recommendation"],
      needsClarification: true,
      handoffRecommended: false,
      generationMode: "deterministic_journey",
    };
  }

  if (spec.kind === "path_choice_clarification") {
    return {
      messages: ["Claro. Você prefere seguir com massagem, termoterapia ou combinar as duas?"],
      answeredTopics: ["integrated_path_choice"],
      needsClarification: true,
      handoffRecommended: false,
      generationMode: "deterministic_journey",
    };
  }

  if (spec.kind === "service_choice_clarification") {
    return {
      messages: ["Claro. Você prefere a Miofascial, mais direcionada à tensão localizada, ou a Relaxante, mais voltada ao relaxamento?"],
      answeredTopics: ["service_choice"],
      needsClarification: true,
      handoffRecommended: false,
      generationMode: "deterministic_journey",
    };
  }

  if (spec.kind === "selected_service") {
    return {
      messages: [selectedService(spec, true)],
      answeredTopics: ["selected_service", ...(spec.offerHotBath ? ["hot_bath_offer"] : [])],
      needsClarification: Boolean(spec.nextQuestion || spec.offerHotBath),
      handoffRecommended: false,
      generationMode: "deterministic_journey",
    };
  }

  if (spec.kind === "schedule_question") {
    const prefix = spec.service ? `Certo, seguimos com a ${spec.service}. ` : "";
    return {
      messages: [`${prefix}${scheduleQuestion(spec.missing)}`],
      answeredTopics: ["scheduling"],
      needsClarification: true,
      handoffRecommended: false,
      generationMode: "deterministic_journey",
    };
  }

  const serviceDetails = selectedService({
    kind: "selected_service",
    service: spec.service,
    includePrice: spec.includePrice,
    includeDuration: spec.includeDuration,
    offerHotBath: spec.offerHotBath,
    activePilates: spec.activePilates,
  });
  const includeDetails = spec.includePrice || spec.includeDuration || spec.offerHotBath;
  const summarizedService = spec.hotBathAccepted
    ? `${spec.service} + banheira quente`
    : spec.service;
  const handoff = `Perfeito: ${summarizedService}, ${spec.day}, às ${spec.time}. Vou encaminhar para a equipe confirmar a disponibilidade; o horário só fica reservado depois dessa confirmação.`;
  return {
    messages: [includeDetails ? `${serviceDetails} ${handoff}` : handoff],
    answeredTopics: ["scheduling_complete"],
    needsClarification: false,
    handoffRecommended: true,
    handoffValidated: true,
    generationMode: "deterministic_journey",
  };
}
