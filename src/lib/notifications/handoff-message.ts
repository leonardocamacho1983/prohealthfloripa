export type HandoffDigestItem = {
  reason: string;
  requestedAt: Date;
};

function elapsedLabel(date: Date, now = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60_000));
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

export function buildShiftDigestSummary(items: readonly HandoffDigestItem[], now = new Date()): string {
  const visible = items.slice(0, 8).map((item, index) =>
    `${index + 1}. ${elapsedLabel(item.requestedAt, now)} — ${item.reason.replace(/\s+/g, " ").trim().slice(0, 110)}`);
  if (items.length > visible.length) visible.push(`+ ${items.length - visible.length} conversa(s) na plataforma`);
  return visible.join("\n").slice(0, 900);
}
