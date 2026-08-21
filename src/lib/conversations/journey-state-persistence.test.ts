import assert from "node:assert/strict";
import test from "node:test";

import { initialJourneyState } from "../journey/types.ts";
import {
  deserializeConversationJourneyState,
  serializeCompletedJourneyHandoffState,
  serializeConversationJourneyState,
  serializeJourneyStateForRevision,
  type ConversationJourneyStateRow,
} from "./journey-state-persistence.ts";

const leonardoRow = (): ConversationJourneyStateRow => ({
  schema_version: 1,
  stage: "ready_for_handoff",
  goals: ["localized_tension", "relaxation"],
  latest_goals: ["relaxation"],
  service_family: "massage",
  recommended_services: ["Relaxante"],
  selected_service: "Relaxante",
  facts_sent: ["service_price", "service_duration", "hot_bath_amenities"],
  offers: { hot_bath: "offered" },
  scheduling: { status: "complete", dayText: "amanhã", period: "afternoon", time: "15:30" },
  dialogue: { safetyStatus: "not_asked" },
  active_pilates: true,
  last_action: "schedule_handoff",
  updated_from_revision: "5",
});

test("loads the complete Leonardo journey without storing raw health complaints", () => {
  const state = deserializeConversationJourneyState(leonardoRow());
  assert.deepEqual(state, {
    schemaVersion: 1,
    stage: "ready_for_handoff",
    goals: ["localized_tension", "relaxation"],
    latestGoals: ["relaxation"],
    serviceFamily: "massage",
    recommendedServices: ["Relaxante"],
    selectedService: "Relaxante",
    factsSent: ["service_price", "service_duration", "hot_bath_amenities"],
    offers: { hot_bath: "offered" },
    scheduling: { status: "complete", dayText: "amanhã", period: "afternoon", time: "15:30" },
    dialogue: { safetyStatus: "not_asked" },
    activePilates: true,
    lastAction: "schedule_handoff",
    updatedFromRevision: 5,
  });
  assert.equal(JSON.stringify(state).includes("torcicolo"), false);
});

test("rejects future schemas and unsafe revisions", () => {
  assert.equal(deserializeConversationJourneyState({ ...leonardoRow(), schema_version: 2 }), undefined);
  assert.equal(deserializeConversationJourneyState({ ...leonardoRow(), updated_from_revision: -1 }), undefined);
  assert.equal(deserializeConversationJourneyState({ ...leonardoRow(), updated_from_revision: "x" }), undefined);
});

test("discards unknown enum values and malformed scheduling fields", () => {
  const state = deserializeConversationJourneyState({
    ...leonardoRow(),
    goals: ["relaxation", "raw-medical-complaint"],
    latest_goals: "not-json",
    facts_sent: ["service_price", "unknown"],
    offers: { hot_bath: "offered", experimental: "accepted", contrast: "invalid" },
    scheduling: { status: "broken", dayText: " amanhã ", time: "35:90", period: "lunch" },
  });
  assert.deepEqual(state?.goals, ["relaxation"]);
  assert.deepEqual(state?.latestGoals, []);
  assert.deepEqual(state?.factsSent, ["service_price"]);
  assert.deepEqual(state?.offers, { hot_bath: "offered" });
  assert.deepEqual(state?.scheduling, { status: "not_started", dayText: "amanhã" });
});

test("serialization produces bounded JSON payloads for Neon", () => {
  const state = deserializeConversationJourneyState(leonardoRow());
  assert.ok(state);
  const serialized = serializeConversationJourneyState(state);
  assert.equal(serialized.goalsJson, '["localized_tension","relaxation"]');
  assert.equal(serialized.latestGoalsJson, '["relaxation"]');
  assert.equal(serialized.schedulingJson, '{"status":"complete","dayText":"amanhã","period":"afternoon","time":"15:30"}');
  assert.equal(serialized.dialogueJson, '{"safetyStatus":"not_asked"}');
  assert.equal(serialized.updatedFromRevision, 5);
});

test("serialization refuses a state with an unsupported version", () => {
  assert.throws(() => serializeConversationJourneyState({
    ...initialJourneyState(), schemaVersion: 99,
  }), /Invalid conversation journey state/);
});

test("atomic handoff accepts only a handed-off state from the leased revision", () => {
  const state = deserializeConversationJourneyState({
    ...leonardoRow(),
    stage: "human_handoff",
    scheduling: { status: "handed_off", dayText: "amanhã", period: "afternoon", time: "15:30" },
  });
  assert.ok(state);
  const outboundKey = "zernio-turn-conversation-5-0";
  assert.equal(serializeCompletedJourneyHandoffState(state, 5, 5, outboundKey).stage, "human_handoff");
  assert.equal(serializeCompletedJourneyHandoffState(state, 5, 4, outboundKey).stage, "human_handoff");
  assert.throws(() => serializeCompletedJourneyHandoffState(state, 6, 5, outboundKey), /not complete for this revision/);
  assert.throws(() => serializeCompletedJourneyHandoffState(state, 5, 0, outboundKey), /not complete for this revision/);
  assert.throws(() => serializeCompletedJourneyHandoffState(state, 5, 6, outboundKey), /not complete for this revision/);
  assert.throws(() => serializeCompletedJourneyHandoffState(state, 5, 4.5, outboundKey), /not complete for this revision/);
  assert.throws(() => serializeCompletedJourneyHandoffState(state, 5, 5, ""), /not complete for this revision/);
  assert.throws(() => serializeCompletedJourneyHandoffState(state, 5, 5, ` ${outboundKey}`), /not complete for this revision/);
  assert.throws(() => serializeCompletedJourneyHandoffState({
    ...state,
    stage: "ready_for_handoff",
    scheduling: { ...state.scheduling, status: "complete" },
  }, 5, 5, outboundKey), /not complete for this revision/);
});

test("atomic ordinary completion requires the journey snapshot from the same revision", () => {
  const state = deserializeConversationJourneyState({
    ...leonardoRow(),
    stage: "collecting_schedule",
    scheduling: { status: "collecting" },
  });
  assert.ok(state);
  assert.equal(serializeJourneyStateForRevision(state, 5).updatedFromRevision, 5);
  assert.throws(() => serializeJourneyStateForRevision(state, 4), /does not belong to this revision/);
});
