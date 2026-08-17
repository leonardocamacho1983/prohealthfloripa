import type { InboxCustomerPanel, InboxQuickReply } from "@/lib/inbox/repository";
import { formatElapsed } from "@/lib/inbox/productivity";
import styles from "./handoff.module.css";
import { InternalNoteForm } from "./internal-note-form";
import { QuickReplyEditor } from "./quick-reply-editor";

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "America/Sao_Paulo",
});

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

const relationshipLabels = {
  unknown: "Não identificado",
  prospect: "Prospect",
  lead: "Lead",
  customer: "Cliente",
  former_customer: "Ex-cliente",
};

const financialLabels: Record<string, string> = {
  current: "Em dia",
  open: "Em aberto",
  overdue: "Com pendência",
};

const formatStoredDate = (value: string) => dateFormatter.format(new Date(`${value}T12:00:00-03:00`));

export function CustomerPanel({ conversationId, panel, quickReplies, returnTo, canOperate, now }: {
  conversationId: string;
  panel?: InboxCustomerPanel;
  quickReplies: InboxQuickReply[];
  returnTo: string;
  canOperate: boolean;
  now: Date;
}) {
  return <aside className={styles.customerPanel} aria-label="Contexto do cliente">
    <section className={styles.panelSection}>
      <div className={styles.panelHeading}><h3>Cliente</h3>
        <span>{panel ? relationshipLabels[panel.relationshipStatus] : "Sem contexto"}</span></div>
      {!panel ? <p className={styles.panelEmpty}>Contexto ainda não disponível.</p> : <dl className={styles.customerFacts}>
        {panel.customerSince ? <><dt>Cliente desde</dt><dd><time dateTime={panel.customerSince}>
          {formatStoredDate(panel.customerSince)}</time></dd></> : null}
        {panel.financialStatus ? <><dt>Situação</dt><dd>{financialLabels[panel.financialStatus] ?? "Não classificada"}</dd></> : null}
        {panel.lastVisitAt ? <><dt>Última visita</dt><dd><time dateTime={panel.lastVisitAt.toISOString()}>
          {dateTimeFormatter.format(panel.lastVisitAt)}</time></dd></> : null}
        {panel.nextVisitAt ? <><dt>Próxima visita</dt><dd><time dateTime={panel.nextVisitAt.toISOString()}>
          {dateTimeFormatter.format(panel.nextVisitAt)}</time></dd></> : null}
      </dl>}
      <div className={styles.serviceGroup}><strong>Serviços ativos</strong>
        <p>{panel?.activeServices.length ? panel.activeServices.join(" · ") : "Nenhum serviço ativo sincronizado"}</p></div>
      {panel?.recentServices.length ? <div className={styles.serviceGroup}><strong>Serviços recentes</strong>
        <p>{panel.recentServices.join(" · ")}</p></div> : null}
      <p className={styles.syncStatus}>{panel?.syncedAt
        ? <>Nextfit atualizado <time dateTime={panel.syncedAt.toISOString()}>{formatElapsed(panel.syncedAt, now)} · {dateTimeFormatter.format(panel.syncedAt)}</time></>
        : "Nextfit ainda não sincronizado para este contato"}</p>
    </section>

    <section className={styles.panelSection}>
      <div className={styles.panelHeading}><h3>Notas internas</h3><span>cliente não vê</span></div>
      {canOperate ? <InternalNoteForm action={`/api/inbox/${conversationId}/notes`} returnTo={returnTo}
        conversationId={conversationId} /> : null}
      <div className={styles.notesList}>{panel?.notes.length ? panel.notes.map((note) => <article key={note.id}>
        <p>{note.content}</p><small>{note.authorLabel} · <time dateTime={note.createdAt.toISOString()}>
          {dateTimeFormatter.format(note.createdAt)}</time></small>
      </article>) : <p className={styles.panelEmpty}>Nenhuma nota interna.</p>}</div>
    </section>

    <section className={styles.panelSection}>
      <div className={styles.panelHeading}><h3>Respostas rápidas</h3><span>{quickReplies.length}</span></div>
      {canOperate ? <QuickReplyEditor quickReplies={quickReplies} returnTo={returnTo} />
        : <p className={styles.panelEmpty}>Somente leitura.</p>}
    </section>
  </aside>;
}
