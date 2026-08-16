"use client";

import styles from "./handoff.module.css";

export function CloseHandoffForm({ conversationId }: { conversationId: string }) {
  return <form action={`/api/handoff/${conversationId}/close`} method="post"
    onSubmit={(event) => { if (!window.confirm("Encerrar o atendimento humano e devolver a conversa ao agente?")) event.preventDefault(); }}>
    <button className={styles.close} type="submit">Encerrar e devolver ao agente</button>
  </form>;
}
