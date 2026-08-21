import { redirect } from "next/navigation";

import { getAttendantProfile } from "@/lib/attendants/repository";
import { nextShiftStartAt, WEEKDAYS } from "@/lib/attendants/schedule";
import { roleLabel } from "@/lib/auth/user-management";
import { isAppAuthorizationError, requireAppUser } from "@/lib/handoff/server-auth";
import { getNotifierHealth } from "@/lib/notifications/delivery-repository";
import { listNotificationChannels } from "@/lib/notifications/repository";
import { isFeatureEnabled } from "@/lib/feature-flags/repository";
import { getWorkforceConfiguration } from "@/lib/attendants/workforce";

import styles from "./profile.module.css";

export const dynamic = "force-dynamic";

type ProfileParams = {
  saved?: string;
  error?: string;
  template?: string;
  welcome?: string;
  test?: string;
  presence?: string;
};

const errorMessage = (value?: string) => ({
  phone: "Informe um número de WhatsApp válido com DDD.",
  schedule: "Revise os horários. O início deve ser anterior ao fim.",
  unavailable: "Não foi possível salvar o perfil agora.",
  template_account: "Ainda não há uma conta WhatsApp vinculada a uma conversa para criar os modelos.",
  template_config: "A integração Zernio ainda não está configurada neste ambiente.",
  template_failed: "Não foi possível criar ou consultar os modelos no WhatsApp.",
  test_config: "Ative as notificações, informe um WhatsApp e configure a integração antes do teste.",
  test_rate: "Aguarde dez minutos antes de enviar outro teste.",
  test_failed: "O teste falhou. Confira o estado do modelo e tente novamente.",
}[value ?? ""] ?? "Revise os dados e tente novamente.");

export default async function ProfilePage({ searchParams }: { searchParams: Promise<ProfileParams> }) {
  let user;
  try {
    user = await requireAppUser();
  } catch (error) {
    if (isAppAuthorizationError(error)) {
      if (error.status === 401) redirect("/sign-in");
      redirect("/access-denied");
    }
    throw error;
  }

  const params = await searchParams;
  const displayName = user.name?.trim() || user.email?.trim() || "Atendimento";
  const [profile, notifierHealth, channels, workforceEnabled] = await Promise.all([
    getAttendantProfile({ userId: user.userId, displayName }),
    getNotifierHealth(user.userId),
    listNotificationChannels(),
    isFeatureEnabled("workforce_routing"),
  ]);
  const canManageTemplates = user.role === "admin" || user.role === "owner";
  const nextShift = profile.notificationEnabled
    ? nextShiftStartAt(profile.weeklySchedule, new Date(), profile.timezone) : undefined;
  const whatsappChannel = channels.find((item) => item.channel === "whatsapp");
  const workforce = workforceEnabled ? await getWorkforceConfiguration(user.userId) : undefined;
  const workforceState = workforce?.state;
  const readiness = [
    { label: "Função de acesso válida", ready: true },
    { label: "WhatsApp para avisos informado", ready: Boolean(profile.notificationPhone) },
    { label: "Notificações habilitadas", ready: profile.notificationEnabled },
    { label: "Notificação de teste entregue", ready: workforce?.notificationTested ?? Boolean(notifierHealth.lastSentAt) },
    { label: "Ao menos um turno configurado", ready: Object.values(profile.weeklySchedule).some((day) => day.enabled) },
    { label: "Modelos do WhatsApp ativos", ready: whatsappChannel?.status === "enabled" },
  ];
  const formatDate = (value?: Date) => value?.toLocaleString("pt-BR", { timeZone: profile.timezone }) ?? "Ainda não registrado";

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>ProHealth</p><h1>Meu perfil</h1></div>
      <nav className={styles.nav} aria-label="Navegação">
        <a href="/handoff">Atendimento</a>
        {canManageTemplates ? <a href="/admin/users">Usuários</a> : null}
      </nav>
    </header>

    <div className={styles.content}>
      {params.welcome === "1" ? <section className={styles.welcome}>
        <div><strong>Seu acesso está liberado como {roleLabel(user.role)}.</strong>
          <p>Confirme abaixo seu WhatsApp e horário de atendimento antes de abrir a fila.</p></div>
        <a href="/handoff">Ir direto ao atendimento</a>
      </section> : null}

      <section className={styles.card}>
        <h2>Identificação</h2>
        <dl className={styles.identity}>
          <div><dt>Nome</dt><dd>{displayName}</dd></div>
          <div><dt>E-mail</dt><dd>{user.email ?? "Não informado"}</dd></div>
          <div><dt>Função</dt><dd>{roleLabel(user.role)}</dd></div>
          <div><dt>Fuso horário</dt><dd>Florianópolis · America/Sao_Paulo</dd></div>
        </dl>
      </section>

      <section className={styles.card}>
        <h2>Prontidão operacional</h2>
        <p className={styles.intro}>A distribuição automática usa somente perfis com os requisitos essenciais configurados.</p>
        <ul className={styles.readiness}>{readiness.map((item) => <li key={item.label}
          className={item.ready ? styles.ready : styles.pending}>{item.ready ? "✓" : "!"} {item.label}</li>)}</ul>
        {workforceEnabled ? <div className={styles.presence}>
          <p>Estado atual: <strong>{workforceState?.state === "paused" ? "Em pausa"
            : workforceState?.state === "offline" ? "Indisponível" : "Disponível"}</strong></p>
          {params.presence ? <p className={styles.notice}>Disponibilidade atualizada.</p> : null}
          {workforceState?.state === "paused" ? <form action="/api/profile/presence" method="post">
            <input type="hidden" name="action" value="resume" /><button type="submit">Voltar ao atendimento</button></form>
          : <form className={styles.pauseForm} action="/api/profile/presence" method="post">
            <input type="hidden" name="action" value="pause" />
            <label>Minutos<input type="number" name="minutes" min={5} max={480} defaultValue={30} /></label>
            <label>Motivo<input name="reason" maxLength={120} placeholder="Pausa" /></label>
            <button type="submit">Iniciar pausa</button>
          </form>}</div> : null}
      </section>

      <section className={styles.card}>
        <h2>Disponibilidade e notificações</h2>
        <p className={styles.intro}>Avisos chegam apenas durante seu horário. No início de cada turno, você recebe um resumo das conversas pendentes, começando por quem espera há mais tempo.</p>
        {params.saved === "1" ? <p className={styles.notice}>Perfil salvo.</p> : null}
        {params.test === "sent" ? <p className={styles.notice}>Teste enviado para o WhatsApp configurado.</p> : null}
        {params.error ? <p className={styles.error}>{errorMessage(params.error)}</p> : null}
        <form className={styles.form} action="/api/profile" method="post">
          {params.welcome === "1" ? <input type="hidden" name="firstAccess" value="1" /> : null}
          <label>WhatsApp para avisos
            <input type="tel" name="notificationPhone" defaultValue={profile.notificationPhone ?? ""}
              inputMode="tel" autoComplete="tel" placeholder="(48) 99999-9999" maxLength={24} />
          </label>
          <label className={styles.checkRow}>
            <input type="checkbox" name="notificationEnabled" defaultChecked={profile.notificationEnabled} />
            <span>Receber notificações de novos atendimentos e resumo de início de turno</span>
          </label>

          <fieldset className={styles.schedule}>
            <legend>Horário semanal</legend>
            {WEEKDAYS.map((day) => {
              const schedule = profile.weeklySchedule[day.key];
              return <div className={styles.dayRow} key={day.key}>
                <label className={styles.dayToggle}>
                  <input type="checkbox" name={`day_${day.key}_enabled`} defaultChecked={schedule?.enabled} />
                  <span>{day.shortLabel}</span>
                </label>
                <label><span className={styles.srOnly}>Início de {day.label}</span>
                  <input type="time" name={`day_${day.key}_start`} defaultValue={schedule?.start ?? "08:00"} /></label>
                <span aria-hidden="true">até</span>
                <label><span className={styles.srOnly}>Fim de {day.label}</span>
                  <input type="time" name={`day_${day.key}_end`} defaultValue={schedule?.end ?? "18:00"} /></label>
              </div>;
            })}
          </fieldset>
          <button type="submit">Salvar perfil</button>
        </form>
        <div className={styles.notifierHealth}>
          <h3>Saúde do agente notificador</h3>
          <dl>
            <div><dt>Modelos do WhatsApp</dt><dd>{whatsappChannel?.status === "enabled" ? "Aprovados e ativos"
              : whatsappChannel?.status === "disabled" ? "Desativados" : "Configuração ou aprovação pendente"}</dd></div>
            <div><dt>Próximo início de turno</dt><dd>{nextShift ? formatDate(nextShift.at) : "Nenhum turno futuro configurado"}</dd></div>
            <div><dt>Último envio</dt><dd>{formatDate(notifierHealth.lastSentAt)}</dd></div>
            <div><dt>Última falha</dt><dd>{notifierHealth.lastFailedAt
              ? `${formatDate(notifierHealth.lastFailedAt)} · ${notifierHealth.lastErrorCode ?? "falha categorizada"}`
              : "Nenhuma falha registrada"}</dd></div>
          </dl>
          <form action="/api/profile/notification-test" method="post">
            <button className={styles.secondaryButton} type="submit">Enviar notificação de teste</button>
          </form>
        </div>
      </section>

      {canManageTemplates ? <section className={styles.card}>
        <h2>Modelos do WhatsApp</h2>
        <p className={styles.intro}>Cria ou consulta, de forma segura e idempotente, os modelos de passagem de bastão e resumo de início de turno. A aprovação final é feita pela Meta.</p>
        {params.template === "ready" ? <p className={styles.notice}>Modelos verificados. Os já existentes foram preservados.</p> : null}
        {params.template === "pending" ? <p className={styles.notice}>Modelos enviados. Eles ficarão disponíveis após a aprovação da Meta; use este botão novamente para verificar.</p> : null}
        <form action="/api/admin/notifications/templates/ensure" method="post">
          <button className={styles.secondaryButton} type="submit">Criar ou verificar modelos</button>
        </form>
      </section> : null}
    </div>
  </main>;
}
