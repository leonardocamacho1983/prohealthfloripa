import { RetryError } from "ai";

export type SafeAiErrorSummary = {
  name: string;
  retryReason?: "maxRetriesExceeded" | "errorNotRetryable" | "abort";
  lastErrorName?: string;
  causeName?: string;
  statusCode?: number;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null
    ? value as UnknownRecord
    : undefined;
}

function safeName(value: unknown): string | undefined {
  const raw = value instanceof Error
    ? value.name
    : asRecord(value)?.name;
  if (typeof raw !== "string") return undefined;
  const normalized = raw.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 80);
  return normalized || undefined;
}

function safeStatusCode(value: unknown): number | undefined {
  const statusCode = asRecord(value)?.statusCode;
  return Number.isInteger(statusCode) && Number(statusCode) >= 100 && Number(statusCode) <= 599
    ? Number(statusCode)
    : undefined;
}

function nestedError(value: unknown, key: "cause" | "lastError"): unknown {
  if (value instanceof Error) return (value as Error & UnknownRecord)[key];
  return asRecord(value)?.[key];
}

/**
 * Returns diagnostic metadata that is safe to write to application logs.
 * Error messages, response bodies, prompts, generated text and token usage are
 * intentionally excluded because they can contain customer or credential data.
 */
export function summarizeAiError(error: unknown): SafeAiErrorSummary {
  const lastError = RetryError.isInstance(error)
    ? error.lastError
    : nestedError(error, "lastError");
  const cause = nestedError(error, "cause");
  const nestedCause = nestedError(lastError, "cause");
  const statusCode = safeStatusCode(error)
    ?? safeStatusCode(lastError)
    ?? safeStatusCode(cause)
    ?? safeStatusCode(nestedCause);

  return {
    name: safeName(error) ?? "UnknownError",
    ...(RetryError.isInstance(error) ? { retryReason: error.reason } : {}),
    ...(safeName(lastError) ? { lastErrorName: safeName(lastError) } : {}),
    ...(safeName(cause) ? { causeName: safeName(cause) } : {}),
    ...(statusCode !== undefined ? { statusCode } : {}),
  };
}
