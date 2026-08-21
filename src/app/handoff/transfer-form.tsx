"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import type { TransferCandidate } from "@/lib/attendants/directory";
import type { ConversationReason } from "@/lib/reasons/repository";
import styles from "./handoff.module.css";

export function TransferHandoffForm({ conversationId, assignmentVersion, candidates, reasons }: {
  conversationId: string;
  assignmentVersion: number;
  candidates: TransferCandidate[];
  reasons: ConversationReason[];
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setPending(true); setError(""); setSuccess("");
    const data = new FormData(event.currentTarget);
    data.set("idempotencyKey", crypto.randomUUID());
    try {
      const response = await fetch(`/api/handoff/${conversationId}/transfer`, { method: "POST", body: data });
      if (!response.ok) {
        setError(response.status === 409 ? "A conversa mudou. Atualize e confira o responsável."
          : "Não foi possível transferir. Revise os campos e tente novamente.");
        return;
      }
      const result = await response.json() as { notificationStatus?: "queued" | "skipped" | "failed" };
      const targetLabel = candidates.find((item) => item.userId === data.get("targetUserId"))?.label ?? "o atendente";
      setSuccess(result.notificationStatus === "queued"
        ? `Atendimento transferido para ${targetLabel}. Notificação enviada para processamento.`
        : result.notificationStatus === "failed"
          ? `Atendimento transferido para ${targetLabel}, mas a notificação falhou.`
          : `Atendimento transferido para ${targetLabel}. O perfil ainda não está pronto para receber notificações.`);
      dialog.current?.close(); router.refresh();
    } catch { setError("Falha de conexão. A transferência não foi concluída."); }
    finally { setPending(false); }
  };

  if (candidates.length === 0 || reasons.length === 0) return null;
  return <>
    <button className={styles.secondary} type="button" onClick={() => dialog.current?.showModal()}>Transferir</button>
    {success ? <p className={styles.workflowFeedback} role="status">{success}</p> : null}
    <dialog ref={dialog} className={styles.workflowDialog} aria-labelledby={`transfer-title-${conversationId}`}>
      <form onSubmit={submit}>
        <div className={styles.dialogHeader}><div><p className={styles.eyebrow}>Passagem de bastão</p>
          <h2 id={`transfer-title-${conversationId}`}>Transferir atendimento</h2></div>
          <button type="button" className={styles.dialogClose} aria-label="Fechar" onClick={() => dialog.current?.close()}>×</button></div>
        <input type="hidden" name="expectedAssignmentVersion" value={assignmentVersion} />
        <label>Novo responsável<select name="targetUserId" required defaultValue="">
          <option value="" disabled>Selecione uma pessoa</option>
          {candidates.map((item) => <option key={item.userId} value={item.userId}>{item.label}</option>)}
        </select></label>
        <label>Motivo<select name="reasonId" required defaultValue="">
          <option value="" disabled>Selecione o motivo</option>
          {reasons.map((reason) => <option key={reason.id} value={reason.id}>{reason.label}</option>)}
        </select></label>
        <label>Nota interna <span>(opcional)</span><textarea name="note" maxLength={500}
          placeholder="Contexto que ajuda o próximo atendente. O cliente não vê esta nota." /></label>
        {error ? <p className={styles.formError} role="alert">{error}</p> : null}
        <div className={styles.dialogActions}><button type="button" className={styles.secondary}
          onClick={() => dialog.current?.close()} disabled={pending}>Cancelar</button>
          <button type="submit" disabled={pending}>{pending ? "Transferindo…" : "Confirmar transferência"}</button></div>
      </form>
    </dialog>
  </>;
}
