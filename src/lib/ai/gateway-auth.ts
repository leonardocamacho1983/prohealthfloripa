export function hasAiGatewayCredential(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(environment.AI_GATEWAY_API_KEY?.trim() || environment.VERCEL_OIDC_TOKEN?.trim());
}
