"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";

import type { InboxQuickReply } from "@/lib/inbox/repository";
import styles from "./handoff.module.css";

export function QuickReplyComposer({ conversationId, quickReplies, assignmentVersion, assumesConversation = false }: {
  conversationId: string;
  quickReplies: InboxQuickReply[];
  assignmentVersion: number;
  assumesConversation?: boolean;
}) {
  const router = useRouter();
  const draftKey = `prohealth:reply-draft:${conversationId}`;
  const [draft, setDraft] = useState(() => typeof window === "undefined"
    ? "" : sessionStorage.getItem(draftKey) ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const idempotencyKey = useRef("");
  const inputId = `message-${conversationId}`;
  const errorId = `message-error-${conversationId}`;

  useEffect(() => {
    if (draft) sessionStorage.setItem(draftKey, draft);
    else sessionStorage.removeItem(draftKey);
  }, [draft, draftKey]);

  const insertReply = (content: string) => setDraft((current) => current.trim()
    ? `${current.trimEnd()}\n${content}`
    : content);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || !draft.trim()) return;

    setPending(true);
    setError("");
    try {
      const data = new FormData(event.currentTarget);
      idempotencyKey.current ||= crypto.randomUUID();
      data.set("idempotencyKey", idempotencyKey.current);
      const response = await fetch(`/api/handoff/${conversationId}/reply`, {
        method: "POST",
        body: data,
      });
      if (!response.ok) {
        setError(response.status === 409
          ? "A conversa mudou. Atualize a página antes de enviar."
          : response.status === 401 || response.status === 403
            ? "Sua sessão não permite enviar mensagens. Atualize a página."
            : response.status === 503
              ? "O envio está temporariamente indisponível. Sua mensagem foi preservada; tente novamente."
              : "Não foi possível enviar a mensagem. Tente novamente.");
        return;
      }
      setDraft("");
      idempotencyKey.current = "";
      router.refresh();
    } catch {
      setError("Falha de conexão. A mensagem não foi enviada.");
    } finally {
      setPending(false);
    }
  };

  const submitWithShortcut = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return <div className={styles.composerArea}>
    {quickReplies.length > 0 ? <div className={styles.quickReplies} aria-label="Respostas rápidas">
      <span>Respostas rápidas</span>
      {quickReplies.map((reply) => <button key={reply.id} type="button" disabled={pending}
        onClick={() => { insertReply(reply.content); setError(""); }}>
        {reply.label}
      </button>)}
    </div> : null}
    <form className={styles.composer} onSubmit={submit} aria-busy={pending}>
      <input type="hidden" name="expectedAssignmentVersion" value={assignmentVersion} />
      <label htmlFor={inputId} className={styles.srOnly}>Mensagem</label>
      <textarea id={inputId} name="message" required maxLength={1500} placeholder="Escreva uma mensagem…"
        value={draft} disabled={pending} aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? errorId : undefined} onKeyDown={submitWithShortcut}
        onChange={(event) => { setDraft(event.target.value); setError(""); }} />
      <button type="submit" disabled={pending || !draft.trim()}>{pending ? "Enviando…"
        : assumesConversation ? "Responder e assumir" : "Enviar"}</button>
      {error ? <p id={errorId} className={styles.composerFeedback} role="alert">{error}</p> : null}
    </form>
  </div>;
}
