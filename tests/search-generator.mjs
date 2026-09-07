import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { generateSearchIndexes, indexTerms } from "../app/tools/generate-search-indexes.mjs";

const root = await mkdtemp(join(tmpdir(), "bible-search-generator-"));
let checks = 0;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const put = async (path, value) => { const target = join(root, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, JSON.stringify(value)); };
const get = async (path) => JSON.parse(await readFile(join(root, path), "utf8"));
const check = (condition, message) => { assert.ok(condition, message); checks += 1; };
const reject = async (action, pattern) => { await assert.rejects(action, pattern); checks += 1; };
const snapshot = async (path = root) => {
  const entries = [];
  for (const item of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
    const child = join(path, item.name);
    if (item.isDirectory()) entries.push(...await snapshot(child));
    else entries.push([child.slice(root.length), hash(await readFile(child)), (await stat(child)).mtimeMs]);
  }
  return entries;
};
const unchanged = async (before, message) => { assert.deepEqual(await snapshot(), before, message); checks += 1; };

try {
  const book = { id: "genesis", name: "Genesis", osis: "Gen" };
  const manifest = { books: [book], translations: [{ id: "fixture", code: "FIX" }], counts: { verses_by_translation: { fixture: 3 } } };
  const rights = { source_package: { classification: "OPENBIBLE_CONFIRMED", archive_sha256: "a".repeat(64), default_rights: "Fixture rights" }, exceptions: [{ scope: "source text", terms: "retain notices", notices: ["Fixture notice"] }] };
  const commentaryMetadata = { sources: [{ id: "fixture", name: "Fixture" }], counts: { source_entries: 2 }, source_entries_by_source: { fixture: 2 } };
  await put("manifest.json", manifest);
  await put("source-manifest.json", rights);
  await put("text-editions.json", { editions: [{ id: "fixture", license_note: "Fixture rights", coverage: { books: 1 } }] });
  await put("commentaries/metadata.json", commentaryMetadata);
  const verses = { book, translation: { id: "fixture", code: "FIX" }, chapters: { 2: { 1: "Third café" }, 1: { 2: "Word grace", 1: "Word word café a the" } } };
  await put("verses/fixture/genesis.json", verses);
  for (const [language, prefix] of [["hebrew", "H"], ["greek", "G"]]) {
    const entry = (number) => ({ language, strong_code: `${prefix}${number}`, strong_number: number, summary: number === 1 ? "Word café" : "Second word", meaning: "grace", short_definition: "grace", concordance_definition: "inherited constructor", original_word: "εἰσί3rd", transliteration: "cafē", title: "excludedtitle", part_of_speech: "excludedpart" });
    await put(`lexicon/${language}/0000.json`, { schema_version: 1, language, entries: { [`${prefix}2`]: entry(2), [`${prefix}1`]: entry(1) } });
  }
  await put("outlines/books/genesis.json", { book, items: [{ marker: "1.", title: "Word word café", reference: { book_id: "genesis", label: "1:1–2", start_chapter: 1, start_verse: 1 } }] });
  const commentary = { book, source: { id: "fixture" }, chapters: { 1: { 1: [{ verse_text: "excludedversetext", commentary_html: "<b>Word</b>word &amp; café" }], 2: [{ commentary_html: "Grace" }] } } };
  await put("commentaries/source/fixture/genesis.json", commentary);
  assert.deepEqual(indexTerms("Café café ἄλφα a the __proto__ constructor"), ["cafe", "cafe", "a", "the", "proto", "constructor"]); checks += 1;

  let before = await snapshot();
  await reject(() => generateSearchIndexes({ dataRoot: root, check: true }), /missing generated output[\s\S]*npm run search:generate/);
  await unchanged(before, "check mode must not create the absent Search tree");
  const generated = await generateSearchIndexes({ dataRoot: root });
  check(generated.changed_files === 6, "write mode creates five shards and the manifest");
  const search = await get("search/manifest.json");
  check(!("generated_at" in search), "deterministic identity must not contain wall-clock timestamps");
  check(search.counts.verses_records === 3 && search.counts.lexicon_records === 4 && search.counts.outlines_records === 1 && search.counts.commentaries_records === 2, "collection counts reconcile canonical records");
  const { manifest_digest: manifestDigest, ...otherIdentity } = search.identity;
  assert.equal(hash(JSON.stringify({ ...search, identity: otherIdentity })), manifestDigest); checks += 1;
  for (const shard of Object.values(search.generated).flat()) {
    check(hash(await readFile(join(root, shard.path))) === shard.sha256, `${shard.path} has verified byte identity`);
    for (const input of shard.inputs) check(hash(await readFile(join(root, input.path))) === input.sha256, `${input.path} has verified canonical identity`);
  }
  const verseShard = await get("search/verses/fixture/genesis.json");
  assert.deepEqual(verseShard.terms.word, [["1", "1"], ["1", "1"], ["1", "2"]]); checks += 1;
  assert.deepEqual(verseShard.terms.cafe, [["1", "1"], ["2", "1"]]); checks += 1;
  check(verseShard.terms.a.length === 1 && verseShard.terms.the.length === 1, "index preserves stopwords and single character postings");
  const lexicon = await get("search/lexicon/greek.json");
  assert.deepEqual(lexicon.terms.word, ["G1", "G2"]); checks += 1;
  assert.deepEqual(lexicon.terms.grace, ["G1", "G1", "G2", "G2"]); checks += 1;
  check(lexicon.terms.constructor.length === 2 && !lexicon.terms.excludedtitle && !lexicon.terms.excludedpart && !lexicon.terms.g1, "lexicon field boundary and dictionary-key safety are preserved");
  const commentaryShard = await get("search/commentaries/fixture/genesis.json");
  assert.deepEqual(commentaryShard.terms.word, [["1", "1", 0], ["1", "1", 0]]); checks += 1;
  check(commentaryShard.terms.amp.length === 1 && !commentaryShard.terms.excludedversetext, "commentary uses tag-separated HTML without changing legacy entity or verse-text indexing");
  check(search.source_identities.every((source) => source.witness_id && source.namespace && source.output_namespace), "every collection has witness-qualified and namespaced identity");
  check(search.authority_boundaries.alignment_required === false && search.authority_boundaries.excluded.includes("morphology"), "source-only records and independent future authorities are explicit");

  before = await snapshot();
  await generateSearchIndexes({ dataRoot: root, check: true });
  await unchanged(before, "successful check mode must not rewrite bytes or timestamps");
  check((await generateSearchIndexes({ dataRoot: root })).changed_files === 0, "second write generation is idempotent");
  await unchanged(before, "idempotent generation must preserve timestamps");
  await put("search/verses/fixture/genesis.json", { changed: true });
  before = await snapshot();
  await reject(() => generateSearchIndexes({ dataRoot: root, check: true }), /search\/verses\/fixture\/genesis.json: expected SHA-256/);
  await unchanged(before, "mismatch check mode must not repair outputs");
  await generateSearchIndexes({ dataRoot: root });

  // A late malformed source/count must fail before repairing an earlier stale shard.
  await put("search/verses/fixture/genesis.json", { changed: true });
  await put("commentaries/metadata.json", { ...commentaryMetadata, source_entries_by_source: { fixture: 3 } });
  before = await snapshot();
  await reject(() => generateSearchIndexes({ dataRoot: root }), /fixture commentary entry count: expected 3, received 2/);
  await unchanged(before, "late canonical validation must run before any write");
  await put("commentaries/metadata.json", commentaryMetadata);
  await generateSearchIndexes({ dataRoot: root });
  await put("source-manifest.json", { ...rights, exceptions: [] });
  await reject(() => generateSearchIndexes({ dataRoot: root }), /retained exception notices are required/);
  await put("source-manifest.json", rights);
  await put("manifest.json", { ...manifest, translations: [{ id: "../escape" }] });
  await reject(() => generateSearchIndexes({ dataRoot: root }), /invalid namespaced path identifier/);
  await put("manifest.json", manifest);
  await put("search/unknown.json", { marker: "preserve" });
  before = await snapshot();
  await reject(() => generateSearchIndexes({ dataRoot: root }), /unexpected Search output/);
  await unchanged(before, "unexpected output must be retained");
  await rm(join(root, "search/unknown.json"));

  const greekPath = "lexicon/greek/0000.json";
  const greek = await get(greekPath);
  await put(greekPath, { ...greek, entries: { ...greek.entries, G1: { ...greek.entries.G1, strong_number: 99 } } });
  await reject(() => generateSearchIndexes({ dataRoot: root }), /G1 Strong's number: expected 1, received 99/);
  await put(greekPath, greek);
  const outside = await mkdtemp(join(tmpdir(), "bible-search-link-target-"));
  try {
    await symlink(outside, join(root, "search/linked"), process.platform === "win32" ? "junction" : "dir");
    await reject(() => generateSearchIndexes({ dataRoot: root }), /symbolic links\/reparse paths are not allowed/);
    await rm(join(root, "search/linked"));
  } finally { await rm(outside, { recursive: true, force: true }); }
  console.log(`PASS search-generator: ${checks} deterministic generation, identity, compatibility, and safety assertions`);
} finally {
  // Only this test's mkdtemp root is removed; no owner data or repository tree.
  await rm(root, { recursive: true, force: true });
}
