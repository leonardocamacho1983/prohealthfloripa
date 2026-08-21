import "server-only";

import { getDatabase } from "@/lib/db/neon";
import { APP_FEATURE_FLAGS, type AppFeatureFlag, type FeatureFlagRecord } from "./types";

let schemaPromise: Promise<void> | undefined;

export function ensureFeatureFlagSchema(): Promise<void> {
  if (!schemaPromise) {
    const sql = getDatabase();
    schemaPromise = sql.transaction((tx) => [
      tx`CREATE TABLE IF NOT EXISTS app_feature_flags (
        key text PRIMARY KEY,
        enabled boolean NOT NULL DEFAULT false,
        config jsonb NOT NULL DEFAULT '{}'::jsonb,
        updated_by_user_id text,
        updated_at timestamptz NOT NULL DEFAULT now())`,
      tx`INSERT INTO app_feature_flags (key, enabled) SELECT value, false
        FROM jsonb_array_elements_text(${JSON.stringify(APP_FEATURE_FLAGS)}::jsonb) value
        ON CONFLICT (key) DO NOTHING`,
    ]).then(() => undefined).catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }
  return schemaPromise;
}

function safeConfig(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function isFeatureEnabled(key: AppFeatureFlag): Promise<boolean> {
  await ensureFeatureFlagSchema();
  const sql = getDatabase();
  const rows = await sql`SELECT enabled FROM app_feature_flags WHERE key=${key} LIMIT 1` as Array<{ enabled: boolean }>;
  return rows[0]?.enabled === true;
}

export async function listFeatureFlags(): Promise<FeatureFlagRecord[]> {
  await ensureFeatureFlagSchema();
  const sql = getDatabase();
  const rows = await sql`SELECT key, enabled, config, updated_at FROM app_feature_flags
    WHERE key IN (SELECT jsonb_array_elements_text(${JSON.stringify(APP_FEATURE_FLAGS)}::jsonb))
    ORDER BY key` as Array<{ key: AppFeatureFlag; enabled: boolean; config: unknown; updated_at: Date | string }>;
  return rows.map((row) => ({ key: row.key, enabled: row.enabled,
    config: safeConfig(row.config), updatedAt: new Date(row.updated_at) }));
}

export async function setFeatureFlag(input: {
  key: AppFeatureFlag;
  enabled: boolean;
  actorUserId: string;
}): Promise<void> {
  await ensureFeatureFlagSchema();
  const sql = getDatabase();
  await sql`UPDATE app_feature_flags SET enabled=${input.enabled},
    updated_by_user_id=${input.actorUserId}, updated_at=now() WHERE key=${input.key}`;
}
