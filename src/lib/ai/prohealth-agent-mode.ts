export type ProHealthAgentMode = "off" | "active";

export function parseProHealthAgentMode(value: string | undefined, vercelEnvironment: string | undefined): ProHealthAgentMode {
  if (value === "off" || value === "active") return value;
  return vercelEnvironment === "preview" ? "active" : "off";
}

export function proHealthAgentMode(): ProHealthAgentMode {
  return parseProHealthAgentMode(process.env.PROHEALTH_AGENT_MODE, process.env.VERCEL_ENV);
}
