import { clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { parseAppRole } from "@/lib/auth/permissions";
import { getWorkforceConfiguration } from "@/lib/attendants/workforce";
import { isFeatureEnabled } from "@/lib/feature-flags/repository";
import { isAppAuthorizationError, requireAppPermission } from "@/lib/handoff/server-auth";
import styles from "../maintenance/maintenance.module.css";

export const dynamic = "force-dynamic";

export default async function WorkforcePage({ searchParams }: { searchParams: Promise<{
  saved?: string; error?: string }> }) {
  try { await requireAppPermission("operations:configure"); }
  catch (error) { if (isAppAuthorizationError(error)) redirect(error.status === 401 ? "/sign-in" : "/handoff"); throw error; }
  const [users, enabled, params] = await Promise.all([
    (await clerkClient()).users.getUserList({ limit: 100, orderBy: "+first_name" }),
    isFeatureEnabled("workforce_routing"), searchParams,
  ]);
  const attendants = users.data.filter((user) => {
    const role = parseAppRole(user.publicMetadata.role);
    return role !== undefined && !user.banned && !user.locked;
  });
  const configurations = await Promise.all(attendants.map((user) => getWorkforceConfiguration(user.id)));
  const format = (value: Date) => value.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  return <main className={styles.shell}>
    <header className={styles.header}><div><p>ProHealth · operação</p><h1>Equipe e capacidade</h1></div>
      <nav><a href="/admin/users">Usuários</a><a href="/admin/features">Recursos</a><a href="/handoff">Atendimento</a></nav></header>
    {!enabled ? <section className={styles.card}><p className={styles.warning}>O roteamento por workforce está instalado e desligado. Configure e valide a equipe antes de ativar a flag.</p></section> : null}
    {params.saved ? <section className={styles.card}><p className={styles.success}>Configuração atualizada.</p></section> : null}
    {params.error ? <section className={styles.card}><p className={styles.warning}>Não foi possível aplicar a alteração. Revise os campos.</p></section> : null}
    {attendants.map((user, index) => {
      const config = configurations[index]!;
      const name = [user.firstName, user.lastName].filter(Boolean).join(" ")
        || user.primaryEmailAddress?.emailAddress || "Atendente";
      return <section className={styles.card} key={user.id}>
        <p className={styles.eyebrow}>{config.state.state} · {config.notificationTested ? "notificação testada" : "teste pendente"}</p>
        <h2>{name}</h2><p>{user.primaryEmailAddress?.emailAddress}</p>
        <form action={`/api/admin/workforce/${user.id}/settings`} method="post">
          <label>Capacidade simultânea
            <input type="number" name="capacity" min={1} max={100} defaultValue={config.capacity} required />
          </label>
          <label>Competências (separadas por vírgula)
            <input name="skills" maxLength={500} defaultValue={config.skills.join(", ")} placeholder="pilates, recovery" />
          </label>
          <button type="submit">Salvar capacidade e competências</button>
        </form>
        <h3>Exceções de escala</h3>
        {config.exceptions.length === 0 ? <p>Nenhuma exceção futura ou recente.</p> : config.exceptions.map((exception) => <div key={exception.id}>
          <p><strong>{exception.kind === "coverage" ? "Cobertura" : "Indisponível"}</strong> · {format(exception.startsAt)} até {format(exception.endsAt)}{exception.reason ? ` · ${exception.reason}` : ""}</p>
          <form action={`/api/admin/workforce/${user.id}/exceptions/${exception.id}`} method="post">
            <button type="submit">Remover exceção</button>
          </form>
        </div>)}
        <form action={`/api/admin/workforce/${user.id}/exceptions`} method="post">
          <label>Tipo<select name="kind" defaultValue="unavailable"><option value="unavailable">Indisponibilidade</option><option value="coverage">Cobertura extra</option></select></label>
          <label>Início<input type="datetime-local" name="startsAt" required /></label>
          <label>Fim<input type="datetime-local" name="endsAt" required /></label>
          <label>Motivo<input name="reason" maxLength={200} /></label>
          <button type="submit">Adicionar exceção</button>
        </form>
      </section>;
    })}
  </main>;
}
