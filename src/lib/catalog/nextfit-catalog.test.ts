import assert from "node:assert/strict";
import test from "node:test";

import { normalizeNextfitCatalogItems } from "./nextfit-catalog.ts";

test("catalog normalization keeps only confirmed Nextfit names", () => {
  assert.deepEqual(normalizeNextfitCatalogItems([
    { id: 1, descricao: " Pilates 2x  " }, { id: 1, descricao: "Pilates atualizado" },
    { id: 2, descricao: null }, { id: 3, descricao: "Massagem Lomi-Lomi" },
  ]), [{ id: "1", name: "Pilates atualizado" }, { id: "3", name: "Massagem Lomi-Lomi" }]);
});
