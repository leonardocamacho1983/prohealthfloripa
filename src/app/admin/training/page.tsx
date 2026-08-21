import { redirect } from "next/navigation";
import { isAppAuthorizationError, requireAppUser } from "@/lib/handoff/server-auth";
import { TrainingRepository } from "@/lib/training/repository";
import { TrainingEnrollmentForm } from "./enrollment-form";
import styles from "../maintenance/maintenance.module.css";

export const dynamic = "force-dynamic";

const statusLabel: Record<string, string> = {
  collecting: "Em andamento", pending_review: "Aguardando revisão", approved: "Aprovado",
  rejected: "Rejeitado", cancelled: "Cancelado",
};

export default async function TrainingPage() {
  try { await requireAppUser(["owner", "admin"]); }
  catch (error) {
    if (isAppAuthorizationError(error)) {
      if (error.status === 401) redirect("/sign-in");
      if (error.status === 403) redirect("/handoff");
    }
    throw error;
  }
  const sessions = await new TrainingRepository().listSessions();
  return <main className={styles.shell}>
    <header className={styles.header}>
      <div><p>ProHealth · conhecimento</p><h1>Treinamentos</h1></div>
      <nav><a href="/handoff">Atendimento</a><a href="/admin/knowledge">Publicações</a><a href="/admin/reasons">Motivos</a><a href="/metrics">Indicadores</a></nav>
    </header>
    <section className={styles.card}><TrainingEnrollmentForm /></section>
    {sessions.length === 0 ? <section className={styles.card}><h2>Nenhum treinamento</h2>
      <p>As propostas enviadas pelo treinador aparecerão aqui.</p></section>
      : sessions.map((session) => <section className={styles.card} key={session.id}>
        <p className={styles.eyebrow}>{session.trainer} · {statusLabel[session.status] ?? session.status}</p>
        <h2>{session.items.length} {session.items.length === 1 ? "proposta" : "propostas"}</h2>
        {session.reviewDueAt ? <p>Revisão prevista até {session.reviewDueAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.</p> : null}
        {session.items.length === 0 ? <p>Nenhum item registrado.</p> : <ol>
          {session.items.map((item) => <li key={item.sequence}>
            <strong>{item.summary}</strong>
            <p>{item.sourceKind === "audio" ? "Áudio" : "Texto"} · {item.type}</p>
            {item.clarificationQuestion ? <p>Pendente: {item.clarificationQuestion}</p> : null}
            {item.riskFlags.length ? <p>Revisar: {item.riskFlags.join(", ")}</p> : null}
          </li>)}
        </ol>}
        {session.status === "pending_review" ? <>
          {session.items.some((item) => item.type === "unknown" || item.needsClarification || item.riskFlags.length > 0)
            ? <p className={styles.warning}>Esta sessão possui itens sem classificação, dúvidas ou riscos. Ela pode ser rejeitada, mas só poderá ser aprovada depois da correção.</p>
            : null}
          <form className={styles.reviewForm} action={`/api/admin/training/${session.id}/review`} method="post">
            <label>Nota da revisão <span>(opcional ao aprovar; recomendada ao rejeitar)</span>
              <textarea name="note" rows={3} maxLength={1000} placeholder="Decisão, evidências ou ajustes necessários" /></label>
            <div className={styles.reviewActions}>
              <button className={styles.rejectButton} type="submit" name="decision" value="rejected">Rejeitar propostas</button>
              <button type="submit" name="decision" value="approved"
                disabled={session.items.some((item) => item.type === "unknown" || item.needsClarification || item.riskFlags.length > 0)}>
                Aprovar propostas
              </button>
            </div>
          </form>
        </> : null}
        {session.reviewedAt ? <p className={styles.clear}>Revisado em {session.reviewedAt.toLocaleString("pt-BR", {
          timeZone: "America/Sao_Paulo",
        })}. {session.reviewNote ? `Nota: ${session.reviewNote}` : "A revisão não altera automaticamente o conhecimento em produção."}</p> : null}
      </section>)}
  </main>;
}
