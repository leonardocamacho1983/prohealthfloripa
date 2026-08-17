"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export function TrainingEnrollmentForm() {
  const router = useRouter();
  const [conversationId, setConversationId] = useState("");
  const [displayName, setDisplayName] = useState("João");
  const [state, setState] = useState<"idle" | "submitting" | "success" | "error">("idle");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!conversationId.trim() || state === "submitting") return;

    setState("submitting");
    try {
      const response = await fetch("/api/training/enroll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: conversationId.trim(), displayName: displayName.trim() }),
      });
      if (!response.ok) throw new Error("Enrollment failed");

      setState("success");
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
    <button type="submit" disabled={state === "submitting" || !conversationId.trim()}>
      {state === "submitting" ? "Ativando…" : "Ativar modo de treinamento"}
    </button>
    {state === "success" ? <p role="status">Treinador ativado.</p> : null}
    {state === "error" ? <p role="alert">Não foi possível ativar. Confira a conversa e tente novamente.</p> : null}
  </form>;
}
