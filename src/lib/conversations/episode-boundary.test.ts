import assert from "node:assert/strict";
import test from "node:test";

import type { ConversationMessage } from "./types.ts";
import { applyEpisodeBoundaryToHistory, detectEpisodeBoundary } from "./episode-boundary.ts";

function message(id: string, content: string, at: string, role: "user" | "assistant" = "user"): ConversationMessage {
  return { id, conversationId: "conversation", direction: role === "user" ? "inbound" : "outbound",
    role, content, createdAt: new Date(at) };
}

test("starts a new topical episode when Leonardo greets after inactivity", () => {
  const old = [
    message("old-user", "Dor na cervical e no ombro direito", "2026-08-16T10:00:00.000Z"),
    message("old-agent", "Vou considerar esse sintoma.", "2026-08-16T10:00:10.000Z", "assistant"),
  ];
  const current = [
    message("new-1", "Oi bom dia", "2026-08-17T09:30:00.000Z"),
    message("new-2", "Tudo bem?", "2026-08-17T09:30:02.000Z"),
    message("new-3", "Queria ver massagem de liberação", "2026-08-17T09:30:05.000Z"),
    message("new-4", "Dor no ombro", "2026-08-17T09:30:08.000Z"),
  ];
  const result = applyEpisodeBoundaryToHistory({ history: [...old, ...current], currentTurn: current });

  assert.deepEqual(result.boundary, { startsNewEpisode: true, reason: "greeting_after_inactivity",
    boundaryMessageId: "new-1", boundaryAt: new Date("2026-08-17T09:30:00.000Z") });
  assert.deepEqual(result.messages.map((item) => item.id), ["new-1", "new-2", "new-3", "new-4"]);
  assert.equal(result.messages.some((item) => item.content.includes("cervical")), false);
});

test("does not split an active episode for a quick greeting", () => {
  const previous = message("previous", "Quero saber o preço", "2026-08-17T09:25:00.000Z");
  const current = [message("current", "Oi", "2026-08-17T09:30:00.000Z")];
  const boundary = detectEpisodeBoundary({ history: [previous, ...current], currentTurn: current });
  assert.deepEqual(boundary, { startsNewEpisode: false });
});

test("a delayed oi nudge preserves an unanswered request", () => {
  const pending = message("pending", "Quais os valores da massagem?", "2026-08-17T09:00:00.000Z");
  const nudge = message("nudge", "Oi?", "2026-08-17T09:31:00.000Z");
  const result = applyEpisodeBoundaryToHistory({ history: [pending, nudge], currentTurn: [nudge] });

  assert.deepEqual(result.boundary, { startsNewEpisode: false });
  assert.deepEqual(result.messages.map((item) => item.id), ["pending", "nudge"]);
});

test("persists the latest episode boundary into the turn after the greeting", () => {
  const old = [
    message("old-user", "Dor na cervical", "2026-08-16T18:00:00.000Z"),
    message("old-agent", "Posso ajudar com isso.", "2026-08-16T18:01:00.000Z", "assistant"),
  ];
  const greeting = message("greeting", "Oi bom dia", "2026-08-17T05:00:00.000Z");
  const greetingReply = message("greeting-reply", "Oi! Como posso ajudar?", "2026-08-17T05:00:02.000Z", "assistant");
  const current = [message("new-request", "Quero massagem", "2026-08-17T05:02:00.000Z")];
  const result = applyEpisodeBoundaryToHistory({
    history: [...old, greeting, greetingReply, ...current],
    currentTurn: current,
  });

  assert.equal(result.boundary.startsNewEpisode, true);
  assert.equal(result.boundary.startsNewEpisode && result.boundary.boundaryMessageId, "greeting");
  assert.deepEqual(result.messages.map((item) => item.id), ["greeting", "greeting-reply", "new-request"]);
  assert.equal(result.messages.some((item) => item.content.includes("cervical")), false);
});

test("explicit restart wins without requiring inactivity and removes earlier bubbles in the same turn", () => {
  const history = [
    message("old", "Quero Pilates", "2026-08-17T09:29:00.000Z"),
    message("current-1", "Espera", "2026-08-17T09:30:00.000Z"),
    message("reset", "Vamos começar do zero", "2026-08-17T09:30:01.000Z"),
    message("current-2", "Quero massagem", "2026-08-17T09:30:02.000Z"),
  ];
  const result = applyEpisodeBoundaryToHistory({ history, currentTurn: history.slice(1) });
  assert.equal(result.boundary.startsNewEpisode, true);
  assert.equal(result.boundary.startsNewEpisode && result.boundary.reason, "explicit_reset");
  assert.deepEqual(result.messages.map((item) => item.id), ["reset", "current-2"]);
});

test("returns the original history reference when no boundary is present", () => {
  const history = [message("old", "Quero Pilates", "2026-08-17T09:29:00.000Z")];
  const current = [message("current", "Quanto custa?", "2026-08-17T09:30:00.000Z")];
  const result = applyEpisodeBoundaryToHistory({ history, currentTurn: current });
  assert.equal(result.messages, history);
  assert.deepEqual(result.boundary, { startsNewEpisode: false });
});
