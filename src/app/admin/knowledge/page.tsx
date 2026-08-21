import { redirect } from "next/navigation";
import { isFeatureEnabled } from "@/lib/feature-flags/repository";
import { isAppAuthorizationError, requireAppPermission } from "@/lib/handoff/server-auth";
import { listKnowledgeChangeSets, listKnowledgeVersions } from "@/lib/knowledge/governance";
import styles from "../maintenance/maintenance.module.css";

export const dynamic = "force-dynamic";
export default async function KnowledgePage({ searchParams }: { searchParams: Promise<{
  published?: string; rolledBack?: string; error?: string }> }) {
  try { await requireAppPermission("operations:configure"); }
  catch (error) { if (isAppAuthorizationError(error)) redirect(error.status === 401 ? "/sign-in" : "/handoff"); throw error; }
  const [sets, versions, enabled, params] = await Promise.all([listKnowledgeChangeSets(), listKnowledgeVersions(),
    isFeatureEnabled("knowledge_publishing"), searchParams]);
  return <main className={styles.shell}><header className={styles.header}>
    <div><p>ProHealth · conhecimento</p><h1>Publicações</h1></div>
    <nav><a href="/admin/training">Treinamentos</a><a href="/handoff">Atendimento</a></nav></header>
    {params.published ? <section className={styles.card}><p className={styles.clear}>Versão {params.published} publicada com sucesso.</p></section> : null}
    {params.rolledBack ? <section className={styles.card}><p className={styles.clear}>Versão {params.rolledBack} restaurada e ativada.</p></section> : null}
    {params.error ? <section className={styles.card}><p className={styles.warning}>A publicação foi bloqueada. É necessário ter evidência registrada e nenhum risco pendente.</p></section> : null}
    {!enabled ? <section className={styles.card}><h2>Publicação protegida</h2><p>O pipeline está instalado, mas a flag de publicação permanece desligada. Aprovações não alteram o agente.</p></section> : null}
    {sets.length === 0 ? <section className={styles.card}><h2>Nenhum conjunto aprovado</h2><p>Uma aprovação de treinamento cria um conjunto versionável.</p></section>
      : sets.map((set) => <section className={styles.card} key={set.id}>
        <p className={styles.eyebrow}>{set.status} · risco {set.riskLevel}</p><h2>{set.title}</h2>
        <p>{set.itemCount} itens · checksum {set.checksum.slice(0, 12)}</p>
        <p>{set.evidence ? `Evidência: ${set.evidence}` : "Sem evidência registrada — publicação bloqueada."}</p>
        {enabled && set.status === "approved" ? <form action={`/api/admin/knowledge/${set.id}/publish`} method="post">
          <button type="submit">Publicar nova versão</button></form> : null}
      </section>)}
    <section className={styles.card}>
      <p className={styles.eyebrow}>Histórico imutável</p><h2>Versões e rollback</h2>
      {versions.length === 0 ? <p>Nenhuma versão publicada.</p> : versions.map((version) => <article key={version.id}>
        <p><strong>Versão {version.versionNumber}</strong> · {version.active ? "ativa" : "inativa"} · checksum {version.checksum.slice(0, 12)}</p>
        {!version.active && enabled ? <form action={`/api/admin/knowledge/${version.id}/rollback`} method="post">
          <label>Motivo do rollback
            <input name="reason" required minLength={5} maxLength={500} placeholder="Descreva a regressão observada" />
          </label>
          <button type="submit">Restaurar esta versão</button>
        </form> : null}
      </article>)}
    </section>
  </main>;
}
