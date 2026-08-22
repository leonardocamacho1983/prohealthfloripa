import assert from "node:assert/strict";
import test from "node:test";

import { composeDeterministicReply } from "../ai/deterministic-reply-composer.ts";
import {
  extractSchedule,
  extractExplicitServiceFamilyChange,
  extractServiceSelectionChange,
} from "./extractors.ts";
import { decideJourneyAction } from "./policy.ts";
import {
  applyDeliveredJourneyOutcome,
  applySemanticJourneyEvidence,
  observeAssistantJourneyFacts,
  reduceJourneyState,
} from "./reducer.ts";
import { initialJourneyState } from "./types.ts";

test("semantic evidence maps free-form localized discomfort into the journey without storing the complaint", () => {
  const state = applySemanticJourneyEvidence(initialJourneyState(1), {
    intent: "symptom_or_goal",
    goals: ["localized_tension"],
    confidence: "high",
  });
  assert.deepEqual(state.goals, ["localized_tension"]);
  assert.deepEqual(state.latestGoals, ["localized_tension"]);
  assert.equal(decideJourneyAction(state).action.type, "recommend_integrated_paths");
  assert.equal("rawComplaint" in state, false);
});

test("low-confidence semantic evidence cannot steer a commercial recommendation", () => {
  const state = applySemanticJourneyEvidence(initialJourneyState(1), {
    intent: "other",
    goals: ["localized_tension"],
    confidence: "low",
  });
  assert.deepEqual(state.goals, []);
  assert.equal(decideJourneyAction(state).action.type, "assisted");
});

test("Leonardo flow preserves recommendation, selection, price, bath and split schedule", () => {
  let state = reduceJourneyState(initialJourneyState(), {
    messages: ["to com torcicolo, qual seria a melhor massagem pra mim?"],
    revision: 1,
    activePilates: true,
  });
  let decision = decideJourneyAction(state);
  assert.equal(decision.action.type, "recommend_service");
  if (decision.action.type !== "recommend_service") return;
  state = applyDeliveredJourneyOutcome(state, {
    action: decision.action,
    messages: composeDeterministicReply({
      kind: "service_recommendation",
      goal: decision.action.goal,
    }).messages,
  });
  assert.deepEqual(state.recommendedServices, ["Miofascial", "Relaxante"]);

  state = reduceJourneyState(state, {
    messages: ["legal. eu tbm to com dificuldade de relaxar"],
    revision: 2,
    activePilates: true,
  });
  decision = decideJourneyAction(state);
  assert.equal(decision.action.type, "recommend_service");
  if (decision.action.type !== "recommend_service") return;
  assert.equal(decision.action.goal, "relaxation");
  state = applyDeliveredJourneyOutcome(state, {
    action: decision.action,
    messages: composeDeterministicReply({
      kind: "service_recommendation",
      goal: decision.action.goal,
    }).messages,
  });
  assert.deepEqual(state.recommendedServices, ["Relaxante"]);

  state = reduceJourneyState(state, {
    messages: ["quero sim"],
    revision: 3,
    activePilates: true,
  });
  decision = decideJourneyAction(state);
  assert.equal(decision.action.type, "present_selected_service");
  if (decision.action.type !== "present_selected_service") return;
  assert.equal(decision.action.service, "Relaxante");
  assert.equal(decision.action.includePrice, true);
  assert.equal(decision.action.includeDuration, true);
  assert.equal(decision.action.offerHotBath, true);
  assert.equal(decision.action.activePilates, true);
  state = applyDeliveredJourneyOutcome(state, {
    action: decision.action,
    messages: composeDeterministicReply({
      kind: "selected_service",
      service: decision.action.service,
      includePrice: decision.action.includePrice,
      includeDuration: decision.action.includeDuration,
      offerHotBath: decision.action.offerHotBath,
      activePilates: decision.action.activePilates,
      ...(decision.action.nextQuestion ? { nextQuestion: decision.action.nextQuestion } : {}),
    }).messages,
  });

  state = reduceJourneyState(state, { messages: ["que tal as 15:30?", "amanhã"], revision: 5 });
  decision = decideJourneyAction(state);
  assert.deepEqual(decision.action, {
    type: "schedule_handoff",
    service: "Relaxante",
    day: "amanhã",
    time: "15:30",
    includePrice: false,
    includeDuration: false,
    offerHotBath: false,
    activePilates: true,
  });
});

test("a direct Relaxante slot offers the bath before handoff and then summarizes an acceptance", () => {
  let state = reduceJourneyState(initialJourneyState(), {
    messages: ["Quero a massagem Relaxante amanhã às 15:30"],
    revision: 1,
    activePilates: true,
  });
  let decision = decideJourneyAction(state);
  assert.equal(decision.action.type, "present_selected_service");
  if (decision.action.type !== "present_selected_service") return;
  assert.equal(decision.action.includePrice, true);
  assert.equal(decision.action.includeDuration, true);
  assert.equal(decision.action.offerHotBath, true);

  const presentation = composeDeterministicReply({
    kind: "selected_service",
    service: decision.action.service,
    includePrice: decision.action.includePrice,
    includeDuration: decision.action.includeDuration,
    offerHotBath: decision.action.offerHotBath,
    activePilates: decision.action.activePilates,
  });
  assert.match(presentation.messages[0], /R\$ 270/);
  assert.match(presentation.messages[0], /uma hora completa/i);
  assert.match(presentation.messages[0], /banheira quente depois de uma das suas aulas/i);
  assert.equal((presentation.messages[0].match(/\?/g) ?? []).length, 1);
  state = applyDeliveredJourneyOutcome(state, {
    action: decision.action,
    messages: presentation.messages,
  });

  state = reduceJourneyState(state, { messages: ["quero sim"], revision: 2 });
  decision = decideJourneyAction(state);
  assert.equal(decision.action.type, "schedule_handoff");
  if (decision.action.type !== "schedule_handoff") return;
  assert.equal(decision.action.hotBathAccepted, true);
  assert.equal(decision.action.includePrice, false);
  assert.equal(decision.action.includeDuration, false);
  const handoff = composeDeterministicReply({
    kind: "schedule_handoff",
    service: decision.action.service,
    day: decision.action.day,
    time: decision.action.time,
    hotBathAccepted: decision.action.hotBathAccepted,
  });
  assert.match(handoff.messages[0], /Relaxante \+ banheira quente, amanhã, às 15:30/i);
  assert.match(handoff.messages[0], /confirmar a disponibilidade/i);
});

test("a previous mention of Relaxante does not suppress a bath that was never offered", () => {
  let state = reduceJourneyState(initialJourneyState(), {
    messages: ["Quero massagem Relaxante porque estou estressado"], revision: 1,
  });
  state = observeAssistantJourneyFacts(state, ["A Relaxante pode contribuir para conforto e relaxamento."]);
  const decision = decideJourneyAction(state);
  assert.equal(decision.action.type, "present_selected_service");
  assert.equal(decision.action.type === "present_selected_service" && decision.action.offerHotBath, true);
});

test("assistant evidence prevents repeating price, duration and an offered bath", () => {
  let state = reduceJourneyState(initialJourneyState(), {
    messages: ["Quero massagem Relaxante porque estou estressado"], revision: 1,
  });
  state = observeAssistantJourneyFacts(state, [
    "A Relaxante custa R$ 270, ocupa uma hora completa e pode ser combinada com a primeira banheira quente por R$ 35. Basta trazer roupa de banho; temos toalhas.",
  ]);
  const decision = decideJourneyAction(state);
  assert.equal(decision.action.type, "ask_schedule");
  assert.equal(decision.action.type === "ask_schedule" && decision.action.missing, "day");
});

test("planning never marks commercial facts as sent before delivery", () => {
  const state = reduceJourneyState(initialJourneyState(), {
    messages: ["Quero a massagem Relaxante"],
    revision: 1,
  });
  const decision = decideJourneyAction(state);
  assert.equal(decision.action.type, "present_selected_service");
  assert.deepEqual(decision.nextState.factsSent, []);
  assert.equal(decision.nextState.offers.hot_bath, undefined);

  if (decision.action.type !== "present_selected_service") return;
  const delivered = applyDeliveredJourneyOutcome(state, {
    action: decision.action,
    messages: composeDeterministicReply({
      kind: "selected_service",
      service: decision.action.service,
      includePrice: decision.action.includePrice,
      includeDuration: decision.action.includeDuration,
      offerHotBath: decision.action.offerHotBath,
      activePilates: decision.action.activePilates,
    }).messages,
  });
  assert.deepEqual(delivered.factsSent.sort(), [
    "hot_bath_amenities",
    "service_duration",
    "service_price",
  ]);
  assert.equal(delivered.offers.hot_bath, "offered");
});

test("privacy-minimized state stores categories instead of the raw complaint", () => {
  const state = reduceJourneyState(undefined, {
    messages: ["Acordei com torcicolo e acho que foi meu travesseiro"], revision: 1,
  });
  assert.deepEqual(state.goals, ["localized_tension"]);
  assert.doesNotMatch(JSON.stringify(state), /travesseiro|acordei/i);
});

test("changing the selected service clears service facts while preserving the requested slot", () => {
  const previous = {
    ...initialJourneyState(4),
    stage: "collecting_schedule" as const,
    goals: ["relaxation" as const],
    latestGoals: [],
    serviceFamily: "massage" as const,
    recommendedServices: ["Relaxante"],
    selectedService: "Relaxante",
    factsSent: ["service_price" as const, "service_duration" as const],
    offers: { hot_bath: "offered" as const },
    scheduling: { status: "collecting" as const, dayText: "amanhã", time: "15:30" },
  };
  const state = reduceJourneyState(previous, {
    messages: ["Na verdade, quero a Miofascial"],
    revision: 5,
  });
  assert.equal(state.selectedService, "Miofascial");
  assert.deepEqual(state.factsSent, []);
  assert.deepEqual(state.offers, { hot_bath: "offered" });
  assert.deepEqual(state.scheduling, {
    status: "complete",
    dayText: "amanhã",
    time: "15:30",
  });
});

test("explicitly accepting the only recommendation preserves facts already delivered for it", () => {
  const previous = {
    ...initialJourneyState(2),
    stage: "recommendation" as const,
    goals: ["relaxation" as const],
    latestGoals: [],
    serviceFamily: "massage" as const,
    recommendedServices: ["Relaxante"],
    factsSent: ["service_price" as const, "service_duration" as const],
    offers: { hot_bath: "offered" as const },
  };
  const state = reduceJourneyState(previous, {
    messages: ["Quero a Relaxante"],
    revision: 3,
  });
  assert.equal(state.selectedService, "Relaxante");
  assert.deepEqual(state.factsSent, ["service_price", "service_duration"]);
  assert.deepEqual(state.offers, { hot_bath: "offered" });
});

test("a factual Relaxante price question stays assisted instead of becoming a recommendation", () => {
  const state = reduceJourneyState(initialJourneyState(), {
    messages: ["Quanto custa a massagem Relaxante?"],
    revision: 1,
  });
  assert.deepEqual(state.goals, []);
  assert.equal(decideJourneyAction(state).action.type, "assisted");
});

test("a complaint inside a price question does not replace the requested factual answer", () => {
  const state = reduceJourneyState(initialJourneyState(), {
    messages: ["Tô com torcicolo; quanto custa a massagem Relaxante?"],
    revision: 1,
  });
  assert.deepEqual(state.goals, ["localized_tension"]);
  assert.deepEqual(state.latestGoals, []);
  assert.equal(decideJourneyAction(state).action.type, "assisted");
});

test("a negated massage is not selected and the last affirmative correction wins", () => {
  assert.deepEqual(extractServiceSelectionChange("Não quero Relaxante"), {
    rejectedServices: ["Relaxante"],
  });
  assert.deepEqual(extractServiceSelectionChange("não Relaxante; quero Miofascial"), {
    selectedService: "Miofascial",
    rejectedServices: ["Relaxante"],
  });

  const previous = {
    ...initialJourneyState(2),
    stage: "ready_for_handoff" as const,
    serviceFamily: "massage" as const,
    recommendedServices: ["Relaxante"],
    selectedService: "Relaxante",
    factsSent: ["service_price" as const],
    offers: { hot_bath: "offered" as const },
    scheduling: { status: "complete" as const, dayText: "amanhã", time: "15:30" },
  };
  const rejected = reduceJourneyState(previous, {
    messages: ["Não quero Relaxante"],
    revision: 3,
  });
  assert.equal(rejected.selectedService, undefined);
  assert.deepEqual(rejected.factsSent, []);
  assert.deepEqual(rejected.offers, { hot_bath: "offered" });
  assert.notEqual(decideJourneyAction(rejected).action.type, "schedule_handoff");
});

test("an explicit primary-family switch clears an incompatible massage and its slot", () => {
  const previous = {
    ...initialJourneyState(4),
    stage: "ready_for_handoff" as const,
    serviceFamily: "massage" as const,
    recommendedServices: ["Relaxante"],
    selectedService: "Relaxante",
    factsSent: ["service_price" as const, "service_duration" as const],
    offers: { hot_bath: "offered" as const },
    scheduling: { status: "complete" as const, dayText: "amanhã", time: "15:30" },
  };
  for (const [message, family] of [
    ["Na verdade, quero Pilates sexta", "pilates"],
    ["Na verdade, quero recovery sexta", "recovery"],
  ] as const) {
    const switched = reduceJourneyState(previous, { messages: [message], revision: 5 });
    assert.equal(switched.serviceFamily, family);
    assert.equal(switched.selectedService, undefined);
    assert.deepEqual(switched.recommendedServices, []);
    assert.deepEqual(switched.offers, { hot_bath: "offered" });
    assert.equal(switched.scheduling.dayText, "sexta");
    assert.equal(switched.scheduling.time, undefined);
    assert.notEqual(decideJourneyAction(switched).action.type, "schedule_handoff");
  }
  assert.equal(extractExplicitServiceFamilyChange("não quero Pilates"), undefined);
});

test("negated and non-exact scheduling language cannot produce an exact slot", () => {
  assert.deepEqual(extractSchedule("não amanhã; sexta"), { dayText: "sexta" });
  assert.deepEqual(extractSchedule("não às 15:30; pode ser às 16:00"), { time: "16:00" });
  assert.equal(extractSchedule("antes das 15:30").time, undefined);
  assert.equal(extractSchedule("depois das 15:30").time, undefined);
  assert.equal(extractSchedule("entre 14:00 e 15:00").time, undefined);
  assert.equal(extractSchedule("das 14 às 15").time, undefined);
  assert.equal(extractSchedule("de 14 a 15").time, undefined);

  const previous = {
    ...initialJourneyState(2),
    stage: "ready_for_handoff" as const,
    serviceFamily: "massage" as const,
    selectedService: "Miofascial",
    factsSent: ["service_price" as const, "service_duration" as const],
    scheduling: { status: "complete" as const, dayText: "amanhã", time: "15:30" },
  };
  const constrained = reduceJourneyState(previous, {
    messages: ["não às 15:30; precisa ser antes das 17h"],
    revision: 3,
  });
  assert.equal(constrained.scheduling.time, undefined);
  const decision = decideJourneyAction(constrained);
  assert.equal(decision.action.type, "ask_schedule");
  assert.equal(decision.action.type === "ask_schedule" && decision.action.missing, "time");

  const alternative = reduceJourneyState(previous, {
    messages: ["não amanhã; sexta"],
    revision: 3,
  });
  assert.equal(alternative.scheduling.dayText, "sexta");
});

test("assistant history cannot overwrite a newer persisted recommendation", () => {
  const persisted = {
    ...initialJourneyState(5),
    stage: "recommendation" as const,
    serviceFamily: "massage" as const,
    recommendedServices: ["Relaxante"],
  };
  const preserved = observeAssistantJourneyFacts(persisted, [
    "A Miofascial ajuda na tensão localizada; a Relaxante combina com relaxamento geral.",
  ]);
  assert.deepEqual(preserved.recommendedServices, ["Relaxante"]);

  const reconstructed = observeAssistantJourneyFacts({
    ...persisted,
    recommendedServices: [],
  }, [
    "A Miofascial ajuda na tensão localizada; a Relaxante combina com relaxamento geral.",
    "Como seu foco agora é relaxar, recomendo a Relaxante.",
  ]);
  assert.deepEqual(reconstructed.recommendedServices, ["Relaxante"]);
});

test("short adjacent replies accept or decline the offered hot bath", () => {
  const offered = {
    ...initialJourneyState(4),
    stage: "service_selected" as const,
    serviceFamily: "massage" as const,
    selectedService: "Relaxante",
    factsSent: ["service_price" as const, "service_duration" as const],
    offers: { hot_bath: "offered" as const },
    scheduling: { status: "complete" as const, dayText: "amanhã", time: "15:30" },
    lastAction: "present_selected_service" as const,
  };
  for (const affirmative of ["sim", "quero sim", "pode ser", "opa quero sim"]) {
    const accepted = reduceJourneyState(offered, { messages: [affirmative], revision: 5 });
    assert.equal(accepted.offers.hot_bath, "accepted");
    const action = decideJourneyAction(accepted).action;
    assert.equal(action.type, "schedule_handoff");
    assert.equal(action.type === "schedule_handoff" && action.hotBathAccepted, true);
  }
  const declined = reduceJourneyState(offered, { messages: ["não"], revision: 5 });
  assert.equal(declined.offers.hot_bath, "declined");
  assert.equal(decideJourneyAction(declined).action.type, "schedule_handoff");
});

test("a natural positive evaluation selects the named massage", () => {
  const state = reduceJourneyState({
    ...initialJourneyState(2),
    stage: "recommendation",
    goals: ["localized_tension"],
    serviceFamily: "massage",
    recommendedServices: ["Miofascial", "Relaxante"],
  }, {
    messages: ["Massagem Relaxante me parece bom"],
    revision: 3,
  });
  assert.equal(state.selectedService, "Relaxante");
  assert.equal(decideJourneyAction(state).action.type, "present_selected_service");
});

test("peitoral tension is treated as a localized complaint", () => {
  const state = reduceJourneyState(initialJourneyState(), {
    messages: ["Tô com o músculo do peitoral bem tenso. Como podem me ajudar?"],
    revision: 1,
  });
  assert.ok(state.goals.includes("localized_tension"));
  assert.equal(decideJourneyAction(state).action.type, "recommend_integrated_paths");
});

test("assistant evidence recognizes a plain one-hour duration", () => {
  const observed = observeAssistantJourneyFacts(initialJourneyState(), [
    "A sessão dura 1 hora.",
  ]);
  assert.ok(observed.factsSent.includes("service_duration"));
});

test("common localized complaints use an integrated path without hard-coding one body area", () => {
  for (const complaint of [
    "Estou com muita tensão na lombar, como podem me ajudar?",
    "Estou com rigidez nos ombros, o que vocês recomendam?",
    "Meu pescoço está travado e desconfortável",
  ]) {
    const state = reduceJourneyState(initialJourneyState(), {
      messages: [complaint],
      revision: 1,
    });
    assert.ok(state.goals.includes("localized_tension"));
    const decision = decideJourneyAction(state);
    assert.equal(decision.action.type, "recommend_integrated_paths");
    if (decision.action.type !== "recommend_integrated_paths") continue;
    const reply = composeDeterministicReply({
      kind: "integrated_recommendation",
      goal: decision.action.goal,
    });
    assert.equal(reply.messages.length, 2);
    assert.match(reply.messages[0], /tensão localizada/i);
    assert.match(reply.messages[0], /Miofascial/i);
    assert.match(reply.messages[0], /Relaxante/i);
    assert.match(reply.messages[1], /Miofascial ou Relaxante/i);
    assert.doesNotMatch(reply.messages.join("\n"), /termoterapia|endere[cç]o/i);
    assert.doesNotMatch(reply.messages.join("\n"), /se (?:você )?quiser/i);
  }
});

test("a natural discomfort recommendation stores the concrete massage choices", () => {
  let state = reduceJourneyState(initialJourneyState(), {
    messages: ["Estou com tensão nas costas e quero relaxar"],
    revision: 1,
  });
  const firstDecision = decideJourneyAction(state);
  assert.equal(firstDecision.action.type, "recommend_integrated_paths");
  if (firstDecision.action.type !== "recommend_integrated_paths") return;
  const reply = composeDeterministicReply({
    kind: "integrated_recommendation",
    goal: firstDecision.action.goal,
  });
  state = applyDeliveredJourneyOutcome(state, {
    action: firstDecision.action,
    messages: reply.messages,
  });
  assert.equal(state.dialogue.thermotherapyMentioned, undefined);
  assert.equal(state.dialogue.lastQuestion, "service_choice");
  assert.deepEqual(state.recommendedServices, ["Miofascial", "Relaxante"]);
  assert.equal(state.offers.hot_bath, undefined);

  state = reduceJourneyState(state, { messages: ["quero a Relaxante"], revision: 2 });
  const selected = decideJourneyAction(state);
  assert.equal(selected.action.type, "present_selected_service");
  assert.equal(selected.action.type === "present_selected_service" && selected.action.offerHotBath, true);
});

test("choosing both paths accepts the adjacent thermotherapy invitation", () => {
  const offered = {
    ...initialJourneyState(1),
    goals: ["localized_tension" as const],
    latestGoals: ["localized_tension" as const],
    dialogue: { safetyStatus: "not_asked" as const, thermotherapyMentioned: true },
    lastAction: "recommend_integrated_paths" as const,
  };
  const state = reduceJourneyState(offered, {
    messages: ["Quero combinar as duas"],
    revision: 2,
  });
  assert.equal(state.serviceFamily, "massage");
  assert.equal(state.offers.hot_bath, "accepted");
  assert.equal(decideJourneyAction(state).action.type, "recommend_service");
});

test("service discovery advances after thermotherapy was already presented", () => {
  let state = applySemanticJourneyEvidence(initialJourneyState(1), {
    intent: "symptom_or_goal",
    goals: ["localized_tension"],
    confidence: "high",
  });
  const integrated = decideJourneyAction(state).action;
  assert.equal(integrated.type, "recommend_integrated_paths");
  if (integrated.type !== "recommend_integrated_paths") return;
  state = applyDeliveredJourneyOutcome(state, {
    action: integrated,
    messages: composeDeterministicReply({
      kind: "integrated_recommendation",
      goal: integrated.goal,
    }).messages,
  });
  state = reduceJourneyState(state, {
    messages: ["Quais serviços vocês acham que dão bom para mim?"],
    revision: 2,
  });
  state = applySemanticJourneyEvidence(state, {
    intent: "service_discovery",
    goals: ["localized_tension"],
    confidence: "high",
  });
  const decision = decideJourneyAction(state);
  assert.equal(decision.action.type, "recommend_service");
});

test("a short acceptance fulfills the assistant's pending promise", () => {
  let state = applySemanticJourneyEvidence(initialJourneyState(1), {
    intent: "symptom_or_goal",
    goals: ["localized_tension"],
    confidence: "high",
  });
  state = observeAssistantJourneyFacts(state, [
    "Quer que eu te passe quais serviços podem fazer mais sentido?",
  ]);
  state = reduceJourneyState(state, { messages: ["quero sim"], revision: 2 });
  assert.equal(state.dialogue.pendingCommitment, "explain_service_options");
  assert.equal(decideJourneyAction(state).action.type, "recommend_service");
});

test("an ambiguous yes asks one useful clarification instead of repeating the pitch", () => {
  const state = reduceJourneyState({
    ...initialJourneyState(1),
    goals: ["localized_tension"],
    serviceFamily: "massage",
    recommendedServices: ["Miofascial", "Relaxante"],
    dialogue: { safetyStatus: "not_asked", lastQuestion: "service_choice" },
  }, { messages: ["quero sim"], revision: 2 });
  const decision = decideJourneyAction(state);
  assert.equal(decision.action.type, "clarify_service_choice");
  if (decision.action.type !== "clarify_service_choice") return;
  const reply = composeDeterministicReply({ kind: "service_choice_clarification" });
  assert.match(reply.messages[0], /Miofascial/);
  assert.match(reply.messages[0], /Relaxante/);
  assert.equal((reply.messages[0].match(/\?/g) ?? []).length, 1);
});

test("a clear safety denial is remembered instead of reopening the checklist", () => {
  let state = observeAssistantJourneyFacts(initialJourneyState(1), [
    "Você está com dor forte, formigamento, perda de força ou isso começou após algum trauma?",
  ]);
  assert.equal(state.dialogue.safetyStatus, "asked");
  state = reduceJourneyState(state, {
    messages: ["É só um mal jeito mesmo, nada disso"],
    revision: 2,
  });
  assert.equal(state.dialogue.safetyStatus, "cleared");
  assert.equal(state.dialogue.lastQuestion, undefined);
});
