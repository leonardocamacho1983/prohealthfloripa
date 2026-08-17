"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import type { InboxQuickReply } from "@/lib/inbox/repository";
import styles from "./handoff.module.css";

function QuickReplyForm({ reply, returnTo }: { reply: InboxQuickReply; returnTo: string }) {
  const router = useRouter();
  const [label, setLabel] = useState(reply.label);
  const [content, setContent] = useState(reply.content);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "error" | "success"; message: string }>();
  const labelId = `quick-reply-label-${reply.id}`;
  const contentId = `quick-reply-content-${reply.id}`;
  const feedbackId = `quick-reply-feedback-${reply.id}`;
  const valid = Boolean(label.trim() && content.trim());
  const changed = label !== reply.label || content !== reply.content;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || !valid || !changed) return;

    setPending(true);
    setFeedback(undefined);
    try {
      const response = await fetch(`/api/inbox/quick-replies/${reply.id}`, {
        method: "POST",
        body: new FormData(event.currentTarget),
      });
      if (!response.ok) {
        setFeedback({ kind: "error", message: response.status === 403
          ? "Sua sessão não permite editar respostas rápidas."
          : "Não foi possível salvar. Tente novamente." });
        return;
      }
      setFeedback({ kind: "success", message: "Resposta salva." });
      router.refresh();
    } catch {
      setFeedback({ kind: "error", message: "Falha de conexão. A resposta não foi salva." });
    } finally {
      setPending(false);
    }
  };

  return <form onSubmit={submit} aria-busy={pending}>
    <input type="hidden" name="returnTo" value={returnTo} />
    <label htmlFor={labelId}>Nome<input id={labelId} name="label" required maxLength={60} value={label}
      disabled={pending} aria-invalid={feedback?.kind === "error" || undefined}
      onChange={(event) => { setLabel(event.target.value); setFeedback(undefined); }} /></label>
    <label htmlFor={contentId}>Mensagem<textarea id={contentId} name="content" required maxLength={1500}
      value={content} disabled={pending} aria-describedby={feedback ? feedbackId : undefined}
      aria-invalid={feedback?.kind === "error" || undefined}
      onChange={(event) => { setContent(event.target.value); setFeedback(undefined); }} /></label>
    <button type="submit" disabled={pending || !valid || !changed}>{pending ? "Salvando…" : "Salvar"}</button>
    {feedback ? <p id={feedbackId} className={feedback.kind === "error" ? styles.inlineError : styles.inlineSuccess}
      role={feedback.kind === "error" ? "alert" : "status"}>{feedback.message}</p> : null}
  </form>;
}

export function QuickReplyEditor({ quickReplies, returnTo }: {
  quickReplies: InboxQuickReply[];
  returnTo: string;
}) {
  return <details className={styles.quickReplyEditor}>
    <summary>Editar catálogo</summary>
    <div>{quickReplies.map((reply) => <QuickReplyForm key={reply.id} reply={reply} returnTo={returnTo} />)}</div>
  </details>;
}
