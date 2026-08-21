const MODEL_ID = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*$/i;

export const DEFAULT_SEMANTIC_MODEL = "openai/gpt-5.4-mini";
export const DEFAULT_SEMANTIC_FALLBACK_MODELS = [
  "google/gemini-3-flash",
  "openai/gpt-5.4-nano",
] as const;

export const DEFAULT_WHATSAPP_MODEL = "openai/gpt-5.4-mini";
export const DEFAULT_WHATSAPP_FALLBACK_MODELS = [
  "google/gemini-3-flash",
] as const;

function parseModelList(value: string | undefined, defaults: readonly string[]): string[] {
  const candidates = value === undefined
    ? [...defaults]
    : value.split(",").map((model) => model.trim()).filter(Boolean);
  return [...new Set(candidates.filter((model) => MODEL_ID.test(model)))];
}

type ModelEnvironment = Readonly<Record<string, string | undefined>>;

export function semanticModelRouting(env: ModelEnvironment = process.env): {
  model: string;
  fallbackModels: string[];
} {
  const model = env.SEMANTIC_AI_MODEL?.trim() || env.WHATSAPP_AI_MODEL?.trim()
    || DEFAULT_SEMANTIC_MODEL;
  const fallbackModels = parseModelList(
    env.SEMANTIC_AI_FALLBACK_MODELS,
    DEFAULT_SEMANTIC_FALLBACK_MODELS,
  ).filter((fallback) => fallback !== model);
  return { model, fallbackModels };
}

export function whatsappModelRouting(env: ModelEnvironment = process.env): {
  model: string;
  fallbackModels: string[];
} {
  const model = env.WHATSAPP_AI_MODEL?.trim() || DEFAULT_WHATSAPP_MODEL;
  const fallbackModels = parseModelList(
    env.WHATSAPP_AI_FALLBACK_MODELS,
    DEFAULT_WHATSAPP_FALLBACK_MODELS,
  ).filter((fallback) => fallback !== model);
  return { model, fallbackModels };
}

export function gatewayProviderOptions(input: {
  fallbackModels: readonly string[];
  feature: "semantic-turn" | "whatsapp-reply" | "whatsapp-reply-fallback";
}) {
  return {
    gateway: {
      models: [...input.fallbackModels],
      tags: [
        `feature:${input.feature}`,
        `env:${process.env.VERCEL_ENV ?? "local"}`,
        "app:prohealth-whatsapp",
      ],
    },
  };
}
