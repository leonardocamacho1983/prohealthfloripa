import assert from "node:assert/strict";
import test from "node:test";

import { qualifyMassageServiceNames } from "./massage-service-display.ts";

test("qualifies customer-facing massage technique names", () => {
  assert.equal(
    qualifyMassageServiceNames("A Miofascial é mais direcionada; a Relaxante ajuda a desacelerar."),
    "A Massagem Miofascial é mais direcionada; a Massagem Relaxante ajuda a desacelerar.",
  );
  assert.equal(
    qualifyMassageServiceNames("Thai / Thai Yoga, Lomi-Lomi e Drenagem linfática."),
    "Massagem Thai / Thai Yoga, Massagem Lomi-Lomi e Massagem Drenagem linfática.",
  );
});

test("does not duplicate an existing massage qualifier or rewrite ordinary adjectives", () => {
  assert.equal(
    qualifyMassageServiceNames("Massagem Miofascial e massagem Relaxante."),
    "Massagem Miofascial e massagem Relaxante.",
  );
  assert.equal(
    qualifyMassageServiceNames("Pode ser uma experiência relaxante."),
    "Pode ser uma experiência relaxante.",
  );
});
