import { getDatabase } from "../db/neon.ts";
import type { NextfitApi, NextfitContractBase } from "../nextfit/types.ts";

let schemaPromise: Promise<void> | undefined;
const CATALOG_CONTEXT_CACHE_TTL_MS = 5 * 60 * 1000;
export const NEXTFIT_CATALOG_LOAD_TIMEOUT_MS = 500;
const CATALOG_TIMEOUT_CACHE_TTL_MS = 10 * 1000;

type CatalogContextCache = {
  get: () => Promise<string | undefined>;
  clear: () => void;
};

function formatCatalogContext(names: string[]): string | undefined {
  if (!names.length) return undefined;
  return `CATÁLOGO NEXTFIT SINCRONIZADO (confirma somente que estes nomes estão ativos; não deduza preço, duração ou benefício a partir do nome):\n- ${names.join("\n- ")}`;
}

export function createNextfitCatalogContextCache(
  loadActiveNames: () => Promise<string[]>,
  options: { ttlMs?: number; loadTimeoutMs?: number; timeoutCacheTtlMs?: number; now?: () => number } = {},
): CatalogContextCache {
  const ttlMs = options.ttlMs ?? CATALOG_CONTEXT_CACHE_TTL_MS;
  const loadTimeoutMs = options.loadTimeoutMs ?? NEXTFIT_CATALOG_LOAD_TIMEOUT_MS;
  const timeoutCacheTtlMs = options.timeoutCacheTtlMs ?? CATALOG_TIMEOUT_CACHE_TTL_MS;
  const now = options.now ?? Date.now;
  let cached: { value: string | undefined; expiresAt: number } | undefined;
  let inFlight: Promise<string | undefined> | undefined;
  let generation = 0;

  return {
    async get() {
      const timestamp = now();
      if (cached && cached.expiresAt > timestamp) return cached.value;
      if (inFlight) return inFlight;

      const loadGeneration = generation;
      const loader = Promise.resolve().then(loadActiveNames);
      const boundedLoader = new Promise<string[] | undefined>((resolve, reject) => {
        const timer = setTimeout(() => resolve(undefined), loadTimeoutMs);
        loader.then(
          (names) => { clearTimeout(timer); resolve(names); },
          (error) => { clearTimeout(timer); reject(error); },
        );
      });
      inFlight = boundedLoader
        .then((names) => {
          const timedOut = names === undefined;
          const value = timedOut ? undefined : formatCatalogContext(names);
          if (generation === loadGeneration) {
            cached = { value, expiresAt: now() + (timedOut ? timeoutCacheTtlMs : ttlMs) };
          }
          return value;
        })
        .finally(() => { inFlight = undefined; });
      return inFlight;
    },
    clear() {
      generation += 1;
      cached = undefined;
    },
  };
}

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

function normalizeIntentText(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

const CATALOG_DISCOVERY = /\b(?:catalogo|lista\s+de\s+(?:servicos|massagens|modalidades|aulas|planos)|quais?\s+(?:tipos?\s+de\s+)?(?:servicos|massagens|modalidades|aulas|planos)|quais?\s+opcoes|o\s+que\s+(?:voces?|a\s+pro\s*health)\s+(?:tem|oferece(?:m)?|faz(?:em)?))\b/;
const SERVICE_TERM = /\b(?:servico|massagem|pilates|banheira|banho|recovery|recuperacao|fisioterapia|acupuntura|drenagem|terapia|modalidade|aula|plano)\b/;
const PROVIDER_OFFER_VERB = /\b(?:voces?|a\s+pro\s*health)\s+(?:tem|oferece(?:m)?|faz(?:em)?|trabalha(?:m)?\s+com)\b/;
const BARE_OFFER_VERB = /^(?:tem|oferece(?:m)?|faz(?:em)?|trabalha(?:m)?\s+com)\b/;
const NAME_CONFIRMATION = /\b(?:qual\s+(?:e\s+)?o\s+nome|nome\s+(?:certo|correto)|como\s+(?:se\s+)?chama|esta\s+no\s+catalogo|esse\s+servico\s+existe)\b/;
const SCHEDULING_OR_FACT_ONLY = /\b(?:horarios?|agendas?|vagas?|amanha|hoje|precos?|valores?|custam?|descontos?|enderecos?|estacionamento|roupas?\s+de\s+banho|toalhas?|duchas?|chuveiros?|secadores?|vestiarios?)\b/;

/**
 * Decides whether a turn needs the synchronized list of active Nextfit names.
 * Prices, scheduling, known-service details and social turns deliberately stay
 * on the fast path; the catalog is useful only for discovery or confirmation.
 */
export function shouldLoadNextfitCatalogContext(message: string): boolean {
  const text = normalizeIntentText(message);
  if (!text) return false;
  // A service term can be only context for a scheduling, price or amenities
  // question. Keep those turns off the catalog path even when they start with
  // "vocês têm".
  if (SCHEDULING_OR_FACT_ONLY.test(text)) return false;
  if (CATALOG_DISCOVERY.test(text) || NAME_CONFIRMATION.test(text)) return true;

  const asksWhetherOffered = PROVIDER_OFFER_VERB.test(text) || BARE_OFFER_VERB.test(text);
  if (asksWhetherOffered && SERVICE_TERM.test(text)) return true;

  // Also cover unknown technique names ("Vocês têm shiatsu?") without turning
  // operational availability or facility questions into a catalog lookup.
  if (asksWhetherOffered) return true;
  return false;
}

async function loadActiveCatalogNames(): Promise<string[]> {
  await ensureCatalogSchema();
  const sql = getDatabase();
  const rows = await sql`SELECT name FROM catalog_items WHERE source='nextfit' AND active=true
    ORDER BY name ASC LIMIT 120` as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

const catalogContextCache = createNextfitCatalogContextCache(loadActiveCatalogNames);

export async function syncNextfitCatalog(api: Pick<NextfitApi, "listContractBases">): Promise<number> {
  await ensureCatalogSchema();
  const sql = getDatabase();
  try {
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
    catalogContextCache.clear();
    return items.length;
  } catch (error) {
    try {
      await sql`INSERT INTO catalog_sync_runs (source, status, item_count) VALUES ('nextfit', 'failed', 0)`;
    } catch (persistenceError) {
      console.warn("Catalog sync failure could not be recorded", {
        error: persistenceError instanceof Error ? persistenceError.name : "UnknownError",
      });
    }
    console.warn("Nextfit catalog sync failed", { error: error instanceof Error ? error.name : "UnknownError" });
    throw error;
  }
}

export async function getNextfitCatalogContext(): Promise<string | undefined> {
  try {
    return await catalogContextCache.get();
  } catch (error) {
    console.warn("Catalog context unavailable", { error: error instanceof Error ? error.name : "UnknownError" });
    return undefined;
  }
}

export async function getNextfitCatalogContextForMessage(message: string): Promise<string | undefined> {
  if (!shouldLoadNextfitCatalogContext(message)) return undefined;
  return getNextfitCatalogContext();
}

export const normalizeNextfitCatalogItems = normalizeItems;
