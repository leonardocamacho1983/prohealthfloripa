"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import styles from "./handoff.module.css";

export function InternalNoteForm({ action, returnTo, conversationId }: {
  action: string;
  returnTo: string;
  conversationId: string;
}) {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "error" | "success"; message: string }>();
  const inputId = `internal-note-${conversationId}`;
  const feedbackId = `internal-note-feedback-${conversationId}`;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || !content.trim()) return;

    setPending(true);
    setFeedback(undefined);
    try {
      const response = await fetch(action, { method: "POST", body: new FormData(event.currentTarget) });
      if (!response.ok) {
        setFeedback({ kind: "error", message: response.status === 403
          ? "Sua sessão não permite adicionar notas."
          : "Não foi possível adicionar a nota. Tente novamente." });
        return;
      }
      setContent("");
      setFeedback({ kind: "success", message: "Nota adicionada." });
      router.refresh();
    } catch {
      setFeedback({ kind: "error", message: "Falha de conexão. A nota não foi adicionada." });
    } finally {
      setPending(false);
    }
  };

  return <form className={styles.noteForm} onSubmit={submit} aria-busy={pending}>
    <input type="hidden" name="returnTo" value={returnTo} />
    <label className={styles.srOnly} htmlFor={inputId}>Adicionar nota interna</label>
    <textarea id={inputId} name="content" required maxLength={1000} placeholder="Ex.: prefere contato à tarde"
      value={content} disabled={pending} aria-describedby={feedback ? feedbackId : undefined}
      aria-invalid={feedback?.kind === "error" || undefined}
      onChange={(event) => { setContent(event.target.value); setFeedback(undefined); }} />
    <button type="submit" disabled={pending || !content.trim()}>{pending ? "Adicionando…" : "Adicionar nota"}</button>
    {feedback ? <p id={feedbackId} className={feedback.kind === "error" ? styles.inlineError : styles.inlineSuccess}
      role={feedback.kind === "error" ? "alert" : "status"}>{feedback.message}</p> : null}
  </form>;
}
