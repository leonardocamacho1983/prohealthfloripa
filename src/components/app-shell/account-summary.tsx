export function AccountSummary({ account, role, avatarClassName }: {
  account: string; role: string; avatarClassName?: string }) {
  return <><span className={avatarClassName} aria-hidden="true">{account.slice(0, 1).toUpperCase()}</span>
    <span><strong>{account}</strong><small>{role}</small></span></>;
}
