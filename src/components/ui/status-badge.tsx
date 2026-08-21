import type { ReactNode } from "react";

export function StatusBadge({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={className} role="status">{children}</span>;
}
