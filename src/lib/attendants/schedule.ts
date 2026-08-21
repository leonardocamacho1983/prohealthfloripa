export const ATTENDANT_TIMEZONE = "America/Sao_Paulo";

export type WorkdaySchedule = {
  enabled: boolean;
  start: string;
  end: string;
};

export type WeeklySchedule = Record<string, WorkdaySchedule>;

export const WEEKDAYS = [
  { key: "1", shortLabel: "Seg", label: "Segunda-feira" },
  { key: "2", shortLabel: "Ter", label: "Terça-feira" },
  { key: "3", shortLabel: "Qua", label: "Quarta-feira" },
  { key: "4", shortLabel: "Qui", label: "Quinta-feira" },
  { key: "5", shortLabel: "Sex", label: "Sexta-feira" },
  { key: "6", shortLabel: "Sáb", label: "Sábado" },
  { key: "0", shortLabel: "Dom", label: "Domingo" },
] as const;

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DATE_TIME_LOCAL_PATTERN = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/;

export function parseSaoPauloDateTimeLocal(value: string): Date | undefined {
  if (!DATE_TIME_LOCAL_PATTERN.test(value)) return undefined;
  const date = new Date(`${value}:00-03:00`);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

export function defaultWeeklySchedule(): WeeklySchedule {
  return Object.fromEntries(WEEKDAYS.map(({ key }) => [key, {
    enabled: Number(key) >= 1 && Number(key) <= 5,
    start: "08:00",
    end: "18:00",
  }]));
}

export function normalizeWeeklySchedule(value: unknown): WeeklySchedule {
  const defaults = defaultWeeklySchedule();
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;
  const input = value as Record<string, unknown>;
  return Object.fromEntries(WEEKDAYS.map(({ key }) => {
    const candidate = input[key];
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [key, defaults[key]];
    const record = candidate as Record<string, unknown>;
    const start = typeof record.start === "string" && TIME_PATTERN.test(record.start)
      ? record.start
      : defaults[key]!.start;
    const end = typeof record.end === "string" && TIME_PATTERN.test(record.end)
      ? record.end
      : defaults[key]!.end;
    return [key, { enabled: record.enabled === true && start < end, start, end }];
  }));
}

export function parseWeeklyScheduleForm(form: FormData): WeeklySchedule {
  return normalizeWeeklySchedule(Object.fromEntries(WEEKDAYS.map(({ key }) => [key, {
    enabled: form.get(`day_${key}_enabled`) === "on",
    start: String(form.get(`day_${key}_start`) ?? ""),
    end: String(form.get(`day_${key}_end`) ?? ""),
  }])));
}

type LocalTime = { date: string; weekday: string; minutes: number };

function localTimeAt(date: Date, timezone: string): LocalTime | undefined {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
    const weekday = { Sun: "0", Mon: "1", Tue: "2", Wed: "3", Thu: "4", Fri: "5", Sat: "6" }[part("weekday")];
    const hour = Number(part("hour"));
    const minute = Number(part("minute"));
    if (weekday === undefined || !Number.isInteger(hour) || !Number.isInteger(minute)) return undefined;
    return { date: `${part("year")}-${part("month")}-${part("day")}`, weekday, minutes: hour * 60 + minute };
  } catch {
    return undefined;
  }
}

const minutesFor = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));

export function activeShiftKeyAt(schedule: WeeklySchedule, date = new Date(), timezone = ATTENDANT_TIMEZONE): string | undefined {
  const local = localTimeAt(date, timezone);
  if (!local) return undefined;
  const day = schedule[local.weekday];
  if (!day?.enabled || local.minutes < minutesFor(day.start) || local.minutes >= minutesFor(day.end)) return undefined;
  return `${local.date}:${day.start}`;
}

export function isAttendantOnDuty(schedule: WeeklySchedule, date = new Date(), timezone = ATTENDANT_TIMEZONE): boolean {
  return Boolean(activeShiftKeyAt(schedule, date, timezone));
}

export function nextShiftStartAt(schedule: WeeklySchedule, now = new Date(), timezone = ATTENDANT_TIMEZONE): {
  at: Date; shiftKey: string;
} | undefined {
  const currentShift = activeShiftKeyAt(schedule, now, timezone);
  const stepMinutes = 15;
  const maxSteps = Math.ceil((8 * 24 * 60) / stepMinutes);
  for (let step = 1; step <= maxSteps; step += 1) {
    const candidate = new Date(now.getTime() + step * stepMinutes * 60_000);
    const key = activeShiftKeyAt(schedule, candidate, timezone);
    if (!key || key === currentShift) continue;
    const windowStart = new Date(candidate.getTime() - stepMinutes * 60_000);
    for (let minute = 0; minute <= stepMinutes; minute += 1) {
      const exact = new Date(windowStart.getTime() + minute * 60_000);
      const exactKey = activeShiftKeyAt(schedule, exact, timezone);
      if (exactKey && exactKey !== currentShift) return { at: exact, shiftKey: exactKey };
    }
  }
  return undefined;
}
