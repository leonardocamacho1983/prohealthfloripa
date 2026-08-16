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
    expected: ["Thai", "precisa ser confirmada com a equipe", "Nunca classificar"],
  },
  {
    question: "Qual a diferença entre tradicional e especial?",
    expected: ["tradicional: R$ 270", "especial: R$ 300", "precisa ser confirmada com a equipe"],
  },
  {
    question: "Vocês abrem sábado?",
    expected: ["segunda a sexta, das 08h às 21h", "Não afirmar funcionamento aos sábados"],
  },
  {
    question: "Tem aula experimental?",
    expected: ["aula experimental e seu valor", "precisa confirmar com a equipe"],
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
