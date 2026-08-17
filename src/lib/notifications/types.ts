export type NotificationChannel = "in_app" | "whatsapp";
export type NotificationSeverity = "info" | "warning" | "critical";
export type NotificationStatus = "pending" | "sent" | "failed" | "dismissed" | "suppressed" | "resolved";

export type NotificationCandidate = {
  type: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  dedupeKey: string;
  payload?: Record<string, string | number | boolean | null>;
};

export type NotificationRecord = NotificationCandidate & {
  id: string;
  channel: NotificationChannel;
  status: NotificationStatus;
  occurrenceCount: number;
  lastSeenAt: Date;
  createdAt: Date;
};

export type NotificationChannelSetting = {
  channel: NotificationChannel;
  status: "enabled" | "pending" | "disabled";
  configured: boolean;
  updatedAt: Date;
};
