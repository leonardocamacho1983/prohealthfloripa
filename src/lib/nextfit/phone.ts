import { normalizeBrazilianPhoneNumber } from "../conversations/phone.ts";

export function normalizeBrazilianPhone(ddd?: string | null, phone?: string | null): string | undefined {
  const digits = `${ddd ?? ""}${phone ?? ""}`.replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length !== 10 && digits.length !== 11 && digits.length !== 12 && digits.length !== 13) return undefined;
  try { return normalizeBrazilianPhoneNumber(digits); } catch { return undefined; }
}
