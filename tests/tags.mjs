#!/usr/bin/env node

import assert from "node:assert/strict";
import { projectAssertionsToSemanticGraph } from "../app/src/semantic-graph.js";
import {
  createBookTarget,
  createChapterTarget,
  createSourceTokenSpanTarget,
  createSourceTokenTarget,
  createTagAssertion,
  createTextSpanTarget,
  createVerseRangeTarget,
  createVerseTarget,
  deriveTagTargetIndex,
  deriveVerseTagsFromAssertions,
  normalizeTagAssertion,
  resolveTextSpanAnchor,
  tagAssertionId,
  tagDefinitionId,
  targetId,
} from "../app/src/semantic-targets.js";
import {
  createUserDataExport,
  getTagTargets,
  getTaggedTargetsForReference,
  getTargetTags,
  importUserData,
  normalizeTagStore,
  setTagAssertion,
  setVerseTag,
} from "../app/src/stores.js";

function createLocalStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    clear() {
      values.clear();
    },
  };
}

globalThis.window = {
  localStorage: createLocalStorage(),
  setTimeout,
  clearTimeout,
};

assert.equal(tagDefinitionId("positive_sentiment"), "tag:positive-sentiment");
assert.equal(tagDefinitionId("negative_sentiment"), "tag:negative-sentiment");
assert.equal(tagDefinitionId("command_declaration"), "tag:command-declaration");
assert.equal(tagDefinitionId("question"), "tag:question");

const book = createBookTarget({ translation_id: "BSB", book_id: "John" });
const chapter = createChapterTarget({ translation_id: "bsb", book_id: "john", chapter: 4 });
const verse = createVerseTarget("john:4:1");
const range = createVerseRangeTarget(
  { translation_id: "bsb", book_id: "john", chapter: 4, verse_start: 1, verse_end: 3 },
);
const span = createTextSpanTarget("john:4:1", {
  char_start: 0,
  char_end: 4,
  text_snapshot: "When",
});
const token = createSourceTokenTarget("john:4:1", {
  token_index: 10,
  strong_code: "g3754",
  language: "Greek",
  original: "hoti",
});
const tokenSpan = createSourceTokenSpanTarget("john:4:1", {
  token_start: 8,
  token_end: 10,
  language: "greek",
  strong_codes: ["G5330", "G191", "G3754"],
  source_snapshots: ["Pharisaioi", "ēkousan", "hoti"],
});

assert.equal(book.target_id, "target:book:bsb:new:john");
assert.equal(chapter.target_id, "target:chapter:bsb:new:john:4");
assert.equal(verse.target_id, "target:verse:bsb:new:john:4:1");
assert.equal(range.target_id, "target:verse_range:bsb:new:john:4:1:3");
assert.equal(span.target_id, "target:text_span:bsb:new:john:4:1:0:4");
assert.equal(token.target_id, "target:source_token:bsb:new:john:4:1:10");
assert.equal(tokenSpan.target_id, "target:source_token_span:bsb:new:john:4:1:8:10");
assert.equal(targetId(token), token.target_id);
assert.equal(createBookTarget("not-a-book"), null);
assert.equal(createSourceTokenTarget("john:4:1", { token_index: 0 }), null);
assert.deepEqual(resolveTextSpanAnchor(span, "When Jesus spoke"), {
  status: "current",
  char_start: 0,
  char_end: 4,
  text_snapshot: "When",
});
assert.deepEqual(resolveTextSpanAnchor(span, "Now When Jesus spoke"), {
  status: "relocated",
  char_start: 4,
  char_end: 8,
  text_snapshot: "When",
});
assert.equal(resolveTextSpanAnchor(span, "Then When and When").status, "ambiguous");

const legacyAssertion = normalizeTagAssertion({
  id: "assertion:tag:john.4.1:positive_sentiment",
  schema_version: 1,
  assertion_type: "tag_application",
  tag_id: "tag:positive_sentiment",
  legacy_tag_id: "positive_sentiment",
  target: {
    target_type: "verse",
    edition_id: "bsb",
    reference: {
      book_id: "john",
      chapter: 4,
      verse_start: 1,
      verse_end: 1,
    },
  },
  active: true,
  created_at: "2026-06-20T00:00:00.000Z",
  updated_at: "2026-06-20T00:00:00.000Z",
});
assert.equal(legacyAssertion.schema_version, 2);
assert.equal(legacyAssertion.tag_id, "tag:positive-sentiment");
assert.equal(legacyAssertion.target_id, verse.target_id);
assert.equal(legacyAssertion.id, tagAssertionId(verse, "positive_sentiment"));
assert.equal(legacyAssertion.legacy_assertion_id, "assertion:tag:john.4.1:positive_sentiment");

const verseAssertion = createTagAssertion(verse, "favorite");
const tokenAssertion = createTagAssertion(token, "favorite");
const mixedAssertions = {
  [verseAssertion.id]: verseAssertion,
  [tokenAssertion.id]: tokenAssertion,
};
assert.deepEqual(deriveVerseTagsFromAssertions(mixedAssertions), { "john:4:1": ["favorite"] });
assert.deepEqual(deriveTagTargetIndex(mixedAssertions)["tag:favorite"], [token.target_id, verse.target_id].sort());

const migratedStore = normalizeTagStore({
  version: 3,
  verse_tags: {
    "john:4:1": ["positive_sentiment"],
  },
  tag_assertions: {
    legacy: legacyAssertion,
    corrupt: {
      id: "corrupt",
      assertion_type: "tag_application",
      tag_id: "tag:favorite",
      target: { target_type: "book", reference: {} },
    },
  },
});
assert.equal(migratedStore.version, 4);
assert.equal(migratedStore.tags.favorite.display_behavior, "quick_toggle");
assert.equal(migratedStore.tags.inquiry.on_apply_job_type, null);
assert.equal(migratedStore.quarantined_records.length, 1);
assert.equal(Object.keys(migratedStore.tag_assertions).length, 1);

const state = {};
const favoriteBook = setTagAssertion(state, book, "favorite", true);
setTagAssertion(state, chapter, "favorite", true);
setTagAssertion(state, verse, "favorite", true);
setTagAssertion(state, span, "favorite", true);
setTagAssertion(state, token, "favorite", true);
setTagAssertion(state, tokenSpan, "favorite", true);
assert.equal(favoriteBook.tag_id, "tag:favorite");
assert.equal(getTagTargets(state, "favorite").length, 6);
assert.deepEqual(getTargetTags(state, book), ["favorite"]);
assert.deepEqual(getTargetTags(state, chapter), ["favorite"]);
assert.deepEqual(state.tagStore.verse_tags["john:4:1"], ["favorite"]);
assert.deepEqual(getTargetTags(state, token), ["favorite"]);
assert.deepEqual(
  getTaggedTargetsForReference(state, "john:4:1", {
    targetTypes: ["text_span"],
    translationId: "bsb",
  }).map((entry) => [entry.target.target_id, entry.tag_ids]),
  [[span.target_id, ["favorite"]]],
);
assert.throws(
  () => setTagAssertion(state, book, "positive_sentiment", true),
  /cannot be applied to book/,
);

const inquiry = setTagAssertion(state, token, "inquiry", true, { note: "Why is this rendered because?" });
const duplicate = setTagAssertion(state, token, "inquiry", true, { note: "Why is this rendered because?" });
assert.equal(duplicate.id, inquiry.id);
assert.deepEqual(getTargetTags(state, token), ["favorite", "inquiry"]);
assert.deepEqual(state.tagStore.job_events, []);
assert.equal(inquiry.note, "Why is this rendered because?");

setVerseTag(state, "john:4:2", "question", true);
assert.deepEqual(state.tagStore.verse_tags["john:4:2"], ["question"]);

const graph = projectAssertionsToSemanticGraph(state.assertionStore.assertions);
assert(graph.nodes.some((node) => node.id === token.target_id));
assert(graph.edges.some((edge) => edge.type === "tagged_as" && edge.to === "tag:inquiry"));

const exported = createUserDataExport(state);
assert.equal(exported.version, 3);
const imported = {};
const summary = importUserData(imported, exported, "replace");
assert.equal(getTagTargets(imported, "favorite").length, 6);
assert.deepEqual(imported.tagStore.job_events, []);
assert(summary.tag_assertions >= 8);

console.log(
  JSON.stringify(
    {
      status: "ok",
      target_types: 7,
      migrated_store_version: migratedStore.version,
      favorite_targets: getTagTargets(imported, "favorite").length,
      inquiry_jobs: state.tagStore.job_events.length,
      graph_edges: graph.counts.edges,
      assertions: 49,
    },
    null,
    2,
  ),
);
