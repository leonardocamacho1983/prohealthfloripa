import assert from "node:assert/strict";
import test from "node:test";

import { inferHandoffReasonId, isReasonCategory } from "./catalog.ts";

test("categoriza motivos de handoff sem depender do texto exato", () => {
  assert.equal(inferHandoffReasonId({ source: "customer", reason: "Cliente solicitou atendimento humano." }),
    "customer_requested_human");
  assert.equal(inferHandoffReasonId({ source: "safety_rule", reason: "Solicitação financeira requer acompanhamento humano." }),
    "financial_request");
  assert.equal(inferHandoffReasonId({ source: "safety_rule", reason: "Precisa de avaliação clínica por segurança." }),
    "clinical_safety");
  assert.equal(inferHandoffReasonId({ source: "system_failure", reason: "Falha persistente." }), "automation_failure");
});

test("valida somente categorias conhecidas", () => {
  assert.equal(isReasonCategory("human_closure"), true);
  assert.equal(isReasonCategory("other"), false);
});

