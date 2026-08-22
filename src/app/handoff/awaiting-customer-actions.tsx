"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./handoff.module.css";

export function AwaitingCustomerActions({ conversationId, assignmentVersion, awaiting }: {
  conversationId: string; assignmentVersion: number; awaiting: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const run = async () => {
    setPending(true); setError("");
    const data = new FormData();
    data.set("operation", awaiting ? "resume" : "start");
    data.set("expectedAssignmentVersion", String(assignmentVersion));
    data.set("idempotencyKey", crypto.randomUUID());
    try {
      const response = await fetch(`/api/handoff/${conversationId}/waiting`, { method: "POST", body: data });
      if (!response.ok) {
        if (response.status === 409) router.refresh();
        setError(response.status === 409
          ? "A conversa mudou e foi atualizada automaticamente. Confira o novo estado."
          : "Não foi possível atualizar o estado.");
        return;
      }
      router.refresh();
    } catch { setError("Falha de conexão. Tente novamente."); }
    finally { setPending(false); }
  };
  return <div className={styles.inlineWorkflowAction}>
    <button className={styles.secondary} type="button" disabled={pending} onClick={run}>
      {pending ? "Atualizando…" : awaiting ? "Retomar atendimento" : "Aguardar cliente"}
    </button>
    {error ? <p className={styles.formError} role="alert">{error}</p> : null}
  </div>;
}
