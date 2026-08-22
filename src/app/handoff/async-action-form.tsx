"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import styles from "./handoff.module.css";

const errorMessageFor = (status: number) => {
  if (status === 401 || status === 403) return "Sua sessão não permite esta ação. Atualize a página.";
  if (status === 409) return "A conversa mudou e foi atualizada automaticamente. Confira o novo estado.";
  if (status === 503) return "Serviço indisponível no momento. Tente novamente em instantes.";
  if (status >= 500) return "O sistema não conseguiu concluir a ação. Tente novamente em instantes.";
  return "Não foi possível concluir a ação. Tente novamente.";
};

export function AsyncActionForm({ action, buttonClassName, confirmMessage, hiddenFields, idleLabel, pendingLabel }: {
  action: string;
  buttonClassName: string;
  confirmMessage?: string;
  hiddenFields?: Record<string, string | number>;
  idleLabel: string;
  pendingLabel: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || (confirmMessage && !window.confirm(confirmMessage))) return;

    setPending(true);
    setError("");
    try {
      const response = await fetch(action, { method: "POST", body: new FormData(event.currentTarget) });
      if (!response.ok) {
        if (response.status === 409) router.refresh();
        setError(errorMessageFor(response.status));
        return;
      }

      if (response.redirected) {
        const target = new URL(response.url);
        if (target.origin === window.location.origin && target.pathname.startsWith("/handoff")) {
          router.replace(`${target.pathname}${target.search}`, { scroll: false });
          return;
        }
      }
      router.refresh();
    } catch {
      setError("Falha de conexão. Verifique a internet e tente novamente.");
    } finally {
      setPending(false);
    }
  };

  return <form className={styles.asyncActionForm} onSubmit={submit} aria-busy={pending}>
    {Object.entries(hiddenFields ?? {}).map(([name, value]) =>
      <input key={name} type="hidden" name={name} value={String(value)} />)}
    <button className={buttonClassName} type="submit" disabled={pending}>
      {pending ? pendingLabel : idleLabel}
    </button>
    {error ? <p className={styles.inlineError} role="alert">{error}</p> : null}
  </form>;
}
