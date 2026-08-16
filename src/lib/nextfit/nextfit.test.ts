import assert from "node:assert/strict";
import test from "node:test";

import { handleIncomingMessage } from "../conversations/handle-incoming-message.ts";
import type { ConversationIdentity, ConversationRepository } from "../conversations/types.ts";
import { buildModelCustomerContext, type CustomerContext } from "../customer-context/index.ts";
import { buildSnapshot, classifyRelationship, lookupPersonByPhone } from "./normalization.ts";
import { createNextfitEnricher, shouldRefresh } from "./sync-customer.ts";
import type { NextfitPerson } from "./types.ts";

const now = new Date("2026-08-16T12:00:00.000Z");
const person = (overrides: Partial<NextfitPerson> = {}): NextfitPerson => ({
  id: 1, nome: "Ana Souza", dataCadastro: "2025-08-16", dataNascimento: "1990-08-20",
  dddFone: "48", fone: "999991234", inativo: false, ...overrides,
});
const snapshot = (overrides: Partial<Parameters<typeof buildSnapshot>[0]> = {}) => buildSnapshot({
  personType: "customer", person: person(), contracts: [], contractBases: [], receivables: [], sales: [], agenda: [], now, ...overrides,
});

test("1. telefone ausente permanece desconhecido", () => assert.equal(lookupPersonByPhone("+5548999990000", [person()], []).kind, "not_found"));
test("2. cliente é localizado por telefone normalizado exato", () => assert.equal(lookupPersonByPhone("+5548999991234", [person()], []).kind, "match"));
test("2b. formato nacional da Zernio concilia com o formato Nextfit", () => assert.equal(lookupPersonByPhone("48999991234", [person()], []).kind, "match"));
test("2c. máscara nacional concilia com o formato internacional", () => assert.equal(lookupPersonByPhone("(48) 99999-1234", [person()], []).kind, "match"));
test("3. lead é identificado", () => {
  const result = lookupPersonByPhone("+5548999991234", [], [person()]);
  assert.equal(result.kind === "match" && result.personType, "lead");
});
test("4. contrato ativo classifica cliente", () => assert.equal(classifyRelationship("customer", person(), [{ id: 1, codigoCliente: 1, codigoContratoBase: 1, dataInicio: "2026-01-01", dataValidade: "2027-01-01", status: "Ativo" }], now), "customer"));
test("5. contrato histórico classifica ex-cliente", () => assert.equal(classifyRelationship("customer", person(), [{ id: 1, codigoCliente: 1, codigoContratoBase: 1, dataInicio: "2024-01-01", dataValidade: "2025-01-01", status: "Encerrado" }], now), "former_customer"));
test("6. múltiplos contratos ativos são preservados", () => {
  const result = snapshot({ contracts: [
    { id: 1, codigoCliente: 1, codigoContratoBase: 1, dataInicio: "2026-01-01", dataValidade: "2027-01-01", status: "Ativo" },
    { id: 2, codigoCliente: 1, codigoContratoBase: 2, dataInicio: "2026-02-01", dataValidade: "2027-02-01", status: "Ativo" },
  ], contractBases: [{ id: 1, descricao: "Pilates" }, { id: 2, descricao: "Recovery" }] });
  assert.equal((result.activeContracts as unknown[]).length, 2);
});
test("7. histórico inclui apenas serviços concluídos", () => assert.deepEqual(snapshot({ sales: [
  { id: 1, codigoCliente: 1, data: "2026-01-01", descricao: "Pilates", status: "Concluida" },
  { id: 2, codigoCliente: 1, data: "2026-01-02", descricao: "Massagem", status: "Cancelada" },
] }).consumedServicesSummary, { services: ["Pilates"], previousContracts: [] }));
test("8. financeiro sem aberto é current", () => assert.equal(snapshot().financialStatus, "current"));
test("9. título aberto vencido é overdue", () => assert.equal(snapshot({ receivables: [{ id: 1, codigoCliente: 1, dataVencimento: "2026-08-01", status: "Aberto" }] }).financialStatus, "overdue"));
test("10. proximidade de aniversário é calculada", () => assert.equal((snapshot().relationshipMetrics as { daysUntilBirthday: number }).daysUntilBirthday, 3));
test("11. tempo de relacionamento é determinístico", () => assert.equal((snapshot().relationshipMetrics as { daysAsCustomer: number }).daysAsCustomer, 365));
test("12. presença recente atualiza última visita", () => assert.equal(snapshot({ agenda: [{ id: 1, dataInicial: "2026-08-15T10:00:00Z", dataFinal: "2026-08-15T11:00:00Z", participantes: [{ codigoCliente: 1, status: "Presente" }] }] }).lastVisitAt, "2026-08-15T10:00:00.000Z"));
test("13. ausência prolongada gera inatividade", () => assert.equal((snapshot({ agenda: [{ id: 1, dataInicial: "2026-05-01T12:00:00Z", dataFinal: "2026-05-01T13:00:00Z", participantes: [{ codigoCliente: 1, status: "Presente" }] }] }).relationshipMetrics as { inactivityDays: number }).inactivityDays, 107));
test("14. clientes com telefones distintos não se misturam", () => assert.equal((lookupPersonByPhone("+5548999991234", [person(), person({ id: 2, fone: "988887777" })], []) as { kind: string; person?: NextfitPerson }).person?.id, 1));
test("15. falha no enriquecimento não interrompe resposta do WhatsApp", async () => {
  const identity: ConversationIdentity = { contactId: "c", conversationId: "v", relationshipStatus: "unknown" };
  let sent = false;
  const repository: ConversationRepository = {
    async recordInbound() { return { inserted: true, identity }; }, async recordOutbound() {},
    async getRecentMessages() { return []; }, async getCustomerProfile() { return undefined; },
  };
  const result = await handleIncomingMessage({ accountId: "a", providerConversationId: "v", providerEventId: "e", providerMessageId: "m",
    phoneNumber: "5548999991234", text: "oi", repository, provider: { async sendText() { sent = true; } },
    async enrichCustomer() { throw new Error("Nextfit down"); }, async generateReply() { return "Olá"; } });
  assert.equal(result, "replied"); assert.equal(sent, true);
});
test("16. contexto do modelo minimiza dados sensíveis e descarta dados voláteis antigos", () => {
  const context: CustomerContext = { identity: { relationshipStatus: "customer", firstName: "Ana" }, conversation: { recentMessages: [] },
    customer: { customerSince: "2025-01-01", dateOfBirth: "1990-01-01", financialStatus: "overdue", syncedAt: "2026-08-14T00:00:00Z" } };
  const output = buildModelCustomerContext(context, now);
  assert.equal(output.includes("dateOfBirth"), false); assert.equal(output.includes("overdue"), false);
  assert.equal(shouldRefresh("2026-08-16T11:50:00Z", "meu pagamento", now), false);
});
test("17. snapshot sem vínculo não impede nova consulta de identidade", async () => {
  let customerQueries = 0;
  const identity: ConversationIdentity = { contactId: "c", conversationId: "v", relationshipStatus: "unknown" };
  const enrich = createNextfitEnricher({
    api: {
      async listCustomers() { customerQueries += 1; return []; }, async listLeads() { return []; },
      async listContracts() { return []; }, async listContractBases() { return []; }, async listReceivables() { return []; },
      async listSales() { return []; }, async listAgenda() { return []; }, async listOpportunities() { return []; },
    },
    store: {
      async getProfileSyncState() { return { syncedAt: now.toISOString() }; },
      async saveCustomerSnapshot() { return identity; },
    },
    now: () => now,
  });
  await enrich({ identity, phoneNumber: "+5548999991234", message: "Quando vence meu plano?" });
  assert.equal(customerQueries, 1);
});
test("18. falha de fonte opcional não descarta contrato disponível", async () => {
  let savedContractCount = 0;
  const identity: ConversationIdentity = { contactId: "c", conversationId: "v", relationshipStatus: "unknown" };
  const enrich = createNextfitEnricher({
    api: {
      async listCustomers() { return [person()]; }, async listLeads() { return []; },
      async listContracts() { return [{ id: 1, codigoCliente: 1, codigoContratoBase: 1, dataInicio: "2026-01-01", dataValidade: "2027-01-01", status: "Ativo" as const }]; },
      async listContractBases() { return [{ id: 1, descricao: "Pilates" }]; },
      async listReceivables() { throw new Error("unavailable"); }, async listSales() { throw new Error("unavailable"); },
      async listAgenda() { throw new Error("unavailable"); }, async listOpportunities() { return []; },
    },
    store: {
      async getProfileSyncState() { return {}; },
      async saveCustomerSnapshot(input) { savedContractCount = (input.profile.activeContracts as unknown[]).length; return identity; },
    },
    now: () => now,
  });
  await enrich({ identity, phoneNumber: "+5548999991234", message: "Quando vence meu plano?" });
  assert.equal(savedContractCount, 1);
});
