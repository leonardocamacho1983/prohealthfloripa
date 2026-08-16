import type { ConversationMessage } from "../conversations/types.ts";

export function buildHandoffSummary(messages: ConversationMessage[], reason: string): string {
  const recent = messages.slice(-6).map((message) => {
    const speaker = message.direction === "inbound" ? "Cliente" : "Agente";
    const content = message.content.replace(/\s+/g, " ").trim().slice(0, 180);
    return `${speaker}: ${content}`;
  });
  return [`Motivo: ${reason}`, ...recent].join("\n").slice(0, 900);
}
