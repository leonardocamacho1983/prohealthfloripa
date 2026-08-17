export function hasConfiguredHandoffWhatsAppChannel(input: {
  phone?: string;
  templateName?: string;
}): boolean {
  return Boolean(input.phone?.trim() && input.templateName?.trim());
}
