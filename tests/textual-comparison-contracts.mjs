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
  VERSE_MAP_TYPES,
  assertValidTextualComparisonRecord,
  sourceTokenIdentityKey,
  validateAlignmentEdge,
  validateCrossCorpusLemmaLink,
  validateSourceToken,
  validateTextWitness,
  validateVerseMap,
  witnessVoteKey,
} from "../app/src/textual-comparison-contracts.js";

const provenance = (authority, sourceId = `fixture:${authority}`) => [
  { source_id: sourceId, revision: "fixture-v1", authority },
];

const witness = ({ id, language, script, versification, representations, license = "fixture-only" }) => ({
  schema_version: TEXTUAL_COMPARISON_SCHEMA_VERSION,
  id,
  language,
  script,
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
  provenance: provenance("versification", "stepbible:tvtms@ea47bd4c7eab7375f2dca07086ccc356e95a4128"),
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
  lxx_witness_id: "swete:lxx",
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
  check(() => assert.equal(wlcWitness.representations.length, 2));
  check(() => assert.equal(witnessVoteKey(pointedWlcToken), witnessVoteKey(consonantalWlcToken)));
  check(() => assert.equal(sourceTokenIdentityKey(pointedWlcToken), sourceTokenIdentityKey(consonantalWlcToken)));
  check(() => assert.deepEqual(validateSourceToken(sweteSourceOnlyToken), []));
  check(() => assert.equal(sweteSourceOnlyToken.canonical_reference, null));
  check(() => assert.equal(sweteSourceOnlyToken.lemma, null));
  check(() => assert.equal(sweteSourceOnlyToken.morphology, null));

  check(() => assert.deepEqual(validateVerseMap(exactVerseMap), []));
  check(() => assert.deepEqual(validateVerseMap(acceptedPsalmDivergence), []));
  check(() => assert.equal(acceptedPsalmDivergence.map_type, "merged"));
  check(() => assert.deepEqual(acceptedPsalmDivergence.source_references, ["Ps.50.1", "Ps.50.2", "Ps.50.3"]));
  check(() => assert.deepEqual(acceptedPsalmDivergence.canonical_references, ["psalms/51/1"]));
  check(() => assert.deepEqual(validateVerseMap(sourceOnlyMap), []));
  check(() => assert.deepEqual(validateVerseMap(canonicalOnlyMap), []));

  alignmentFixtures.forEach((fixture) => {
    check(() => assert.deepEqual(validateAlignmentEdge(fixture), [], fixture.id));
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
    verseMaps: 4,
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
