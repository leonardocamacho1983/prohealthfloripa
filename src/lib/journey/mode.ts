export type JourneyEngineMode = "off" | "shadow" | "active";

export function parseJourneyEngineMode(
  value: string | undefined,
  vercelEnvironment: string | undefined,
): JourneyEngineMode {
  if (value === "off" || value === "shadow" || value === "active") return value;
  return vercelEnvironment === "production" ? "shadow" : "active";
}

export function journeyEngineMode(): JourneyEngineMode {
  return parseJourneyEngineMode(
    process.env.JOURNEY_ENGINE_MODE,
    process.env.VERCEL_ENV,
  );
}
