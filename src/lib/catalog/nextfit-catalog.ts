import { getDatabase } from "../db/neon.ts";
import type { NextfitApi, NextfitContractBase } from "../nextfit/types.ts";

let schemaPromise: Promise<void> | undefined;

function ensureCatalogSchema(): Promise<void> {
  if (!schemaPromise) {
    const sql = getDatabase();
    schemaPromise = sql.transaction((tx) => [
      tx`CREATE TABLE IF NOT EXISTS catalog_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source text NOT NULL, external_id text NOT NULL,
        name text NOT NULL, active boolean NOT NULL DEFAULT true, synced_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (source, external_id))`,
      tx`CREATE INDEX IF NOT EXISTS catalog_items_active_name_idx ON catalog_items(source, active, name)`,
      tx`CREATE TABLE IF NOT EXISTS catalog_sync_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source text NOT NULL,
        status text NOT NULL, item_count integer NOT NULL DEFAULT 0,
        completed_at timestamptz NOT NULL DEFAULT now())`,
      tx`CREATE INDEX IF NOT EXISTS catalog_sync_runs_source_completed_idx
        ON catalog_sync_runs(source, completed_at DESC)`,
    ]).then(() => undefined).catch((error) => { schemaPromise = undefined; throw error; });
  }
  return schemaPromise;
}

function normalizeItems(items: NextfitContractBase[]): Array<{ id: string; name: string }> {
  const unique = new Map<string, string>();
  for (const item of items) {
    const name = item.descricao?.replace(/\s+/g, " ").trim();
    if (Number.isFinite(item.id) && name) unique.set(String(item.id), name.slice(0, 240));
  }
  return [...unique].map(([id, name]) => ({ id, name }));
}

export async function syncNextfitCatalog(api: Pick<NextfitApi, "listContractBases">): Promise<number> {
  await ensureCatalogSchema();
  const sql = getDatabase();
  const items = normalizeItems(await api.listContractBases());
  const now = new Date();
  await sql.transaction((tx) => [
    tx`UPDATE catalog_items SET active=false, updated_at=now() WHERE source='nextfit'`,
    ...items.map((item) => tx`INSERT INTO catalog_items (source, external_id, name, active, synced_at)
      VALUES ('nextfit', ${item.id}, ${item.name}, true, ${now})
      ON CONFLICT (source, external_id) DO UPDATE SET name=EXCLUDED.name, active=true,
        synced_at=EXCLUDED.synced_at, updated_at=now()`),
    tx`INSERT INTO catalog_sync_runs (source, status, item_count) VALUES ('nextfit', 'succeeded', ${items.length})`,
  ]);
  return items.length;
}

export async function getNextfitCatalogContext(): Promise<string | undefined> {
  try {
    await ensureCatalogSchema();
    const sql = getDatabase();
    const rows = await sql`SELECT name FROM catalog_items WHERE source='nextfit' AND active=true
      ORDER BY name ASC LIMIT 120` as Array<{ name: string }>;
    if (!rows.length) return undefined;
    return `CATÁLOGO NEXTFIT SINCRONIZADO (confirma somente que estes nomes estão ativos; não deduza preço, duração ou benefício a partir do nome):\n- ${rows.map((row) => row.name).join("\n- ")}`;
  } catch (error) {
    console.warn("Catalog context unavailable", { error: error instanceof Error ? error.name : "UnknownError" });
    return undefined;
  }
}

export const normalizeNextfitCatalogItems = normalizeItems;
