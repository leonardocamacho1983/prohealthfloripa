import assert from "node:assert/strict";
import test from "node:test";

import { buildProHealthInstructions } from "./prohealth-context.ts";

const scenarios = [
  {
    question: "Quanto custa Pilates 2x por semana?",
    expected: ["Mensal: 1x/semana R$ 330; 2x/semana R$ 420", "6x R$ 390", "12x R$ 360"],
  },
  {
    question: "Quanto custa Pilates mensal 3x?",
    expected: ["3x/semana R$ 500"],
  },
  {
    question: "Quanto custa fisioterapia?",
    expected: ["Atendimento de fisioterapia: R$ 270"],
  },
  {
    question: "Quanto custa banheira de gelo?",
    expected: ["Banheira de gelo avulsa: R$ 70"],
  },
  {
    question: "Tem pacote de massagem?",
    expected: ["5 sessões / 40 dias: R$ 1.215", "10 sessões / 70 dias: R$ 2.700"],
  },
  {
    question: "Quanto custa massagem Thai?",
    expected: ["Thai/Thai Yoga e Ayurvédica são técnicas diferentes", "R$ 300"],
  },
  {
    question: "Qual a diferença entre tradicional e especial?",
    expected: ["Valor avulso tradicional/clássica: R$ 270", "Valor avulso especial: R$ 300"],
  },
  {
    question: "Vocês abrem sábado?",
    expected: ["primeiro horário às 08h", "sábado e domingo somente com agendamento prévio", "sem aula experimental"],
  },
  {
    question: "Tem aula experimental?",
    expected: ["aula experimental de Pilates é oferecida gratuitamente"],
  },
  {
    question: "Onde vocês ficam?",
    expected: ["Rua Vera Linhares de Andrade, 2063", "Córrego Grande, Florianópolis"],
  },
  {
    question: "Estou grávida, posso fazer crioterapia?",
    expected: ["Crioterapia + massagem tradicional: R$ 300", "gestação", "Não diagnosticar"],
  },
  {
    question: "Quero contratar Pilates anual 2x.",
    expected: [
      "12x R$ 360 = R$ 4.320",
      "https://venda.nextfit.com.br/afda9e7e-af58-4b0f-b882-4be65b5a0bdd/contratos",
    ],
  },
] as const;

const policyScenarios = [
  ["Posso remarcar?", "24 horas de antecedência"],
  ["Faltei sem avisar", "remarcada em até 30 dias"],
  ["Posso pedir reembolso?", "mediante atestado ou situação de força maior"],
  ["Posso congelar o Pilates anual?", "Congelamento anual: até 1 mês"],
  ["Quanto tempo dura o atendimento?", "1 hora completa"],
] as const;

for (const [question, expected] of policyScenarios) {
  test(`includes updated owner rule for: ${question}`, () => {
    assert.ok(buildProHealthInstructions(question).includes(expected));
  });
}

for (const scenario of scenarios) {
  test(`includes confirmed guidance for: ${scenario.question}`, () => {
    const instructions = buildProHealthInstructions(scenario.question);
    for (const expected of scenario.expected) {
      assert.ok(
        instructions.includes(expected),
        `Expected instructions to include: ${expected}`,
      );
    }
  });
}

test("removes the obsolete claim that prices are unavailable", () => {
  const instructions = buildProHealthInstructions(
    "Quanto custa Pilates e fisioterapia?",
  );

  assert.doesNotMatch(
    instructions,
    /não (?:tenho|tem|possui|possuímos) acesso (?:a|aos) preços/i,
  );
});

const massageScenarios = [
  ["Quanto custa massagem desportiva?", ["Desportiva", "tradicional/clássica", "R$ 270"]],
  ["Thai é tradicional ou especial?", ["Thai/Thai Yoga e Ayurvédica são técnicas diferentes", "R$ 300"]],
  ["Quanto custa Lomi-Lomi?", ["Lomi-Lomi", "tradicional/clássica", "R$ 270"]],
  ["Quanto custa Abhyanga?", ["Abhyanga (1h)", "Valor avulso especial: R$ 300"]],
  ["Qual a duração do Shirodhara?", ["Shirodhara (50 min)", "categoria especial"]],
  ["Compare massagem clássica e especial", [
    "Valor avulso tradicional/clássica: R$ 270",
    "5 sessões / 40 dias: R$ 1.215",
    "Valor avulso especial: R$ 300",
    "10 sessões / 70 dias: R$ 2.700",
  ]],
] as const;

for (const [question, expected] of massageScenarios) {
  test(`includes confirmed massage classification for: ${question}`, () => {
    const instructions = buildProHealthInstructions(question);
    for (const value of expected) assert.ok(instructions.includes(value), `Expected instructions to include: ${value}`);
    assert.doesNotMatch(instructions, /classificação.+precisa ser confirmada/i);
  });
}

const knowledgeUpdateScenarios = [
  ["Quem é o responsável técnico e quem atende?", [
    "Maciel Henrique Lopes, fisioterapeuta do esporte",
    "Massagens tradicionais: Ângela, Cátia Preto, Juliana",
  ]],
  ["Como é a avaliação de Pilates?", [
    "avaliação cinético-funcional",
    "avaliação postural dinâmica",
    "avaliação postural estática",
  ]],
  ["Vocês fazem avaliação inicial?", [
    "AVALIAÇÃO INICIAL",
    "Pilates pode incluir",
    "Termoterapias e contraste",
  ]],
  ["Estou grávida, posso fazer contraste?", [
    "Protocolo interno PRO HEALTH",
    "doenças cardíacas; gestação",
    "não um diagnóstico médico universal",
  ]],
  ["Como funciona o Pilates Performance?", [
    "TRX, elásticos, wall ball",
    "demandas e aos gestos técnicos do esporte",
    "Não prometer prevenção de lesões",
  ]],
  ["A banheira quente aumenta hipertrofia?", [
    "recovery, conforto e relaxamento",
    "não atribuir hipertrofia ou síntese muscular ao calor",
  ]],
  ["A crioterapia acelera a recuperação muscular?", [
    "reduzir a sensação de dor muscular tardia",
    "Evidências sobre inflamação, força, performance e velocidade de reparação são inconsistentes",
  ]],
  ["Como funciona a massagem Thai?", [
    "técnicas diferentes",
    "pressões, mobilizações e alongamentos",
  ]],
  ["Como funciona o retorno ao esporte?", [
    "forma progressiva e individualizada",
    "Nem todo cliente necessariamente percorre todas as etapas",
  ]],
  ["Vocês têm fontes científicas sobre Pilates?", [
    "10.3390/ijerph20042850",
    "não citar DOI em respostas normais de WhatsApp",
  ]],
  ["Como é o ambiente e o espaço?", [
    "cabines individualizadas",
    "Evitar a expressão \"espaço de cura\"",
  ]],
] as const;

for (const [question, expected] of knowledgeUpdateScenarios) {
  test(`includes safe updated knowledge for: ${question}`, () => {
    const instructions = buildProHealthInstructions(question);
    for (const value of expected) {
      assert.ok(instructions.includes(value), `Expected instructions to include: ${value}`);
    }
  });
}

test("uses Joao's confirmed monthly recovery recurrence", () => {
  const instructions = buildProHealthInstructions("Quanto custa o plano recorrente de termoterapias?");
  assert.match(instructions, /R\$ 350 por mês/);
  assert.match(instructions, /2 sessões por semana/);
  assert.match(instructions, /8 sessões no mês/);
  assert.doesNotMatch(instructions, /6x R\$ 350/);
});

test("trains the agent to offer the complete experience after experimental Pilates", () => {
  const instructions = buildProHealthInstructions(
    "Quero marcar uma aula experimental de Pilates",
  );

  assert.match(instructions, /aula experimental de Pilates é oferecida gratuitamente/i);
  assert.match(instructions, /de R\$ 70 por R\$ 35/);
  assert.match(instructions, /de R\$ 100 por R\$ 50/);
  assert.match(instructions, /depois da aula/);
  assert.match(instructions, /permanecer conosco por mais uma hora/);
  assert.match(instructions, /roupa de banho/);
  assert.match(instructions, /toalhas macias, secas e cheirosas/);
  assert.match(instructions, /chuveiro ou ducha/);
  assert.match(instructions, /secador de cabelo/);
});

test("prioritizes same-day conversion instead of an open recovery voucher", () => {
  const instructions = buildProHealthInstructions(
    "Posso fazer a banheira junto com a experimental?",
  );

  assert.match(instructions, /horários consecutivos no mesmo dia/);
  assert.match(instructions, /preferencialmente em até 72 horas/);
  assert.match(instructions, /não oferecer um benefício aberto/i);
  assert.match(instructions, /Nunca afirmar que reservou ou que existe vaga/i);
  assert.match(instructions, /Evitar voucher aberto/i);
});

test("keeps hot recovery after Pilates and routine safety checks out of ordinary conversation", () => {
  const instructions = buildProHealthInstructions(
    "Depois do Pilates eu queria relaxar na banheira quente",
  );

  assert.match(instructions, /banheira quente nunca deve ser oferecida antes do Pilates/i);
  assert.match(instructions, /não deve ser mencionada em uma conversa comum/i);
  assert.match(instructions, /não mencionar triagem, anamnese, contraindicações nem o risco de queda de pressão/i);
  assert.match(instructions, /Por protocolo da equipe, a experiência com a banheira quente é realizada depois da aula/);
});

test("connects common recovery motives without clinical promises", () => {
  const instructions = buildProHealthInstructions(
    "Fico dolorido depois de treino intenso e queria conhecer o espaço",
  );

  assert.match(instructions, /percepção de recovery e dor muscular tardia/i);
  assert.match(instructions, /sem diagnosticar nem prometer resultado/i);
  assert.match(instructions, /primeira experiência na banheira de gelo ou quente/i);
});

test("trains cross-sell and evidence-based recovery upsell without pressure", () => {
  const instructions = buildProHealthInstructions(
    "Já faço Pilates aí e queria conhecer o recovery depois do treino",
  );

  assert.match(instructions, /COMPLEMENTO DE TERMOTERAPIA/);
  assert.match(instructions, /termoterapia pode complementar qualquer serviço/i);
  assert.match(instructions, /no máximo uma apresentação de termoterapia por conversa ativa/i);
  assert.match(instructions, /não insistir nem reformular a mesma oferta/i);
  assert.match(instructions, /Depois da primeira utilização, perguntar como foi a experiência/i);
  assert.match(instructions, /O segundo uso volta ao valor normal/i);
  assert.match(instructions, /histórico objetivo de usos repetidos/i);
  assert.match(instructions, /R\$ 350 por mês; 2 sessões por semana; 8 sessões no mês/);
  assert.match(instructions, /não presumir recorrência nem pressionar/i);
});
