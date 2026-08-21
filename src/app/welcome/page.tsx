import { SignOutButton } from "@clerk/nextjs";
import { clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { authorize } from "@/lib/auth/server";

import { AccessStatusRefresh } from "./access-status-refresh";
import styles from "./welcome.module.css";

export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const access = await authorize("handoff:view");
  if (access.ok) redirect("/profile?welcome=1");
  if (access.status === 401) redirect("/sign-in");

  let name = "Novo usuário";
  let email = "Conta autenticada";
  if (access.userId) {
    try {
      const client = await clerkClient();
      const user = await client.users.getUser(access.userId);
      name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || name;
      email = user.primaryEmailAddress?.emailAddress ?? email;
    } catch {
      // A identidade pode estar temporariamente indisponível; o botão de atualização tenta novamente.
    }
  }

  const waitingForRole = access.reason === "missing_role" || access.reason === "invalid_role";

  return <main className={styles.shell}>
    <section className={styles.card}>
      <p className={styles.eyebrow}>ProHealth</p>
      <span className={styles.status}>{waitingForRole ? "Aguardando liberação" : "Verificando acesso"}</span>
      <h1>Cadastro concluído</h1>
      <p className={styles.lead}>{waitingForRole
        ? "Seu acesso foi criado e está aguardando a função definida pelo administrador. Você pode manter esta página aberta."
        : "Estamos confirmando os dados do seu acesso. Tente novamente em alguns instantes."}</p>

      <dl className={styles.identity}>
        <div><dt>Conta atual</dt><dd>{email}</dd></div>
        <div><dt>Nome</dt><dd>{name}</dd></div>
      </dl>

      <AccessStatusRefresh />
      <SignOutButton redirectUrl="/sign-in">
        <button className={styles.secondary} type="button">Entrar com outra conta</button>
      </SignOutButton>
    </section>
  </main>;
}
