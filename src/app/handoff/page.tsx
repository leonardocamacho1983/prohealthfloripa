import { redirect } from "next/navigation";
import { NeonConversationRepository } from "@/lib/conversations/neon-repository";
import { isHandoffAuthenticated } from "@/lib/handoff/server-auth";
import styles from "./handoff.module.css";

export const dynamic = "force-dynamic";

const formatTime = (date: Date) => new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit",
  timeZone: "America/Sao_Paulo" }).format(date);

export default async function HandoffPage({ searchParams }: { searchParams: Promise<{ conversation?: string }> }) {
  if (!(await isHandoffAuthenticated())) redirect("/handoff/login");
  const queue = await new NeonConversationRepository().listHandoffs();
  const selectedId = (await searchParams).conversation ?? queue[0]?.id;
  const selected = queue.find((item) => item.id === selectedId);
  return <main className={styles.shell}>
    <header className={styles.header}><div><p className={styles.eyebrow}>ProHealth</p><h1>Atendimento</h1></div>
      <span className={styles.queueCount}>{queue.length} {queue.length === 1 ? "conversa" : "conversas"}</span></header>
    <div className={styles.workspace}>
      <aside className={styles.queue} aria-label="Conversas encaminhadas">
        {queue.length === 0 ? <div className={styles.empty}><h2>Tudo em dia</h2><p>Nenhuma conversa aguarda atendimento.</p></div> : queue.map((item) =>
          <a key={item.id} href={`/handoff?conversation=${item.id}`} className={`${styles.queueItem} ${item.id === selected?.id ? styles.selected : ""}`}>
            <span className={styles.avatar}>{(item.firstName?.[0] ?? "C").toUpperCase()}</span><span><strong>{item.firstName ?? "Cliente"}</strong>
            <small>{item.reason}</small></span><time>{formatTime(item.requestedAt)}</time></a>)}
      </aside>
      <section className={styles.detail}>
        {!selected ? <div className={styles.noSelection}><h2>Nenhuma conversa selecionada</h2><p>Os pedidos de atendimento humano aparecerão aqui.</p></div> : <>
          <div className={styles.detailHeader}><div><h2>{selected.firstName ?? "Cliente"}</h2><p>{selected.maskedPhone} · expira às {formatTime(selected.expiresAt)}</p></div>
            <span className={styles.status}>{selected.status === "human_active" ? "Em atendimento" : "Aguardando"}</span></div>
          <div className={styles.summary}><strong>Resumo para atendimento</strong><p>{selected.summary}</p></div>
          <div className={styles.messages}>{selected.messages.map((message) => <div key={message.id}
            className={message.direction === "inbound" ? styles.inbound : styles.outbound}>
            <p>{message.content}</p><time>{formatTime(message.createdAt)}</time></div>)}</div>
          <div className={styles.actions}>
            {selected.status === "human_requested" ? <form action={`/api/handoff/${selected.id}/take`} method="post"><button className={styles.secondary}>Assumir conversa</button></form> : null}
            <form action={`/api/handoff/${selected.id}/close`} method="post"><button className={styles.close}>Encerrar e devolver ao agente</button></form>
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
