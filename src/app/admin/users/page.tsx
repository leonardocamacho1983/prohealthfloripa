import { clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { parseAppRole } from "@/lib/auth/permissions";
import { canAssignRole, roleLabel } from "@/lib/auth/user-management";
import { AppAuthorizationError, requireAppUser } from "@/lib/handoff/server-auth";

import styles from "./users.module.css";

export const dynamic = "force-dynamic";

type PageParams = { success?: string; error?: string; page?: string; invitePage?: string };
const PAGE_SIZE = 50;
const INVITATION_PAGE_SIZE = 25;

const errorMessage = (value?: string) => ({
  self: "Você não pode remover seu próprio acesso administrativo.",
  self_change: "Você não pode alterar sua própria função.",
  forbidden: "Um administrador não pode alterar a função de um proprietário.",
  owner_protected: "A função de proprietário é protegida e só pode ser alterada diretamente no Clerk.",
  cannot_assign_owner: "Somente um proprietário pode conceder essa função.",
  actor_not_allowed: "Sua função não permite essa alteração.",
  "last-owner": "O último proprietário não pode perder essa função.",
  invalid: "Revise o e-mail e a função informados.",
}[value ?? ""] ?? "Não foi possível concluir. Confira os dados e tente novamente.");

function primaryEmail(user: { primaryEmailAddress?: { emailAddress: string } | null; emailAddresses: Array<{ emailAddress: string }> }) {
  return user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? "Sem e-mail";
}

export default async function UsersPage({ searchParams }: { searchParams: Promise<PageParams> }) {
  let principal;
  try {
    principal = await requireAppUser(["admin", "owner"]);
  } catch (error) {
    if (error instanceof AppAuthorizationError) {
      if (error.status === 401) redirect("/sign-in");
      if (error.status === 403) redirect("/handoff");
    }
    throw error;
  }

  const params = await searchParams;
  const requestedPage = Number.parseInt(params.page ?? "1", 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const requestedInvitePage = Number.parseInt(params.invitePage ?? "1", 10);
  const invitePage = Number.isFinite(requestedInvitePage) && requestedInvitePage > 0 ? requestedInvitePage : 1;
  const client = await clerkClient();
  const [response, invitations] = await Promise.all([
    client.users.getUserList({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, orderBy: "-created_at" }),
    client.invitations.getInvitationList({ limit: INVITATION_PAGE_SIZE,
      offset: (invitePage - 1) * INVITATION_PAGE_SIZE, status: "pending", orderBy: "-created_at" }),
  ]);
  const totalPages = Math.max(1, Math.ceil(response.totalCount / PAGE_SIZE));
  const invitationTotalPages = Math.max(1, Math.ceil(invitations.totalCount / INVITATION_PAGE_SIZE));

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>ProHealth</p><h1>Usuários</h1></div>
      <nav className={styles.nav} aria-label="Navegação administrativa">
        <a href="/handoff">Atendimento</a>
        <a href="/metrics">Indicadores</a>
      </nav>
    </header>

    <div className={styles.content}>
      <section className={styles.card}>
        <h2>Convidar usuário</h2>
        <p className={styles.cardIntro}>O Clerk enviará o acesso por e-mail. A função controla o que a pessoa poderá fazer.</p>
        {params.success === "invited" ? <p className={styles.notice}>Convite enviado.</p> : null}
        {params.error ? <p className={styles.error}>{errorMessage(params.error)}</p> : null}
        <form className={styles.form} action="/api/admin/users/invite" method="post">
          <label>E-mail
            <input type="email" name="email" autoComplete="email" required maxLength={254} placeholder="nome@empresa.com" />
          </label>
          <label>Função
            <select name="role" defaultValue="attendant">
              <option value="attendant">Atendente</option>
              <option value="admin">Administrador</option>
              {principal.role === "owner" ? <option value="owner">Proprietário</option> : null}
            </select>
          </label>
          <button type="submit">Enviar convite</button>
        </form>
      </section>

      <section className={styles.card}>
        <h2>Equipe</h2>
        <p className={styles.cardIntro}>{response.totalCount} {response.totalCount === 1 ? "usuário cadastrado" : "usuários cadastrados"}.</p>
        {params.success === "role" ? <p className={styles.notice}>Função atualizada.</p> : null}
        <div className={styles.users}>
          {response.data.length === 0 ? <p className={styles.empty}>Nenhum usuário encontrado.</p> : response.data.map((user) => {
            const role = parseAppRole(user.publicMetadata.role);
            const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || primaryEmail(user);
            const roleLocked = user.id === principal.userId || role === "owner";
            return <article className={styles.user} key={user.id}>
              <div><strong>{name}{user.id === principal.userId ? " (você)" : ""}</strong><small>{primaryEmail(user)}</small></div>
              {roleLocked ? <span className={styles.roleBadge}>{role ? roleLabel(role) : "Sem função"}</span>
              : <form className={styles.roleForm} action={`/api/admin/users/${user.id}/role`} method="post">
                <label className={styles.srOnly} htmlFor={`role-${user.id}`}>Função de {name}</label>
                <select id={`role-${user.id}`} name="role" defaultValue={role ?? ""} required>
                  {!role ? <option value="" disabled>Sem função</option> : null}
                  <option value="attendant">Atendente</option>
                  <option value="admin">Administrador</option>
                  {principal.role === "owner" ? <option value="owner" disabled={!canAssignRole(principal.role, "owner")}>Proprietário</option> : null}
                </select>
                <button type="submit">Salvar</button>
              </form>}
            </article>;
          })}
        </div>
        {totalPages > 1 ? <nav className={styles.pagination} aria-label="Paginação de usuários">
          {page > 1 ? <a href={`/admin/users?page=${page - 1}`}>Anterior</a> : <span />}
          <span>Página {Math.min(page, totalPages)} de {totalPages}</span>
          {page < totalPages ? <a href={`/admin/users?page=${page + 1}`}>Próxima</a> : <span />}
        </nav> : null}
        {invitations.totalCount > 0 ? <div className={styles.pending}>
          <h3>Convites pendentes ({invitations.totalCount})</h3>
          {invitations.data.map((invitation) => {
            const role = parseAppRole(invitation.publicMetadata?.role);
            return <p key={invitation.id}><span>{invitation.emailAddress}</span>
              <small>{role ? roleLabel(role) : "Sem função"}</small></p>;
          })}
          {invitationTotalPages > 1 ? <nav className={styles.pagination} aria-label="Paginação de convites">
            {invitePage > 1 ? <a href={`/admin/users?page=${page}&invitePage=${invitePage - 1}`}>Anterior</a> : <span />}
            <span>Página {Math.min(invitePage, invitationTotalPages)} de {invitationTotalPages}</span>
            {invitePage < invitationTotalPages
              ? <a href={`/admin/users?page=${page}&invitePage=${invitePage + 1}`}>Próxima</a> : <span />}
          </nav> : null}
        </div> : null}
      </section>
    </div>
  </main>;
}
