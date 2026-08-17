import assert from "node:assert/strict";
import test from "node:test";
import { buildTrainingAcknowledgement, isTrainingCompleteCommand } from "./analyzer.ts";

test("only accepts the exact training completion command", () => {
  assert.equal(isTrainingCompleteCommand("  treinamento   concluído "), true);
  assert.equal(isTrainingCompleteCommand("não concluir treinamento"), false);
  assert.equal(isTrainingCompleteCommand("quando eu disser TREINAMENTO CONCLUÍDO"), false);
});

test("acknowledges a proposal and asks one clarification when needed", () => {
  const reply = buildTrainingAcknowledgement(2, { summary: "Massagem X custa R$ 100.",
    itemType: "commercial_fact", needsClarification: true,
    clarificationQuestion: "Esse valor está vigente?", riskFlags: [] });
  assert.match(reply, /item 2/);
  assert.match(reply, /nada foi publicado/i);
  assert.match(reply, /Esse valor está vigente\?/);
});
