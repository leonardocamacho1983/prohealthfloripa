import { redirect } from "next/navigation";

import { previewConversationRevisionRepair, repairConversationRevisions } from "@/lib/conversations/repair-conversation-revisions";
import { isAppAuthorizationError, requireAppUser } from "@/lib/handoff/server-auth";

import styles from "./maintenance.module.css";

export const dynamic = "force-dynamic";

async function applyConversationRevisionRepair() {
  "use server";
  await requireAppUser(["owner", "admin"]);
  const result = await repairConversationRevisions();
  const outcome = result.queueFailures === 0 ? "success" : "partial";
  redirect(`/admin/maintenance?repair=${outcome}&messages=${result.affectedMessages}&conversations=${result.affectedConversations}&queued=${result.queuedTurns}`);
}

export default async function MaintenancePage({ searchParams }: {
  searchParams: Promise<{ repair?: string; messages?: string; conversations?: string; queued?: string; schema?: string }>;
}) {
  try {
    await requireAppUser(["owner", "admin"]);
  } catch (error) {
    if (isAppAuthorizationError(error)) {
      if (error.status === 401) redirect("/sign-in");
      if (error.status === 403) redirect("/handoff");
    }
    throw error;
  }
  const [preview, params] = await Promise.all([previewConversationRevisionRepair(), searchParams]);
  const applied = params.repair === "success" || params.repair === "partial";

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div><p>ProHealth · operação</p><h1>Manutenção</h1></div>
      <nav><a href="/handoff">Atendimento</a><a href="/metrics">Indicadores</a></nav>
    </header>
    <section className={styles.card}>
      <p className={styles.eyebrow}>Integridade das conversas</p>
      <h2>Revisões de mensagens recebidas</h2>
      <p>Localiza somente o padrão comprovado do incidente: mensagem sem revisão, turno vazio concluído logo depois e nenhuma resposta enviada.</p>
      {applied ? <p className={params.repair === "success" ? styles.success : styles.warning} role="status">
        Reparo executado: {params.messages ?? "0"} mensagem(ns), {params.conversations ?? "0"} conversa(s) e {params.queued ?? "0"} turno(s) reenfileirado(s).
      </p> : null}
      <dl>
        <div><dt>Conversas afetadas</dt><dd>{preview.affectedConversations}</dd></div>
        <div><dt>Mensagens afetadas</dt><dd>{preview.affectedMessages}</dd></div>
      </dl>
      {preview.affectedMessages > 0
        ? <form action={applyConversationRevisionRepair}>
          <button type="submit">Reparar e reenfileirar</button>
        </form>
        : <p className={styles.clear}>Nenhuma mensagem pendente de reparo.</p>}
    </section>
    <section className={styles.card}>
      <p className={styles.eyebrow}>Banco de dados</p><h2>Schema operacional da plataforma</h2>
      <p>Aplica de forma idempotente as estruturas aditivas de workflow, notificação, SLA, CX, conhecimento, avaliações e workforce.</p>
      {params.schema && params.schema !== "error" ? <p className={styles.success}>Schema validado na versão {params.schema}.</p> : null}
      {params.schema === "error" ? <p className={styles.warning}>A validação falhou. Consulte os logs seguros antes de tentar novamente.</p> : null}
      <form action="/api/admin/maintenance/platform-schema" method="post">
        <button type="submit">Validar e aplicar schema</button>
      </form>
    </section>
  </main>;
}
