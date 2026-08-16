import { normalizeBrazilianPhone } from "./phone.ts";
import { brazilianPhoneCandidates } from "../conversations/phone.ts";
import { buildCustomerIntelligence } from "../customer-intelligence/engine.ts";
import type { CustomerTimelineEvent } from "../customer-intelligence/types.ts";
import type { NextfitAgenda, NextfitContract, NextfitContractBase, NextfitLookup, NextfitPerson, NextfitReceivable, NextfitSale, NextfitSnapshot } from "./types.ts";

const ACTIVE_CONTRACT_STATUSES = new Set(["Ativo", "Suspenso", "Bloqueado", "Agendado"]);

const dayDifference = (later: Date, earlier: Date) => Math.floor((later.getTime() - earlier.getTime()) / 86_400_000);
const firstName = (name?: string | null) => name?.trim().split(/\s+/)[0] || undefined;

export function lookupPersonByPhone(phone: string, customers: NextfitPerson[], leads: NextfitPerson[]): NextfitLookup {
  const people = [
    ...customers.map((person) => ({ personType: "customer" as const, person })),
    ...leads.map((person) => ({ personType: "lead" as const, person })),
  ];
  const canonical = brazilianPhoneCandidates(phone)[0];
  let matches = people.filter(({ person }) => normalizeBrazilianPhone(person.dddFone, person.fone) === canonical);
  if (matches.length === 0) {
    const incomingCandidates = new Set(brazilianPhoneCandidates(phone));
    matches = people.filter(({ person }) => {
      const stored = normalizeBrazilianPhone(person.dddFone, person.fone);
      return stored ? brazilianPhoneCandidates(stored).some((candidate) => incomingCandidates.has(candidate)) : false;
    });
  }
  if (matches.length === 0) return { kind: "not_found" };
  if (matches.length > 1) return { kind: "ambiguous", count: matches.length };
  return { kind: "match", ...matches[0]! };
}

export function classifyRelationship(personType: "customer" | "lead", person: NextfitPerson, contracts: NextfitContract[], now = new Date()): NextfitSnapshot["relationshipStatus"] {
  if (personType === "lead") return "lead";
  const active = contracts.some((contract) => ACTIVE_CONTRACT_STATUSES.has(contract.status) && new Date(contract.dataValidade) >= now);
  if (active) return "customer";
  if (person.inativo || contracts.length > 0) return "former_customer";
  return "customer";
}

export function buildSnapshot(input: {
  personType: "customer" | "lead"; person: NextfitPerson; contracts: NextfitContract[];
  contractBases: NextfitContractBase[]; receivables: NextfitReceivable[]; sales: NextfitSale[];
  agenda: NextfitAgenda[]; now?: Date;
}): NextfitSnapshot {
  const now = input.now ?? new Date();
  const relationshipStatus = classifyRelationship(input.personType, input.person, input.contracts, now);
  const relevantAgenda = input.agenda.flatMap((entry) => (entry.participantes ?? [])
    .filter((p) => p.codigoCliente === input.person.id)
    .map((p) => ({ date: new Date(entry.dataInicial), status: p.status })));
  const attended = relevantAgenda.filter((event) => event.status === "Presente" && event.date <= now).sort((a, b) => b.date.getTime() - a.date.getTime());
  const upcoming = relevantAgenda.filter((event) => event.status === "Reservado" && event.date > now).sort((a, b) => a.date.getTime() - b.date.getTime());
  const last90 = relevantAgenda.filter((event) => event.date <= now && dayDifference(now, event.date) <= 90);
  const last30 = last90.filter((event) => dayDifference(now, event.date) <= 30);
  const noShows = last90.filter((event) => event.status === "Falta").length;
  const attendanceDenominator = last90.filter((event) => ["Presente", "Falta", "FaltaJustificada"].includes(event.status)).length;
  const openReceivables = input.receivables.filter((item) => item.status === "Aberto");
  const overdue = openReceivables.filter((item) => new Date(item.dataVencimento) < now);
  const lastPayment = input.receivables.filter((item) => item.status === "Recebido" && item.receberRecebimento)
    .sort((a, b) => new Date(b.receberRecebimento!.dataRecebimento).getTime() - new Date(a.receberRecebimento!.dataRecebimento).getTime())[0];
  const bases = new Map(input.contractBases.map((base) => [base.id, base.descricao]));
  const activeContracts = input.contracts.filter((contract) => ACTIVE_CONTRACT_STATUSES.has(contract.status) && new Date(contract.dataValidade) >= now)
    .map((contract) => ({ name: bases.get(contract.codigoContratoBase) ?? "Contrato", status: contract.status,
      startsAt: contract.dataInicio, expiresAt: contract.dataValidade }));
  const activeContractValues = input.contracts.filter((contract) => ACTIVE_CONTRACT_STATUSES.has(contract.status) && new Date(contract.dataValidade) >= now && typeof contract.valorTotal === "number")
    .map((contract) => ({ name: bases.get(contract.codigoContratoBase) ?? "Contrato", contractTotal: contract.valorTotal,
      recurring: contract.recorrente ?? false }));
  const services = [...new Set(input.sales.filter((sale) => sale.status === "Concluida" && sale.descricao).map((sale) => sale.descricao!.trim()))].slice(0, 8);
  const previousContracts = input.contracts.filter((contract) => !activeContracts.some((active) => active.startsAt === contract.dataInicio && active.expiresAt === contract.dataValidade))
    .slice(0, 5).map((contract) => ({ name: bases.get(contract.codigoContratoBase) ?? "Contrato", status: contract.status,
      startsAt: contract.dataInicio, expiresAt: contract.dataValidade }));
  const birthday = input.person.dataNascimento ? new Date(input.person.dataNascimento) : undefined;
  const nextBirthday = birthday ? new Date(Date.UTC(now.getUTCFullYear(), birthday.getUTCMonth(), birthday.getUTCDate())) : undefined;
  if (nextBirthday && nextBirthday < now) nextBirthday.setUTCFullYear(nextBirthday.getUTCFullYear() + 1);
  const customerSince = input.person.dataCadastro;
  const contractExpirations = activeContracts.map((contract) => new Date(contract.expiresAt)).sort((a, b) => a.getTime() - b.getTime());
  const relationshipMetrics = {
    snapshotVersion: 4,
    daysAsCustomer: Math.max(0, dayDifference(now, new Date(customerSince))),
    relationshipAnniversaryDate: customerSince.slice(5, 10),
    ...(attended[0] ? { daysSinceLastVisit: dayDifference(now, attended[0].date) } : {}),
    ...(contractExpirations[0] ? { daysUntilContractExpiration: dayDifference(contractExpirations[0], now), contractExpiringSoon: dayDifference(contractExpirations[0], now) <= 30 } : {}),
    ...(nextBirthday ? { daysUntilBirthday: dayDifference(nextBirthday, now) } : {}),
    inactivityDays: attended[0] ? dayDifference(now, attended[0].date) : undefined,
  };
  const timeline: CustomerTimelineEvent[] = [
    { type: "registration", occurredAt: input.person.dataCadastro },
    ...(input.person.dataNascimento ? [{ type: "birthday" as const, occurredAt: input.person.dataNascimento }] : []),
    ...input.contracts.flatMap((contract) => [
      { type: "contract_start" as const, occurredAt: contract.dataInicio, service: bases.get(contract.codigoContratoBase) ?? "Contrato", status: contract.status },
      { type: "contract_expiration" as const, occurredAt: contract.dataValidade, service: bases.get(contract.codigoContratoBase) ?? "Contrato", status: contract.status },
    ]),
    ...input.sales.filter((sale) => sale.status === "Concluida").map((sale) => ({ type: "purchase" as const, occurredAt: sale.data, ...(sale.descricao ? { service: sale.descricao.trim() } : {}) })),
    ...relevantAgenda.filter((event) => event.date <= now && event.status === "Presente").map((event) => ({ type: "attendance" as const, occurredAt: event.date.toISOString() })),
    ...relevantAgenda.filter((event) => event.date <= now && ["Falta", "FaltaJustificada"].includes(event.status)).map((event) => ({ type: "absence" as const, occurredAt: event.date.toISOString(), status: event.status })),
    ...input.receivables.flatMap((item): CustomerTimelineEvent[] => {
      if (item.status === "Recebido" && item.receberRecebimento) return [{ type: "payment", occurredAt: item.receberRecebimento.dataRecebimento, status: "received" }];
      if (item.status === "Aberto") return [{ type: "financial_due", occurredAt: item.dataVencimento, status: new Date(item.dataVencimento) < now ? "overdue" : "open" }];
      return [];
    }),
  ];
  const customerIntelligence = buildCustomerIntelligence({
    sourceRelationship: relationshipStatus,
    timeline,
    activeServices: activeContracts.map((contract) => contract.name),
    financialStatus: overdue.length ? "overdue" : openReceivables.length ? "open" : "current",
    now,
  });
  return {
    externalCustomerId: String(input.person.id), source: "nextfit", relationshipStatus,
    ...(firstName(input.person.nome) ? { firstName: firstName(input.person.nome) } : {}),
    customerSince, ...(input.person.dataNascimento ? { dateOfBirth: input.person.dataNascimento } : {}),
    financialStatus: overdue.length ? "overdue" : openReceivables.length ? "open" : "current",
    ...(attended[0] ? { lastVisitAt: attended[0].date.toISOString() } : {}),
    ...(upcoming[0] ? { nextVisitAt: upcoming[0].date.toISOString() } : {}),
    activeContracts,
    consumedServicesSummary: { services, previousContracts },
    attendanceMetrics: { visitsLast30Days: last30.filter((event) => event.status === "Presente").length,
      visitsLast90Days: attended.filter((event) => dayDifference(now, event.date) <= 90).length, noShowsLast90Days: noShows,
      ...(attendanceDenominator ? { attendanceRatio: last90.filter((event) => event.status === "Presente").length / attendanceDenominator } : {}) },
    relationshipMetrics: { ...relationshipMetrics, customerIntelligence, overdueCount: overdue.length,
      ...(openReceivables.length ? { nextDueAt: openReceivables.map((item) => item.dataVencimento).sort()[0] } : {}),
      ...(lastPayment ? { lastPayment: { amount: lastPayment.receberRecebimento!.valorRecebido,
        paidAt: lastPayment.receberRecebimento!.dataRecebimento,
        ...(lastPayment.descricao ? { description: lastPayment.descricao } : {}) } } : {}),
      ...(activeContractValues.length ? { activeContractValues } : {}),
      ...(overdue.length ? { maximumDaysOverdue: Math.max(...overdue.map((item) => dayDifference(now, new Date(item.dataVencimento)))) } : {}) },
    syncedAt: now.toISOString(),
  };
}
