import { generateText, jsonSchema, Output } from "ai";

import type { JourneyGoal, JourneyIntent } from "../journey/types.ts";
import { gatewayProviderOptions, semanticModelRouting } from "./gateway-routing.ts";

export type SemanticTurnInterpretation = {
  intent: JourneyIntent;
  goals: JourneyGoal[];
  serviceFamily?: "massage" | "pilates" | "physiotherapy" | "recovery";
  confidence: "low" | "medium" | "high";
};

const interpretationSchema = jsonSchema<{
  intent: SemanticTurnInterpretation["intent"];
  goals: JourneyGoal[];
  serviceFamily: SemanticTurnInterpretation["serviceFamily"] | null;
  confidence: SemanticTurnInterpretation["confidence"];
}>({
  type: "object",
  additionalProperties: false,
  required: ["intent", "goals", "serviceFamily", "confidence"],
  properties: {
    intent: { type: "string", enum: ["symptom_or_goal", "service_discovery", "service_question", "scheduling", "social", "other"] },
    goals: { type: "array", maxItems: 4,
      items: { type: "string", enum: ["localized_tension", "relaxation", "post_exercise_recovery", "general_recovery"] } },
    serviceFamily: { anyOf: [
      { type: "string", enum: ["massage", "pilates", "physiotherapy", "recovery"] },
      { type: "null" },
    ] },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
  },
});

export const SEMANTIC_INTERPRETATION_TIMEOUTS_MS = {
  primary: 3_000,
  fallback: 3_000,
} as const;

async function generateInterpretation(input: {
  message: string;
  model: string;
  timeoutMs: number;
}) {
  const result = await generateText({
    model: input.model,
    output: Output.object({ schema: interpretationSchema }),
    instructions: `Você interpreta mensagens de WhatsApp para uma clínica de saúde e performance.
Sua única tarefa é devolver sinais semânticos estruturados para orientar o próximo passo do atendimento. Não diagnostique e não escreva uma resposta ao cliente.

Mapeamento de objetivos:
- localized_tension: dor, incômodo, rigidez, travamento, tensão ou desconforto corporal localizado, mesmo que a pessoa não use a palavra "tensão".
- relaxation: desejo de relaxar, desacelerar, aliviar estresse ou tensão geral.
- post_exercise_recovery: recuperação explicitamente após treino, prova ou exercício.
- general_recovery: recuperação corporal geral sem contexto claro de pós-exercício.

Regras:
- Entenda o sentido, não procure palavras exatas.
- Uma queixa corporal não autoriza diagnóstico nem promessa clínica.
- Não classifique pergunta objetiva de preço, endereço ou funcionamento como symptom_or_goal.
- serviceFamily só deve ser preenchido quando a pessoa pediu ou escolheu explicitamente aquela família; uma queixa aberta deve ficar sem família para permitir recomendação integrada.
- Use confidence=high apenas quando o significado estiver claro.`,
    prompt: input.message,
    maxOutputTokens: 120,
    maxRetries: 0,
    providerOptions: gatewayProviderOptions({
      fallbackModels: [],
      feature: "semantic-turn",
    }),
    abortSignal: AbortSignal.timeout(input.timeoutMs),
  });

  // Output.object can fail lazily when `output` is read. Read it inside this
  // attempt so an empty/invalid structured answer also advances to reserve.
  return result.output;
}

export async function interpretSemanticTurn(input: {
  message: string;
}): Promise<SemanticTurnInterpretation> {
  const routing = semanticModelRouting();
  const models = [routing.model, ...routing.fallbackModels];
  let lastError: unknown;

  for (const [index, model] of models.entries()) {
    try {
      const output = await generateInterpretation({
        message: input.message,
        model,
        timeoutMs: index === 0
          ? SEMANTIC_INTERPRETATION_TIMEOUTS_MS.primary
          : SEMANTIC_INTERPRETATION_TIMEOUTS_MS.fallback,
      });
      return {
        intent: output.intent,
        goals: output.goals,
        ...(output.serviceFamily ? { serviceFamily: output.serviceFamily } : {}),
        confidence: output.confidence,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("No semantic interpretation model is configured.");
}
