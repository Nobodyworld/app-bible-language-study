#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  configureDataAdapter,
  configurePhysicalPackResolver,
  invalidatePhysicalPackData,
} from "../app/src/data-service.js?v=pr13-live-qa-20260711e";

// The production view imports shell modules with initialization listeners. These
// inert surfaces let us call its exported logical contract without a browser,
// renderer, network, database, CacheStorage, or an owner's study profile.
globalThis.document = {
  documentElement: { dataset: {} },
  querySelector: () => null,
  addEventListener() {},
  createElement(tag) {
    assert.equal(tag, "template", "Logical Search must not render UI in this suite.");
    return {
      content: { textContent: "" },
      set innerHTML(value) {
        // Deliberately only plain text: HTML decoding/markup is browser coverage.
        assert.doesNotMatch(value, /[<&]/, "Use plain-text commentary fixtures here.");
        this.content.textContent = value;
      },
    };
  },
};
globalThis.window = {
  matchMedia: () => ({ matches: false }),
  addEventListener() {},
  requestAnimationFrame() {},
};
const { searchTerms, refsMatchingTerms, runSearch } = await import("../app/src/views/search-view.js");

const verse = (translation, id, name, chapters) => ({
  translation: { id: translation, code: translation.toUpperCase() },
  book: { id, name },
  chapters,
});
const genesis = verse("bsb", "genesis", "Genesis", {
  10: { 1: "Wisdom light in chapter ten." },
  2: { 1: "Wisdom light in chapter two." },
  1: { 2: "Light and wisdom from canonical verse two.", 1: "Wisdom and light from canonical verse one." },
});
const john = verse("bsb", "john", "John", { 1: { 1: "Wisdom and light from canonical John." } });
const alternate = verse("alternate", "genesis", "Genesis", { 1: { 1: "Alternate edition canonical wisdom." } });
const lexiconEntry = (strongCode, language) => ({
  strong_code: strongCode, language, transliteration: "logos", original_word: "λόγος",
  summary: "Canonical summary", short_definition: "Canonical gloss", meaning: "Secondary meaning",
  concordance_definition: "Secondary definition", part_of_speech: "noun",
});
const comment = "Canonical commentary wisdom. ".repeat(20);
function records() {
  return new Map(Object.entries({
    "search/manifest.json": { generated: {
      verses: [
        { translation_id: "alternate", book_id: "genesis", path: "search/verses/alternate/genesis.json" },
        { translation_id: "bsb", book_id: "john", path: "search/verses/bsb/john.json" },
        { translation_id: "bsb", book_id: "genesis", path: "search/verses/bsb/genesis.json" },
        { translation_id: "bsb", book_id: "missing", path: "search/verses/bsb/missing.json" },
      ],
      lexicon: [
        { language: "greek", path: "search/lexicon/greek.json" },
        { language: "hebrew", path: "search/lexicon/hebrew.json" },
        { language: "greek", path: "search/lexicon/duplicate.json" },
      ],
      outlines: [
        { book_id: "john", path: "search/outlines/john.json" },
        { book_id: "genesis", path: "search/outlines/genesis.json" },
      ],
      commentaries: [
        { book_id: "john", source_id: "source-a", path: "search/commentaries/source-a/john.json" },
        { book_id: "genesis", source_id: "source-a", path: "search/commentaries/source-a/genesis.json" },
        { book_id: "genesis", source_id: "source-b", path: "search/commentaries/source-b/genesis.json" },
      ],
    } },
    "verses/bsb/genesis.json": genesis,
    "verses/bsb/john.json": john,
    "verses/alternate/genesis.json": alternate,
    "search/verses/bsb/genesis.json": { book: { name: "Stale index label" }, terms: {
      wisdom: [["1", "2"], ["1", "1"], ["9", "9"]], light: [["1", "1"], ["1", "2"]], ghost: [["9", "9"]],
    } },
    "search/verses/bsb/john.json": { terms: { wisdom: [["1", "1"]], light: [["1", "1"]] } },
    "search/verses/alternate/genesis.json": { terms: { wisdom: [["1", "1"]] } },
    "search/lexicon/greek.json": { terms: { wisdom: ["G1", "G2", "G999"], word: ["G1"], g1: ["G1"] } },
    "search/lexicon/hebrew.json": { terms: { wisdom: ["H1"] } },
    "search/lexicon/duplicate.json": { terms: { wisdom: ["G1"] } },
    "lexicon/greek/0000.json": { entries: { G1: lexiconEntry("G1", "greek"), G2: lexiconEntry("G2", "greek") } },
    "lexicon/hebrew/0000.json": { entries: { H1: { ...lexiconEntry("H1", "hebrew"), summary: "", short_definition: "First fallback" } } },
    "search/outlines/genesis.json": { terms: { wisdom: [1, 0, 9] } },
    "search/outlines/john.json": { terms: { wisdom: [0] } },
    "outlines/books/genesis.json": { book: { name: "Genesis" }, items: [
      { marker: "I", title: "Canonical first outline", reference: { label: "Genesis 1:1", start_chapter: 1, start_verse: 1 } },
      { title: "Canonical second outline", reference: { book_id: "genesis", label: "Genesis 2:3", chapter: 2, verse_start: 3 } },
    ] },
    "outlines/books/john.json": { book: { name: "John" }, items: [{ title: "Canonical John outline" }] },
    "search/commentaries/source-a/genesis.json": { terms: { wisdom: [["1", "2", 0], ["1", "1", 0], ["9", "9", 0]] } },
    "search/commentaries/source-a/john.json": { terms: { wisdom: [["1", "1", 0]] } },
    "search/commentaries/source-b/genesis.json": { terms: { wisdom: [["1", "1", 0]] } },
    "commentaries/source/source-a/genesis.json": { book: { name: "Genesis" }, chapters: { 1: { 1: [{ commentary_html: "Canonical first commentary." }], 2: [{ commentary_html: comment }] } } },
    "commentaries/source/source-a/john.json": { book: { name: "John" }, chapters: { 1: { 1: [{ commentary_html: "Canonical John commentary." }] } } },
    "commentaries/source/source-b/genesis.json": { book: { name: "Genesis" }, chapters: { 1: { 1: [{ commentary_html: "Canonical second source." }] } } },
  }));
}

function context(overrides = {}) {
  return {
    state: { translationId: "bsb", bookId: "genesis", verseBook: genesis,
      manifest: { books: [{ id: "genesis" }, { id: "john" }, { id: "missing" }] }, ...overrides },
    findBook: (id) => ({ name: id }),
    canUseCapability: () => true,
  };
}

const relativePath = (path) => path.replace(/^\.\/data\//, "").split("?")[0];
function useRecords(mode, values = records()) {
  const requests = [];
  const responseFor = (path) => {
    const key = relativePath(path);
    requests.push(key);
    return values.has(key) ? new Response(JSON.stringify(values.get(key))) : new Response("missing", { status: 404 });
  };
  configurePhysicalPackResolver(null);
  invalidatePhysicalPackData();
  configureDataAdapter({ fetchResponse(path) {
    assert.equal(mode, "static", "Managed records must not silently fall back to static storage.");
    return responseFor(path);
  } });
  if (mode === "managed") configurePhysicalPackResolver(async (path) => ({
    response: responseFor(path), source_key: "search-contract-memory-pack", runtime_source: "fixture", pack_id: "fixture-search",
  }));
  return { values, requests };
}

test("query normalization is NFKD ASCII, with the current stop words and repeated terms", () => {
  assert.deepEqual(searchTerms("  WÍSDOM, café's WORD — G1 H07225 42 7 A the unto  "), ["wisdom", "cafe", "word", "g1", "h07225", "42"]);
  assert.deepEqual(searchTerms("wisdom wisdom"), ["wisdom", "wisdom"]);
  assert.deepEqual(searchTerms("and THE a 1 λόγος בְּרֵאשִׁית"), []);
  assert.deepEqual(searchTerms(null), []);
  assert.deepEqual(searchTerms("John 1:1"), ["john"], "A reference-shaped query is ordinary terms; no new reference parser.");
});

test("posting intersection, identity, ordering, repeated terms and caps preserve the exact matcher", () => {
  const a = ["1", "1"], b = ["1", "2"], c = ["1", "3"];
  const shard = { terms: { wisdom: [b, a, c], light: [a, b] } };
  assert.deepEqual(refsMatchingTerms(shard, ["wisdom", "light"]), [b, a]);
  assert.deepEqual(refsMatchingTerms(shard, ["wisdom", "light"], 1), [b]);
  assert.deepEqual(refsMatchingTerms(shard, ["wisdom", "wisdom"]), [b, a, c]);
  assert.deepEqual(refsMatchingTerms(shard, ["wisdom", "absent"]), []);
  assert.deepEqual(refsMatchingTerms(null, ["wisdom"]), []);
  assert.deepEqual(refsMatchingTerms(shard, []), []);
  assert.deepEqual(refsMatchingTerms({ terms: { id: [["1", "1"], [1, 1], "G1", 0] } }, ["id"]), [["1", "1"], [1, 1], "G1", 0]);

  // Compatibility evidence, not a proposed ranking algorithm: occurrence counts
  // currently drive matching. Deduplicating existing postings changes results.
  const duplicate = { terms: { wisdom: [a, a, b], light: [a, b] } };
  assert.deepEqual(refsMatchingTerms(duplicate, ["wisdom"]), [b]);
  assert.deepEqual(refsMatchingTerms(duplicate, ["wisdom", "wisdom"]), [b]);
  assert.deepEqual(refsMatchingTerms(duplicate, ["wisdom", "light"]), [b]);
  assert.deepEqual(refsMatchingTerms(duplicate, ["wisdom", "absent"]), [a], "Preserve current occurrence-count coincidence, pending separately approved Search semantics.");
});

for (const mode of ["static", "managed"]) {
  test(`${mode}: verses resolve canonical text/edition/ref, preserve shard order and apply limits`, async () => {
    useRecords(mode);
    const ctx = context();
    const results = await runSearch(ctx, "WÍSDOM light", "verses", "book", 20);
    assert.deepEqual(results, [
      { kind: "verse", label: "Genesis 1:2", meta: "BSB", text: genesis.chapters[1][2], location: { book_id: "genesis", chapter: "1", verse_start: "2" } },
      { kind: "verse", label: "Genesis 1:1", meta: "BSB", text: genesis.chapters[1][1], location: { book_id: "genesis", chapter: "1", verse_start: "1" } },
    ]);
    assert.deepEqual(await runSearch(ctx, "wisdom light", "verses", "book", 1), results.slice(0, 1));
    assert.deepEqual(await runSearch(ctx, "wisdom light", "verses", "book", 20), results);
    assert.deepEqual((await runSearch(ctx, "wisdom", "verses", "translation", 20)).map((result) => result.label), ["John 1:1", "Genesis 1:2", "Genesis 1:1"]);
    assert.deepEqual((await runSearch(ctx, "wisdom", "verses", "translation", 2)).map((result) => result.label), ["John 1:1", "Genesis 1:2"]);
    const selected = await runSearch(context({ translationId: "alternate", verseBook: alternate }), "wisdom", "verses", "translation", 20);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].meta, "ALTERNATE");
    assert.equal(selected[0].text, alternate.chapters[1][1]);
    assert.deepEqual(await runSearch(ctx, "ghost", "verses", "book", 20), [], "Stale index refs must not synthesize canonical content.");
    assert.deepEqual(await runSearch(ctx, "nonmatching", "verses", "book", 20), []);
    assert.deepEqual(await runSearch(ctx, "the 1", "verses", "book", 20), []);
  });

  test(`${mode}: lexicon scopes, Strong's identity, canonical field precedence and deduplication`, async () => {
    useRecords(mode);
    const results = await runSearch(context(), "wisdom", "lexicon", "all", 20);
    assert.deepEqual(results.map((result) => result.strong_token.strong_code), ["G1", "G2", "H1"]);
    assert.deepEqual(results[0], {
      kind: "lexicon", label: "G1 logos", meta: "greek Strong's", text: "Canonical summary",
      strong_token: { strong_code: "G1", language: "greek", original: "λόγος", transliteration: "logos", morphology: "noun", gloss: "Canonical gloss" },
    });
    assert.equal(results[2].text, "First fallback");
    assert.deepEqual((await runSearch(context(), "wisdom", "lexicon", "hebrew", 20)).map((result) => result.strong_token.strong_code), ["H1"]);
    assert.deepEqual((await runSearch(context(), "wisdom word", "lexicon", "greek", 20)).map((result) => result.strong_token.strong_code), ["G1"]);
    assert.equal((await runSearch(context(), "G1", "lexicon", "all", 20))[0].strong_token.strong_code, "G1");
    assert.deepEqual(await runSearch(context(), "wisdom", "lexicon", "all", 1), results.slice(0, 1));
  });

  test(`${mode}: outlines use canonical item identities, locations, scope and ordering`, async () => {
    useRecords(mode);
    const results = await runSearch(context(), "wisdom", "outlines", "book", 20);
    assert.deepEqual(results, [
      { kind: "outline", label: "Genesis - Canonical second outline", meta: "Genesis 2:3", text: "Canonical second outline", location: { book_id: "genesis", chapter: 2, verse_start: 3 } },
      { kind: "outline", label: "Genesis - Canonical first outline", meta: "Genesis 1:1", text: "I Canonical first outline", location: { book_id: "genesis", chapter: 1, verse_start: 1 } },
    ]);
    assert.deepEqual(await runSearch(context(), "wisdom", "outlines", "book", 1), results.slice(0, 1));
    const all = await runSearch(context(), "wisdom", "outlines", "all", 20);
    assert.equal(all.length, 3);
    assert.equal(all[0].label, "John - Canonical John outline");
    assert.deepEqual(all[0].location, { book_id: "john", chapter: 1, verse_start: 1 });
  });

  test(`${mode}: commentary source grouping, canonical entries and snippet cap`, async () => {
    useRecords(mode);
    const results = await runSearch(context(), "wisdom", "commentaries", "book", 20);
    assert.deepEqual(results.map(({ kind, label, meta }) => ({ kind, label, meta })), [
      { kind: "commentary", label: "Genesis 1:2", meta: "source-a" },
      { kind: "commentary", label: "Genesis 1:1", meta: "source-a" },
      { kind: "commentary", label: "Genesis 1:1", meta: "source-b" },
    ]);
    assert.equal(results[0].text, comment.slice(0, 360));
    assert.deepEqual(results[0].location, { book_id: "genesis", chapter: "1", verse_start: "2" });
    assert.equal(results[1].text, "Canonical first commentary.");
    assert.equal(results[2].text, "Canonical second source.");
    assert.deepEqual(await runSearch(context(), "wisdom", "commentaries", "book", 1), results.slice(0, 1));
    const all = await runSearch(context(), "wisdom", "commentaries", "all", 20);
    assert.equal(all.length, 4);
    assert.equal(all[0].label, "John 1:1");
  });

  test(`${mode}: missing indexes fall back only for verses and retain numeric book ordering`, async () => {
    const values = records();
    values.delete("search/manifest.json");
    useRecords(mode, values);
    const results = await runSearch(context(), "wisdom light", "verses", "book", 20);
    assert.deepEqual(results.map((result) => result.label), ["Genesis 1:1", "Genesis 1:2", "Genesis 2:1", "Genesis 10:1"]);
    assert.deepEqual(await runSearch(context(), "wisdom light", "verses", "book", 1), results.slice(0, 1));
    assert.deepEqual((await runSearch(context(), "wisdom", "verses", "translation", 20)).map((result) => result.label), [...results.map((result) => result.label), "John 1:1"]);
    for (const collection of ["lexicon", "outlines", "commentaries"]) {
      assert.deepEqual(await runSearch(context(), "wisdom", collection, "all", 20), []);
    }
    const missingShard = records();
    missingShard.delete("search/verses/bsb/genesis.json");
    useRecords(mode, missingShard);
    assert.deepEqual(await runSearch(context(), "wisdom light", "verses", "book", 20), results);
    assert.deepEqual((await runSearch(context(), "wisdom", "verses", "translation", 20)).map((result) => result.label), ["John 1:1"], "A partially loaded translation index does not mix fallback results.");
  });

  test(`${mode}: missing canonical records are skipped and unavailable capability does no reads`, async () => {
    const values = records();
    for (const path of ["verses/bsb/genesis.json", "lexicon/greek/0000.json", "outlines/books/genesis.json", "commentaries/source/source-a/genesis.json"]) values.delete(path);
    const { requests } = useRecords(mode, values);
    assert.deepEqual(await runSearch(context(), "wisdom", "verses", "book", 20), []);
    assert.deepEqual(await runSearch(context(), "wisdom", "lexicon", "greek", 20), []);
    assert.deepEqual(await runSearch(context(), "wisdom", "outlines", "book", 20), []);
    assert.deepEqual((await runSearch(context(), "wisdom", "commentaries", "book", 20)).map((result) => result.meta), ["source-b"]);
    const before = requests.length;
    const unavailable = { ...context(), canUseCapability: () => false };
    for (const collection of ["lexicon", "outlines", "commentaries"]) assert.deepEqual(await runSearch(unavailable, "wisdom", collection, "all", 20), []);
    assert.equal(requests.length, before);
  });
}

test("managed-pack refusal propagates and never silently uses bundled data", async () => {
  useRecords("managed");
  const refusal = Object.assign(new Error("fixture managed source unavailable"), { detail: { managed_fallback_forbidden: true } });
  configurePhysicalPackResolver(async () => { throw refusal; });
  for (const collection of ["verses", "lexicon", "outlines", "commentaries"]) {
    await assert.rejects(() => runSearch(context(), "wisdom", collection, "all", 20), (error) => error === refusal);
  }
});

test("tracked verse and Strong's indexes resolve through the same production contract", async () => {
  configurePhysicalPackResolver(null);
  invalidatePhysicalPackData();
  configureDataAdapter({ async fetchResponse(path) {
    try {
      return new Response(await readFile(new URL(`../app/data/${relativePath(path)}`, import.meta.url), "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return new Response("missing", { status: 404 });
    }
  } });
  const ctx = context({ bookId: "proverbs", verseBook: null });
  const wisdom = await runSearch(ctx, "wisdom", "verses", "book", 80);
  assert.ok(wisdom.some((result) => result.label === "Proverbs 1:2" && result.meta === "BSB" && /wisdom/i.test(result.text)));
  const whole = await runSearch(ctx, "still small voice", "verses", "translation", 20);
  assert.ok(whole.some((result) => result.label === "1 Kings 19:12"));
  const lexicon = await runSearch(ctx, "reshith firstfruits", "lexicon", "hebrew", 20);
  assert.ok(lexicon.some((result) => result.strong_token.strong_code === "H7225"));
});
