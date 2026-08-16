export function normalizePhoneNumber(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) throw new Error("Invalid phone number");
  return `+${digits}`;
}

export function normalizeBrazilianPhoneNumber(value: string): string {
  const digits = value.replace(/\D/g, "").replace(/^0+/, "");
  if (value.trim().startsWith("+")) return normalizePhoneNumber(digits);
  if (digits.length === 10 || digits.length === 11) return normalizePhoneNumber(`55${digits}`);
  return normalizePhoneNumber(digits);
}

export function brazilianPhoneCandidates(value: string): string[] {
  const canonical = normalizeBrazilianPhoneNumber(value);
  const digits = canonical.slice(1);
  const candidates = new Set([canonical]);
  if (digits.startsWith("55") && digits.length === 13 && digits[4] === "9") {
    candidates.add(`+${digits.slice(0, 4)}${digits.slice(5)}`);
  } else if (digits.startsWith("55") && digits.length === 12 && /[6-9]/.test(digits[4] ?? "")) {
    candidates.add(`+${digits.slice(0, 4)}9${digits.slice(4)}`);
  }
  return [...candidates];
}
