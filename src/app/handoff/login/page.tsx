import styles from "../handoff.module.css";

export default async function HandoffLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return <main className={styles.loginShell}><section className={styles.loginCard}>
    <p className={styles.eyebrow}>ProHealth</p><h1>Atendimento humano</h1>
    <p>Entre para acessar somente as conversas encaminhadas.</p>
    <form action="/api/handoff/login" method="post" className={styles.loginForm}>
      <label htmlFor="accessKey">Chave de acesso</label>
      <input id="accessKey" name="accessKey" type="password" autoComplete="current-password" required autoFocus />
      {error ? <p className={styles.error}>Chave inválida.</p> : null}
      <button type="submit">Entrar</button>
    </form>
  </section></main>;
}
