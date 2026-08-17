import type { AppRole } from "@/lib/auth/permissions";

export type AuditOutcome = "success" | "denied" | "failure";

export type AuditEvent = {
  actorUserId?: string;
  actorRole?: AppRole;
  action: string;
  resourceType: string;
  resourceId?: string;
  outcome: AuditOutcome;
  metadata?: Record<string, unknown>;
};
