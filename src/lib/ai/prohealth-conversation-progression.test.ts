import assert from "node:assert/strict";
import test from "node:test";

import { enforceProHealthConversationProgression } from "./prohealth-conversation-progression.ts";
import type { WhatsAppReplyPlan } from "./reply-generation-fallback.ts";

function plan(overrides: Partial<WhatsAppReplyPlan>): WhatsAppReplyPlan {
  return { messages: ["resposta do modelo"], answeredTopics: [], needsClarification: false, handoffRecommended: false, ...overrides };
}

test("groups broad massage discovery instead of dumping the catalog", () => {
  const result = enforceProHealthConversationProgression(plan({
    messages: ["Miofascial, Relaxante, Drenagem, Shiatsu, Desportiva, Sueca, Lomi-Lomi e Tuiná."],
    conversationState: { intent: "service_discovery", selectedService: null, selectionConfidence: "none", missingScheduleFields: ["service", "day", "time"], nextAction: "clarify_goal" },
  }));
  assert.match(result.messages[0]!, /relaxamento.*tensões musculares.*recuperação esportiva/i);
  assert.doesNotMatch(result.messages[0]!, /Lomi-Lomi|Tuiná|Shiatsu/iu);
});

test("accepts a hedged Relaxante preference and advances directly to scheduling", () => {
  const result = enforceProHealthConversationProgression(plan({
    messages: ["Você confirma que prefere a Relaxante em vez da Miofascial?"],
    conversationState: { intent: "service_selection", selectedService: "Relaxante", selectionConfidence: "high", missingScheduleFields: ["day", "time"], nextAction: "collect_schedule" },
  }));
  assert.match(result.messages[0]!, /seguimos com a Relaxante/i);
  assert.match(result.messages[0]!, /R\$ 270/);
  assert.match(result.messages[0]!, /1 hora/i);
  assert.match(result.messages[0]!, /Qual dia e horário/i);
  assert.doesNotMatch(result.messages[0]!, /confirma|Miofascial/i);
});

test("does not override an explicit full catalog request", () => {
  const result = enforceProHealthConversationProgression(plan({
    messages: ["Lista completa das massagens confirmadas."],
    conversationState: { intent: "service_catalog", selectedService: null, selectionConfidence: "none", missingScheduleFields: ["service", "day", "time"], nextAction: "answer" },
  }));
  assert.deepEqual(result.messages, ["Lista completa das massagens confirmadas."]);
});
