import { ATTENDANT_TIMEZONE, defaultWeeklySchedule, normalizeWeeklySchedule,
  type WeeklySchedule } from "../attendants/schedule.ts";

export type BusinessCalendar = { timezone: string; weeklySchedule: WeeklySchedule; holidays: readonly string[] };

export const defaultBusinessCalendar = (): BusinessCalendar => ({
  timezone: ATTENDANT_TIMEZONE, weeklySchedule: defaultWeeklySchedule(), holidays: [],
});

type LocalMinute = { date: string; weekday: string; minutes: number };
function localMinuteAt(date: Date, timezone: string): LocalMinute | undefined {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric",
      month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit",
      hourCycle: "h23" }).formatToParts(date);
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
    const weekday = { Sun: "0", Mon: "1", Tue: "2", Wed: "3", Thu: "4", Fri: "5", Sat: "6" }[get("weekday")];
    if (weekday === undefined) return undefined;
    return { date: `${get("year")}-${get("month")}-${get("day")}`, weekday,
      minutes: Number(get("hour")) * 60 + Number(get("minute")) };
  } catch { return undefined; }
}
const toMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));

export function isBusinessMinute(date: Date, calendar: BusinessCalendar): boolean {
  const local = localMinuteAt(date, calendar.timezone);
  if (!local || calendar.holidays.includes(local.date)) return false;
  const day = normalizeWeeklySchedule(calendar.weeklySchedule)[local.weekday];
  return Boolean(day?.enabled && local.minutes >= toMinutes(day.start) && local.minutes < toMinutes(day.end));
}

export function addBusinessMinutes(start: Date, minutes: number, calendar: BusinessCalendar): Date {
  if (!Number.isSafeInteger(minutes) || minutes < 0 || minutes > 10080) throw new Error("Invalid business minutes");
  let remaining = minutes;
  let cursor = new Date(start);
  if (remaining === 0) return cursor;
  const maxSteps = 31 * 24 * 60;
  for (let step = 0; step < maxSteps; step += 1) {
    if (isBusinessMinute(cursor, calendar)) remaining -= 1;
    cursor = new Date(cursor.getTime() + 60_000);
    if (remaining === 0) return cursor;
  }
  throw new Error("Business deadline exceeds supported horizon");
}
