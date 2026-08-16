import { redirect } from "next/navigation";
import { NeonConversationRepository } from "@/lib/conversations/neon-repository";
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

export default async function HandoffPage({ searchParams }: { searchParams: Promise<{ conversation?: string; filter?: string }> }) {
  if (!(await isHandoffAuthenticated())) redirect("/handoff/login");
  const repository = new NeonConversationRepository();
  const queue = await repository.listHandoffs();
  const params = await searchParams;
  const filter = params.filter === "waiting" || params.filter === "active" ? params.filter : "all";
  const filteredQueue = queue.filter((item) => filter === "all" || (filter === "waiting" ? item.status === "human_requested" : item.status === "human_active"));
  const selectedId = params.conversation ?? filteredQueue[0]?.id;
  const selected = filteredQueue.find((item) => item.id === selectedId);
  if (selected) await repository.markHandoffViewed(selected.id);
  const waitingCount = queue.filter((item) => item.status === "human_requested").length;
  const activeCount = queue.length - waitingCount;
  const linkFor = (nextFilter: string, conversation?: string) => `/handoff?filter=${nextFilter}${conversation ? `&conversation=${conversation}` : ""}`;
  return <main className={styles.shell}>
    <HandoffLiveRefresh />
    <header className={styles.header}><div><p className={styles.eyebrow}>ProHealth</p><h1>Atendimento</h1></div>
      <div className={styles.headerActions}><span className={styles.queueCount}>{queue.length} {queue.length === 1 ? "conversa" : "conversas"}</span>
        <form action="/api/handoff/logout" method="post"><button className={styles.logout}>Sair</button></form></div></header>
    <div className={styles.workspace}>
      <aside className={styles.queue} aria-label="Conversas encaminhadas">
        <nav className={styles.filters} aria-label="Filtrar conversas">
          <a className={filter === "all" ? styles.filterActive : ""} href={linkFor("all")}>Todas <span>{queue.length}</span></a>
          <a className={filter === "waiting" ? styles.filterActive : ""} href={linkFor("waiting")}>Aguardando <span>{waitingCount}</span></a>
          <a className={filter === "active" ? styles.filterActive : ""} href={linkFor("active")}>Em atendimento <span>{activeCount}</span></a>
        </nav>
        {filteredQueue.length === 0 ? <div className={styles.empty}><h2>Tudo em dia</h2><p>Nenhuma conversa neste filtro.</p></div> : filteredQueue.map((item) =>
          <a key={item.id} href={linkFor(filter, item.id)} className={`${styles.queueItem} ${item.id === selected?.id ? styles.selected : ""}`}>
            <span className={styles.avatar}>{(item.firstName?.[0] ?? "C").toUpperCase()}</span><span><strong>{item.firstName ?? "Cliente"}</strong>
            <small>{item.messages.at(-1)?.content ?? item.reason}</small></span><span className={styles.queueMeta}><time>{elapsed(item.lastActivityAt)}</time>
              {item.id !== selected?.id && item.unreadCount > 0 ? <b aria-label={`${item.unreadCount} mensagens novas`}>{item.unreadCount}</b> : null}</span></a>)}
      </aside>
      <section className={styles.detail}>
        {!selected ? <div className={styles.noSelection}><h2>Nenhuma conversa selecionada</h2><p>Os pedidos de atendimento humano aparecerão aqui.</p></div> : <>
          <div className={styles.detailHeader}><div><h2>{selected.firstName ?? "Cliente"}</h2><p>{selected.maskedPhone} · {selected.status === "human_requested"
            ? `aguardando ${elapsed(selected.requestedAt)}`
            : `última atividade ${elapsed(selected.lastActivityAt)} · proteção até ${selected.expiresAt ? formatTime(selected.expiresAt) : "—"}`}</p></div>
            <span className={styles.status}>{selected.status === "human_active" ? "Em atendimento" : "Aguardando"}</span></div>
          <div className={styles.summary}><strong>Resumo para atendimento</strong><p>{selected.summary}</p></div>
          <div className={styles.messages}>{selected.messages.map((message) => <div key={message.id}
            className={message.direction === "inbound" ? styles.inbound : styles.outbound}>
            <p>{message.content}</p><time>{formatTime(message.createdAt)}</time></div>)}</div>
          <div className={styles.actions}>
            {selected.status === "human_requested" ? <form action={`/api/handoff/${selected.id}/take`} method="post"><button className={styles.secondary}>Assumir conversa</button></form> : null}
            <CloseHandoffForm conversationId={selected.id} />
          </div>
          <form action={`/api/handoff/${selected.id}/reply`} method="post" className={styles.composer}>
            <label htmlFor="message" className={styles.srOnly}>Mensagem</label><textarea id="message" name="message" required maxLength={1500} placeholder="Escreva uma mensagem…" />
            <button type="submit">Enviar</button>
          </form>
        </>}
      </section>
    </div>
  </main>;
}
