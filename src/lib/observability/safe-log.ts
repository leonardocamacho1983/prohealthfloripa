type ProcessingLog = {
  event: string;
  eventId?: string;
  messageId?: string;
  result?: string;
  error?: string;
};

export function logProcessingEvent(level: "info" | "warn" | "error", data: ProcessingLog): void {
  console[level](data.event, {
    ...(data.eventId ? { eventId: data.eventId } : {}),
    ...(data.messageId ? { messageId: data.messageId } : {}),
    ...(data.result ? { result: data.result } : {}),
    ...(data.error ? { error: data.error } : {}),
  });
}
