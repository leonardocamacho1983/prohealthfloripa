import { redirect } from "next/navigation";
import { NeonConversationRepository } from "@/lib/conversations/neon-repository";
import type { ConversationStatus } from "@/lib/conversations/types";
import { isHandoffAuthenticated } from "@/lib/handoff/server-auth";
import styles from "./handoff.module.css";
import { HandoffLiveRefresh } from "./handoff-live";
import { CloseHandoffForm } from "./close-form";

export const dynamic = "force-dynamic";

const formatTime = (date: Date) => new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit",
  timeZone: "America/Sao_Paulo" }).format(date);
const elapsed = (date: Date) => {
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `há ${hours}h` : `há ${Math.floor(hours / 24)}d`;
};
const statusLabel: Record<ConversationStatus, string> = {
  active: "Com o agente", human_requested: "Aguardando", human_active: "Em atendimento", closed: "Encerrada",
};

type InboxFilter = "all" | "agent" | "waiting" | "human" | "closed";
const matchesFilter = (status: ConversationStatus, filter: InboxFilter) => filter === "all"
  || (filter === "agent" && status === "active")
  || (filter === "waiting" && status === "human_requested")
  || (filter === "human" && status === "human_active")
  || (filter === "closed" && status === "closed");

export default async function HandoffPage({ searchParams }: { searchParams: Promise<{ conversation?: string; filter?: string }> }) {
  if (!(await isHandoffAuthenticated())) redirect("/handoff/login");
  const repository = new NeonConversationRepository();
  const conversations = await repository.listInboxConversations();
  const params = await searchParams;
  const allowedFilters: InboxFilter[] = ["all", "agent", "waiting", "human", "closed"];
  const filter: InboxFilter = allowedFilters.includes(params.filter as InboxFilter) ? params.filter as InboxFilter : "all";
  const filtered = conversations.filter((item) => matchesFilter(item.status, filter));
  const selectedId = params.conversation ?? filtered[0]?.id;
  const selected = filtered.find((item) => item.id === selectedId);
  if (selected) await repository.markHandoffViewed(selected.id);
  const count = (status: ConversationStatus) => conversations.filter((item) => item.status === status).length;
  const linkFor = (nextFilter: InboxFilter, conversation?: string) => `/handoff?filter=${nextFilter}${conversation ? `&conversation=${conversation}` : ""}`;

  return <main className={styles.shell}>
    <HandoffLiveRefresh />
    <header className={styles.header}><div><p className={styles.eyebrow}>ProHealth</p><h1>Atendimento</h1></div>
      <div className={styles.headerActions}><span className={styles.queueCount}>{conversations.length} {conversations.length === 1 ? "conversa" : "conversas"}</span>
        <form action="/api/catalog/sync" method="post"><button className={styles.logout}>Atualizar catálogo</button></form>
        <form action="/api/handoff/logout" method="post"><button className={styles.logout}>Sair</button></form></div></header>
    <div className={styles.workspace}>
      <aside className={styles.queue} aria-label="Conversas">
        <nav className={styles.filters} aria-label="Filtrar conversas">
          <a className={filter === "all" ? styles.filterActive : ""} href={linkFor("all")}>Todas <span>{conversations.length}</span></a>
          <a className={filter === "agent" ? styles.filterActive : ""} href={linkFor("agent")}>Agente <span>{count("active")}</span></a>
          <a className={filter === "waiting" ? styles.filterActive : ""} href={linkFor("waiting")}>Aguardando <span>{count("human_requested")}</span></a>
          <a className={filter === "human" ? styles.filterActive : ""} href={linkFor("human")}>Humano <span>{count("human_active")}</span></a>
          <a className={filter === "closed" ? styles.filterActive : ""} href={linkFor("closed")}>Encerradas <span>{count("closed")}</span></a>
        </nav>
        {filtered.length === 0 ? <div className={styles.empty}><h2>Tudo em dia</h2><p>Nenhuma conversa neste filtro.</p></div> : filtered.map((item) =>
          <a key={item.id} href={linkFor(filter, item.id)} className={`${styles.queueItem} ${item.id === selected?.id ? styles.selected : ""}`}>
            <span className={styles.avatar}>{(item.firstName?.[0] ?? "C").toUpperCase()}</span><span><strong>{item.firstName ?? "Cliente"}</strong>
            <small>{item.messages.at(-1)?.content ?? item.reason ?? "Sem mensagens"}</small><em className={`${styles.rowStatus} ${styles[`status_${item.status}`]}`}>{statusLabel[item.status]}</em></span>
            <span className={styles.queueMeta}><time>{elapsed(item.lastActivityAt)}</time>
              {item.id !== selected?.id && item.unreadCount > 0 ? <b aria-label={`${item.unreadCount} mensagens novas`}>{item.unreadCount}</b> : null}</span></a>)}
      </aside>
      <section className={styles.detail}>
        {!selected ? <div className={styles.noSelection}><h2>Nenhuma conversa selecionada</h2><p>As conversas do agente e os atendimentos humanos aparecerão aqui.</p></div> : <>
          <div className={styles.detailHeader}><div><h2>{selected.firstName ?? "Cliente"}</h2><p>{selected.maskedPhone} · última atividade {elapsed(selected.lastActivityAt)}</p></div>
            <span className={`${styles.status} ${styles[`status_${selected.status}`]}`}>{statusLabel[selected.status]}</span></div>
          {selected.status === "human_requested" || selected.status === "human_active" ? <div className={styles.summary}>
            <strong>Resumo para atendimento</strong><p>{selected.summary}</p></div> : null}
          <div className={styles.messages}>{selected.messages.map((message) => <div key={message.id}
            className={message.direction === "inbound" ? styles.inbound : styles.outbound}>
            <p>{message.content}</p><time>{formatTime(message.createdAt)}</time></div>)}</div>
          <div className={styles.actions}>
            {selected.status === "active" ? <form action={`/api/handoff/${selected.id}/assume`} method="post">
              <button className={styles.secondary}>Assumir conversa</button></form> : null}
            {selected.status === "human_requested" ? <form action={`/api/handoff/${selected.id}/take`} method="post">
              <button className={styles.secondary}>Assumir conversa</button></form> : null}
            {selected.status === "human_requested" || selected.status === "human_active" ? <CloseHandoffForm conversationId={selected.id} /> : null}
          </div>
          {selected.status === "human_requested" || selected.status === "human_active" ? <form action={`/api/handoff/${selected.id}/reply`} method="post" className={styles.composer}>
            <label htmlFor="message" className={styles.srOnly}>Mensagem</label><textarea id="message" name="message" required maxLength={1500} placeholder="Escreva uma mensagem…" />
            <button type="submit">Enviar</button></form> : <div className={styles.readOnlyNote}>{selected.status === "active"
              ? "O agente continua respondendo. Assuma a conversa para falar com o cliente."
              : "Conversa encerrada disponível apenas para consulta."}</div>}
        </>}
      </section>
    </div>
  </main>;
}
