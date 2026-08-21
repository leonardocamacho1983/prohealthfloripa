import { NextResponse } from "next/server";

import { saveAttendantProfile } from "@/lib/attendants/repository";
import { ATTENDANT_TIMEZONE, parseWeeklyScheduleForm, WEEKDAYS } from "@/lib/attendants/schedule";
import { isAppAuthorizationError, requireAppUser } from "@/lib/handoff/server-auth";
import { scheduleNextShiftNotifier } from "@/lib/notifications/notifier-queue";

export async function POST(request: Request) {
  let user;
  try {
    user = await requireAppUser();
  } catch (error) {
    if (isAppAuthorizationError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }

  const form = await request.formData();
  const firstAccess = form.get("firstAccess") === "1";
  const profileRedirect = (query: string) => new URL(`/profile?${firstAccess ? "welcome=1&" : ""}${query}`, request.url);
  const weeklySchedule = parseWeeklyScheduleForm(form);
  const hasInvalidEnabledDay = WEEKDAYS.some(({ key }) => {
    if (form.get(`day_${key}_enabled`) !== "on") return false;
    const day = weeklySchedule[key];
    return !day?.enabled;
  });
  if (hasInvalidEnabledDay) return NextResponse.redirect(profileRedirect("error=schedule"), 303);

  const notificationPhone = String(form.get("notificationPhone") ?? "").trim();
  const notificationEnabled = form.get("notificationEnabled") === "on";
  try {
    await saveAttendantProfile({
      userId: user.userId,
      displayName: user.name?.trim() || user.email?.trim() || "Atendimento",
      ...(notificationPhone ? { notificationPhone } : {}),
      notificationEnabled,
      weeklySchedule,
    });
    if (notificationEnabled) {
      try {
        await scheduleNextShiftNotifier({ attendantUserId: user.userId, weeklySchedule,
          timezone: ATTENDANT_TIMEZONE });
      } catch (error) {
        console.warn("Unable to schedule the next attendant shift notification", error);
      }
    }
  } catch (error) {
    const reason = error instanceof Error && /phone/i.test(error.message) ? "phone" : "unavailable";
    return NextResponse.redirect(profileRedirect(`error=${reason}`), 303);
  }
  return NextResponse.redirect(new URL(firstAccess ? "/handoff?welcome=1" : "/profile?saved=1", request.url), 303);
}
