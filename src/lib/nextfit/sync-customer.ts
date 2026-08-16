import type { ConversationIdentity, CustomerProfileStore } from "../conversations/types.ts";
import { buildSnapshot, lookupPersonByPhone } from "./normalization.ts";
import type { NextfitApi } from "./types.ts";

const VOLATILE_TERMS = /\b(venc|pag|finance|plano|contrato|agenda|visita|frequ[eê]ncia)\w*/i;

export function shouldRefresh(syncedAt: string | undefined, message: string, now = new Date()): boolean {
  if (!syncedAt) return true;
  const age = now.getTime() - new Date(syncedAt).getTime();
  return age >= (VOLATILE_TERMS.test(message) ? 15 * 60_000 : 6 * 3_600_000);
}

export function createNextfitEnricher(input: { api: NextfitApi; store: CustomerProfileStore; now?: () => Date }) {
  return async ({ identity, phoneNumber, message }: { identity: ConversationIdentity; phoneNumber: string; message: string }): Promise<ConversationIdentity> => {
    const now = input.now?.() ?? new Date();
    const state = await input.store.getProfileSyncState(identity.contactId);
    if (state.externalCustomerId && state.snapshotVersion === 2 && !shouldRefresh(state.syncedAt, message, now)) return identity;
    const [customersResult, leadsResult] = await Promise.allSettled([input.api.listCustomers(), input.api.listLeads()]);
    if (customersResult.status === "rejected" && leadsResult.status === "rejected") throw new Error("Nextfit identity lookup failed");
    const customers = customersResult.status === "fulfilled" ? customersResult.value : [];
    const leads = leadsResult.status === "fulfilled" ? leadsResult.value : [];
    const match = lookupPersonByPhone(phoneNumber, customers, leads);
    if (match.kind !== "match") {
      return input.store.saveCustomerSnapshot({ contactId: identity.contactId, relationshipStatus: "unknown",
        profile: { source: "nextfit", syncedAt: now.toISOString() } });
    }
    if (match.personType === "lead") {
      const snapshot = buildSnapshot({ personType: "lead", person: match.person, contracts: [], contractBases: [], receivables: [], sales: [], agenda: [], now });
      return input.store.saveCustomerSnapshot({ contactId: identity.contactId, firstName: snapshot.firstName,
        relationshipStatus: snapshot.relationshipStatus, profile: snapshot });
    }
    const from = new Date(now); from.setUTCDate(from.getUTCDate() - 90);
    const to = new Date(now); to.setUTCDate(to.getUTCDate() + 90);
    const results = await Promise.allSettled([
      input.api.listContracts(match.person.id), input.api.listContractBases(), input.api.listReceivables(match.person.id),
      input.api.listSales(match.person.id), input.api.listAgenda(from, to),
    ]);
    const [contractsResult, basesResult, receivablesResult, salesResult, agendaResult] = results;
    const contracts = contractsResult.status === "fulfilled" ? contractsResult.value : [];
    const contractBases = basesResult.status === "fulfilled" ? basesResult.value : [];
    const receivables = receivablesResult.status === "fulfilled" ? receivablesResult.value : [];
    const sales = salesResult.status === "fulfilled" ? salesResult.value : [];
    const agenda = agendaResult.status === "fulfilled" ? agendaResult.value : [];
    const snapshot = buildSnapshot({ personType: "customer", person: match.person, contracts, contractBases, receivables, sales, agenda, now });
    return input.store.saveCustomerSnapshot({ contactId: identity.contactId, firstName: snapshot.firstName,
      relationshipStatus: snapshot.relationshipStatus, profile: snapshot });
  };
}
