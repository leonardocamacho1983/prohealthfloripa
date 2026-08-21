import { NextResponse } from "next/server";
import { getAttendantProfile } from "@/lib/attendants/repository";
import { isAttendantOnDuty, nextShiftStartAt } from "@/lib/attendants/schedule";
import { requireAppUser } from "@/lib/handoff/server-auth";
import { getNotifierHealth } from "@/lib/notifications/delivery-repository";
import { listNotificationChannels } from "@/lib/notifications/repository";

const mask = (phone?: string) => phone ? `••••${phone.slice(-4)}` : undefined;

export async function GET() {
  const user = await requireAppUser();
  const displayName = user.name?.trim() || user.email?.trim() || "Atendimento";
  const [profile, health, channels] = await Promise.all([
    getAttendantProfile({ userId: user.userId, displayName }), getNotifierHealth(user.userId),
    listNotificationChannels(),
  ]);
  const now = new Date(); const nextShift = nextShiftStartAt(profile.weeklySchedule, now, profile.timezone);
  const template = channels.find((channel) => channel.channel === "whatsapp");
  return NextResponse.json({
    enabled: profile.notificationEnabled,
    maskedPhone: mask(profile.notificationPhone),
    onDuty: isAttendantOnDuty(profile.weeklySchedule, now, profile.timezone),
    nextShiftAt: nextShift?.at.toISOString(),
    templateStatus: template?.status ?? "pending",
    lastSentAt: health.lastSentAt?.toISOString(),
    lastFailedAt: health.lastFailedAt?.toISOString(),
    lastErrorCode: health.lastErrorCode,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
