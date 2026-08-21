"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import styles from "./handoff.module.css";

type PromiseItem = { id: string; description: string; dueAt: string; status: "open" | "completed" | "cancelled" };

export function PromisePanel({ conversationId, items, canEdit }: {
  conversationId: string; items: PromiseItem[]; canEdit: boolean;
}) {
  const router = useRouter(); const [pending, setPending] = useState(""); const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>, endpoint: string, key: string) => {
    event.preventDefault(); setPending(key); setError("");
    const data = new FormData(event.currentTarget);
    const localDueAt = data.get("dueAtLocal");
    if (typeof localDueAt === "string" && localDueAt) data.set("dueAt", new Date(localDueAt).toISOString());
    try { const response = await fetch(endpoint, { method: "POST", body: data });
      if (!response.ok) { setError("O compromisso mudou ou os dados precisam ser revisados."); return; }
      event.currentTarget.reset(); router.refresh();
    } catch { setError("Falha de conexão. O compromisso não foi alterado."); }
    finally { setPending(""); }
  };
  const open = items.filter((item) => item.status === "open");
  return <section className={styles.promisePanel} aria-labelledby={`promises-${conversationId}`}>
    <div className={styles.promiseHeader}><div><strong id={`promises-${conversationId}`}>Próximas ações</strong>
      <span>{open.length} {open.length === 1 ? "compromisso aberto" : "compromissos abertos"}</span></div></div>
    {open.map((item) => <article key={item.id} className={styles.promiseItem}>
      <div><p>{item.description}</p><time dateTime={item.dueAt}>Até {new Date(item.dueAt).toLocaleString("pt-BR")}</time></div>
      {canEdit ? <div className={styles.promiseActions}>
        <form onSubmit={(event) => submit(event, `/api/promises/${item.id}/complete`, `complete-${item.id}`)}>
          <button type="submit" disabled={Boolean(pending)}>{pending === `complete-${item.id}` ? "Concluindo…" : "Concluir"}</button>
        </form>
        <details><summary>Alterar</summary><div>
          <form onSubmit={(event) => submit(event, `/api/promises/${item.id}/reschedule`, `reschedule-${item.id}`)}>
            <label>Novo prazo<input type="datetime-local" name="dueAtLocal" required /></label>
            <label>Motivo<input name="reason" minLength={3} maxLength={240} required /></label>
            <button type="submit" disabled={Boolean(pending)}>Reagendar</button>
          </form>
          <form onSubmit={(event) => submit(event, `/api/promises/${item.id}/cancel`, `cancel-${item.id}`)}>
            <label>Motivo do cancelamento<input name="reason" minLength={3} maxLength={240} required /></label>
            <button type="submit" disabled={Boolean(pending)}>Cancelar compromisso</button>
          </form>
        </div></details>
      </div> : null}
    </article>)}
    {canEdit ? <details className={styles.promiseCreate}><summary>Adicionar compromisso</summary>
      <form onSubmit={(event) => submit(event, `/api/handoff/${conversationId}/promises`, "create")}>
        <label>Próxima ação<input name="description" minLength={3} maxLength={240} required
          placeholder="Ex.: confirmar o horário solicitado" /></label>
        <label>Prazo<input type="datetime-local" name="dueAtLocal" required /></label>
        <button type="submit" disabled={Boolean(pending)}>{pending === "create" ? "Salvando…" : "Salvar compromisso"}</button>
      </form></details> : null}
    {error ? <p className={styles.formError} role="alert">{error}</p> : null}
  </section>;
}
