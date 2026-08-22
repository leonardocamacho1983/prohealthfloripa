import { SignOutButton } from "@clerk/nextjs";
import Link from "next/link";
import { redirect } from "next/navigation";

import { hasPermission } from "@/lib/auth/permissions";
import { roleLabel } from "@/lib/auth/user-management";
import { NeonConversationRepository } from "@/lib/conversations/neon-repository";
import { isAppAuthorizationError, requireAppUser } from "@/lib/handoff/server-auth";
import {
  filterAndSortInbox,
  formatElapsed,
  isInboxConversationStalled,
  matchesInboxFilter,
  type InboxFilter,
  type InboxSort,
} from "@/lib/inbox/productivity";
import {
  getInboxCustomerPanel,
  getInboxPhoneSearchIndex,
  listInboxQuickReplies,
  type InboxQuickReply,
} from "@/lib/inbox/repository";
import { AsyncActionForm } from "./async-action-form";
import { CloseHandoffForm } from "./close-form";
import { CustomerPanel } from "./customer-panel";
import styles from "./handoff.module.css";
import { HandoffLiveRefresh } from "./handoff-live";
import { QueueLinkStatus } from "./queue-link-status";
import { QuickReplyComposer } from "./quick-reply-composer";
import { ConversationViewed } from "./conversation-viewed";
import { listConversationReasons } from "@/lib/reasons/repository";
import { isFeatureEnabled } from "@/lib/feature-flags/repository";
import { listTransferCandidates, type TransferCandidate } from "@/lib/attendants/directory";
import { AwaitingCustomerActions } from "./awaiting-customer-actions";
import { TransferHandoffForm } from "./transfer-form";
import { listConversationPromises } from "@/lib/promises/repository";
import { PromisePanel } from "./promise-panel";
import { workflowStatusLabel } from "@/lib/ui/state-labels";
import { AccountSummary } from "@/components/app-shell/account-summary";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

const attendantWorkflowLabel = (input: { status: "active" | "human_requested" | "human_active" | "closed";
  awaitingCustomer: boolean; assignedToViewer: boolean }) => {
  if (input.awaitingCustomer) return "Aguardando cliente";
  if (input.status === "human_requested" && input.assignedToViewer) return "Atribuída — aguardando aceite";
  return workflowStatusLabel({ status: input.status });
};

const timeFormatter = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

const allowedFilters: InboxFilter[] = ["all", "mine", "unassigned", "team", "agent", "waiting", "customer_waiting", "human", "unread", "stalled", "closed"];
const allowedSorts: InboxSort[] = ["longest_waiting", "recent"];

type InboxSearchParams = {
  conversation?: string;
  filter?: string;
  q?: string;
  sort?: string;
  welcome?: string;
};

export default async function HandoffPage({ searchParams }: { searchParams: Promise<InboxSearchParams> }) {
  let appUser;
  try {
    appUser = await requireAppUser();
  } catch (error) {
    if (isAppAuthorizationError(error)) {
      if (error.status === 401) redirect("/sign-in");
      if (error.status === 403) redirect("/access-denied");
    }
    throw error;
  }
  const canOperate = hasPermission(appUser.role, "handoff:reply");
  const canManage = appUser.role === "admin" || appUser.role === "owner";
  const canReturnToAgent = hasPermission(appUser.role, "handoff:return_to_agent");
  const params = await searchParams;
  const activeAccount = appUser.email?.trim() || appUser.name?.trim() || "Conta ativa";
  const filter: InboxFilter = allowedFilters.includes(params.filter as InboxFilter)
    ? params.filter as InboxFilter
    : "all";
  const sort: InboxSort = allowedSorts.includes(params.sort as InboxSort)
    ? params.sort as InboxSort
    : "longest_waiting";
  const query = params.q?.trim().slice(0, 80) ?? "";
  const now = new Date();

  const repository = new NeonConversationRepository();
  const [conversations, phoneIndex, closureReasons, transferEnabled, awaitingCustomerEnabled, promisesEnabled] = await Promise.all([
    repository.listInboxConversations(100, appUser.userId),
    getInboxPhoneSearchIndex(),
    listConversationReasons({ category: "human_closure", activeOnly: true }),
    isFeatureEnabled("conversation_transfer"),
    isFeatureEnabled("awaiting_customer"),
    isFeatureEnabled("promises"),
  ]);
  const searchableConversations = conversations.map((item) => ({
    ...item,
    searchablePhone: phoneIndex.get(item.id),
  }));
  const filtered = filterAndSortInbox(searchableConversations, { filter, query, sort, now });
  const selectedId = params.conversation ?? filtered[0]?.id;
  const selected = filtered.find((item) => item.id === selectedId);

  const canForceTransfer = hasPermission(appUser.role, "handoff:force_transfer");
  const canTransferSelected = Boolean(selected && selected.status !== "closed" && transferEnabled
    && (selected.assignedAttendantUserId === appUser.userId || canForceTransfer));
  const selectedResources = selected
    ? await Promise.all([
      getInboxCustomerPanel(selected.id),
      listInboxQuickReplies(),
      canTransferSelected
        ? listTransferCandidates(selected.assignedAttendantUserId === appUser.userId ? appUser.userId : undefined)
        : Promise.resolve([] as TransferCandidate[]),
      canTransferSelected
        ? listConversationReasons({ category: "handoff", activeOnly: true })
        : Promise.resolve([]),
      promisesEnabled ? listConversationPromises(selected.id) : Promise.resolve([]),
    ]).then(([panel, replies, transferCandidates, transferReasons, promises]) => ({ panel, replies,
      transferCandidates, transferReasons, promises }))
    : { panel: undefined, replies: [] as InboxQuickReply[], transferCandidates: [] as TransferCandidate[],
      transferReasons: [], promises: [] };
  const customerPanel = selectedResources.panel;
  const quickReplies = selectedResources.replies;

  const countFor = (nextFilter: InboxFilter) => searchableConversations
    .filter((item) => matchesInboxFilter(item, nextFilter, now)).length;
  const linkFor = (nextFilter: InboxFilter, conversation?: string, nextQuery = query, nextSort = sort) => {
    const next = new URLSearchParams({ filter: nextFilter, sort: nextSort });
    if (nextQuery) next.set("q", nextQuery);
    if (conversation) next.set("conversation", conversation);
    return `/handoff?${next.toString()}`;
  };
  const returnTo = selected ? linkFor(filter, selected.id) : linkFor(filter);

  const filterLinks: Array<{ value: InboxFilter; label: string }> = [
    { value: "all", label: "Todas" },
    { value: "mine", label: "Minhas" },
    { value: "unassigned", label: "Sem responsável" },
    { value: "team", label: "Equipe" },
    { value: "agent", label: "Agente" },
    { value: "waiting", label: "Aguardando" },
    { value: "customer_waiting", label: "Aguardando cliente" },
    { value: "human", label: "Humano" },
    { value: "unread", label: "Não lidas" },
    { value: "stalled", label: "Paradas" },
    { value: "closed", label: "Encerradas" },
  ];

  return <main className={styles.shell}>
    <HandoffLiveRefresh />
    <header className={styles.header}>
      <div className={styles.headerIdentity}><p className={styles.eyebrow}>ProHealth</p>
        <div className={styles.headerTitleRow}><h1>Atendimento</h1>
          <span className={styles.queueCount}>{conversations.length} {conversations.length === 1 ? "conversa" : "conversas"}</span>
        </div></div>
      <div className={styles.headerActions}>
        {canManage ? <nav className={styles.headerNav} aria-label="Navegação principal">
          <a className={styles.primaryNavLink} href="/metrics">Indicadores</a>
          <details className={styles.menuDetails}>
            <summary className={styles.menuSummary}>Administração <span aria-hidden="true">⌄</span></summary>
            <div className={styles.menuPanel}>
              <p className={styles.menuSectionTitle}>Configuração da operação</p>
              <a className={styles.menuLink} href="/admin/users"><span>Usuários</span><small>Acessos e funções</small></a>
              <a className={styles.menuLink} href="/admin/reasons"><span>Motivos</span><small>Transferência e encerramento</small></a>
              <a className={styles.menuLink} href="/admin/workforce"><span>Equipe</span><small>Escalas e capacidade</small></a>
              <a className={styles.menuLink} href="/admin/features"><span>Recursos</span><small>Ativação segura</small></a>
              <p className={styles.menuSectionTitle}>Qualidade e inteligência</p>
              <a className={styles.menuLink} href="/admin/knowledge"><span>Conhecimento</span><small>Conteúdo do agente</small></a>
              <a className={styles.menuLink} href="/admin/cx"><span>CX</span><small>Pesquisas e resultados</small></a>
              <a className={styles.menuLink} href="/admin/training"><span>Treinamentos</span><small>Desenvolvimento da equipe</small></a>
              <AsyncActionForm action="/api/catalog/sync" buttonClassName={styles.menuAction}
                idleLabel="Atualizar catálogo" pendingLabel="Atualizando…" />
            </div>
          </details>
        </nav> : null}
        <details className={`${styles.menuDetails} ${styles.accountMenu}`}>
          <summary className={styles.accountSummary} aria-label={`Menu da conta ${activeAccount}`}>
            <AccountSummary account={activeAccount} role={roleLabel(appUser.role)} avatarClassName={styles.accountAvatar} />
            <span className={styles.accountChevron} aria-hidden="true">⌄</span>
          </summary>
          <div className={`${styles.menuPanel} ${styles.accountPanel}`}>
            <a className={styles.menuLink} href="/profile"><span>Meu perfil</span><small>Horários e notificações</small></a>
            <SignOutButton redirectUrl="/sign-in"><button className={styles.signOutAction} type="button">Sair da conta</button></SignOutButton>
          </div>
        </details>
      </div>
    </header>

    {params.welcome === "1" ? <div className={styles.welcomeBanner} role="status">
      <span><strong>Perfil salvo.</strong> Você está conectado como {activeAccount} · {roleLabel(appUser.role)}.</span>
      <a href="/profile">Revisar perfil</a>
    </div> : null}

    <div className={`${styles.workspace} ${selected ? styles.hasSelection : ""}`}>
      <aside className={styles.queue} aria-label="Conversas">
        <form className={styles.searchForm} action="/handoff" method="get">
          <input type="hidden" name="filter" value={filter} />
          <label className={styles.srOnly} htmlFor="inbox-search">Buscar por nome ou telefone</label>
          <input id="inbox-search" type="search" name="q" defaultValue={query} maxLength={80}
            placeholder="Buscar nome ou telefone" />
          <label className={styles.srOnly} htmlFor="inbox-sort">Ordenar conversas</label>
          <select id="inbox-sort" name="sort" defaultValue={sort}>
            <option value="longest_waiting">Maior espera</option>
            <option value="recent">Mais recentes</option>
          </select>
          <button type="submit">Aplicar</button>
          {query ? <a href={linkFor(filter, undefined, "")}>Limpar busca</a> : null}
        </form>

        <nav className={styles.filters} aria-label="Filtrar conversas">
          {filterLinks.map((item) => <a key={item.value}
            className={filter === item.value ? styles.filterActive : ""} href={linkFor(item.value)}
            aria-current={filter === item.value ? "page" : undefined}>
            {item.label} <span>{countFor(item.value)}</span>
          </a>)}
        </nav>

        {filtered.length === 0 ? <EmptyState className={styles.empty}
          title={query ? "Nenhuma conversa encontrada" : "Tudo em dia"}>
          {query ? "Tente buscar por outro nome ou telefone." : "Nenhuma conversa neste filtro."}
        </EmptyState> : filtered.map((item) => {
          const stalled = isInboxConversationStalled(item, now);
          return <Link key={item.id} href={linkFor(filter, item.id)}
            data-conversation-link="true"
            className={`${styles.queueItem} ${item.id === selected?.id ? styles.selected : ""}`}
            aria-current={item.id === selected?.id ? "page" : undefined}>
            <span className={styles.avatar}>{(item.firstName?.[0] ?? "C").toUpperCase()}</span>
            <span><strong>{item.firstName ?? "Cliente"}</strong>
              <small>{item.messages.at(-1)?.content ?? item.reason ?? "Sem mensagens"}</small>
              <span className={styles.rowLabels}>
                <em className={`${styles.rowStatus} ${item.awaitingCustomerSince ? styles.status_awaiting_customer : styles[`status_${item.status}`]}`}>
                  {attendantWorkflowLabel({ status: item.status, awaitingCustomer: Boolean(item.awaitingCustomerSince),
                    assignedToViewer: item.assignedAttendantUserId === appUser.userId })}</em>
                {item.assignedAttendantUserId ? <em className={styles.ownerLabel}>
                  {item.assignedAttendantUserId === appUser.userId ? "Com você" : "Atribuída"}
                </em> : null}
                {stalled ? <em className={styles.stalledLabel}>Parada</em> : null}
                {item.slaStatus === "warning" || item.slaStatus === "breached"
                  ? <em className={item.slaStatus === "breached" ? styles.slaBreached : styles.slaWarning}>
                    {item.slaStatus === "breached" ? "SLA vencido" : "SLA em atenção"}</em> : null}
                {item.openPromiseCount ? <em className={styles.ownerLabel}>{item.openPromiseCount} pendência(s)</em> : null}
                {item.notificationFailure ? <em className={styles.slaWarning}>Falha no aviso</em> : null}
              </span>
            </span>
            <span className={styles.queueMeta}><time dateTime={item.lastActivityAt.toISOString()}>
              {formatElapsed(item.lastActivityAt, now)}</time>
              {item.id !== selected?.id && item.unreadCount > 0
                ? <b aria-label={`${item.unreadCount} mensagens novas`}>{item.unreadCount}</b>
                : null}
              <QueueLinkStatus />
            </span>
          </Link>;
        })}
      </aside>

      <div key={selected?.id ?? "no-selection"} className={styles.conversationWorkspace}>
        <section className={styles.detail}>
          {!selected ? <div className={styles.noSelection}><h2>Nenhuma conversa selecionada</h2>
            <p>As conversas do agente e os atendimentos humanos aparecerão aqui.</p></div> : <>
            <ConversationViewed conversationId={selected.id} />
            <div className={styles.detailHeader}>
              <div><a className={styles.mobileBack} href={linkFor(filter)}>← Voltar às conversas</a>
                <h2>{selected.firstName ?? "Cliente"}</h2>
                <p>{selected.maskedPhone} · última atividade <time dateTime={selected.lastActivityAt.toISOString()}>
                  {formatElapsed(selected.lastActivityAt, now)}</time></p>
                {selected.assignedAttendantUserId ? <p className={styles.ownerLine}>
                  Responsável: {selected.assignedAttendantUserId === appUser.userId
                    ? activeAccount : selected.assignedAttendantName ?? "outro atendente"}
                </p> : <p className={styles.ownerLine}>Sem responsável</p>}</div>
              <span className={`${styles.status} ${selected.awaitingCustomerSince ? styles.status_awaiting_customer : styles[`status_${selected.status}`]}`}>
                {attendantWorkflowLabel({ status: selected.status,
                  awaitingCustomer: Boolean(selected.awaitingCustomerSince),
                  assignedToViewer: selected.assignedAttendantUserId === appUser.userId })}</span>
            </div>
            {selected.status === "human_requested" || selected.status === "human_active" ? <div className={styles.summary}>
              <strong>Resumo para atendimento</strong><p>{selected.summary}</p>
            </div> : null}
            {promisesEnabled ? <PromisePanel conversationId={selected.id}
              items={selectedResources.promises.map((item) => ({ id: item.id, description: item.description,
                dueAt: item.dueAt.toISOString(), status: item.status }))}
              canEdit={canOperate && selected.status === "human_active"
                && selected.assignedAttendantUserId === appUser.userId} /> : null}
            <div className={styles.messages}>{selected.messages.map((message) => <div key={message.id}
              className={message.kind === "workflow_event" ? styles.workflowEvent
                : message.direction === "inbound" ? styles.inbound : styles.outbound}>
              {message.actorLabel ? <strong className={styles.messageAuthor}>{message.actorLabel}</strong> : null}
              <p>{message.content}</p><time dateTime={message.createdAt.toISOString()}>
                {timeFormatter.format(message.createdAt)}</time>
            </div>)}</div>
            {canOperate ? <div className={styles.actions}>
              {canReturnToAgent && (selected.status === "human_requested" || selected.status === "human_active")
                  && (hasPermission(appUser.role, "handoff:force_transfer")
                    || selected.assignedAttendantUserId === appUser.userId)
                ? <AsyncActionForm action={`/api/handoff/${selected.id}/return-to-agent`}
                  buttonClassName={styles.secondary} idleLabel="Devolver conversa ao agente"
                  pendingLabel="Devolvendo…"
                  hiddenFields={{ expectedAssignmentVersion: selected.assignmentVersion }}
                  confirmMessage="Devolver esta conversa ao atendimento automático?" /> : null}
              {selected.status === "active" && (!selected.assignedAttendantUserId || selected.assignedAttendantUserId === appUser.userId)
                ? <AsyncActionForm action={`/api/handoff/${selected.id}/assume`}
                buttonClassName={styles.secondary} idleLabel="Assumir conversa" pendingLabel="Assumindo…" /> : null}
              {selected.status === "human_requested" && (!selected.assignedAttendantUserId || selected.assignedAttendantUserId === appUser.userId)
                ? <AsyncActionForm action={`/api/handoff/${selected.id}/take`}
                buttonClassName={styles.secondary} idleLabel="Assumir conversa" pendingLabel="Assumindo…" /> : null}
              {selected.status === "human_active" && selected.assignedAttendantUserId === appUser.userId
                ? <><CloseHandoffForm conversationId={selected.id} reasons={closureReasons}
                  assignmentVersion={selected.assignmentVersion} inboundRevision={selected.inboundRevision} />
                  {awaitingCustomerEnabled ? <AwaitingCustomerActions conversationId={selected.id}
                    assignmentVersion={selected.assignmentVersion} awaiting={Boolean(selected.awaitingCustomerSince)} /> : null}</>
                : null}
              {canTransferSelected ? <TransferHandoffForm conversationId={selected.id}
                assignmentVersion={selected.assignmentVersion} candidates={selectedResources.transferCandidates}
                reasons={selectedResources.transferReasons} /> : null}
            </div> : null}
            {canOperate && (selected.status === "human_requested" || selected.status === "human_active")
              && (!selected.assignedAttendantUserId || selected.assignedAttendantUserId === appUser.userId)
              ? <QuickReplyComposer conversationId={selected.id} quickReplies={quickReplies}
                assignmentVersion={selected.assignmentVersion} assumesConversation={selected.status === "human_requested"} />
              : <div className={styles.readOnlyNote}>{!canOperate
                ? "Acesso em modo leitura."
                : selected.assignedAttendantUserId && selected.assignedAttendantUserId !== appUser.userId
                  ? "Esta conversa está atribuída a outro atendente."
                : selected.status === "active"
                  ? "O agente continua respondendo. Assuma a conversa para falar com o cliente."
                  : "Conversa encerrada disponível apenas para consulta."}</div>}
          </>}
        </section>
        {selected ? <CustomerPanel conversationId={selected.id} panel={customerPanel} quickReplies={quickReplies}
          returnTo={returnTo} canOperate={canOperate} now={now} /> : null}
      </div>
    </div>
  </main>;
}
