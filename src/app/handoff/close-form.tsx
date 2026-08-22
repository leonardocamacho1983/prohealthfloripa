"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import styles from "./handoff.module.css";

export function CloseHandoffForm({ conversationId, reasons, assignmentVersion, inboundRevision }: {
  conversationId: string;
  reasons: Array<{ id: string; label: string }>;
  assignmentVersion: number;
  inboundRevision: number;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/handoff/${conversationId}/close`, {
        method: "POST",
        body: new FormData(event.currentTarget),
      });
      if (!response.ok) {
        setError(response.status === 400
          ? "Escolha um motivo válido para encerrar."
          : response.status === 409
            ? "Chegou uma mensagem nova ou o atendimento mudou. Atualize a página antes de encerrar."
            : "Não foi possível encerrar o atendimento.");
        return;
      }
      dialogRef.current?.close();
      router.replace("/handoff", { scroll: false });
      router.refresh();
    } catch {
      setError("Falha de conexão. Tente novamente.");
    } finally {
      setPending(false);
    }
  };

  return <>
    <button className={styles.close} type="button" onClick={() => dialogRef.current?.showModal()}>
      Encerrar atendimento
    </button>
    <dialog className={styles.closeDialog} ref={dialogRef} aria-labelledby="close-title">
      <form method="dialog" className={styles.closeDialogDismiss}>
        <button type="submit" aria-label="Fechar">×</button>
      </form>
      <form className={styles.closeDialogForm} onSubmit={submit} aria-busy={pending}>
        <input type="hidden" name="expectedAssignmentVersion" value={assignmentVersion} />
        <input type="hidden" name="expectedInboundRevision" value={inboundRevision} />
        <div><p className={styles.eyebrow}>Conclusão do atendimento</p>
          <h2 id="close-title">Por que este atendimento está sendo encerrado?</h2>
          <p>O motivo fica somente na plataforma e ajuda a melhorar a operação.</p></div>
        <label>Motivo de fechamento
          <select name="reasonId" required defaultValue="">
            <option value="" disabled>Selecione um motivo</option>
            {reasons.map((reason) => <option value={reason.id} key={reason.id}>{reason.label}</option>)}
          </select>
        </label>
        <label>Observação interna <span>(opcional)</span>
          <textarea name="note" maxLength={500} rows={3} placeholder="Contexto útil para a equipe" />
        </label>
        {error ? <p className={styles.inlineError} role="alert">{error}</p> : null}
        <div className={styles.closeDialogActions}>
          <button className={styles.secondary} type="button" disabled={pending}
            onClick={() => dialogRef.current?.close()}>Continuar atendimento</button>
          <button className={styles.close} type="submit" disabled={pending}>
            {pending ? "Encerrando…" : "Confirmar encerramento"}
          </button>
        </div>
      </form>
    </dialog>
  </>;
}
