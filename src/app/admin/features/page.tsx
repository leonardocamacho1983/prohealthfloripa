import { redirect } from "next/navigation";

import { listFeatureFlags } from "@/lib/feature-flags/repository";
import type { AppFeatureFlag } from "@/lib/feature-flags/types";
import { isAppAuthorizationError, requireAppPermission } from "@/lib/handoff/server-auth";
import styles from "./features.module.css";

export const dynamic = "force-dynamic";

const copy: Record<AppFeatureFlag, { title: string; description: string }> = {
  conversation_transfer: { title: "Transferência entre atendentes", description: "Permite transferir uma conversa com motivo, nota interna e histórico auditável." },
  awaiting_customer: { title: "Aguardando cliente", description: "Separa conversas aguardando resposta das que exigem ação da equipe." },
  sla_engine: { title: "Motor de SLA", description: "Calcula prazos, risco e escalonamentos operacionais." },
  cx_surveys: { title: "Pesquisas de experiência", description: "Ativa pesquisas e recuperação de insatisfação." },
  promises: { title: "Promessas e retornos", description: "Registra compromissos com prazo e responsável." },
  knowledge_publishing: { title: "Publicação de conhecimento", description: "Ativa o fluxo editorial da base de respostas." },
  new_app_shell: { title: "Nova interface", description: "Ativa gradualmente a nova estrutura visual do produto." },
  workforce_routing: { title: "Roteamento por disponibilidade", description: "Distribui atendimentos considerando escala e capacidade." },
};

export default async function FeaturesPage({ searchParams }: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  try { await requireAppPermission("operations:configure"); }
  catch (error) {
    if (isAppAuthorizationError(error)) redirect(error.status === 401 ? "/sign-in" : "/handoff");
    throw error;
  }
  const [flags, params] = await Promise.all([listFeatureFlags(), searchParams]);
  return <main className={styles.shell}>
    <header><div><p>ProHealth · implantação</p><h1>Recursos da plataforma</h1></div>
      <nav><a href="/handoff">Atendimento</a><a href="/admin/reasons">Motivos</a></nav></header>
    <div className={styles.content}>
      <section className={styles.intro}><h2>Liberação controlada</h2>
        <p>Cada recurso pode ser validado separadamente antes de ficar disponível para a operação.</p></section>
      {params.success ? <p className={styles.notice} role="status">Configuração atualizada.</p> : null}
      {params.error ? <p className={styles.error} role="alert">Não foi possível atualizar o recurso.</p> : null}
      <div className={styles.grid}>{flags.map((flag) => <article key={flag.key} className={styles.card}>
        <div><span className={flag.enabled ? styles.enabled : styles.disabled}>{flag.enabled ? "Ativo" : "Inativo"}</span>
          <h2>{copy[flag.key].title}</h2><p>{copy[flag.key].description}</p>
          <small>Atualizado em {flag.updatedAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</small></div>
        <form action="/api/admin/features" method="post">
          <input type="hidden" name="key" value={flag.key} />
          <input type="hidden" name="enabled" value={flag.enabled ? "false" : "true"} />
          <button type="submit">{flag.enabled ? "Desativar" : "Ativar"}</button>
        </form>
      </article>)}</div>
    </div>
  </main>;
}
