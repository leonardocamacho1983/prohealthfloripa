import { send } from "@vercel/queue";
export const CX_SURVEY_TOPIC = "prohealth-cx-survey";
export async function enqueueCxSurvey(surveyId: string, availableAt: Date): Promise<void> {
  await send(CX_SURVEY_TOPIC, { surveyId }, { delaySeconds: Math.max(1, Math.min(604800,
    Math.ceil((availableAt.getTime() - Date.now()) / 1000))), retentionSeconds: 604800,
    idempotencyKey: `cx-survey-${surveyId}` });
}
