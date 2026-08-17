import assert from "node:assert/strict";
import test from "node:test";

import { hasConfiguredHandoffWhatsAppChannel } from "./channels.ts";

test("WhatsApp alerts require both a recipient and an approved template", () => {
  assert.equal(hasConfiguredHandoffWhatsAppChannel({}), false);
  assert.equal(hasConfiguredHandoffWhatsAppChannel({ phone: "5548999999999" }), false);
  assert.equal(hasConfiguredHandoffWhatsAppChannel({ templateName: "handoff_alert" }), false);
  assert.equal(hasConfiguredHandoffWhatsAppChannel({
    phone: " 5548999999999 ",
    templateName: " handoff_alert ",
  }), true);
});
