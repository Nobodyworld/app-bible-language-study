#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  buildReferenceContext,
  referenceContextKey,
  testamentForBook,
} from "../app/src/reference-context.js";
import {
  createReaderNavigationSnapshot,
  historyStateWithReaderSnapshot,
  readerNavigationLocationKey,
  readerSnapshotFromHistoryState,
} from "../app/src/reader-navigation.js";
import { createTextSpanTarget } from "../app/src/semantic-targets.js";

assert.equal(testamentForBook("genesis"), "old");
assert.equal(testamentForBook("john"), "new");
assert.equal(testamentForBook("not_a_book"), null);

const context = buildReferenceContext({
  translationId: "bsb",
  bookId: "John",
  chapter: "4",
  verse: "1",
  word: {
    tokenIndex: "10",
    strongCode: "G3754",
    language: "greek",
    original: "hoti",
  },
});

assert.equal(context.translation_id, "bsb");
assert.equal(context.testament, "new");
assert.equal(context.book_id, "john");
assert.equal(context.chapter, 4);
assert.equal(context.verse, 1);
assert.equal(context.word.token_index, 10);
assert.equal(referenceContextKey(context, "translation"), "bsb");
assert.equal(referenceContextKey(context, "verse"), "bsb:new:john:4:1");
assert.equal(referenceContextKey(context, "word"), "bsb:new:john:4:1:10");
assert(Object.isFrozen(context) && Object.isFrozen(context.word));
assert.throws(
  () => referenceContextKey(buildReferenceContext({ translationId: "bsb", bookId: "unknown" }), "book"),
  /missing testament/,
);
assert.equal(
  buildReferenceContext({ bookId: "john", testament: "invalid" }).testament,
  "new",
);
assert.equal(
  buildReferenceContext({ bookId: "john", testament: "old" }).testament,
  "new",
);
assert.deepEqual(
  buildReferenceContext({
    translationId: " BSB ",
    bookId: " John ",
    word: { strongCode: " g3754 ", language: " Greek " },
  }),
  {
    translation_id: "bsb",
    testament: "new",
    book_id: "john",
    chapter: null,
    verse: null,
    segment_id: null,
    word: {
      token_index: null,
      strong_code: "G3754",
      language: "greek",
      original: null,
    },
  },
);

const phraseTarget = createTextSpanTarget(
  { translation_id: "bsb", book_id: "psalms", chapter: 23, verse: 1 },
  { char_start: 0, char_end: 24, text_snapshot: "The LORD is my shepherd;" },
);
const navigationSnapshot = createReaderNavigationSnapshot({
  translationId: "bsb",
  bookId: "psalms",
  chapter: "23",
  verse: null,
  pageX: 0,
  pageY: 0,
  detailScrollTop: 184.5,
  detailTitle: "Language Study",
  detailLocked: true,
  readerContext: { translationId: "bsb", bookId: "psalms", chapter: 23, verse: 1 },
  textSpanTarget: phraseTarget,
  focus: { kind: "strong-token", verse: 1, interlinearKey: "1:2:H3068" },
});
assert.equal(navigationSnapshot.pageY, 0, "A top-of-document snapshot must remain an exact zero.");
assert.equal(navigationSnapshot.verse, null, "Route verse must remain separate from committed reader context.");
assert.equal(navigationSnapshot.readerContext.verse, 1);
assert.equal(navigationSnapshot.textSpanTarget.anchor.text_snapshot, "The LORD is my shepherd;");
assert.equal(readerNavigationLocationKey(navigationSnapshot), "bsb:psalms:23:");
const historyState = historyStateWithReaderSnapshot({ retained: "value" }, navigationSnapshot);
const restoredSnapshot = readerSnapshotFromHistoryState(historyState);
assert.equal(historyState.retained, "value");
assert.deepEqual(restoredSnapshot, navigationSnapshot);
assert.equal(createReaderNavigationSnapshot(null), null, "Missing browser-history state must not throw or create a snapshot.");
assert.equal(
  createReaderNavigationSnapshot({ ...navigationSnapshot, version: 999 }),
  null,
  "Unknown reader-navigation snapshot versions must fail closed.",
);
assert.equal(
  createReaderNavigationSnapshot({
    ...navigationSnapshot,
    readerContext: { ...navigationSnapshot.readerContext, book_id: "john" },
  }),
  null,
  "A stale reader context from another location must invalidate the snapshot.",
);
assert.equal(
  createReaderNavigationSnapshot({
    ...navigationSnapshot,
    textSpanTarget: {
      ...navigationSnapshot.textSpanTarget,
      reference: { ...navigationSnapshot.textSpanTarget.reference, book_id: "john" },
    },
  }),
  null,
  "A stale text-span context from another location must invalidate the snapshot.",
);
assert.equal(JSON.stringify(restoredSnapshot).includes("HTML"), false, "Reader snapshots must remain serializable application data.");

console.log(
  JSON.stringify(
    {
      status: "ok",
      assertions: 30,
      verse_key: referenceContextKey(context, "verse"),
      word_key: referenceContextKey(context, "word"),
    },
    null,
    2,
  ),
);
