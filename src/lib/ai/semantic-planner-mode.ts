export type SemanticPlannerMode = "off" | "shadow" | "active";

export function parseSemanticPlannerMode(value: string | undefined, vercelEnvironment: string | undefined): SemanticPlannerMode {
  if (value === "off" || value === "shadow" || value === "active") return value;
  return vercelEnvironment === "production" ? "shadow" : "active";
}

export function semanticPlannerMode(): SemanticPlannerMode {
  return parseSemanticPlannerMode(process.env.SEMANTIC_PLANNER_MODE, process.env.VERCEL_ENV);
}
