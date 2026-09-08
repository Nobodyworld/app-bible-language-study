#!/usr/bin/env node

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import {
  ALIGNMENT_STATES,
  CROSS_CORPUS_LEMMA_LINK_TYPES,
  PASSAGE_RELATION_TYPES,
  SEPTUAGINT_PHASE1_BOUNDARY,
  TEXTUAL_COMPARISON_CONTRACT,
  TEXTUAL_COMPARISON_SCHEMA_VERSION,
  TEXT_WITNESS_COVERAGE_SCOPES,
  VERSE_MAP_TYPES,
  assertValidTextualComparisonRecord,
  sourceTokenIdentityKey,
  validateAlignmentEdge,
  validateCrossCorpusLemmaLink,
  validatePassageRelation,
  validateSourceToken,
  validateTextWitness,
  validateVerseMap,
  witnessVoteKey,
} from "../app/src/textual-comparison-contracts.js";

const provenance = (authority, sourceId = `fixture:${authority}`) => [
  { source_id: sourceId, revision: "fixture-v1", authority },
];

const witness = ({ id, language, script, canon, coverage, versification, representations, license = "fixture-only" }) => ({
  schema_version: TEXTUAL_COMPARISON_SCHEMA_VERSION,
  id,
  language,
  script,
  canon,
  coverage,
  edition: { name: `Fixture ${id}`, version: "fixture-v1" },
  versification,
  normalization_profile: "unicode-nfc",
  representations,
  rights: { license_id: license, delivery: "fixture-only" },
  provenance: provenance("text"),
});

const wlcWitness = witness({
  id: "openbible:wlc",
  language: "hebrew",
  script: "Hebrew",
  canon: "fixture:hebrew-canon",
  coverage: [{ source_book_id: "Gen", scope: "partial", source_references: ["Gen.1.1"] }],
  versification: "openbible:wlc:source-references",
  representations: [
    { id: "pointed", display: "Pointed Hebrew", normalization_profile: "unicode-nfc" },
    { id: "consonants-only", display: "Consonants-only Hebrew", normalization_profile: "unicode-nfc" },
  ],
});

const sweteWitness = witness({
  id: "swete:lxx",
  language: "greek",
  script: "Greek",
  canon: "fixture:greek-canon",
  coverage: [
    { source_book_id: "Gen", scope: "partial", source_references: ["Gen.1.1"] },
    { source_book_id: "Ps", scope: "partial", source_references: ["Ps.50.1", "Ps.50.2", "Ps.50.3"] },
    { source_book_id: "FixtureAddition", scope: "unknown", source_references: [] },
  ],
  versification: "swete:source-references",
  representations: [
    { id: "source-text", display: "Swete Greek", normalization_profile: "unicode-nfc" },
  ],
  license: "CC-BY-SA-4.0",
});

function token({
  id,
  witnessId,
  versification,
  sourceReference,
  canonicalReference = null,
  tokenIndex,
  representationId,
  surface,
  lemma = null,
  morphology = null,
  transliteration = null,
}) {
  return {
    schema_version: TEXTUAL_COMPARISON_SCHEMA_VERSION,
    id,
    witness_id: witnessId,
    versification,
    source_reference: sourceReference,
    canonical_reference: canonicalReference,
    token_index: tokenIndex,
    representation_id: representationId,
    surface,
    normalized_forms: { nfc: surface.normalize("NFC") },
    lemma,
    morphology,
    transliteration,
    external_ids: [],
    provenance: provenance("text"),
  };
}

const pointedWlcToken = token({
  id: "token:wlc:gen1-1:1:pointed",
  witnessId: "openbible:wlc",
  versification: "openbible:wlc:source-references",
  sourceReference: "Gen.1.1",
  canonicalReference: "genesis/1/1",
  tokenIndex: 1,
  representationId: "pointed",
  surface: "א",
});

const consonantalWlcToken = token({
  id: "token:wlc:gen1-1:1:consonantal",
  witnessId: "openbible:wlc",
  versification: "openbible:wlc:source-references",
  sourceReference: "Gen.1.1",
  canonicalReference: "genesis/1/1",
  tokenIndex: 1,
  representationId: "consonants-only",
  surface: "א",
});

const sweteSourceOnlyToken = token({
  id: "token:swete:fixture:1",
  witnessId: "swete:lxx",
  versification: "swete:source-references",
  sourceReference: "Fixture.1.1",
  canonicalReference: null,
  tokenIndex: 1,
  representationId: "source-text",
  surface: "α",
});

const exactVerseMap = {
  schema_version: TEXTUAL_COMPARISON_SCHEMA_VERSION,
  id: "verse-map:fixture:exact",
  witness_id: "swete:lxx",
  source_versification: "swete:source-references",
  source_references: ["Gen.1.1"],
  canonical_references: ["genesis/1/1"],
  map_type: "exact",
  provenance: provenance("versification"),
  review_status: "reviewed",
};

const acceptedPsalmDivergence = {
  schema_version: TEXTUAL_COMPARISON_SCHEMA_VERSION,
  id: "verse-map:swete:ps50-1-3:app-ps51-1",
  witness_id: "swete:lxx",
  source_versification: "swete:source-references",
  source_references: ["Ps.50.1", "Ps.50.2", "Ps.50.3"],
  canonical_references: ["psalms/51/1"],
  map_type: "merged",
  // Bounded reference metadata credited to STEPBible.org / Tyndale House,
  // CC BY 4.0; selected, expanded and projected onto app targets per #97.
  provenance: [
    { source_id: "stepbible:tvtms", revision: "ea47bd4c7eab7375f2dca07086ccc356e95a4128", authority: "versification" },
    ...provenance("versification", "fixture:app-title-merge-projection"),
  ],
  review_status: "reviewed",
};

const sourceOnlyMap = {
  schema_version: TEXTUAL_COMPARISON_SCHEMA_VERSION,
  id: "verse-map:fixture:source-only",
  witness_id: "fixture:greek",
  source_versification: "fixture:greek:source-references",
  source_references: ["FixtureAddition.1.1"],
  canonical_references: [],
  map_type: "source-only",
  provenance: provenance("versification"),
  review_status: "source-provided",
};

const canonicalOnlyMap = {
  schema_version: TEXTUAL_COMPARISON_SCHEMA_VERSION,
  id: "verse-map:fixture:canonical-only",
  witness_id: "fixture:greek",
  source_versification: "fixture:greek:source-references",
  source_references: [],
  canonical_references: ["fixture/1/1"],
  map_type: "canonical-only",
  provenance: provenance("versification"),
  review_status: "reviewed",
};

const generatedEvidence = {
  class: "deterministic-generated-candidate",
  algorithm_id: "fixture:alignment-rules-v1",
  confidence: null,
};
const sourceEvidence = {
  class: "source-provided",
  source_id: "fixture:alignment-source",
  confidence: null,
};
const reviewedEvidence = {
  class: "manually-reviewed",
  reviewer_id: "fixture:reviewer",
  basis: "Synthetic contract fixture review.",
  confidence: null,
};

const alignment = (id, state, hebrew, greek, evidence = generatedEvidence, reviewStatus = "generated-candidate") => ({
  schema_version: TEXTUAL_COMPARISON_SCHEMA_VERSION,
  id,
  state,
  hebrew_token_ids: hebrew,
  greek_token_ids: greek,
  evidence,
  provenance: provenance("alignment"),
  review_status: reviewStatus,
});

const alignmentFixtures = [
  alignment("alignment:fixture:1-1", "aligned-1:1", ["h1"], ["g1"], sourceEvidence, "source-provided"),
  alignment("alignment:fixture:1-n", "aligned-1:n", ["h2"], ["g2", "g3"]),
  alignment("alignment:fixture:n-1", "aligned-n:1", ["h3", "h4"], ["g4"]),
  alignment("alignment:fixture:n-m", "aligned-n:m", ["h5", "h6"], ["g5", "g6"]),
  alignment("alignment:fixture:reordered", "reordered", ["h7", "h8"], ["g7", "g8"]),
  alignment("alignment:fixture:hebrew-unaligned", "hebrew-unaligned", ["h9"], []),
  alignment("alignment:fixture:greek-unaligned", "greek-unaligned", [], ["g9"]),
  alignment("alignment:fixture:lexical-substitution", "lexical-substitution", ["h10"], ["g10"], reviewedEvidence, "reviewed"),
  alignment("alignment:fixture:uncertain", "uncertain", ["h11"], ["g11"]),
];

const exactLemmaLink = {
  schema_version: TEXTUAL_COMPARISON_SCHEMA_VERSION,
  id: "lemma-link:fixture:exact",
  // Synthetic lexical authority; this does not assign lemmas to Swete tokens.
  lxx_witness_id: "fixture:annotated-greek",
  lxx_lemma_id: "lemma:fixture:alpha",
  nt_witness_id: "openbible:nestle-1904",
  nt_lemma_id: "lemma:fixture:alpha",
  link_type: "exact-canonical-lemma",
  evidence: sourceEvidence,
  provenance: provenance("lexical_relation"),
  review_status: "source-provided",
};

const unresolvedLemmaCandidate = {
  ...exactLemmaLink,
  id: "lemma-link:fixture:candidate",
  lxx_lemma_id: "lemma:fixture:candidate-a",
  nt_lemma_id: "lemma:fixture:candidate-b",
  link_type: "unresolved-candidate",
  evidence: generatedEvidence,
  review_status: "generated-candidate",
};

const passageRelation = {
  schema_version: TEXTUAL_COMPARISON_SCHEMA_VERSION,
  id: "passage-relation:fixture:explicit",
  source_passage_id: "old-testament:fixture:1:1",
  receiving_passage_id: "new-testament:fixture:1:1",
  relation_type: "explicit-citation",
  evidence: sourceEvidence,
  provenance: provenance("passage_relation"),
  review_status: "source-provided",
};

export function runTextualComparisonContractTests() {
  let checks = 0;
  const check = (fn) => {
    fn();
    checks += 1;
  };

  check(() => assert.equal(TEXTUAL_COMPARISON_CONTRACT.schema_version, 1));
  check(() => assert.deepEqual(TEXTUAL_COMPARISON_CONTRACT.source_token_identity_fields, [
    "witness_id",
    "versification",
    "source_reference",
    "token_index",
  ]));
  check(() => assert.equal(TEXTUAL_COMPARISON_CONTRACT.witness_vote_key, "witness_id"));
  check(() => assert.deepEqual(VERSE_MAP_TYPES, ["exact", "split", "merged", "moved", "source-only", "canonical-only", "unavailable", "uncertain"]));
  check(() => assert.deepEqual(ALIGNMENT_STATES, [
    "aligned-1:1",
    "aligned-1:n",
    "aligned-n:1",
    "aligned-n:m",
    "reordered",
    "hebrew-unaligned",
    "greek-unaligned",
    "lexical-substitution",
    "uncertain",
  ]));
  check(() => assert.deepEqual(CROSS_CORPUS_LEMMA_LINK_TYPES, [
    "exact-canonical-lemma",
    "normalized-alias",
    "documented-lexical-relation",
    "unresolved-candidate",
  ]));
  check(() => assert.deepEqual(PASSAGE_RELATION_TYPES, [
    "explicit-citation",
    "formula-citation",
    "probable-quotation",
    "allusion",
    "thematic-parallel",
  ]));

  check(() => assert.deepEqual(validateTextWitness(wlcWitness), []));
  check(() => assert.deepEqual(validateTextWitness(sweteWitness), []));
  check(() => assert.deepEqual(TEXT_WITNESS_COVERAGE_SCOPES, ["complete", "partial", "unknown"]));
  for (const field of ["canon", "coverage", "edition", "rights", "provenance", "versification", "normalization_profile"]) {
    check(() => {
      const invalid = { ...wlcWitness };
      delete invalid[field];
      assert.ok(validateTextWitness(invalid).some((item) => item.path === `$.${field}`), field);
    });
  }
  for (const [field, key] of [["edition", "name"], ["edition", "version"], ["rights", "license_id"], ["rights", "delivery"]]) {
    check(() => {
      const invalid = { ...wlcWitness, [field]: { ...wlcWitness[field], [key]: "" } };
      assert.ok(validateTextWitness(invalid).some((item) => item.path === `$.${field}.${key}`));
    });
  }
  for (const coverage of [
    [{ source_book_id: "FixtureAddition", scope: "complete", source_references: [] }],
    [{ source_book_id: "Ps", scope: "partial", source_references: ["Ps.144.13a"] }],
  ]) {
    check(() => assert.deepEqual(validateTextWitness({ ...sweteWitness, coverage }), []));
  }
  for (const coverage of [
    [],
    [null],
    [{ source_book_id: "", scope: "unknown", source_references: [] }],
    [{ source_book_id: "Gen", scope: "invented", source_references: [] }],
    [{ source_book_id: "Gen", scope: "partial", source_references: [] }],
    [{ source_book_id: "Gen", scope: "partial", source_references: ["Gen.1.1", "Gen.1.1"] }],
    [{ source_book_id: "Gen", scope: "complete", source_references: ["Gen.1.1"] }],
    [{ source_book_id: "Gen", scope: "unknown", source_references: ["Gen.1.1"] }],
    [...wlcWitness.coverage, ...wlcWitness.coverage],
  ]) {
    check(() => assert.ok(validateTextWitness({ ...wlcWitness, coverage }).length));
  }
  check(() => assert.ok(validateTextWitness({ ...wlcWitness, representations: [...wlcWitness.representations, wlcWitness.representations[0]] })
    .some((item) => item.code === "representation.duplicate")));
  check(() => assert.deepEqual(validateTextWitness({
    ...wlcWitness,
    representations: [...wlcWitness.representations, { id: "fixture-normalized", display: "Synthetic normalized view", normalization_profile: "fixture:lossy-alias" }],
  }), []));
  check(() => assert.equal(wlcWitness.representations.length, 2));
  check(() => assert.equal(witnessVoteKey(pointedWlcToken), witnessVoteKey(consonantalWlcToken)));
  check(() => assert.equal(sourceTokenIdentityKey(pointedWlcToken), sourceTokenIdentityKey(consonantalWlcToken)));
  check(() => assert.deepEqual(validateSourceToken(sweteSourceOnlyToken), []));
  check(() => assert.equal(sweteSourceOnlyToken.canonical_reference, null));
  check(() => assert.equal(sweteSourceOnlyToken.lemma, null));
  check(() => assert.equal(sweteSourceOnlyToken.morphology, null));

  // Every non-identity field can vary without changing a canonical occurrence.
  const identityVariants = [
    { id: "fixture:another-record" },
    { representation_id: "consonants-only" },
    { representation_id: null },
    { canonical_reference: null },
    { segment_index: 2 },
    { group_index: 3 },
    { segment_index: 2, group_index: 3 },
    { segment_index: null, group_index: null },
    { surface: "ב", normalized_forms: { nfc: "ב", alias: "fixture:b" } },
    { lemma: { id: "lemma:fixture:a", provenance: provenance("lemma") } },
    { morphology: { value: "fixture:m", scheme: "fixture:scheme", provenance: provenance("morphology") } },
    { transliteration: { value: "fixture:a", provenance: provenance("text") } },
    { external_ids: [{ system: "fixture", value: "another-id", provenance: provenance("text") }] },
    { provenance: provenance("text", "fixture:another-source") },
  ];
  for (const variant of identityVariants) {
    check(() => assert.equal(sourceTokenIdentityKey({ ...pointedWlcToken, ...variant }), sourceTokenIdentityKey(pointedWlcToken), JSON.stringify(variant)));
  }
  for (const variant of [
    { witness_id: "fixture:another-witness" },
    { versification: "fixture:another-versification" },
    { source_reference: "Gen.1.2" },
    { token_index: 2 },
  ]) {
    check(() => assert.notEqual(sourceTokenIdentityKey({ ...pointedWlcToken, ...variant }), sourceTokenIdentityKey(pointedWlcToken)));
  }
  for (const field of ["token_index", "segment_index", "group_index"]) {
    for (const invalid of [0, -1, 1.5, "1", Number.MAX_SAFE_INTEGER + 1]) {
      check(() => assert.ok(validateSourceToken({ ...pointedWlcToken, [field]: invalid }).some((item) => item.path === `$.${field}`)));
    }
  }
  for (const [kind, annotation] of [
    ["lemma", { id: "lemma:fixture:unsupported", provenance: provenance("lemma") }],
    ["morphology", { value: "fixture:m", scheme: "fixture:scheme", provenance: provenance("morphology") }],
  ]) {
    check(() => assert.ok(validateSourceToken({ ...sweteSourceOnlyToken, [kind]: annotation })
      .some((item) => item.path === `$.${kind}` && item.code === "source-token.unsupported-annotation")));
  }
  check(() => {
    const unmapped = { ...sweteSourceOnlyToken, source_reference: "Ps.144.13a", segment_index: 1, group_index: 2 };
    const before = JSON.stringify(unmapped);
    assertValidTextualComparisonRecord("sourceToken", unmapped);
    sourceTokenIdentityKey(unmapped);
    assert.equal(JSON.stringify(unmapped), before, "Unmapped source identity and null annotations must be preserved without mutation.");
  });

  check(() => assert.deepEqual(validateVerseMap(exactVerseMap), []));
  check(() => assert.deepEqual(validateVerseMap(acceptedPsalmDivergence), []));
  check(() => assert.equal(acceptedPsalmDivergence.map_type, "merged"));
  check(() => assert.deepEqual(acceptedPsalmDivergence.source_references, ["Ps.50.1", "Ps.50.2", "Ps.50.3"]));
  check(() => assert.deepEqual(acceptedPsalmDivergence.canonical_references, ["psalms/51/1"]));
  check(() => assert.deepEqual(validateVerseMap(sourceOnlyMap), []));
  check(() => assert.deepEqual(validateVerseMap(canonicalOnlyMap), []));
  for (const fixture of [
    { ...exactVerseMap, map_type: "split", canonical_references: ["fixture/1/1", "fixture/1/2"] },
    { ...exactVerseMap, map_type: "moved", canonical_references: ["fixture/2/1"] },
    { ...sourceOnlyMap, map_type: "unavailable" },
    { ...sourceOnlyMap, map_type: "uncertain" },
  ]) {
    check(() => assert.deepEqual(validateVerseMap(fixture), [], fixture.map_type));
  }
  check(() => {
    const mappedTokens = acceptedPsalmDivergence.source_references.map((source_reference) => ({
      ...sweteSourceOnlyToken,
      source_reference,
      canonical_reference: "psalms/51/1",
    }));
    assert.equal(new Set(mappedTokens.map(sourceTokenIdentityKey)).size, 3, "Many-to-one verse mapping must retain three source identities.");
  });

  alignmentFixtures.forEach((fixture) => {
    check(() => assert.deepEqual(validateAlignmentEdge(fixture), [], fixture.id));
    check(() => assert.ok(validateAlignmentEdge({ ...fixture, hebrew_token_ids: [], greek_token_ids: [] })
      .some((item) => item.code === "alignment.cardinality"), fixture.state));
  });
  check(() => assert.equal(alignmentFixtures.filter((item) => item.state === "hebrew-unaligned").length, 1));
  check(() => assert.equal(alignmentFixtures.filter((item) => item.state === "greek-unaligned").length, 1));

  check(() => {
    const invalid = alignment("alignment:fixture:invalid-1-n", "aligned-1:n", ["h1"], ["g1"]);
    assert.ok(validateAlignmentEdge(invalid).some((item) => item.code === "alignment.cardinality"));
  });
  check(() => {
    const invalid = { ...alignmentFixtures[1], review_status: "reviewed" };
    assert.ok(validateAlignmentEdge(invalid).some((item) => item.code === "evidence.generated-review-state"));
  });
  check(() => {
    const invalid = { ...exactVerseMap, map_type: "merged" };
    assert.ok(validateVerseMap(invalid).some((item) => item.code === "verse-map.cardinality"));
  });
  check(() => {
    const invalid = {
      ...sweteSourceOnlyToken,
      lemma: { id: "lemma:fixture:unsupported", provenance: [] },
    };
    assert.ok(validateSourceToken(invalid).some((item) => item.code === "provenance.minimum"));
  });

  check(() => assert.deepEqual(validateCrossCorpusLemmaLink(exactLemmaLink), []));
  check(() => assert.deepEqual(validateCrossCorpusLemmaLink(unresolvedLemmaCandidate), []));
  for (const link_type of ["normalized-alias", "documented-lexical-relation"]) {
    check(() => assert.deepEqual(validateCrossCorpusLemmaLink({ ...exactLemmaLink, link_type, nt_lemma_id: "lemma:fixture:related" }), []));
  }
  check(() => assert.ok(validateCrossCorpusLemmaLink({ ...exactLemmaLink, nt_lemma_id: "lemma:fixture:different" })
    .some((item) => item.code === "lemma-link.exact-identity")));
  for (const [validate, fixture] of [
    [validateAlignmentEdge, alignmentFixtures[0]],
    [validateCrossCorpusLemmaLink, exactLemmaLink],
    [validatePassageRelation, passageRelation],
  ]) {
    check(() => assert.ok(validate({
      ...fixture,
      evidence: { ...generatedEvidence, confidence: 1, confidence_basis: "fixture:certainty-does-not-confer-review" },
      review_status: "reviewed",
    }).some((item) => item.code === "evidence.generated-review-state")));
    check(() => assert.ok(validate({ ...fixture, evidence: reviewedEvidence, review_status: "unreviewed" })
      .some((item) => item.code === "evidence.manual-review-state")));
  }
  for (const relation_type of PASSAGE_RELATION_TYPES) {
    check(() => assert.deepEqual(validatePassageRelation({ ...passageRelation, relation_type }), []));
  }
  check(() => {
    const invalid = { ...unresolvedLemmaCandidate, review_status: "reviewed" };
    assert.ok(validateCrossCorpusLemmaLink(invalid).some((item) => item.code === "lemma-link.candidate-review-state"));
  });
  check(() => assertValidTextualComparisonRecord("passageRelation", passageRelation));
  check(() => assert.equal(exactLemmaLink.link_type, "exact-canonical-lemma"));
  check(() => assert.equal(passageRelation.relation_type, "explicit-citation"));

  check(() => assert.equal(SEPTUAGINT_PHASE1_BOUNDARY.greek_text.witness_id, "swete:lxx"));
  check(() => assert.equal(SEPTUAGINT_PHASE1_BOUNDARY.greek_text.versification, "swete:source-references"));
  check(() => assert.equal(SEPTUAGINT_PHASE1_BOUNDARY.token_annotations.lemma, "unsupported"));
  check(() => assert.equal(SEPTUAGINT_PHASE1_BOUNDARY.token_annotations.morphology, "unsupported"));
  check(() => assert.equal(SEPTUAGINT_PHASE1_BOUNDARY.hebrew_greek_word_alignment, "unsupported"));
  check(() => assert.equal(SEPTUAGINT_PHASE1_BOUNDARY.production_corpus, "not-in-phase-1"));

  return {
    checks,
    witnesses: 2,
    verseMaps: 8,
    alignmentFixtures: alignmentFixtures.length,
    phase1Boundary: {
      lemma: SEPTUAGINT_PHASE1_BOUNDARY.token_annotations.lemma,
      morphology: SEPTUAGINT_PHASE1_BOUNDARY.token_annotations.morphology,
      wordAlignment: SEPTUAGINT_PHASE1_BOUNDARY.hebrew_greek_word_alignment,
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(runTextualComparisonContractTests(), null, 2));
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}
