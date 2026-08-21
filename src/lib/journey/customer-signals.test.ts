import assert from "node:assert/strict";
import test from "node:test";

import { activeServiceNames, hasActivePilates } from "./customer-signals.ts";

test("reads active Pilates directly from the normalized Nextfit contracts", () => {
  const profile = {
    activeContracts: [
      { name: "PILATES MENSAL 2X SEMANA" },
      { name: "Recovery" },
    ],
  };
  assert.deepEqual(activeServiceNames(profile), ["PILATES MENSAL 2X SEMANA", "Recovery"]);
  assert.equal(hasActivePilates(profile), true);
});

test("falls back to derived Nextfit intelligence and deduplicates names", () => {
  const profile = {
    activeContracts: [{ name: "Pilates 2x" }],
    relationshipMetrics: {
      customerIntelligence: {
        metrics: { activeServices: ["Pilates 2x", "Fisioterapia"] },
      },
    },
  };
  assert.deepEqual(activeServiceNames(profile), ["Pilates 2x", "Fisioterapia"]);
  assert.equal(hasActivePilates(profile), true);
});

test("malformed or missing customer data never invents an active service", () => {
  assert.deepEqual(activeServiceNames({ activeContracts: [null, "private"] }), []);
  assert.equal(hasActivePilates({ relationshipMetrics: { customerIntelligence: "invalid" } }), false);
});
