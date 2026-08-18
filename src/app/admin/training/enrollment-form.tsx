"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export function TrainingEnrollmentForm() {
  const router = useRouter();
  const [conversationId, setConversationId] = useState("");
  const [displayName, setDisplayName] = useState("João");
  const [state, setState] = useState<"idle" | "activating" | "deactivating" | "activated" | "deactivated" | "error">("idle");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const action = submitter instanceof HTMLButtonElement ? submitter.value : "activate";
    if (!conversationId.trim() || state === "activating" || state === "deactivating") return;

    setState(action === "deactivate" ? "deactivating" : "activating");
    try {
      const response = await fetch("/api/training/enroll", {
        method: action === "deactivate" ? "DELETE" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: conversationId.trim(), displayName: displayName.trim() }),
      });
      if (!response.ok) throw new Error("Enrollment failed");

      setState(action === "deactivate" ? "deactivated" : "activated");
      setConversationId("");
      router.refresh();
    } catch {
      setState("error");
    }
  }

  return <form onSubmit={submit}>
    <h2>Ativar treinador</h2>
    <p>Vincule uma conversa existente. A partir da próxima mensagem, o contato entrará no modo de treinamento.</p>
    <label>
      Nome
      <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={80} required />
    </label>
    <label>
      ID da conversa
      <input value={conversationId} onChange={(event) => setConversationId(event.target.value)} required />
    </label>
    <button type="submit" value="activate" disabled={state === "activating" || state === "deactivating" || !conversationId.trim()}>
      {state === "activating" ? "Ativando…" : "Ativar modo de treinamento"}
    </button>
    <button type="submit" value="deactivate" disabled={state === "activating" || state === "deactivating" || !conversationId.trim()}>
      {state === "deactivating" ? "Desativando…" : "Voltar ao atendimento normal"}
    </button>
    {state === "activated" ? <p role="status">Treinador ativado.</p> : null}
    {state === "deactivated" ? <p role="status">Modo de treinamento desativado. O contato voltou ao atendimento normal.</p> : null}
    {state === "error" ? <p role="alert">Não foi possível ativar. Confira a conversa e tente novamente.</p> : null}
  </form>;
}
