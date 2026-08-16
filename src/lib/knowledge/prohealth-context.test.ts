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
    expected: ["Thai e Ayurvédica pertencem à categoria especial", "R$ 300"],
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
  ["Thai é tradicional ou especial?", ["Thai e Ayurvédica pertencem à categoria especial", "R$ 300"]],
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
