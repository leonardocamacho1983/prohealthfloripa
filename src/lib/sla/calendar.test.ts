import assert from "node:assert/strict";
import test from "node:test";
import { addBusinessMinutes, defaultBusinessCalendar, isBusinessMinute } from "./calendar.ts";

test("SLA crosses the end of the workday without counting the night", () => {
  const calendar = defaultBusinessCalendar();
  assert.equal(addBusinessMinutes(new Date("2026-08-19T20:50:00.000Z"), 20, calendar).toISOString(),
    "2026-08-20T11:10:00.000Z");
});

test("weekends and configured holidays do not consume SLA minutes", () => {
  const calendar = { ...defaultBusinessCalendar(), holidays: ["2026-08-24"] };
  assert.equal(isBusinessMinute(new Date("2026-08-22T15:00:00.000Z"), calendar), false);
  assert.equal(addBusinessMinutes(new Date("2026-08-21T20:59:00.000Z"), 2, calendar).toISOString(),
    "2026-08-25T11:01:00.000Z");
});
