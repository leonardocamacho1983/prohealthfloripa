import { SignOutButton } from "@clerk/nextjs";

import styles from "./access-denied.module.css";

export default function AccessDeniedPage() {
  return <main className={styles.shell}>
    <section className={styles.card}>
      <p className={styles.eyebrow}>ProHealth</p>
      <h1>Acesso ainda não liberado</h1>
      <p>Sua conta está autenticada, mas ainda não possui uma função válida. Peça a um administrador para liberar seu acesso.</p>
      <SignOutButton redirectUrl="/sign-in"><button type="button">Entrar com outra conta</button></SignOutButton>
    </section>
  </main>;
}
