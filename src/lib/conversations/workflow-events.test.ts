import assert from "node:assert/strict";
import test from "node:test";

import { workflowEventText } from "./workflow-events.ts";

test("builds an internal transfer event without exposing a transcript", () => {
  assert.equal(workflowEventText({ eventType: "transferred", toUserLabel: "Maria",
    reasonLabel: "Troca de especialidade", internalNote: "Continuar pela manhã" }),
  "Atendimento transferido para Maria. Motivo: Troca de especialidade. Nota: Continuar pela manhã");
});

test("uses compact state-change labels", () => {
  assert.equal(workflowEventText({ eventType: "awaiting_customer_started" }),
    "Atendimento marcado como aguardando resposta do cliente.");
  assert.equal(workflowEventText({ eventType: "awaiting_customer_cancelled" }),
    "O cliente respondeu e o atendimento voltou ao estado em andamento.");
  assert.equal(workflowEventText({ eventType: "returned_to_agent" }),
    "Atendimento devolvido ao agente automático.");
});
