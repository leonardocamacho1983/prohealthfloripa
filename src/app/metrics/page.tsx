import { redirect } from "next/navigation";

import { isAppAuthorizationError, requireAppUser } from "@/lib/handoff/server-auth";
import { parseMetricPeriodDays } from "@/lib/metrics/calculations";
import { METRIC_DEFINITIONS } from "@/lib/metrics/definitions";
import { getMetricSnapshot } from "@/lib/metrics/repository";
import type { DurationSummary } from "@/lib/metrics/types";
import { listNotificationChannels, listOpenNotifications } from "@/lib/notifications/repository";

import styles from "./metrics.module.css";

export const dynamic = "force-dynamic";

const formatCount = (value: number) => new Intl.NumberFormat("pt-BR").format(value);
const formatPercent = (value: number | null) => value === null
  ? "Sem amostra"
  : new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 }).format(value);
const formatCurrency = (cents: number) => new Intl.NumberFormat("pt-BR", {
  style: "currency", currency: "BRL",
}).format(cents / 100);
const formatDuration = (milliseconds: number | null) => {
  if (milliseconds === null) return "Sem amostra";
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s`;
  return `${(milliseconds / 60_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} min`;
};
const formatDateTime = (value: Date | null) => value
  ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(value)
  : "Sem registro";

function LatencyMetric({ summary }: { summary: DurationSummary }) {
  return <dl className={styles.metricGrid}>
    <div><dt>p50</dt><dd>{formatDuration(summary.p50Ms)}</dd></div>
    <div><dt>p95</dt><dd>{formatDuration(summary.p95Ms)}</dd></div>
    <div><dt>Cobertura</dt><dd>{formatPercent(summary.coverage)}</dd></div>
    <div><dt>Amostra</dt><dd>{summary.observed}/{summary.eligible}</dd></div>
  </dl>;
}

export default async function MetricsPage({ searchParams }: {
  searchParams: Promise<{ days?: string }>;
}) {
  try {
    await requireAppUser(["admin", "owner"] as const);
  } catch (error) {
    if (isAppAuthorizationError(error)) {
      if (error.status === 401) redirect("/sign-in");
      if (error.status === 403) redirect("/handoff");
    }
    throw error;
  }

  const params = await searchParams;
  const days = parseMetricPeriodDays(params.days);
  const [snapshot, notifications, channels] = await Promise.all([
    getMetricSnapshot(days),
    listOpenNotifications(),
    listNotificationChannels(),
  ]);
  const whatsappChannel = channels.find((channel) => channel.channel === "whatsapp");
  const qualityInstrumented = snapshot.quality.intentCoverageSamples > 0
    || snapshot.quality.repairRequested > 0
    || snapshot.quality.duplicateReplies > 0
    || snapshot.quality.outOfOrderReplies > 0;

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>ProHealth · operação</p><h1>Métricas e saúde</h1>
        <p>Leitura operacional da janela. Atualizado em {formatDateTime(snapshot.generatedAt)}.</p></div>
      <nav><a href="/handoff">Atendimento</a> · <a href="/admin/users">Usuários</a></nav>
    </header>

    <div className={styles.toolbar}>
      <nav aria-label="Período">
        {[1, 7, 30].map((period) => <a key={period} href={`/metrics?days=${period}`}
          className={days === period ? styles.active : ""}>{period === 1 ? "24 horas" : `${period} dias`}</a>)}
      </nav>
      <form action="/api/notifications/evaluate" method="post">
        <input type="hidden" name="days" value={days} />
        <button type="submit">Reavaliar alertas</button>
      </form>
    </div>

    <section className={styles.summary} aria-label="Resumo">
      <article><span>Conversas com entrada</span><strong>{formatCount(snapshot.volume.conversations)}</strong>
        <small>{formatCount(snapshot.volume.inboundMessages)} mensagens recebidas</small></article>
      <article><span>Handoffs solicitados</span><strong>{formatCount(snapshot.handoffs.requested)}</strong>
        <small>{formatPercent(snapshot.handoffs.requestRate)} das conversas</small></article>
      <article><span>Primeira resposta p95</span><strong>{formatDuration(snapshot.response.firstOutbound.p95Ms)}</strong>
        <small>{formatPercent(snapshot.response.firstOutbound.coverage)} de cobertura</small></article>
      <article><span>Falhas de entrega</span><strong>{formatCount(snapshot.failures.outboundDeliveries)}</strong>
        <small>{formatCount(snapshot.failures.turns)} turnos falhos</small></article>
    </section>

    <div className={styles.columns}>
      <section className={styles.panel}>
        <div className={styles.sectionTitle}><div><p className={styles.eyebrow}>Experiência</p><h2>Velocidade e atendimento</h2></div></div>
        <article className={styles.metricBlock}><div><h3>Primeira resposta</h3><p>{METRIC_DEFINITIONS.firstOutboundLatency.target}</p></div>
          <LatencyMetric summary={snapshot.response.firstOutbound} /></article>
        <article className={styles.metricBlock}><div><h3>Processamento do turno</h3><p>{METRIC_DEFINITIONS.turnProcessingLatency.target}</p></div>
          <LatencyMetric summary={snapshot.response.turnProcessing} /></article>
        <article className={styles.metricBlock}><div><h3>Tempo até humano</h3><p>{METRIC_DEFINITIONS.humanPickupLatency.target}</p></div>
          <LatencyMetric summary={snapshot.handoffs.timeToHuman} /></article>
        <div className={styles.queueHealth}>
          <span className={snapshot.handoffs.waitingNow > 0 ? styles.warningDot : styles.goodDot} />
          <strong>{snapshot.handoffs.waitingNow} aguardando agora</strong>
          <span>{snapshot.handoffs.oldestWaitingMinutes === null
            ? "Fila vazia"
            : `mais antiga há ${Math.round(snapshot.handoffs.oldestWaitingMinutes)} min`}</span>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.sectionTitle}><div><p className={styles.eyebrow}>Alertas</p><h2>Ações necessárias</h2></div>
          <span className={styles.pill}>{notifications.length} aberto(s)</span></div>
        {notifications.length === 0 ? <div className={styles.empty}><strong>Nenhum alerta aberto</strong>
          <p>Use “Reavaliar alertas” para aplicar as regras à janela atual.</p></div> : <div className={styles.alertList}>
          {notifications.map((item) => <article key={item.id} className={styles[`severity_${item.severity}`]}>
            <div><span>{item.severity === "critical" ? "Crítico" : item.severity === "warning" ? "Atenção" : "Informação"}</span>
              <h3>{item.title}</h3><p>{item.body}</p><small>Visto {item.occurrenceCount} vez(es) · {formatDateTime(item.lastSeenAt)}</small></div>
            <div className={styles.alertActions}>
              {typeof item.payload?.conversationId === "string"
                ? <a href={`/handoff?conversation=${encodeURIComponent(item.payload.conversationId)}`}>Abrir conversa</a>
                : null}
              <form action="/api/notifications/dismiss" method="post"><input type="hidden" name="id" value={item.id} />
                <input type="hidden" name="days" value={days} /><button type="submit">Dispensar</button></form>
            </div>
          </article>)}
        </div>}
        <div className={styles.channelState}><span>Alertas no painel</span><strong>Ativo</strong></div>
        <div className={styles.channelState}><span>Alertas por WhatsApp</span><strong className={styles.pending}>
          {whatsappChannel?.status === "enabled" ? "Ativo" : "Pendente: falta número da atendente"}</strong></div>
      </section>
    </div>

    <div className={styles.columns}>
      <section className={styles.panel}>
        <div className={styles.sectionTitle}><div><p className={styles.eyebrow}>Qualidade</p><h2>Intenções, reparo e integridade</h2></div>
          <span className={qualityInstrumented ? styles.pill : styles.pendingPill}>{qualityInstrumented ? "Com dados" : "Instrumentação pendente"}</span></div>
        <dl className={styles.qualityGrid}>
          <div><dt>Cobertura de intenções</dt><dd>{formatPercent(snapshot.quality.intentCoverage)}</dd>
            <small>{snapshot.quality.intentCoverageSamples} amostra(s)</small></div>
          <div><dt>Sucesso no reparo</dt><dd>{formatPercent(snapshot.quality.repairSuccessRate)}</dd>
            <small>{snapshot.quality.repairSucceeded}/{snapshot.quality.repairRequested} evento(s)</small></div>
          <div><dt>Respostas duplicadas</dt><dd>{qualityInstrumented ? snapshot.quality.duplicateReplies : "—"}</dd>
            <small>Meta: zero</small></div>
          <div><dt>Fora de ordem</dt><dd>{qualityInstrumented ? snapshot.quality.outOfOrderReplies : "—"}</dd>
            <small>Meta: zero</small></div>
        </dl>
        {!qualityInstrumented ? <p className={styles.caveat}>Sem eventos instrumentados, “zero” não seria uma conclusão honesta; por isso os indicadores permanecem indisponíveis.</p> : null}
      </section>

      <section className={styles.panel}>
        <div className={styles.sectionTitle}><div><p className={styles.eyebrow}>Fonte operacional</p><h2>Catálogo Nextfit</h2></div>
          <span className={`${styles.pill} ${styles[`catalog_${snapshot.catalog.status}`]}`}>{snapshot.catalog.status}</span></div>
        <dl className={styles.catalogGrid}>
          <div><dt>Última tentativa</dt><dd>{formatDateTime(snapshot.catalog.lastAttemptAt)}</dd></div>
          <div><dt>Último sucesso</dt><dd>{formatDateTime(snapshot.catalog.lastSuccessAt)}</dd></div>
          <div><dt>Última falha</dt><dd>{formatDateTime(snapshot.catalog.lastFailureAt)}</dd></div>
          <div><dt>Itens ativos</dt><dd>{snapshot.catalog.itemCount ?? "Sem dado"}</dd></div>
        </dl>
        <p className={styles.caveat}>{METRIC_DEFINITIONS.catalogHealth.limitation}</p>
      </section>
    </div>

    <section className={styles.panel}>
      <div className={styles.sectionTitle}><div><p className={styles.eyebrow}>Fundação comercial</p><h2>Resultados associados à conversa</h2></div></div>
      <div className={styles.commercial}>
        <div><span>Eventos observados</span><strong>{snapshot.commercial.observedEvents}</strong></div>
        <div><span>Valor com evidência</span><strong>{formatCurrency(snapshot.commercial.observedAmountCents)}</strong></div>
        <div><span>Recuperações observadas</span><strong>{snapshot.commercial.recoveryEvents}</strong></div>
        <div><span>Cobertura de valor</span><strong>{formatPercent(snapshot.commercial.amountCoverage)}</strong></div>
      </div>
      <p className={styles.caveat}><strong>Sem atribuição causal:</strong> esses eventos apenas registram associação temporal e uma fonte de evidência. Não afirmam que o agente gerou receita ou recuperou o cliente.</p>
    </section>

    <section className={styles.definitions}>
      <details><summary>Como estas métricas são calculadas</summary>
        <div>{Object.values(METRIC_DEFINITIONS).map((definition) => <article key={definition.label}><h3>{definition.label}</h3>
          <p><strong>Fórmula:</strong> {definition.formula}</p><p><strong>Fonte:</strong> {definition.source}</p>
          <p><strong>Limite:</strong> {definition.limitation}</p>{"target" in definition && definition.target
            ? <p><strong>Meta:</strong> {definition.target}</p> : null}</article>)}</div>
      </details>
    </section>
  </main>;
}
