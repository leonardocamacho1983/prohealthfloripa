export const APP_FEATURE_FLAGS = [
  "conversation_transfer",
  "awaiting_customer",
  "sla_engine",
  "cx_surveys",
  "promises",
  "knowledge_publishing",
  "new_app_shell",
  "workforce_routing",
] as const;

export type AppFeatureFlag = (typeof APP_FEATURE_FLAGS)[number];

export type FeatureFlagRecord = {
  key: AppFeatureFlag;
  enabled: boolean;
  config: Record<string, unknown>;
  updatedAt: Date;
};

export function parseAppFeatureFlag(value: unknown): AppFeatureFlag | undefined {
  return typeof value === "string" && APP_FEATURE_FLAGS.includes(value as AppFeatureFlag)
    ? value as AppFeatureFlag
    : undefined;
}
