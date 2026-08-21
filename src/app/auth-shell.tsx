import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import styles from "./auth.module.css";

export const clerkAppearance = {
  variables: {
    colorPrimary: "#14784b",
    colorText: "#12253f",
    colorTextSecondary: "#607068",
    colorBackground: "#ffffff",
    colorInputBackground: "#fbfcfb",
    colorInputText: "#12253f",
    borderRadius: "0.75rem",
    fontFamily: "Arial, Helvetica, sans-serif",
  },
  options: {
    logoImageUrl: "/brand/pro-health-azul-escuro.svg",
    logoLinkUrl: "/",
    logoPlacement: "inside" as const,
    socialButtonsVariant: "blockButton" as const,
  },
};

type AuthShellProps = {
  children: ReactNode;
  description: string;
  title: string;
};

export function AuthShell({ children, description, title }: AuthShellProps) {
  return (
    <main className={styles.shell}>
      <section className={styles.brandPanel} aria-label="ProHealth Saúde e Performance">
        <Link className={styles.brandLink} href="/" aria-label="Ir para o site da ProHealth">
          <Image
            priority
            src="/brand/pro-health-branco.svg"
            width={290}
            height={70}
            alt="ProHealth Saúde e Performance"
          />
        </Link>
        <div className={styles.brandCopy}>
          <p>Portal de atendimento</p>
          <h1>Movimento, recuperação e performance.</h1>
          <span>Acesso seguro para a equipe ProHealth.</span>
        </div>
        <small>ProHealth Floripa</small>
      </section>

      <section className={styles.formPanel} aria-labelledby="auth-title">
        <div className={styles.mobileBrand}>
          <Image
            priority
            src="/brand/pro-health-azul-escuro.svg"
            width={232}
            height={56}
            alt="ProHealth Saúde e Performance"
          />
        </div>
        <header className={styles.formIntro}>
          <p>Área da equipe</p>
          <h2 id="auth-title">{title}</h2>
          <span>{description}</span>
        </header>
        <div className={styles.clerkCard}>{children}</div>
        <p className={styles.support}>Problemas com o acesso? Fale com o administrador da plataforma.</p>
      </section>
    </main>
  );
}
