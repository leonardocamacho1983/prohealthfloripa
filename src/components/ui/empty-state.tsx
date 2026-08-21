import type { ReactNode } from "react";

export function EmptyState({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return <div className={className}><h2>{title}</h2><p>{children}</p></div>;
}
