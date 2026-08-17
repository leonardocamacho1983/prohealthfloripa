import type { AppRole } from "./permissions.ts";

export type AppAuthorizationStatus = 401 | 403 | 503;

export function authorizationStatusMessage(status: AppAuthorizationStatus): string {
  if (status === 401) return "Unauthorized";
  if (status === 403) return "Forbidden";
  return "Service Unavailable";
}

export class AppAuthorizationError extends Error {
  readonly status: AppAuthorizationStatus;
  readonly userId?: string;
  readonly role?: AppRole;

  constructor(status: AppAuthorizationStatus, message = authorizationStatusMessage(status), context?: { userId?: string; role?: AppRole }) {
    super(message);
    this.name = "AppAuthorizationError";
    this.status = status;
    this.userId = context?.userId;
    this.role = context?.role;
  }
}

export function isAppAuthorizationError(error: unknown): error is AppAuthorizationError {
  return error instanceof AppAuthorizationError;
}
