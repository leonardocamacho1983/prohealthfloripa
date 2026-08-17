import assert from "node:assert/strict";
import test from "node:test";

import type { SearchableInboxConversation } from "./productivity.ts";
import {
  filterAndSortInbox,
  formatElapsed,
  isInboxConversationStalled,
  matchesInboxSearch,
  normalizeDateOnly,
  parseDateValue,
  safeInboxReturnPath,
} from "./productivity.ts";

const now = new Date("2026-08-16T15:00:00.000Z");

function conversation(overrides: Partial<SearchableInboxConversation> = {}): SearchableInboxConversation {
  return {
    id: "conversation-1",
    contactId: "contact-1",
    firstName: "João",
    maskedPhone: "••••••6101",
    searchablePhone: "+55 (47) 99216-6101",
    status: "active",
    summary: "Conversa conduzida pelo agente.",
    lastActivityAt: new Date("2026-08-16T14:30:00.000Z"),
    unreadCount: 0,
    messages: [],
    providerAccountId: "account",
    providerConversationId: "provider-conversation",
    ...overrides,
  };
}

test("busca ignora acentos e encontra nome parcial", () => {
  assert.equal(matchesInboxSearch(conversation(), "joa"), true);
  assert.equal(matchesInboxSearch(conversation(), "maria"), false);
});

test("busca encontra telefone completo, formatado ou pelos últimos dígitos", () => {
  const item = conversation();
  assert.equal(matchesInboxSearch(item, "5547992166101"), true);
  assert.equal(matchesInboxSearch(item, "(47) 99216-6101"), true);
  assert.equal(matchesInboxSearch(item, "6101"), true);
});

test("conversa aberta fica parada aos 15 minutos e conversa encerrada não fica", () => {
  assert.equal(isInboxConversationStalled(conversation({ lastActivityAt: new Date("2026-08-16T14:45:00.000Z") }), now), true);
  assert.equal(isInboxConversationStalled(conversation({ lastActivityAt: new Date("2026-08-16T14:45:01.000Z") }), now), false);
  assert.equal(isInboxConversationStalled(conversation({ status: "closed", lastActivityAt: new Date("2026-08-15T14:00:00.000Z") }), now), false);
});

test("filtros de não lidas e paradas preservam a regra operacional", () => {
  const unread = conversation({ id: "unread", unreadCount: 2, lastActivityAt: new Date("2026-08-16T14:58:00.000Z") });
  const stalled = conversation({ id: "stalled", lastActivityAt: new Date("2026-08-16T14:30:00.000Z") });
  assert.deepEqual(filterAndSortInbox([unread, stalled], { filter: "unread", sort: "recent", now }).map((item) => item.id), ["unread"]);
  assert.deepEqual(filterAndSortInbox([unread, stalled], { filter: "stalled", sort: "recent", now }).map((item) => item.id), ["stalled"]);
});

test("ordenação por maior espera coloca primeiro quem aguarda há mais tempo", () => {
  const recent = conversation({ id: "recent", lastActivityAt: new Date("2026-08-16T14:50:00.000Z") });
  const waiting = conversation({ id: "waiting", status: "human_requested", requestedAt: new Date("2026-08-16T13:00:00.000Z") });
  const older = conversation({ id: "older", lastActivityAt: new Date("2026-08-16T14:00:00.000Z") });
  assert.deepEqual(filterAndSortInbox([recent, waiting, older], {
    filter: "all", sort: "longest_waiting", now,
  }).map((item) => item.id), ["waiting", "older", "recent"]);
});

test("tempo relativo usa minutos, horas e dias", () => {
  assert.equal(formatElapsed(new Date("2026-08-16T14:59:30.000Z"), now), "agora");
  assert.equal(formatElapsed(new Date("2026-08-16T14:45:00.000Z"), now), "há 15 min");
  assert.equal(formatElapsed(new Date("2026-08-16T12:00:00.000Z"), now), "há 3h");
  assert.equal(formatElapsed(new Date("2026-08-14T15:00:00.000Z"), now), "há 2d");
});

test("normaliza datas do Postgres sem depender do tipo retornado pelo driver", () => {
  assert.equal(normalizeDateOnly("2026-08-16"), "2026-08-16");
  assert.equal(normalizeDateOnly(new Date("2026-08-16T00:00:00.000Z")), "2026-08-16");
  assert.equal(normalizeDateOnly("2026-02-30"), undefined);
  assert.equal(normalizeDateOnly("data-invalida"), undefined);
});

test("rejeita timestamps inválidos antes que alcancem a interface", () => {
  assert.equal(parseDateValue("2026-08-16T12:30:00.000Z")?.toISOString(), "2026-08-16T12:30:00.000Z");
  assert.equal(parseDateValue(new Date("invalid")), undefined);
  assert.equal(parseDateValue(null), undefined);
});

test("redirecionamento de formulário aceita somente caminhos da inbox", () => {
  assert.equal(safeInboxReturnPath("/handoff?filter=unread"), "/handoff?filter=unread");
  assert.equal(safeInboxReturnPath("https://example.com"), "/handoff");
  assert.equal(safeInboxReturnPath("//example.com/handoff"), "/handoff");
  assert.equal(safeInboxReturnPath("/handoff-externo"), "/handoff");
});
