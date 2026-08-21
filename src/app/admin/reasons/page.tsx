import { redirect } from "next/navigation";

import { isAppAuthorizationError, requireAppUser } from "@/lib/handoff/server-auth";
import { getConversationOperationSettings, listConversationReasons } from "@/lib/reasons/repository";
import type { ReasonCategory } from "@/lib/reasons/catalog";
import styles from "./reasons.module.css";

export const dynamic = "force-dynamic";

const groups: Array<{ category: ReasonCategory; title: string; description: string }> = [
  { category: "handoff", title: "Passagem para atendente",
    description: "Classifica por que o atendimento automático precisou envolver uma pessoa." },
  { category: "human_closure", title: "Fechamento pelo atendente",
    description: "O atendente deve escolher um destes motivos antes de encerrar." },
  { category: "automatic_closure", title: "Fechamento automático",
    description: "Motivos reservados às regras automáticas, como inatividade ou satisfação confirmada." },
];

export default async function ReasonsPage({ searchParams }: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  try { await requireAppUser(["owner", "admin"]); }
  catch (error) {
    if (isAppAuthorizationError(error)) {
      if (error.status === 401) redirect("/sign-in");
      if (error.status === 403) redirect("/handoff");
    }
    throw error;
  }
  const [reasons, settings, params] = await Promise.all([
    listConversationReasons(), getConversationOperationSettings(), searchParams,
  ]);
  return <main className={styles.shell}>
    <header className={styles.header}>
      <div><p>ProHealth · operação</p><h1>Motivos de atendimento</h1></div>
      <nav><a href="/handoff">Atendimento</a><a href="/metrics">Indicadores</a></nav>
    </header>
    <div className={styles.content}>
      {params.success ? <p className={styles.notice}>Motivos atualizados.</p> : null}
      {params.error ? <p className={styles.error}>Não foi possível salvar. Revise o texto e tente novamente.</p> : null}
      <section className={styles.card}>
        <div className={styles.cardHeader}><div><h2>Encerramento por inatividade</h2>
          <p>Quando ativado, o atendimento humano é encerrado se o cliente não responder dentro do intervalo. Uma nova mensagem abre automaticamente um episódio relacionado.</p></div>
          <form className={styles.settingsForm} action="/api/admin/reasons" method="post">
            <input type="hidden" name="operation" value="settings" />
            <label className={styles.switchLabel}><input type="checkbox" name="automaticInactivityEnabled"
              defaultChecked={settings.automaticInactivityEnabled} />Ativar encerramento automático</label>
            <label>Minutos sem resposta
              <input type="number" name="customerInactivityMinutes" min={5} max={10080}
                defaultValue={settings.customerInactivityMinutes} required />
            </label>
            <button type="submit">Salvar regra</button>
          </form></div>
      </section>
      {groups.map((group) => {
        const items = reasons.filter((reason) => reason.category === group.category);
        return <section className={styles.card} key={group.category}>
          <div className={styles.cardHeader}><div><h2>{group.title}</h2><p>{group.description}</p></div>
            <form className={styles.createForm} action="/api/admin/reasons" method="post">
              <input type="hidden" name="operation" value="create" />
              <input type="hidden" name="category" value={group.category} />
              <label className={styles.srOnly} htmlFor={`new-${group.category}`}>Novo motivo</label>
              <input id={`new-${group.category}`} name="label" required minLength={2} maxLength={120}
                placeholder="Adicionar motivo" />
              <button type="submit">Adicionar</button>
            </form></div>
          <div className={styles.reasonList}>
            {items.map((reason) => <form className={styles.reasonRow} action="/api/admin/reasons" method="post" key={reason.id}>
              <input type="hidden" name="operation" value="update" />
              <input type="hidden" name="id" value={reason.id} />
              <input type="hidden" name="active" value={reason.active ? "true" : "false"} />
              <label className={styles.srOnly} htmlFor={`reason-${reason.id}`}>Nome do motivo</label>
              <input id={`reason-${reason.id}`} name="label" defaultValue={reason.label}
                required minLength={2} maxLength={120} />
              <span className={reason.active ? styles.active : styles.inactive}>{reason.active ? "Ativo" : "Inativo"}</span>
              <button type="submit">Salvar</button>
              <button className={reason.active ? styles.deactivate : styles.reactivate} type="submit"
                name="nextActive" value={reason.active ? "false" : "true"}>
                {reason.active ? "Desativar" : "Reativar"}
              </button>
            </form>)}
          </div>
        </section>;
      })}
    </div>
  </main>;
}
