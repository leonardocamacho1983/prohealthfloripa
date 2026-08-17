import { AsyncActionForm } from "./async-action-form";
import styles from "./handoff.module.css";

export function CloseHandoffForm({ conversationId }: { conversationId: string }) {
  return <AsyncActionForm action={`/api/handoff/${conversationId}/close`} buttonClassName={styles.close}
    idleLabel="Encerrar e devolver ao agente" pendingLabel="Encerrando…"
    confirmMessage="Encerrar o atendimento humano e devolver a conversa ao agente?" />;
}
