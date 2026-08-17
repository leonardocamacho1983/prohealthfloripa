import { SignOutButton } from "@clerk/nextjs";
import Link from "next/link";
import { redirect } from "next/navigation";

import { hasPermission } from "@/lib/auth/permissions";
import { NeonConversationRepository } from "@/lib/conversations/neon-repository";
import type { ConversationStatus } from "@/lib/conversations/types";
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

export const dynamic = "force-dynamic";

const timeFormatter = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

const statusLabel: Record<ConversationStatus, string> = {
  active: "Com o agente",
  human_requested: "Aguardando",
  human_active: "Em atendimento",
  closed: "Encerrada",
};

const allowedFilters: InboxFilter[] = ["all", "agent", "waiting", "human", "unread", "stalled", "closed"];
const allowedSorts: InboxSort[] = ["longest_waiting", "recent"];

type InboxSearchParams = {
  conversation?: string;
  filter?: string;
  q?: string;
  sort?: string;
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
  const params = await searchParams;
  const filter: InboxFilter = allowedFilters.includes(params.filter as InboxFilter)
    ? params.filter as InboxFilter
    : "all";
  const sort: InboxSort = allowedSorts.includes(params.sort as InboxSort)
    ? params.sort as InboxSort
    : "longest_waiting";
  const query = params.q?.trim().slice(0, 80) ?? "";
  const now = new Date();

  const repository = new NeonConversationRepository();
  const [conversations, phoneIndex] = await Promise.all([
    repository.listInboxConversations(),
    getInboxPhoneSearchIndex(),
  ]);
  const searchableConversations = conversations.map((item) => ({
    ...item,
    searchablePhone: phoneIndex.get(item.id),
  }));
  const filtered = filterAndSortInbox(searchableConversations, { filter, query, sort, now });
  const selectedId = params.conversation ?? filtered[0]?.id;
  const selected = filtered.find((item) => item.id === selectedId);

  const selectedResources = selected
    ? await Promise.all([
      getInboxCustomerPanel(selected.id),
      listInboxQuickReplies(),
      repository.markHandoffViewed(selected.id),
    ]).then(([panel, replies]) => ({ panel, replies }))
    : { panel: undefined, replies: [] as InboxQuickReply[] };
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
    { value: "agent", label: "Agente" },
    { value: "waiting", label: "Aguardando" },
    { value: "human", label: "Humano" },
    { value: "unread", label: "Não lidas" },
    { value: "stalled", label: "Paradas" },
    { value: "closed", label: "Encerradas" },
  ];

  return <main className={styles.shell}>
    <HandoffLiveRefresh />
    <header className={styles.header}>
      <div className={styles.headerIdentity}><p className={styles.eyebrow}>ProHealth</p><h1>Atendimento</h1></div>
      <div className={styles.headerActions}>
        <span className={styles.queueCount}>{conversations.length} {conversations.length === 1 ? "conversa" : "conversas"}</span>
        {canManage ? <nav className={styles.headerNav} aria-label="Administração"><a className={styles.logout} href="/metrics">Indicadores</a>
          <a className={styles.logout} href="/admin/users">Usuários</a>
          <AsyncActionForm action="/api/catalog/sync" buttonClassName={styles.logout}
            idleLabel="Atualizar catálogo" pendingLabel="Atualizando…" /></nav> : null}
        <SignOutButton redirectUrl="/sign-in"><button className={styles.logout} type="button">Sair</button></SignOutButton>
      </div>
    </header>

    <div className={styles.workspace}>
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

        {filtered.length === 0 ? <div className={styles.empty}>
          <h2>{query ? "Nenhuma conversa encontrada" : "Tudo em dia"}</h2>
          <p>{query ? "Tente buscar por outro nome ou telefone." : "Nenhuma conversa neste filtro."}</p>
        </div> : filtered.map((item) => {
          const stalled = isInboxConversationStalled(item, now);
          return <Link key={item.id} href={linkFor(filter, item.id)}
            data-conversation-link="true"
            className={`${styles.queueItem} ${item.id === selected?.id ? styles.selected : ""}`}
            aria-current={item.id === selected?.id ? "page" : undefined}>
            <span className={styles.avatar}>{(item.firstName?.[0] ?? "C").toUpperCase()}</span>
            <span><strong>{item.firstName ?? "Cliente"}</strong>
              <small>{item.messages.at(-1)?.content ?? item.reason ?? "Sem mensagens"}</small>
              <span className={styles.rowLabels}>
                <em className={`${styles.rowStatus} ${styles[`status_${item.status}`]}`}>{statusLabel[item.status]}</em>
                {stalled ? <em className={styles.stalledLabel}>Parada</em> : null}
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
            <div className={styles.detailHeader}>
              <div><h2>{selected.firstName ?? "Cliente"}</h2>
                <p>{selected.maskedPhone} · última atividade <time dateTime={selected.lastActivityAt.toISOString()}>
                  {formatElapsed(selected.lastActivityAt, now)}</time></p></div>
              <span className={`${styles.status} ${styles[`status_${selected.status}`]}`}>{statusLabel[selected.status]}</span>
            </div>
            {selected.status === "human_requested" || selected.status === "human_active" ? <div className={styles.summary}>
              <strong>Resumo para atendimento</strong><p>{selected.summary}</p>
            </div> : null}
            <div className={styles.messages}>{selected.messages.map((message) => <div key={message.id}
              className={message.direction === "inbound" ? styles.inbound : styles.outbound}>
              <p>{message.content}</p><time dateTime={message.createdAt.toISOString()}>
                {timeFormatter.format(message.createdAt)}</time>
            </div>)}</div>
            {canOperate ? <div className={styles.actions}>
              {selected.status === "active" ? <AsyncActionForm action={`/api/handoff/${selected.id}/assume`}
                buttonClassName={styles.secondary} idleLabel="Assumir conversa" pendingLabel="Assumindo…" /> : null}
              {selected.status === "human_requested" ? <AsyncActionForm action={`/api/handoff/${selected.id}/take`}
                buttonClassName={styles.secondary} idleLabel="Assumir conversa" pendingLabel="Assumindo…" /> : null}
              {selected.status === "human_requested" || selected.status === "human_active"
                ? <CloseHandoffForm conversationId={selected.id} />
                : null}
            </div> : null}
            {canOperate && (selected.status === "human_requested" || selected.status === "human_active")
              ? <QuickReplyComposer conversationId={selected.id} quickReplies={quickReplies} />
              : <div className={styles.readOnlyNote}>{!canOperate
                ? "Acesso em modo leitura."
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
