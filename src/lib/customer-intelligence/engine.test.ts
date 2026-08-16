import assert from "node:assert/strict";
import test from "node:test";

import { buildCustomerIntelligence } from "./engine.ts";
import type { CustomerTimelineEvent, IntelligenceInput } from "./types.ts";

const now = new Date("2026-08-16T12:00:00.000Z");
const event = (type: CustomerTimelineEvent["type"], occurredAt: string, service?: string, status?: string): CustomerTimelineEvent =>
  ({ type, occurredAt, ...(service ? { service } : {}), ...(status ? { status } : {}) });
const activeContract = (expiration="2026-12-31", name="Pilates 2x") => [
  event("contract_start", "2026-01-01", name, "Ativo"), event("contract_expiration", expiration, name, "Ativo"),
];
const build = (overrides: Partial<IntelligenceInput> = {}) => buildCustomerIntelligence({
  sourceRelationship: "customer", timeline: [event("registration", "2025-01-01")], activeServices: [], now, ...overrides,
});
const types = (result: ReturnType<typeof build>) => result.nextBestActions.map((action) => action.type);

test("1. novo lead", () => assert.equal(build({ sourceRelationship: "lead" }).relationshipState.value, "new_lead"));
test("2. cliente recém-contratado", () => assert.equal(build({ timeline: [event("registration", "2026-08-10"), ...activeContract()] }).relationshipState.value, "active_customer"));
test("3. cliente ativo e frequente", () => {
  const visits = [1, 5, 10, 15].map((day) => event("attendance", `2026-08-${String(day).padStart(2, "0")}`));
  assert.equal(build({ timeline: [event("registration", "2025-01-01"), ...activeContract(), ...visits], activeServices: ["Pilates 2x"] }).relationshipState.value, "engaged_customer");
});
test("4. cliente com queda de frequência", () => {
  const visits = ["2026-08-10", "2026-07-01", "2026-07-05", "2026-07-10", "2026-07-15"].map((date) => event("attendance", date));
  assert.equal(build({ timeline: [...activeContract(), ...visits] }).relationshipState.value, "declining_engagement");
});
test("5. cliente inativo", () => assert.equal(build({ timeline: [...activeContract(), event("attendance", "2026-04-01")] }).relationshipState.value, "inactive"));
test("6. contrato vencendo", () => assert.ok(types(build({ timeline: activeContract("2026-08-30") })).includes("renewal_due")));
test("7. ex-cliente", () => assert.equal(build({ sourceRelationship: "former_customer" }).relationshipState.value, "former_customer"));
test("8. cliente recorrente de massagem", () => {
  const timeline = [1, 2, 3].map((day) => event("purchase", `2026-08-0${day}`, "Massagem Sueca"));
  assert.ok(types(build({ timeline })).includes("massage_package"));
});
test("9. cliente recorrente de crioterapia", () => {
  const timeline = [1, 2, 3].map((day) => event("service", `2026-08-0${day}`, "Crioterapia"));
  assert.ok(types(build({ timeline })).includes("recovery_offer"));
});
test("10. cliente de Pilates engajado", () => {
  const visits = [1, 5, 10, 15].map((day) => event("attendance", `2026-08-${String(day).padStart(2, "0")}`));
  assert.ok(types(build({ timeline: [...activeContract(), ...visits], activeServices: ["Pilates 2x"] })).includes("pilates_upgrade"));
});
test("11. cliente com aniversário próximo", () => assert.ok(types(build({ timeline: [event("birthday", "1990-08-20")] })).includes("birthday_context")));
test("12. aniversário de relacionamento", () => assert.ok(types(build({ timeline: [event("registration", "2025-08-18")] })).includes("relationship_checkin")));
test("13. cliente com pendência financeira", () => {
  const result = build({ financialStatus: "overdue", timeline: [event("financial_due", "2026-08-01")] });
  assert.equal(result.metrics.overdueDays, 15); assert.ok(types(result).includes("human_followup"));
});
test("14. histórico insuficiente permanece neutro", () => assert.equal(build({ sourceRelationship: "unknown", timeline: [] }).relationshipState.value, "neutral"));
test("15. métricas ausentes não são inventadas", () => {
  const metrics = build({ sourceRelationship: "unknown", timeline: [] }).metrics;
  assert.equal(metrics.attendanceRatio, undefined); assert.equal(metrics.recentActivityTrend, undefined);
});
test("16. dados contraditórios ou inválidos são ignorados", () => {
  const result = build({ sourceRelationship: "unknown", timeline: [event("attendance", "data-inválida")] });
  assert.equal(result.relationshipState.value, "neutral"); assert.equal(result.metrics.daysSinceLastVisit, undefined);
});
test("17. ausência de contrato não cria renovação", () => assert.equal(types(build()).includes("renewal_due"), false));
test("18. múltiplos contratos são contados", () => {
  const timeline = [...activeContract("2026-12-01", "Pilates"), ...activeContract("2027-01-01", "Recovery")];
  assert.equal(build({ timeline, activeServices: ["Pilates", "Recovery"] }).metrics.currentContractCount, 2);
});
test("toda recomendação contém evidência objetiva", () => {
  const result = build({ sourceRelationship: "lead", financialStatus: "overdue",
    timeline: [...activeContract("2026-08-30"), event("financial_due", "2026-08-01")] });
  assert.ok(result.nextBestActions.every((action) => action.evidence.length > 0));
});
