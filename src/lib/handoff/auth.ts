import { createHmac, timingSafeEqual } from "node:crypto";

export const HANDOFF_COOKIE = "prohealth_handoff_session";

function digest(secret: string): string {
  return createHmac("sha256", secret).update("prohealth-handoff-v1").digest("hex");
}

export function handoffSessionValue(secret: string): string { return digest(secret); }

export function isValidHandoffSession(value: string | undefined, secret: string | undefined): boolean {
  if (!value || !secret) return false;
  const expected = digest(secret);
  const left = Buffer.from(value); const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function isValidHandoffAccessKey(value: string | undefined, secret: string | undefined): boolean {
  if (!value || !secret) return false;
  const left = Buffer.from(createHmac("sha256", secret).update(value).digest("hex"));
  const right = Buffer.from(createHmac("sha256", secret).update(secret).digest("hex"));
  return timingSafeEqual(left, right);
}
