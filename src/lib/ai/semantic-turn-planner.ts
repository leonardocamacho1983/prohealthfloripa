import { generateText, jsonSchema, Output, type ModelMessage } from "ai";

import type { ConversationMessage } from "../conversations/types.ts";
import { gatewayProviderOptions, semanticModelRouting } from "./gateway-routing.ts";
import type { SemanticTurnPlan } from "./semantic-turn-plan.ts";

const schema = jsonSchema<{
  primaryIntent: SemanticTurnPlan["primaryIntent"];
  conversationAct: SemanticTurnPlan["conversationAct"];
  requestedService: SemanticTurnPlan["requestedService"] | null;
  scheduling: SemanticTurnPlan["scheduling"];
  factsAlreadyProvided: string[];
  factsNeeded: string[];
  unresolvedQuestions: string[];
  nextAction: SemanticTurnPlan["nextAction"];
  optionalOffer: SemanticTurnPlan["optionalOffer"] | null;
  acknowledgeGreeting: boolean;
  confidence: SemanticTurnPlan["confidence"];
}>({
  type: "object",
  additionalProperties: false,
  required: ["primaryIntent", "conversationAct", "requestedService", "scheduling", "factsAlreadyProvided",
    "factsNeeded", "unresolvedQuestions", "nextAction", "optionalOffer", "acknowledgeGreeting", "confidence"],
  properties: {
    primaryIntent: { type: "string", enum: ["service_information", "service_discovery", "scheduling", "customer_account", "handoff", "social", "other"] },
    conversationAct: { type: "string", enum: ["new_request", "continuation", "answer", "correction", "reset", "confirmation"] },
    requestedService: { anyOf: [{ type: "object", additionalProperties: false,
      required: ["family", "name", "explicit"], properties: {
        family: { type: "string", enum: ["massage", "pilates", "physiotherapy", "recovery"] },
        name: { anyOf: [{ type: "string", maxLength: 80 }, { type: "null" }] },
        explicit: { type: "boolean" },
      } }, { type: "null" }] },
    scheduling: { type: "object", additionalProperties: false,
      required: ["requested", "dayText", "period", "time"], properties: {
        requested: { type: "boolean" },
        dayText: { anyOf: [{ type: "string", maxLength: 80 }, { type: "null" }] },
        period: { anyOf: [{ type: "string", enum: ["morning", "afternoon", "evening"] }, { type: "null" }] },
        time: { anyOf: [{ type: "string", pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$" }, { type: "null" }] },
      } },
    factsAlreadyProvided: { type: "array", maxItems: 12, items: { type: "string", maxLength: 80 } },
    factsNeeded: { type: "array", maxItems: 8, items: { type: "string", maxLength: 80 } },
    unresolvedQuestions: { type: "array", maxItems: 4, items: { type: "string", maxLength: 160 } },
    nextAction: { type: "string", enum: ["answer", "ask_missing_information", "check_availability", "request_handoff", "acknowledge_only"] },
    optionalOffer: { anyOf: [{ type: "object", additionalProperties: false,
      required: ["id", "appropriateNow", "reason"], properties: {
        id: { type: "string", enum: ["hot_bath", "cold_bath", "contrast"] },
        appropriateNow: { type: "boolean" }, reason: { type: "string", maxLength: 160 },
      } }, { type: "null" }] },
    acknowledgeGreeting: { type: "boolean" },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
  },
});

function cleanNullable<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null)) as T;
}

export async function planSemanticTurn(input: {
  currentTurn: string;
  history: readonly ConversationMessage[];
}): Promise<SemanticTurnPlan> {
  const messages: ModelMessage[] = input.history
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-16)
    .map((message) => ({ role: message.role as "user" | "assistant", content: message.content }));
  messages.push({ role: "user", content: input.currentTurn });
  const routing = semanticModelRouting();
  const result = await generateText({
    model: routing.model,
    output: Output.object({ schema }),
    instructions: `Planeje o próximo turno de um atendimento por WhatsApp da ProHealth Floripa. Não escreva a resposta ao cliente.
Entenda semanticamente a rajada inteira e o histórico recente. Mensagens numeradas pertencem ao mesmo turno.
Regras obrigatórias:
- saudação junto de pedido comercial é apenas um acolhimento dentro da resposta principal;
- um horário exato também determina o período (14:00 é afternoon) e nunca pode gerar nova pergunta de período;
- não declare nem presuma disponibilidade; check_availability apenas quando serviço, dia e hora estiverem presentes;
- resolva o pedido principal antes de sugerir oferta complementar; se algo do pedido principal estiver pendente, appropriateNow=false;
- não invente objetivo, sintoma, preferência ou serviço;
- "começar do zero" reinicia o assunto, mas não apaga identidade cadastral;
- liste somente fatos realmente ausentes em factsNeeded e faça no máximo uma pergunta pendente.`,
    messages,
    maxOutputTokens: 420,
    maxRetries: 0,
    providerOptions: gatewayProviderOptions({ fallbackModels: routing.fallbackModels, feature: "semantic-turn" }),
    abortSignal: AbortSignal.timeout(5_000),
  });
  const output = result.output;
  const { requestedService, optionalOffer, scheduling, ...base } = output;
  return {
    ...base,
    ...(requestedService ? { requestedService: cleanNullable(requestedService) as NonNullable<SemanticTurnPlan["requestedService"]> } : {}),
    scheduling: cleanNullable(scheduling) as SemanticTurnPlan["scheduling"],
    ...(optionalOffer ? { optionalOffer } : {}),
  };
}
