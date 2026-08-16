import type {
  CustomerIntelligence, CustomerTimelineEvent, Evidence, IntelligenceInput,
  NextBestAction, RelationshipState,
} from "./types.ts";

const DAY = 86_400_000;
const daysBetween = (later: Date, earlier: Date) => Math.floor((later.getTime() - earlier.getTime()) / DAY);
const validPast = (event: CustomerTimelineEvent, now: Date) => new Date(event.occurredAt) <= now;
const serviceMatches = (service: string | undefined, terms: RegExp) => Boolean(service && terms.test(service));
const evidence = (metric: string, value: string | number | boolean): Evidence => ({ metric, value, source: "nextfit" });

function anniversaryDistance(date: Date, now: Date): number {
  const anniversary = new Date(Date.UTC(now.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  if (anniversary < now) anniversary.setUTCFullYear(anniversary.getUTCFullYear() + 1);
  return daysBetween(anniversary, now);
}

function relationshipState(input: {
  source: IntelligenceInput["sourceRelationship"];
  daysAsCustomer?: number; contractCount: number; visits30: number; visits90: number;
  inactivityDays?: number; trend?: "increasing" | "stable" | "declining";
}): CustomerIntelligence["relationshipState"] {
  let value: RelationshipState = "neutral";
  let reason = "Dados insuficientes para uma classificação segura.";
  let items: Evidence[] = [];
  if (input.source === "lead") {
    value = "new_lead"; reason = "Pessoa cadastrada como lead e sem contrato ativo.";
    items = [evidence("sourceRelationship", "lead")];
  } else if (input.source === "former_customer") {
    value = "former_customer"; reason = "Cadastro possui relacionamento anterior, mas nenhum contrato ativo.";
    items = [evidence("sourceRelationship", "former_customer"), evidence("currentContractCount", input.contractCount)];
  } else if (input.contractCount > 0) {
    if (input.inactivityDays !== undefined && input.inactivityDays >= 90) {
      value = "inactive"; reason = "Contrato ativo, mas sem presença registrada há pelo menos 90 dias.";
      items = [evidence("inactivityDays", input.inactivityDays), evidence("currentContractCount", input.contractCount)];
    } else if (input.inactivityDays !== undefined && input.inactivityDays >= 45) {
      value = "at_risk"; reason = "Última presença ocorreu há pelo menos 45 dias.";
      items = [evidence("inactivityDays", input.inactivityDays), evidence("currentContractCount", input.contractCount)];
    } else if (input.trend === "declining") {
      value = "declining_engagement"; reason = "A frequência dos últimos 30 dias caiu pelo menos 50% frente aos 30 dias anteriores.";
      items = [evidence("recentActivityTrend", "declining"), evidence("visitsLast30d", input.visits30)];
    } else if (input.visits30 >= 4) {
      value = "engaged_customer"; reason = "Possui contrato ativo e ao menos quatro presenças nos últimos 30 dias.";
      items = [evidence("currentContractCount", input.contractCount), evidence("visitsLast30d", input.visits30)];
    } else {
      value = "active_customer"; reason = "Possui pelo menos um contrato ativo.";
      items = [evidence("currentContractCount", input.contractCount)];
    }
  }
  return { value, reason, evidence: items };
}

function recommendations(input: {
  source: IntelligenceInput["sourceRelationship"]; state: RelationshipState; activeServices: string[];
  historicalServices: string[]; serviceCounts: Map<string, number>; contractCount: number;
  visits30: number; expiration?: number; birthday?: number; anniversary?: number; financialStatus?: string; overdueDays?: number;
}): NextBestAction[] {
  const actions: NextBestAction[] = [];
  const add = (action: NextBestAction) => actions.push(action);
  if (input.source === "lead") add({ type: "experimental_class", reason: "Lead sem contrato pode conhecer a aula experimental gratuita de Pilates.", confidence: "high", evidence: [evidence("sourceRelationship", "lead")] });
  if (input.contractCount > 0) add({ type: "explain_current_plan", reason: "Há contrato ativo que pode ser explicado quando o cliente perguntar.", confidence: "high", evidence: [evidence("currentContractCount", input.contractCount), evidence("activeServices", input.activeServices.join(", ") || "Contrato ativo")] });
  if (input.expiration !== undefined && input.expiration >= 0 && input.expiration <= 30) add({ type: "renewal_due", reason: "O contrato ativo vence em até 30 dias.", confidence: "high", evidence: [evidence("daysUntilContractExpiration", input.expiration)] });
  if (["declining_engagement", "at_risk", "inactive", "former_customer"].includes(input.state)) add({ type: "reengagement", reason: "O estado de relacionamento indica queda ou interrupção objetiva de atividade.", confidence: "high", evidence: [evidence("relationshipState", input.state)] });
  if (input.state === "engaged_customer" && input.visits30 >= 4 && input.activeServices.some((name) => /pilates/i.test(name) && !/3x/i.test(name))) add({ type: "pilates_upgrade", reason: "Cliente engajado utiliza Pilates e o plano identificado não indica frequência de 3x por semana.", confidence: "medium", evidence: [evidence("visitsLast30d", input.visits30), evidence("activeServices", input.activeServices.join(", "))] });
  const massageCount = [...input.serviceCounts].filter(([name]) => serviceMatches(name, /massag|drenagem|shiatsu|thai|lomi|miofascial/i)).reduce((sum, [, count]) => sum + count, 0);
  if (massageCount >= 3) add({ type: "massage_package", reason: "Há pelo menos três compras ou usos registrados de massagem.", confidence: "medium", evidence: [evidence("repeatedMassageRecords", massageCount)] });
  const recoveryCount = [...input.serviceCounts].filter(([name]) => serviceMatches(name, /crioterapia|termoterapia|banheira|recovery|contraste/i)).reduce((sum, [, count]) => sum + count, 0);
  if (recoveryCount >= 3) add({ type: "recovery_offer", reason: "Há pelo menos três usos registrados de recovery ou termoterapia.", confidence: "medium", evidence: [evidence("repeatedRecoveryRecords", recoveryCount)] });
  if (input.birthday !== undefined && input.birthday <= 7) add({ type: "birthday_context", reason: "O aniversário ocorrerá nos próximos sete dias.", confidence: "high", evidence: [evidence("birthdayProximity", input.birthday)] });
  if (input.anniversary !== undefined && input.anniversary <= 7) add({ type: "relationship_checkin", reason: "O aniversário de relacionamento ocorrerá nos próximos sete dias.", confidence: "high", evidence: [evidence("relationshipAnniversaryProximity", input.anniversary)] });
  if (input.financialStatus === "overdue" && input.overdueDays !== undefined) add({ type: "human_followup", reason: "Existe pendência financeira vencida; qualquer tratamento deve ser feito pela equipe.", confidence: "high", evidence: [evidence("financialStatus", "overdue"), evidence("overdueDays", input.overdueDays)] });
  if (!actions.length) actions.push({ type: "no_action", reason: "Nenhuma regra de oportunidade possui evidência suficiente neste momento.", confidence: "high", evidence: [evidence("matchedOpportunityRules", 0)] });
  return actions;
}

export function buildCustomerIntelligence(input: IntelligenceInput): CustomerIntelligence {
  const now = input.now ?? new Date();
  const timeline = input.timeline.filter((event) => !Number.isNaN(new Date(event.occurredAt).getTime())).sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
  const registrations = timeline.filter((event) => event.type === "registration");
  const attendances = timeline.filter((event) => event.type === "attendance" && validPast(event, now));
  const absences = timeline.filter((event) => event.type === "absence" && validPast(event, now));
  const expirations = timeline.filter((event) => event.type === "contract_expiration"
    && ["Ativo", "Suspenso", "Bloqueado", "Agendado"].includes(event.status ?? "")
    && new Date(event.occurredAt) >= now);
  const activeContractCount = expirations.length;
  const serviceEvents = timeline.filter((event) => ["service", "purchase"].includes(event.type) && event.service);
  const serviceCounts = new Map<string, number>();
  for (const event of serviceEvents) serviceCounts.set(event.service!, (serviceCounts.get(event.service!) ?? 0) + 1);
  const historicalServices = [...serviceCounts.keys()];
  const visitsInRange = (min: number, max: number) => attendances.filter((event) => {
    const days = daysBetween(now, new Date(event.occurredAt)); return days >= min && days <= max;
  }).length;
  const visits30 = visitsInRange(0, 30);
  const visits31to60 = visitsInRange(31, 60);
  const visits90 = visitsInRange(0, 90);
  const enoughForTrend = visits30 + visits31to60 >= 4 && visits31to60 >= 2;
  const trend = enoughForTrend
    ? visits30 <= visits31to60 / 2 ? "declining" as const
      : visits30 >= visits31to60 * 1.5 ? "increasing" as const : "stable" as const
    : undefined;
  const lastVisit = attendances.at(-1);
  const inactivityDays = lastVisit ? daysBetween(now, new Date(lastVisit.occurredAt)) : undefined;
  const registration = registrations[0] ? new Date(registrations[0].occurredAt) : undefined;
  const daysAsCustomer = registration && input.sourceRelationship !== "lead" ? daysBetween(now, registration) : undefined;
  const expiration = expirations[0] ? daysBetween(new Date(expirations[0].occurredAt), now) : undefined;
  const birthdays = timeline.filter((event) => event.type === "birthday");
  const birthday = birthdays[0] ? anniversaryDistance(new Date(birthdays[0].occurredAt), now) : undefined;
  const anniversary = registration && daysAsCustomer !== undefined && daysAsCustomer >= 300 ? anniversaryDistance(registration, now) : undefined;
  const financialDue = timeline.filter((event) => event.type === "financial_due" && new Date(event.occurredAt) < now);
  const overdueDays = financialDue.length ? Math.max(...financialDue.map((event) => daysBetween(now, new Date(event.occurredAt)))) : undefined;
  const attendanceDenominator = attendances.length + absences.length;
  const state = relationshipState({ source: input.sourceRelationship, daysAsCustomer, contractCount: activeContractCount,
    visits30, visits90, inactivityDays, trend });
  const metrics: CustomerIntelligence["metrics"] = {
    ...(daysAsCustomer !== undefined ? { daysAsCustomer } : {}),
    ...(inactivityDays !== undefined ? { daysSinceLastVisit: inactivityDays, inactivityDays } : {}),
    visitsLast30d: visits30, visitsLast90d: visits90, currentContractCount: activeContractCount,
    ...(expiration !== undefined ? { daysUntilContractExpiration: expiration, contractExpiringSoon: expiration <= 30 } : {}),
    ...(input.financialStatus ? { financialStatus: input.financialStatus } : {}),
    ...(overdueDays !== undefined ? { overdueDays } : {}),
    ...(historicalServices.length ? { historicalServices } : {}),
    ...(input.activeServices.length ? { activeServices: input.activeServices } : {}),
    ...(birthday !== undefined ? { birthdayProximity: birthday } : {}),
    ...(anniversary !== undefined ? { relationshipAnniversaryProximity: anniversary } : {}),
    ...(attendanceDenominator ? { attendanceRatio: attendances.length / attendanceDenominator } : {}),
    ...(trend ? { recentActivityTrend: trend } : {}),
  };
  return {
    calculatedAt: now.toISOString(), metrics, relationshipState: state,
    nextBestActions: recommendations({ source: input.sourceRelationship, state: state.value,
      activeServices: input.activeServices, historicalServices, serviceCounts, contractCount: activeContractCount,
      visits30, expiration, birthday, anniversary, financialStatus: input.financialStatus, overdueDays }),
    ...(attendances.length ? { recentActivitySummary: `${visits30} presença(s) nos últimos 30 dias${trend ? `; tendência ${trend}` : ""}.` } : {}),
  };
}
