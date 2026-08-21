import { redirect } from "next/navigation";
import { getCxSettings, getCxSnapshot } from "@/lib/cx/repository";
import { isFeatureEnabled } from "@/lib/feature-flags/repository";
import { isAppAuthorizationError, requireAppPermission } from "@/lib/handoff/server-auth";
import styles from "../reasons/reasons.module.css";
export const dynamic = "force-dynamic";
export default async function CxPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  try { await requireAppPermission("operations:configure"); }
  catch (error) { if (isAppAuthorizationError(error)) redirect(error.status === 401 ? "/sign-in" : "/handoff"); throw error; }
  const [settings, snapshot, flag, params] = await Promise.all([getCxSettings(), getCxSnapshot(),
    isFeatureEnabled("cx_surveys"), searchParams]);
  return <main className={styles.shell}><header className={styles.header}><div><p>ProHealth · experiência</p><h1>Desfechos e pesquisas</h1></div>
    <nav><a href="/handoff">Atendimento</a><a href="/metrics">Indicadores</a></nav></header>
    <div className={styles.content}>
      {params.saved ? <p className={styles.notice}>Política salva.</p> : null}
      {params.error ? <p className={styles.error}>Revise os valores da política.</p> : null}
      <section className={styles.card}><h2>Cobertura atual</h2><p>{snapshot.outcomes} desfechos consolidados · {snapshot.reopened} reaberturas observadas · {snapshot.answeredSurveys} pesquisas respondidas.</p>
        <p>Nota média: {snapshot.averageScore === undefined ? "sem cobertura suficiente" : snapshot.averageScore.toFixed(1)}.</p></section>
      <section className={styles.card}><h2>Política de CSAT</h2>
        {!flag ? <p>A flag de pesquisas está desligada. Salvar a política não envia mensagens até a liberação controlada.</p> : null}
        <form className={styles.settingsForm} action="/api/admin/cx" method="post">
          <label className={styles.switchLabel}><input type="checkbox" name="enabled" defaultChecked={settings.enabled} />Ativar amostragem</label>
          <label>Percentual da amostra<input type="number" name="sampleRate" min={0} max={100} step={1} defaultValue={settings.sampleRate * 100} /></label>
          <label>Atraso após encerramento (min)<input type="number" name="delayMinutes" min={0} max={10080} defaultValue={settings.delayMinutes} /></label>
          <label>Validade da resposta (h)<input type="number" name="expiresHours" min={1} max={720} defaultValue={settings.expiresHours} /></label>
          <button type="submit">Salvar política</button></form></section>
    </div></main>;
}
