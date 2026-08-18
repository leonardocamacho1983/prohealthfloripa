import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeMassageRequest,
  buildConfirmedMassageAnswer,
  massageReplyCoversConfirmedMentions,
  massageReplyContradictsConfirmedCatalog,
  missingConfirmedMassageMentions,
  normalizeMassageCatalogText,
} from "./massage-catalog-semantics.ts";

test("normalizes accents and hyphen variants without changing catalog meaning", () => {
  assert.equal(normalizeMassageCatalogText("  Liberação Mío-Fascial! "), "liberacao mio fascial");
  assert.equal(normalizeMassageCatalogText("Lomi‑Lomi"), "lomi lomi");
});

test("maps confirmed liberation aliases to Miofascial", () => {
  for (const input of [
    "liberação",
    "liberacao miofascial",
    "miofacial",
    "liberação miofacial",
    "liberação mío-fascial",
  ]) {
    const analysis = analyzeMassageRequest(`Vocês têm ${input}?`);
    assert.equal(analysis.mentions.length, 1, input);
    assert.equal(analysis.mentions[0]?.canonicalName, "Miofascial");
    assert.equal(analysis.mentions[0]?.categoryLabel, "tradicional/clássica");
    assert.equal(analysis.mentions[0]?.singlePrice, "R$ 270");
    assert.equal(analysis.needsClarification, false);
  }
});

test("accepts light unambiguous typos with medium confidence", () => {
  const analysis = analyzeMassageRequest("Quero uma miofassial");
  assert.equal(analysis.mentions[0]?.canonicalName, "Miofascial");
  assert.equal(analysis.mentions[0]?.matchType, "fuzzy");
  assert.equal(analysis.mentions[0]?.confidence, "medium");
  assert.equal(analysis.mentions[0]?.needsClarification, false);
});

test("requires massage or commercial context for fuzzy names and bare liberation", () => {
  for (const input of [
    "liberação",
    "Isso é relevante para mim",
    "Quero registrar um ponto relevante",
    "Aguardando liberação médica",
    "Preciso de liberação financeira",
    "Saiu a liberação judicial",
    "Liberação técnica do sistema",
  ]) {
    const analysis = analyzeMassageRequest(input);
    assert.deepEqual(analysis.mentions, [], input);
    assert.equal(analysis.massageRelated, false, input);
  }

  for (const input of [
    "Vocês têm liberação?",
    "Quero uma liberação para dor no ombro",
    "Quanto custa a liberação?",
  ]) {
    assert.equal(analyzeMassageRequest(input).mentions[0]?.canonicalName, "Miofascial", input);
  }

  assert.deepEqual(analyzeMassageRequest("miofassial").mentions, []);
  assert.equal(analyzeMassageRequest("Quero uma miofassial").mentions[0]?.canonicalName, "Miofascial");
});

test("extracts multiple confirmed services from a message burst in order", () => {
  const analysis = analyzeMassageRequest([
    "Queria comparar Lomi-Lomi com Thai",
    "e talvez Abhyanga ou Shirodhara",
  ]);
  assert.deepEqual(
    analysis.mentions.map((mention) => mention.canonicalName),
    ["Lomi-Lomi", "Thai / Thai Yoga", "Abhyanga", "Shirodhara"],
  );
  assert.deepEqual(
    analysis.mentions.map((mention) => mention.singlePrice),
    ["R$ 270", "R$ 300", "R$ 300", "R$ 300"],
  );
});

test("keeps the confirmed duration and category for special techniques", () => {
  const thai = analyzeMassageRequest("Thai é tradicional ou especial?").mentions[0];
  assert.equal(thai?.canonicalName, "Thai / Thai Yoga");
  assert.equal(thai?.categoryLabel, "especial");
  assert.equal(thai?.duration, "1h");

  const shirodhara = analyzeMassageRequest("Quanto tempo dura Shirodhara?").mentions[0];
  assert.equal(shirodhara?.categoryLabel, "especial");
  assert.equal(shirodhara?.duration, "50 min");
});

test("keeps Ayurvédica and Thai as distinct confirmed techniques", () => {
  const analysis = analyzeMassageRequest("Compare Ayurvédica e Thai Yoga");
  assert.deepEqual(
    analysis.mentions.map((mention) => mention.canonicalName),
    ["Ayurvédica", "Thai / Thai Yoga"],
  );
});

test("marks an unknown massage technique for clarification without grounding it as fact", () => {
  const analysis = analyzeMassageRequest("Quanto custa massagem com pedras vulcânicas?");
  assert.equal(analysis.massageRelated, true);
  assert.deepEqual(analysis.mentions, []);
  assert.equal(analysis.needsClarification, true);
  assert.match(analysis.grounding ?? "", /Não invente nem negue uma técnica/);
});

test("detects a contradiction and builds a direct repair answer", () => {
  const analysis = analyzeMassageRequest("Ué, mas você disse que não tem liberação miofacial");
  assert.equal(analysis.repairRequested, true);
  assert.match(analysis.grounding ?? "", /Comece reconhecendo o erro/);
  assert.equal(
    buildConfirmedMassageAnswer(analysis),
    "Você tem razão — eu me expressei mal. Temos sim a massagem miofascial, também chamada de liberação miofascial. Ela é da categoria tradicional/clássica e custa R$ 270 no avulso.",
  );
});

test("uses a previous assistant denial as repair context", () => {
  const analysis = analyzeMassageRequest("Então tem miofascial?", {
    previousAssistantMessages: ["Esse nome exato não aparece no nosso catálogo."],
  });
  assert.equal(analysis.repairRequested, true);
  assert.match(buildConfirmedMassageAnswer(analysis) ?? "", /^Você tem razão/);
});

test("a completed correction does not keep apologizing in later turns", () => {
  const analysis = analyzeMassageRequest("E quanto custa miofascial?", {
    previousAssistantMessages: [
      "Esse nome exato não aparece no nosso catálogo.",
      "Você tem razão — temos sim a massagem miofascial por R$ 270.",
    ],
  });
  assert.equal(analysis.repairRequested, false);
  assert.doesNotMatch(buildConfirmedMassageAnswer(analysis) ?? "", /^Você tem razão/);
});

test("ties repair context to the current technique and latest relevant answer", () => {
  const unrelatedDenial = analyzeMassageRequest("Thai custa quanto?", {
    previousAssistantMessages: ["Não trabalhamos com Lomi-Lomi."],
  });
  assert.equal(unrelatedDenial.repairRequested, false);

  const earlierRelevantDenial = analyzeMassageRequest("Thai custa quanto?", {
    previousAssistantMessages: [
      "Não trabalhamos com Thai.",
      "Lomi-Lomi é tradicional e custa R$ 270.",
    ],
  });
  assert.equal(earlierRelevantDenial.repairRequested, true);

  const latestRelevantCorrection = analyzeMassageRequest("Thai custa quanto?", {
    previousAssistantMessages: [
      "Não trabalhamos com Thai.",
      "Na verdade, Thai é especial e custa R$ 300.",
      "Lomi-Lomi é tradicional e custa R$ 270.",
    ],
  });
  assert.equal(latestRelevantCorrection.repairRequested, false);

  const surpriseWithoutDenial = analyzeMassageRequest("Ué, Thai custa quanto?");
  assert.equal(surpriseWithoutDenial.repairRequested, false);
});

test("builds a deterministic concise answer for multiple confirmed techniques", () => {
  const analysis = analyzeMassageRequest("Compare Lomi-Lomi, Thai, Abhyanga e Shirodhara");
  assert.equal(
    buildConfirmedMassageAnswer(analysis),
    "Lomi-Lomi: tradicional/clássica, R$ 270 no avulso; Thai: especial, R$ 300 no avulso, duração de 1h; Abhyanga: especial, R$ 300 no avulso, duração de 1h; Shirodhara: especial, R$ 300 no avulso, duração de 50 min.",
  );
});

test("associates category and price claims with the nearest technique in comparisons", () => {
  const analysis = analyzeMassageRequest("Compare Thai e Lomi-Lomi");

  assert.equal(
    massageReplyContradictsConfirmedCatalog(
      analysis,
      "Thai é especial e custa R$ 300; Lomi-Lomi é tradicional/clássica e custa R$ 270.",
    ),
    false,
  );
  assert.equal(
    massageReplyContradictsConfirmedCatalog(
      analysis,
      "Thai é especial e Lomi-Lomi é tradicional/clássica.",
    ),
    false,
  );
  assert.equal(
    massageReplyContradictsConfirmedCatalog(
      analysis,
      "Thai é tradicional e Lomi-Lomi é especial.",
    ),
    true,
  );
  assert.equal(
    massageReplyContradictsConfirmedCatalog(
      analysis,
      "Thai custa R$ 270 e Lomi-Lomi custa R$ 300.",
    ),
    true,
  );
});

test("does not attribute a different service price to a massage pronoun", () => {
  const analysis = analyzeMassageRequest("Quero Lomi-Lomi e quanto custa Pilates 2x?");
  assert.equal(
    massageReplyContradictsConfirmedCatalog(
      analysis,
      "Ela custa R$ 270. O Pilates 2x custa R$ 420.",
    ),
    false,
  );
  assert.equal(
    massageReplyContradictsConfirmedCatalog(
      analysis,
      "Ela custa R$ 300. O Pilates 2x custa R$ 420.",
    ),
    true,
  );
});

test("associates duration claims with each named special technique", () => {
  const analysis = analyzeMassageRequest("Compare Thai e Shirodhara");
  assert.equal(
    massageReplyContradictsConfirmedCatalog(
      analysis,
      "Thai dura 1h e Shirodhara dura 50 min.",
    ),
    false,
  );
  assert.equal(
    massageReplyContradictsConfirmedCatalog(
      analysis,
      "Thai dura 50 min e Shirodhara dura 1h.",
    ),
    true,
  );
});

test("reports coverage by canonical names or confirmed aliases, never fuzzy echoes", () => {
  const comparison = analyzeMassageRequest("Compare Thai, Lomi-Lomi e Abhyanga");
  assert.equal(
    massageReplyCoversConfirmedMentions(
      comparison,
      "Thai é especial, Lomi-Lomi é tradicional e Abhyanga é especial.",
    ),
    true,
  );
  assert.equal(
    massageReplyCoversConfirmedMentions(comparison, "Thai é especial e Abhyanga é especial."),
    false,
  );
  assert.deepEqual(
    missingConfirmedMassageMentions(comparison, "Thai é especial e Abhyanga é especial.")
      .map((mention) => mention.canonicalName),
    ["Lomi-Lomi"],
  );

  const liberation = analyzeMassageRequest("Vocês têm liberação?");
  assert.equal(massageReplyCoversConfirmedMentions(liberation, "Temos liberação por R$ 270."), true);
  assert.equal(massageReplyCoversConfirmedMentions(liberation, "Temos miofascial por R$ 270."), true);
  assert.equal(massageReplyCoversConfirmedMentions(liberation, "Temos relaxante por R$ 270."), false);

  const typo = analyzeMassageRequest("Quero miofassial");
  assert.equal(massageReplyCoversConfirmedMentions(typo, "A miofassial custa R$ 270."), false);
  assert.equal(massageReplyCoversConfirmedMentions(typo, "A Miofascial custa R$ 270."), true);
});

test("detects denials, wrong categories and wrong prices for every confirmed technique", () => {
  const techniques = [
    { query: "Miofascial", category: "tradicional", wrongCategory: "especial", price: 270, wrongPrice: 300 },
    { query: "Relaxante", category: "tradicional", wrongCategory: "especial", price: 270, wrongPrice: 300 },
    { query: "Drenagem linfática", category: "tradicional", wrongCategory: "especial", price: 270, wrongPrice: 300 },
    { query: "Shiatsu", category: "tradicional", wrongCategory: "especial", price: 270, wrongPrice: 300 },
    { query: "Desportiva", category: "tradicional", wrongCategory: "especial", price: 270, wrongPrice: 300 },
    { query: "Sueca", category: "tradicional", wrongCategory: "especial", price: 270, wrongPrice: 300 },
    { query: "Lomi-Lomi", category: "tradicional", wrongCategory: "especial", price: 270, wrongPrice: 300 },
    { query: "Tuiná", category: "tradicional", wrongCategory: "especial", price: 270, wrongPrice: 300 },
    { query: "Thai", category: "especial", wrongCategory: "tradicional", price: 300, wrongPrice: 270 },
    { query: "Shiro Abhyanga", category: "especial", wrongCategory: "tradicional", price: 300, wrongPrice: 270 },
    { query: "Pada Abhyanga", category: "especial", wrongCategory: "tradicional", price: 300, wrongPrice: 270 },
    { query: "Abhyanga", category: "especial", wrongCategory: "tradicional", price: 300, wrongPrice: 270 },
    { query: "Shirodhara", category: "especial", wrongCategory: "tradicional", price: 300, wrongPrice: 270 },
    { query: "Bastis localizados", category: "especial", wrongCategory: "tradicional", price: 300, wrongPrice: 270 },
    { query: "Massagem Indiana, método tatame", category: "especial", wrongCategory: "tradicional", price: 300, wrongPrice: 270 },
  ] as const;

  for (const technique of techniques) {
    const analysis = analyzeMassageRequest(`Quanto custa ${technique.query}?`);
    assert.equal(analysis.mentions.length, 1, technique.query);
    assert.equal(
      massageReplyContradictsConfirmedCatalog(analysis, `Não trabalhamos com ${technique.query}.`),
      true,
      `${technique.query}: denial`,
    );
    assert.equal(
      massageReplyContradictsConfirmedCatalog(analysis, `${technique.query} é da categoria ${technique.wrongCategory}.`),
      true,
      `${technique.query}: category`,
    );
    assert.equal(
      massageReplyContradictsConfirmedCatalog(analysis, `${technique.query} custa R$ ${technique.wrongPrice} no avulso.`),
      true,
      `${technique.query}: price`,
    );
    assert.equal(
      massageReplyContradictsConfirmedCatalog(
        analysis,
        `${technique.query} é da categoria ${technique.category} e custa R$ ${technique.price} no avulso.`,
      ),
      false,
      `${technique.query}: confirmed facts`,
    );
  }
});

test("detects wrong or invented durations across Thai, Abhyanga, Shirodhara and Lomi-Lomi", () => {
  const cases = [
    { query: "Thai", correct: "1h", wrong: "30 min" },
    { query: "Abhyanga", correct: "1 hora", wrong: "50 min" },
    { query: "Shiro Abhyanga", correct: "30 minutos", wrong: "1h" },
    { query: "Pada Abhyanga", correct: "30 min", wrong: "50 min" },
    { query: "Shirodhara", correct: "50 min", wrong: "1h" },
    { query: "Bastis localizados", correct: "60 min", wrong: "30 min" },
    { query: "Massagem Indiana", correct: "1h", wrong: "50 min" },
  ] as const;

  for (const item of cases) {
    const analysis = analyzeMassageRequest(item.query);
    assert.equal(
      massageReplyContradictsConfirmedCatalog(analysis, `${item.query} dura ${item.wrong}.`),
      true,
      `${item.query}: wrong duration`,
    );
    assert.equal(
      massageReplyContradictsConfirmedCatalog(analysis, `${item.query} dura ${item.correct}.`),
      false,
      `${item.query}: correct duration`,
    );
  }

  const lomi = analyzeMassageRequest("Lomi-Lomi");
  assert.equal(
    massageReplyContradictsConfirmedCatalog(lomi, "Lomi-Lomi dura 1h."),
    true,
    "Lomi-Lomi: unconfirmed duration must not be invented",
  );

  const thai = analyzeMassageRequest("Thai");
  assert.equal(massageReplyContradictsConfirmedCatalog(thai, "Thai dura uma hora."), false);
  assert.equal(massageReplyContradictsConfirmedCatalog(thai, "Thai dura meia hora."), true);
});

test("does not turn financial liberation or a Pilates technique into massage", () => {
  for (const input of ["Preciso de liberação financeira", "Qual é a técnica de Pilates?"]) {
    const analysis = analyzeMassageRequest(input);
    assert.equal(analysis.massageRelated, false, input);
    assert.deepEqual(analysis.mentions, [], input);
  }
});

test("blocks a false catalog denial without mistaking an availability caveat for one", () => {
  const analysis = analyzeMassageRequest("Vocês fazem liberação?");

  assert.equal(
    massageReplyContradictsConfirmedCatalog(
      analysis,
      "Esse nome exato não aparece no nosso catálogo.",
    ),
    true,
  );
  assert.equal(
    massageReplyContradictsConfirmedCatalog(
      analysis,
      "Não temos como confirmar horários agora, mas temos a massagem miofascial por R$ 270.",
    ),
    false,
  );
  assert.equal(
    massageReplyContradictsConfirmedCatalog(
      analysis,
      "Temos sim a massagem miofascial, também chamada de liberação miofascial.",
    ),
    false,
  );
});

test("ignores a non-catalog conversation", () => {
  const analysis = analyzeMassageRequest("Qual é o endereço?");
  assert.equal(analysis.massageRelated, false);
  assert.deepEqual(analysis.mentions, []);
  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.grounding, undefined);
});
