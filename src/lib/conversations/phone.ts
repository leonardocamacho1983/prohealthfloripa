export function normalizePhoneNumber(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) throw new Error("Invalid phone number");
  return `+${digits}`;
}
