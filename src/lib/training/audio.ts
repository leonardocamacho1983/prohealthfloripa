import { gateway, transcribe } from "ai";

const MAX_AUDIO_BYTES = 16 * 1024 * 1024;

export async function downloadZernioAudio(input: {
  apiKey: string; accountId: string; mediaId: string; fetcher?: typeof fetch;
}): Promise<{ bytes: Uint8Array; mediaType: string }> {
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher(`https://zernio.com/api/v1/whatsapp/media/${encodeURIComponent(input.mediaId)}?accountId=${encodeURIComponent(input.accountId)}`, {
    headers: { Authorization: `Bearer ${input.apiKey}` }, signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Zernio media download failed with HTTP ${response.status}`);
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_AUDIO_BYTES) throw new Error("Training audio exceeds 16 MB");
  const mediaType = response.headers.get("content-type")?.split(";")[0] ?? "audio/ogg";
  if (!mediaType.startsWith("audio/") && mediaType !== "application/ogg") throw new Error("Training attachment is not audio");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_AUDIO_BYTES) throw new Error("Training audio size is invalid");
  return { bytes, mediaType };
}

export async function transcribeTrainingAudio(audio: Uint8Array): Promise<string> {
  const result = await transcribe({
    model: gateway.transcription(process.env.TRAINING_TRANSCRIPTION_MODEL ?? "openai/gpt-4o-mini-transcribe"),
    audio, maxRetries: 1, abortSignal: AbortSignal.timeout(45_000),
    providerOptions: { openai: { language: "pt" } },
  });
  const text = result.text.trim();
  if (!text) throw new Error("Training audio transcription was empty");
  return text;
}
