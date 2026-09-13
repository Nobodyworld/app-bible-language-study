export const TEXTUAL_COMPARISON_SCHEMA_VERSION = 1;

export const TEXTUAL_AUTHORITY_KINDS = Object.freeze([
  "text",
  "lemma",
  "morphology",
  "alignment",
  "versification",
  "lexical_relation",
  "passage_relation",
]);

export const TEXT_WITNESS_LANGUAGES = Object.freeze(["hebrew", "aramaic", "greek"]);
export const TEXT_WITNESS_COVERAGE_SCOPES = Object.freeze(["complete", "partial", "unknown"]);
export const VERSE_MAP_TYPES = Object.freeze([
  "exact",
  "split",
  "merged",
  "moved",
  "source-only",
  "canonical-only",
  "unavailable",
  "uncertain",
]);
export const ALIGNMENT_STATES = Object.freeze([
  "aligned-1:1",
  "aligned-1:n",
  "aligned-n:1",
  "aligned-n:m",
  "reordered",
  "hebrew-unaligned",
  "greek-unaligned",
  "lexical-substitution",
  "uncertain",
]);
export const EVIDENCE_CLASSES = Object.freeze([
  "source-provided",
  "deterministic-generated-candidate",
  "manually-reviewed",
]);
export const REVIEW_STATES = Object.freeze([
  "source-provided",
  "generated-candidate",
  "reviewed",
  "unreviewed",
]);
export const CROSS_CORPUS_LEMMA_LINK_TYPES = Object.freeze([
  "exact-canonical-lemma",
  "normalized-alias",
  "documented-lexical-relation",
  "unresolved-candidate",
]);
export const PASSAGE_RELATION_TYPES = Object.freeze([
  "explicit-citation",
  "formula-citation",
  "probable-quotation",
  "allusion",
  "thematic-parallel",
]);

export const SEPTUAGINT_PHASE1_BOUNDARY = Object.freeze({
  schema_version: TEXTUAL_COMPARISON_SCHEMA_VERSION,
  decision_record: "docs/decisions/SEPTUAGINT_SOURCE_STACK.md",
  greek_text: Object.freeze({
    witness_id: "swete:lxx",
    versification: "swete:source-references",
    state: "contract-ready",
    delivery: "future-separately-licensed-optional-pack",
  }),
  versification: Object.freeze({
    authority: "stepbible:tvtms",
    state: "bounded-provider-contract",
  }),
  token_annotations: Object.freeze({
    lemma: "unsupported",
    morphology: "unsupported",
  }),
  hebrew_greek_word_alignment: "unsupported",
  lxx_nt_lexical_identity: "contract-only",
  production_corpus: "not-in-phase-1",
});

export const TEXTUAL_COMPARISON_CONTRACT = Object.freeze({
  schema_version: TEXTUAL_COMPARISON_SCHEMA_VERSION,
  source_token_identity_fields: Object.freeze([
    "witness_id",
    "versification",
    "source_reference",
    "token_index",
  ]),
  witness_vote_key: "witness_id",
  representation_identity_rule:
    "Display and normalization representations do not create independent witnesses or source-token identities.",
  nullable_source_annotations: Object.freeze(["lemma", "morphology", "transliteration"]),
  optional_source_position_fields: Object.freeze(["segment_index", "group_index"]),
  record_types: Object.freeze({
    textWitness: Object.freeze([
      "schema_version",
      "id",
      "language",
      "script",
      "canon",
      "coverage",
      "edition",
      "versification",
      "normalization_profile",
      "representations",
      "rights",
      "provenance",
    ]),
    sourceToken: Object.freeze([
      "schema_version",
      "id",
      "witness_id",
      "versification",
      "source_reference",
      "canonical_reference",
      "token_index",
      "segment_index",
      "group_index",
      "representation_id",
      "surface",
      "normalized_forms",
      "lemma",
      "morphology",
      "transliteration",
      "external_ids",
      "provenance",
    ]),
    verseMap: Object.freeze([
      "schema_version",
      "id",
      "witness_id",
      "source_versification",
      "source_references",
      "canonical_references",
      "map_type",
      "provenance",
      "review_status",
    ]),
    alignmentEdge: Object.freeze([
      "schema_version",
      "id",
      "state",
      "hebrew_token_ids",
      "greek_token_ids",
      "evidence",
      "provenance",
      "review_status",
    ]),
    crossCorpusLemmaLink: Object.freeze([
      "schema_version",
      "id",
      "lxx_witness_id",
      "lxx_lemma_id",
      "nt_witness_id",
      "nt_lemma_id",
      "link_type",
      "evidence",
      "provenance",
      "review_status",
    ]),
    passageRelation: Object.freeze([
      "schema_version",
      "id",
      "source_passage_id",
      "receiving_passage_id",
      "relation_type",
      "evidence",
      "provenance",
      "review_status",
    ]),
  }),
});

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function diagnostic(errors, path, code, message) {
  errors.push({ path, code, message });
}

function requireRecord(value, path, errors) {
  if (!isRecord(value)) {
    diagnostic(errors, path, "record.required", "Expected an object record.");
    return false;
  }
  return true;
}

function requireString(value, path, errors, { nullable = false } = {}) {
  if (nullable && value === null) return true;
  if (typeof value !== "string" || value.trim() === "") {
    diagnostic(errors, path, "string.required", nullable ? "Expected a non-empty string or null." : "Expected a non-empty string.");
    return false;
  }
  return true;
}

function requireInteger(value, path, errors, { minimum = null } = {}) {
  if (!Number.isSafeInteger(value)) {
    diagnostic(errors, path, "integer.required", "Expected a safe integer.");
    return false;
  }
  if (minimum !== null && value < minimum) {
    diagnostic(errors, path, "integer.minimum", `Expected an integer >= ${minimum}.`);
    return false;
  }
  return true;
}

function requireEnum(value, allowed, path, errors) {
  if (!allowed.includes(value)) {
    diagnostic(errors, path, "enum.invalid", `Expected one of: ${allowed.join(", ")}.`);
    return false;
  }
  return true;
}

function requireStringArray(value, path, errors, { minimum = 0 } = {}) {
  if (!Array.isArray(value)) {
    diagnostic(errors, path, "array.required", "Expected an array.");
    return false;
  }
  if (value.length < minimum) {
    diagnostic(errors, path, "array.minimum", `Expected at least ${minimum} item(s).`);
  }
  const seen = new Set();
  value.forEach((item, index) => {
    if (requireString(item, `${path}[${index}]`, errors)) {
      if (seen.has(item)) diagnostic(errors, `${path}[${index}]`, "array.duplicate", "Duplicate values are not allowed.");
      seen.add(item);
    }
  });
  return true;
}

function validateSchemaVersion(value, errors) {
  if (value?.schema_version !== TEXTUAL_COMPARISON_SCHEMA_VERSION) {
    diagnostic(errors, "$.schema_version", "schema.version", `Expected schema_version ${TEXTUAL_COMPARISON_SCHEMA_VERSION}.`);
  }
}

function validateProvenance(value, path, errors, { minimum = 1 } = {}) {
  if (!Array.isArray(value)) {
    diagnostic(errors, path, "provenance.required", "Expected a provenance array.");
    return;
  }
  if (value.length < minimum) diagnostic(errors, path, "provenance.minimum", `Expected at least ${minimum} provenance item(s).`);
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!requireRecord(item, itemPath, errors)) return;
    requireString(item.source_id, `${itemPath}.source_id`, errors);
    requireString(item.revision, `${itemPath}.revision`, errors);
    requireEnum(item.authority, TEXTUAL_AUTHORITY_KINDS, `${itemPath}.authority`, errors);
  });
}

function validateAnnotation(value, path, errors, kind) {
  if (value === null) return;
  if (!requireRecord(value, path, errors)) return;
  if (kind === "lemma") requireString(value.id, `${path}.id`, errors);
  if (kind === "morphology") {
    requireString(value.value, `${path}.value`, errors);
    requireString(value.scheme, `${path}.scheme`, errors);
  }
  if (kind === "transliteration") requireString(value.value, `${path}.value`, errors);
  validateProvenance(value.provenance, `${path}.provenance`, errors);
}

function validateEvidence(value, path, errors) {
  if (!requireRecord(value, path, errors)) return;
  if (!requireEnum(value.class, EVIDENCE_CLASSES, `${path}.class`, errors)) return;

  if (value.class === "source-provided") requireString(value.source_id, `${path}.source_id`, errors);
  if (value.class === "deterministic-generated-candidate") requireString(value.algorithm_id, `${path}.algorithm_id`, errors);
  if (value.class === "manually-reviewed") {
    requireString(value.reviewer_id, `${path}.reviewer_id`, errors);
    requireString(value.basis, `${path}.basis`, errors);
  }

  if (value.confidence !== null && value.confidence !== undefined) {
    if (typeof value.confidence !== "number" || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) {
      diagnostic(errors, `${path}.confidence`, "confidence.range", "Confidence must be null or a finite number from 0 through 1.");
    } else {
      requireString(value.confidence_basis, `${path}.confidence_basis`, errors);
    }
  }
}

function validateEvidenceReviewState(value, errors) {
  if (value.evidence?.class === "deterministic-generated-candidate" && value.review_status !== "generated-candidate") {
    diagnostic(errors, "$.review_status", "evidence.generated-review-state", "Generated candidates must remain generated-candidate until a separate reviewed record exists.");
  }
  if (value.evidence?.class === "manually-reviewed" && value.review_status !== "reviewed") {
    diagnostic(errors, "$.review_status", "evidence.manual-review-state", "Manually reviewed evidence must use reviewed status.");
  }
  if (value.evidence?.class === "source-provided" && !["source-provided", "reviewed"].includes(value.review_status)) {
    diagnostic(errors, "$.review_status", "evidence.source-review-state", "Source-provided evidence must remain source-provided or separately reviewed.");
  }
}

// Book ids and references belong to the witness's source versification, not
// the app's book catalog. A partial entry explicitly lists its covered units.
function validateCoverage(value, path, errors) {
  if (!Array.isArray(value)) {
    diagnostic(errors, path, "array.required", "Expected a book coverage array.");
    return;
  }
  if (!value.length) diagnostic(errors, path, "array.minimum", "Declare at least one source book, with unknown scope if coverage is unverified.");
  const seen = new Set();
  value.forEach((book, index) => {
    const bookPath = `${path}[${index}]`;
    if (!requireRecord(book, bookPath, errors)) return;
    if (requireString(book.source_book_id, `${bookPath}.source_book_id`, errors)) {
      if (seen.has(book.source_book_id)) diagnostic(errors, `${bookPath}.source_book_id`, "coverage.duplicate-book", "Source book ids must be unique within a witness.");
      seen.add(book.source_book_id);
    }
    requireEnum(book.scope, TEXT_WITNESS_COVERAGE_SCOPES, `${bookPath}.scope`, errors);
    requireStringArray(book.source_references, `${bookPath}.source_references`, errors, { minimum: book.scope === "partial" ? 1 : 0 });
    if (["complete", "unknown"].includes(book.scope) && book.source_references?.length) {
      diagnostic(errors, `${bookPath}.source_references`, "coverage.references", "Only partial coverage lists source units; complete means the whole source book and unknown makes no coverage claim.");
    }
  });
}

export function validateTextWitness(value) {
  const errors = [];
  if (!requireRecord(value, "$", errors)) return errors;
  validateSchemaVersion(value, errors);
  requireString(value.id, "$.id", errors);
  requireEnum(value.language, TEXT_WITNESS_LANGUAGES, "$.language", errors);
  requireString(value.script, "$.script", errors);
  requireString(value.canon, "$.canon", errors);
  validateCoverage(value.coverage, "$.coverage", errors);
  if (requireRecord(value.edition, "$.edition", errors)) {
    requireString(value.edition.name, "$.edition.name", errors);
    requireString(value.edition.version, "$.edition.version", errors);
  }
  requireString(value.versification, "$.versification", errors);
  requireString(value.normalization_profile, "$.normalization_profile", errors);
  if (Array.isArray(value.representations)) {
    if (!value.representations.length) diagnostic(errors, "$.representations", "array.minimum", "A text witness must declare at least one representation.");
    const seen = new Set();
    value.representations.forEach((representation, index) => {
      const path = `$.representations[${index}]`;
      if (!requireRecord(representation, path, errors)) return;
      if (requireString(representation.id, `${path}.id`, errors)) {
        if (seen.has(representation.id)) diagnostic(errors, `${path}.id`, "representation.duplicate", "Representation ids must be unique within a witness.");
        seen.add(representation.id);
      }
      requireString(representation.display, `${path}.display`, errors);
      requireString(representation.normalization_profile, `${path}.normalization_profile`, errors);
    });
  } else {
    diagnostic(errors, "$.representations", "array.required", "Expected a representations array.");
  }
  if (requireRecord(value.rights, "$.rights", errors)) {
    requireString(value.rights.license_id, "$.rights.license_id", errors);
    requireString(value.rights.delivery, "$.rights.delivery", errors);
  }
  validateProvenance(value.provenance, "$.provenance", errors);
  return errors;
}

export function validateSourceToken(value) {
  const errors = [];
  if (!requireRecord(value, "$", errors)) return errors;
  validateSchemaVersion(value, errors);
  requireString(value.id, "$.id", errors);
  requireString(value.witness_id, "$.witness_id", errors);
  requireString(value.versification, "$.versification", errors);
  requireString(value.source_reference, "$.source_reference", errors);
  requireString(value.canonical_reference, "$.canonical_reference", errors, { nullable: true });
  requireInteger(value.token_index, "$.token_index", errors, { minimum: 1 });
  // One-based positions within this source reference/representation, independent
  // of token_index. Neither grouping nor display segmentation restarts identity.
  for (const field of TEXTUAL_COMPARISON_CONTRACT.optional_source_position_fields) {
    if (value[field] !== undefined && value[field] !== null) {
      requireInteger(value[field], `$.${field}`, errors, { minimum: 1 });
    }
  }
  requireString(value.representation_id, "$.representation_id", errors, { nullable: true });
  requireString(value.surface, "$.surface", errors);
  if (requireRecord(value.normalized_forms, "$.normalized_forms", errors)) {
    requireString(value.normalized_forms.nfc, "$.normalized_forms.nfc", errors);
  }
  validateAnnotation(value.lemma, "$.lemma", errors, "lemma");
  validateAnnotation(value.morphology, "$.morphology", errors, "morphology");
  validateAnnotation(value.transliteration, "$.transliteration", errors, "transliteration");
  if (value.witness_id === SEPTUAGINT_PHASE1_BOUNDARY.greek_text.witness_id) {
    for (const kind of ["lemma", "morphology"]) {
      if (value[kind] !== null) diagnostic(errors, `$.${kind}`, "source-token.unsupported-annotation", `Swete ${kind} must remain null under the Phase 1 source decision.`);
    }
  }
  if (!Array.isArray(value.external_ids)) {
    diagnostic(errors, "$.external_ids", "array.required", "Expected an external_ids array.");
  } else {
    value.external_ids.forEach((item, index) => {
      const path = `$.external_ids[${index}]`;
      if (!requireRecord(item, path, errors)) return;
      requireString(item.system, `${path}.system`, errors);
      requireString(item.value, `${path}.value`, errors);
      validateProvenance(item.provenance, `${path}.provenance`, errors);
    });
  }
  validateProvenance(value.provenance, "$.provenance", errors);
  return errors;
}

export function validateVerseMap(value) {
  const errors = [];
  if (!requireRecord(value, "$", errors)) return errors;
  validateSchemaVersion(value, errors);
  requireString(value.id, "$.id", errors);
  requireString(value.witness_id, "$.witness_id", errors);
  requireString(value.source_versification, "$.source_versification", errors);
  requireStringArray(value.source_references, "$.source_references", errors);
  requireStringArray(value.canonical_references, "$.canonical_references", errors);
  requireEnum(value.map_type, VERSE_MAP_TYPES, "$.map_type", errors);
  validateProvenance(value.provenance, "$.provenance", errors);
  requireEnum(value.review_status, REVIEW_STATES, "$.review_status", errors);

  const sourceCount = Array.isArray(value.source_references) ? value.source_references.length : 0;
  const canonicalCount = Array.isArray(value.canonical_references) ? value.canonical_references.length : 0;
  const invalidShape = (message) => diagnostic(errors, "$", "verse-map.cardinality", message);
  if (value.map_type === "exact" && (sourceCount !== 1 || canonicalCount !== 1)) invalidShape("exact maps require one source and one canonical reference.");
  if (value.map_type === "split" && (sourceCount !== 1 || canonicalCount < 2)) invalidShape("split maps require one source and multiple canonical references.");
  if (value.map_type === "merged" && (sourceCount < 2 || canonicalCount !== 1)) invalidShape("merged maps require multiple source references and one canonical reference.");
  if (value.map_type === "moved" && (!sourceCount || !canonicalCount)) invalidShape("moved maps require source and canonical references.");
  if (value.map_type === "source-only" && (!sourceCount || canonicalCount !== 0)) invalidShape("source-only maps require source references and no canonical target.");
  if (value.map_type === "canonical-only" && (sourceCount !== 0 || !canonicalCount)) invalidShape("canonical-only maps require canonical references and no source target.");
  if (["unavailable", "uncertain"].includes(value.map_type) && sourceCount + canonicalCount === 0) invalidShape(`${value.map_type} maps must still identify at least one side of the unresolved mapping.`);
  return errors;
}

export function validateAlignmentEdge(value) {
  const errors = [];
  if (!requireRecord(value, "$", errors)) return errors;
  validateSchemaVersion(value, errors);
  requireString(value.id, "$.id", errors);
  requireEnum(value.state, ALIGNMENT_STATES, "$.state", errors);
  requireStringArray(value.hebrew_token_ids, "$.hebrew_token_ids", errors);
  requireStringArray(value.greek_token_ids, "$.greek_token_ids", errors);
  validateEvidence(value.evidence, "$.evidence", errors);
  validateProvenance(value.provenance, "$.provenance", errors);
  requireEnum(value.review_status, REVIEW_STATES, "$.review_status", errors);

  const h = Array.isArray(value.hebrew_token_ids) ? value.hebrew_token_ids.length : 0;
  const g = Array.isArray(value.greek_token_ids) ? value.greek_token_ids.length : 0;
  const invalidShape = (message) => diagnostic(errors, "$", "alignment.cardinality", message);
  if (value.state === "aligned-1:1" && (h !== 1 || g !== 1)) invalidShape("aligned-1:1 requires one Hebrew and one Greek token.");
  if (value.state === "aligned-1:n" && (h !== 1 || g < 2)) invalidShape("aligned-1:n requires one Hebrew token and multiple Greek tokens.");
  if (value.state === "aligned-n:1" && (h < 2 || g !== 1)) invalidShape("aligned-n:1 requires multiple Hebrew tokens and one Greek token.");
  if (value.state === "aligned-n:m" && (h < 2 || g < 2)) invalidShape("aligned-n:m requires multiple tokens on both sides.");
  if (value.state === "reordered" && (h < 2 || g < 2)) invalidShape("reordered requires multi-token units on both sides.");
  if (value.state === "hebrew-unaligned" && (!h || g !== 0)) invalidShape("hebrew-unaligned requires Hebrew tokens and no Greek tokens.");
  if (value.state === "greek-unaligned" && (h !== 0 || !g)) invalidShape("greek-unaligned requires Greek tokens and no Hebrew tokens.");
  if (["lexical-substitution", "uncertain"].includes(value.state) && (!h || !g)) invalidShape(`${value.state} requires identified units on both sides.`);

  validateEvidenceReviewState(value, errors);
  return errors;
}

export function validateCrossCorpusLemmaLink(value) {
  const errors = [];
  if (!requireRecord(value, "$", errors)) return errors;
  validateSchemaVersion(value, errors);
  requireString(value.id, "$.id", errors);
  requireString(value.lxx_witness_id, "$.lxx_witness_id", errors);
  requireString(value.lxx_lemma_id, "$.lxx_lemma_id", errors);
  requireString(value.nt_witness_id, "$.nt_witness_id", errors);
  requireString(value.nt_lemma_id, "$.nt_lemma_id", errors);
  requireEnum(value.link_type, CROSS_CORPUS_LEMMA_LINK_TYPES, "$.link_type", errors);
  validateEvidence(value.evidence, "$.evidence", errors);
  validateProvenance(value.provenance, "$.provenance", errors);
  requireEnum(value.review_status, REVIEW_STATES, "$.review_status", errors);
  validateEvidenceReviewState(value, errors);

  if (value.link_type === "exact-canonical-lemma" && value.lxx_lemma_id !== value.nt_lemma_id) {
    diagnostic(errors, "$.nt_lemma_id", "lemma-link.exact-identity", "Exact canonical lemma links require the same canonical lemma id on both sides.");
  }

  if (value.link_type === "unresolved-candidate") {
    if (value.evidence?.class !== "deterministic-generated-candidate") {
      diagnostic(errors, "$.evidence.class", "lemma-link.candidate-evidence", "Unresolved lemma candidates must use deterministic-generated-candidate evidence.");
    }
    if (value.review_status !== "generated-candidate") {
      diagnostic(errors, "$.review_status", "lemma-link.candidate-review-state", "Unresolved lemma candidates must remain generated-candidate.");
    }
  }
  return errors;
}

export function validatePassageRelation(value) {
  const errors = [];
  if (!requireRecord(value, "$", errors)) return errors;
  validateSchemaVersion(value, errors);
  requireString(value.id, "$.id", errors);
  requireString(value.source_passage_id, "$.source_passage_id", errors);
  requireString(value.receiving_passage_id, "$.receiving_passage_id", errors);
  requireEnum(value.relation_type, PASSAGE_RELATION_TYPES, "$.relation_type", errors);
  validateEvidence(value.evidence, "$.evidence", errors);
  validateProvenance(value.provenance, "$.provenance", errors);
  requireEnum(value.review_status, REVIEW_STATES, "$.review_status", errors);
  validateEvidenceReviewState(value, errors);
  if (value.source_passage_id === value.receiving_passage_id) {
    diagnostic(errors, "$.receiving_passage_id", "passage-relation.self", "Passage relations must connect distinct passage identities.");
  }
  return errors;
}

export function sourceTokenIdentityKey(value) {
  const errors = validateSourceToken(value);
  if (errors.length) throw new TextualComparisonValidationError("sourceToken", errors);
  return JSON.stringify([
    value.witness_id,
    value.versification,
    value.source_reference,
    value.token_index,
  ]);
}

export function witnessVoteKey(value) {
  if (!value || typeof value.witness_id !== "string" || !value.witness_id) {
    throw new TypeError("witnessVoteKey requires a record with witness_id.");
  }
  return value.witness_id;
}

const VALIDATORS = Object.freeze({
  textWitness: validateTextWitness,
  sourceToken: validateSourceToken,
  verseMap: validateVerseMap,
  alignmentEdge: validateAlignmentEdge,
  crossCorpusLemmaLink: validateCrossCorpusLemmaLink,
  passageRelation: validatePassageRelation,
});

export class TextualComparisonValidationError extends Error {
  constructor(recordType, diagnostics) {
    super(`Invalid ${recordType}:\n${diagnostics.map((item) => `- [${item.code}] ${item.path}: ${item.message}`).join("\n")}`);
    this.name = "TextualComparisonValidationError";
    this.recordType = recordType;
    this.diagnostics = diagnostics;
  }
}

export function assertValidTextualComparisonRecord(recordType, value) {
  const validator = VALIDATORS[recordType];
  if (!validator) throw new TypeError(`Unknown textual comparison record type: ${recordType}`);
  const diagnostics = validator(value);
  if (diagnostics.length) throw new TextualComparisonValidationError(recordType, diagnostics);
  return value;
}
