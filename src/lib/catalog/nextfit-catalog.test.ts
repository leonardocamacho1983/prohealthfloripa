import assert from "node:assert/strict";
import test from "node:test";

import {
  createNextfitCatalogContextCache,
  normalizeNextfitCatalogItems,
  shouldLoadNextfitCatalogContext,
} from "./nextfit-catalog.ts";

test("catalog normalization keeps only confirmed Nextfit names", () => {
  assert.deepEqual(normalizeNextfitCatalogItems([
    { id: 1, descricao: " Pilates 2x  " }, { id: 1, descricao: "Pilates atualizado" },
    { id: 2, descricao: null }, { id: 3, descricao: "Massagem Lomi-Lomi" },
  ]), [{ id: "1", name: "Pilates atualizado" }, { id: "3", name: "Massagem Lomi-Lomi" }]);
});

test("loads the Nextfit catalog only for discovery and active-name confirmation", () => {
  for (const message of [
    "Quais massagens vocês oferecem?",
    "Pode me passar a lista de serviços?",
    "O que a ProHealth tem?",
    "Vocês têm massagem Lomi-Lomi?",
    "Vocês trabalham com shiatsu?",
    "Vocês trabalham com shiatsu",
    "O que vocês oferecem",
    "Esse serviço existe?",
    "Lomi-Lomi é o nome correto?",
  ]) {
    assert.equal(shouldLoadNextfitCatalogContext(message), true, message);
  }
});

test("keeps routine, pricing and scheduling turns off the catalog path", () => {
  for (const message of [
    "Oi, tudo bem?",
    "Quero massagem Relaxante amanhã às 15:30",
    "Quanto custa a massagem Relaxante?",
    "Vocês têm horário amanhã?",
    "Vocês têm horário de Pilates amanhã?",
    "Quais serviços têm horário amanhã?",
    "Quais massagens e preços vocês têm?",
    "Vocês têm desconto no Pilates?",
    "Vocês têm toalhas para a banheira?",
    "Tem ducha depois da massagem?",
    "Tem desconto?",
    "Pode agendar",
    "15:30",
    "Qual é o endereço?",
  ]) {
    assert.equal(shouldLoadNextfitCatalogContext(message), false, message);
  }
});

test("catalog cache reuses active names until its TTL expires", async () => {
  let timestamp = 1_000;
  let loads = 0;
  const cache = createNextfitCatalogContextCache(async () => {
    loads += 1;
    return ["Massagem Relaxante", "Pilates 2x"];
  }, { ttlMs: 100, now: () => timestamp });

  const first = await cache.get();
  const second = await cache.get();
  assert.equal(second, first);
  assert.equal(loads, 1);

  timestamp += 101;
  await cache.get();
  assert.equal(loads, 2);
});

test("catalog cache deduplicates concurrent loads and can be invalidated", async () => {
  let loads = 0;
  const cache = createNextfitCatalogContextCache(async () => {
    loads += 1;
    await Promise.resolve();
    return ["Banheira quente"];
  });

  const [first, second] = await Promise.all([cache.get(), cache.get()]);
  assert.equal(first, second);
  assert.equal(loads, 1);

  cache.clear();
  await cache.get();
  assert.equal(loads, 2);
});

test("catalog cache fails open quickly and deduplicates a loader that never resolves", async () => {
  let loads = 0;
  const cache = createNextfitCatalogContextCache(() => {
    loads += 1;
    return new Promise<string[]>(() => undefined);
  }, { loadTimeoutMs: 5, timeoutCacheTtlMs: 100 });

  const startedAt = Date.now();
  const [first, second] = await Promise.all([cache.get(), cache.get()]);
  assert.equal(first, undefined);
  assert.equal(second, undefined);
  assert.equal(loads, 1);
  assert.ok(Date.now() - startedAt < 100);

  assert.equal(await cache.get(), undefined);
  assert.equal(loads, 1);
});
