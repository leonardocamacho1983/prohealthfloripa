import type { CustomerProfile } from "../conversations/types.ts";

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonEmptyName(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function activeServiceNames(profile: CustomerProfile): string[] {
  const names = new Set<string>();
  if (Array.isArray(profile.activeContracts)) {
    for (const item of profile.activeContracts) {
      const name = nonEmptyName(objectRecord(item)?.name);
      if (name) names.add(name);
    }
  }

  const relationship = objectRecord(profile.relationshipMetrics);
  const intelligence = objectRecord(relationship?.customerIntelligence);
  const metrics = objectRecord(intelligence?.metrics);
  if (Array.isArray(metrics?.activeServices)) {
    for (const item of metrics.activeServices) {
      const name = nonEmptyName(item);
      if (name) names.add(name);
    }
  }
  return [...names];
}

export function hasActivePilates(profile: CustomerProfile): boolean {
  return activeServiceNames(profile).some((name) => /\bpilates\b/i.test(name));
}
