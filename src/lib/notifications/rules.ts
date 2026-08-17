import { utcDedupeBucket } from "../metrics/calculations.ts";
import type { MetricSnapshot } from "../metrics/types.ts";
import type { NotificationCandidate } from "./types.ts";

export function buildHandoffRequestedNotification(input: {
  conversationId: string;
  firstName?: string;
  dedupeKey: string;
}): NotificationCandidate {
  return {
    type: "handoff_requested",
    severity: "warning",
    title: "Novo atendimento humano",
    body: `${input.firstName?.trim() || "Cliente"} está aguardando na caixa de atendimento.`,
    dedupeKey: input.dedupeKey,
    payload: { conversationId: input.conversationId },
  };
}

function candidate(input: Omit<NotificationCandidate, "dedupeKey"> & {
  now: Date;
  bucketMinutes: number;
}): NotificationCandidate {
  return {
    type: input.type,
    severity: input.severity,
    title: input.title,
    body: input.body,
    payload: input.payload,
    dedupeKey: `${input.type}:${utcDedupeBucket(input.now, input.bucketMinutes)}`,
  };
}

export function buildOperationalAlerts(snapshot: MetricSnapshot, now = snapshot.generatedAt): NotificationCandidate[] {
  const alerts: NotificationCandidate[] = [];

  if (snapshot.handoffs.waitingNow > 0 && (snapshot.handoffs.oldestWaitingMinutes ?? 0) >= 10) {
    const oldest = Math.round(snapshot.handoffs.oldestWaitingMinutes ?? 0);
    alerts.push(candidate({
      type: "handoff_waiting_too_long",
      severity: oldest >= 30 ? "critical" : "warning",
      title: "Atendimento humano aguardando",
      body: `${snapshot.handoffs.waitingNow} conversa(s) aguardam; a mais antiga está na fila há ${oldest} min.`,
      payload: { waiting: snapshot.handoffs.waitingNow, oldestMinutes: oldest },
      now,
      bucketMinutes: 15,
    }));
  }

  if (snapshot.failures.outboundDeliveries > 0) {
    alerts.push(candidate({
      type: "outbound_delivery_failure",
      severity: "critical",
      title: "Falha ao entregar resposta",
      body: `${snapshot.failures.outboundDeliveries} resposta(s) falharam na janela selecionada.`,
      payload: { failures: snapshot.failures.outboundDeliveries, windowDays: snapshot.window.days },
      now,
      bucketMinutes: 30,
    }));
  }

  if (snapshot.failures.completedTurns >= 5 && (snapshot.failures.turnFailureRate ?? 0) >= 0.05) {
    alerts.push(candidate({
      type: "turn_failure_rate_high",
      severity: (snapshot.failures.turnFailureRate ?? 0) >= 0.15 ? "critical" : "warning",
      title: "Falhas de processamento acima da referência",
      body: `${Math.round((snapshot.failures.turnFailureRate ?? 0) * 100)}% dos turnos concluídos falharam.`,
      payload: { failures: snapshot.failures.turns, completed: snapshot.failures.completedTurns },
      now,
      bucketMinutes: 60,
    }));
  }

  if (snapshot.response.firstOutbound.observed >= 5 && (snapshot.response.firstOutbound.p95Ms ?? 0) > 30_000) {
    alerts.push(candidate({
      type: "first_response_p95_slow",
      severity: "warning",
      title: "Primeira resposta lenta",
      body: `O p95 da primeira resposta está em ${Math.round((snapshot.response.firstOutbound.p95Ms ?? 0) / 1_000)} s.`,
      payload: { p95Ms: snapshot.response.firstOutbound.p95Ms, samples: snapshot.response.firstOutbound.observed },
      now,
      bucketMinutes: 60,
    }));
  }

  if (snapshot.catalog.status !== "healthy") {
    const severity = snapshot.catalog.status === "failed" ? "critical" : "warning";
    const detail = snapshot.catalog.status === "failed"
      ? "A tentativa mais recente falhou depois do último sucesso."
      : snapshot.catalog.status === "stale"
        ? `O último sucesso ocorreu há ${Math.round(snapshot.catalog.ageHours ?? 0)} h.`
        : "Ainda não há sincronização bem-sucedida registrada.";
    alerts.push(candidate({
      type: `catalog_${snapshot.catalog.status}`,
      severity,
      title: "Catálogo Nextfit requer atenção",
      body: detail,
      payload: { status: snapshot.catalog.status, ageHours: snapshot.catalog.ageHours },
      now,
      bucketMinutes: 360,
    }));
  }

  if (snapshot.quality.intentCoverageSamples >= 20 && (snapshot.quality.intentCoverage ?? 1) < 0.95) {
    alerts.push(candidate({
      type: "intent_coverage_low",
      severity: "warning",
      title: "Cobertura de intenções abaixo da meta",
      body: `${Math.round((snapshot.quality.intentCoverage ?? 0) * 100)}% de cobertura em ${snapshot.quality.intentCoverageSamples} amostras.`,
      payload: { coverage: snapshot.quality.intentCoverage, samples: snapshot.quality.intentCoverageSamples },
      now,
      bucketMinutes: 360,
    }));
  }

  if (snapshot.quality.repairRequested >= 10 && (snapshot.quality.repairSuccessRate ?? 0) < 0.9) {
    alerts.push(candidate({
      type: "repair_success_low",
      severity: "warning",
      title: "Reparo conversacional abaixo da meta",
      body: `${Math.round((snapshot.quality.repairSuccessRate ?? 0) * 100)}% dos reparos instrumentados tiveram sucesso.`,
      payload: { requested: snapshot.quality.repairRequested, succeeded: snapshot.quality.repairSucceeded },
      now,
      bucketMinutes: 360,
    }));
  }

  if (snapshot.quality.duplicateReplies > 0 || snapshot.quality.outOfOrderReplies > 0) {
    alerts.push(candidate({
      type: "reply_integrity_failure",
      severity: "critical",
      title: "Integridade de respostas comprometida",
      body: `${snapshot.quality.duplicateReplies} duplicada(s) e ${snapshot.quality.outOfOrderReplies} fora de ordem foram detectadas.`,
      payload: { duplicates: snapshot.quality.duplicateReplies, outOfOrder: snapshot.quality.outOfOrderReplies },
      now,
      bucketMinutes: 30,
    }));
  }

  return alerts;
}
