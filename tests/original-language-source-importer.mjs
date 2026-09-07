#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile, mkdir, mkdtemp, readdir, rm, writeFile, symlink, unlink } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  canonicalBookId,
  extractChapterVerses,
  stableBookJson,
  generateSourceCorpus,
  generateStrongData,
  sanitizeSourceProvenance,
  SOURCE_DEFINITIONS,
  SOURCE_AUTHORITY_CONTRACT,
  INTERLINEAR_SCHEMA,
} from "../app/tools/import-original-language-sources.mjs";

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures", "original-language-sources");
const fixture = (name) => readFile(resolve(fixtureRoot, name), "utf8");

const wlc = extractChapterVerses(await fixture("wlc-psalms-23.htm"), "hebrew");
const wlco = extractChapterVerses(await fixture("wlco-psalms-23.htm"), "hebrew");
const nestle = extractChapterVerses(await fixture("nestle-john-1.htm"), "greek");
const tr94 = extractChapterVerses(await fixture("tr94-john-1.htm"), "greek");
const emptyGreek = extractChapterVerses(await fixture("nestle-psalms-23.htm"), "greek");

assert.equal(wlc.verses["1"], "מִזְמֹ֥ור לְדָוִ֑ד יְהוָ֥ה רֹ֝עִ֗י לֹ֣א אֶחְסָֽר׃");
assert.equal(wlco.verses["1"], "מזמור לדוד יהוה רעי לא אחסר׃");
assert(!/[A-Za-z]/.test(wlc.verses["1"]), "WLC extraction must not substitute transliteration.");
assert(!/miz|mōwr|Yah|rō|eḥsār/i.test(wlc.verses["1"]), "WLC extraction contains transliteration.");
assert(/[\u0370-\u03ff\u1f00-\u1fff]/u.test(nestle.verses["1"]));
assert(/[\u0370-\u03ff\u1f00-\u1fff]/u.test(tr94.verses["1"]));
assert(!/^\d/.test(nestle.verses["1"]), "Verse navigation number leaked into Greek source text.");
assert.deepEqual(emptyGreek.verses, {}, "Empty non-GNT placeholders must not generate Greek data.");
assert.deepEqual(emptyGreek.emptyReferences, ["1"]);
assert.equal(canonicalBookId("Song of Songs"), "songs");
assert.equal(canonicalBookId("1 Samuel"), "1_samuel");

const duplicate = extractChapterVerses(
  '<p class="hebrew"><span class="reftext"><b>1</b></span>אָב</p><p class="hebrew"><span class="reftext"><b>1</b></span>בֵּן</p>',
  "hebrew",
);
assert.deepEqual(duplicate.duplicates, ["1"]);

const payload = {
  book: { id: "psalms", name: "Psalms", osis: "Ps" },
  chapters: { 23: { 2: "ב", 1: "א" }, 1: { 1: "ג" } },
  translation: { id: "wlc", code: "WLC", name: "Westminster Leningrad Codex" },
};
assert.equal(stableBookJson(payload), stableBookJson(payload), "Importer output must be byte-deterministic.");
assert(stableBookJson(payload).indexOf('"1":{"1"') < stableBookJson(payload).indexOf('"23":{"1"'));

assert.deepEqual(INTERLINEAR_SCHEMA, ["token_index", "original", "transliteration", "morphology", "strong_code", "strong_number", "english", "gloss", "language"]);
assert.equal(SOURCE_AUTHORITY_CONTRACT.missing_alignment, null);
assert.deepEqual(SOURCE_AUTHORITY_CONTRACT.authority_kinds, ["text", "lemma", "morphology", "alignment"]);
assert.match(SOURCE_AUTHORITY_CONTRACT.unaligned_records, /retain-with-source-reference/);
assert.match(SOURCE_AUTHORITY_CONTRACT.additional_witness_outputs, /<witness-namespace>/);
assert.equal(new Set(Object.values(SOURCE_DEFINITIONS).map((source) => source.witness_id)).size, 4);
assert.equal(new Set(Object.values(SOURCE_DEFINITIONS).map((source) => source.versification)).size, 4);
assert.deepEqual(sanitizeSourceProvenance({ source_path: "C:/private/archive/secret.htm", child: [{ source_path: "strongs/hebrew/1.htm", keep: true }, { source_path: "strongs/../../private.htm" }] }),
  { child: [{ keep: true, source_path: "strongs/hebrew/1.htm" }, {}] });

const temporaryRoot = await mkdtemp(join(tmpdir(), "bible-source-import-test-"));
try {
  const strongsRoot = join(temporaryRoot, "extract");
  const outputRoot = join(temporaryRoot, "generated");
  const manifestPath = join(temporaryRoot, "manifest.json");
  const identityPath = join(temporaryRoot, "identity.json");
  const book = { id: "genesis", name: "Genesis", osis: "Gen" };
  await writeFile(manifestPath, JSON.stringify({ books: [book] }));
  await mkdir(join(strongsRoot, "verse-words"), { recursive: true });
  await mkdir(join(strongsRoot, "lexicon"), { recursive: true });
  const tokens = [
    { book_id: "genesis", chapter: 1, verse: 1, token_index: 2, original: "ב", language: "hebrew", strong_code: "H1000", strong_number: 1000, morphology: "N", source_path: "C:/private/source" },
    { book_id: "genesis", chapter: 1, verse: 1, token_index: 1, original: "א", language: "hebrew", strong_code: "H1", strong_number: 1 },
    { book_id: "genesis", chapter: 2, verse: 1, token_index: 1, original: "ג", language: "hebrew" },
  ];
  const hebrewEntries = [
    { strong_code: "H1000", strong_number: 1000, language: "hebrew", original_word: "ב" },
    { strong_code: "H1", strong_number: 1, language: "hebrew", original_word: "א", source_path: "C:/private/source", navigation: { next: { source_path: "strongs/hebrew/2.htm" } } },
  ];
  const writeLines = (path, values) => writeFile(join(strongsRoot, path), `${values.map((value) => JSON.stringify(value)).join("\n")}\n`);
  await writeLines("verse-words/strongs_verse_words.jsonl", tokens);
  await writeLines("lexicon/hebrew.jsonl", hebrewEntries);
  await writeLines("lexicon/greek.jsonl", [{ strong_code: "G1", strong_number: 1, language: "greek", original_word: "Α" }]);
  const options = { strongsRoot, outputRoot, manifestPath, identityPath };

  const absent = await generateStrongData({ ...options, check: true });
  assert.equal(absent.mismatches, 5, "Four runtime files plus identity must be reported as missing.");
  assert.equal(absent.mismatch_details[0].reason, "missing output");
  await assert.rejects(readdir(outputRoot), { code: "ENOENT" }, "Check must not create its destination.");
  const generated = await generateStrongData(options);
  const checked = await generateStrongData({ ...options, check: true });
  assert.equal(checked.mismatches, 0);
  assert.deepEqual(checked.identity, generated.identity);
  assert.equal(generated.counts.interlinear.verse_word_records, 3);
  assert.equal(generated.counts.interlinear.verses_by_book.genesis, 2);
  assert.equal(generated.counts.lexicon.hebrew_entries, 2);
  assert.deepEqual(generated.counts.lexicon.chunks_by_language.hebrew, ["0000", "1000"]);
  assert(!JSON.stringify(generated.identity).includes(temporaryRoot), "Generation identities must not contain private archive locations.");
  const bookPath = join(outputRoot, "interlinear/books/genesis.json");
  const interlinear = JSON.parse(await readFile(bookPath, "utf8"));
  assert.deepEqual(Object.keys(interlinear), ["book", "chapters"], "Preserve the accepted runtime wrapper.");
  assert.deepEqual(interlinear.chapters[1][1], [[1, "א", "", "", "H1", 1, "", "", "hebrew"], [2, "ב", "", "N", "H1000", 1000, "", "", "hebrew"]]);
  assert.equal(interlinear.chapters[2][1][0][5], null, "A missing Strong's mapping is retained without an invented link.");
  const lexicon = JSON.parse(await readFile(join(outputRoot, "lexicon/hebrew/0000.json"), "utf8"));
  assert.deepEqual(Object.keys(lexicon), ["schema_version", "language", "entries"]);
  assert.equal(lexicon.entries.H1.source_path, undefined);
  assert.equal(lexicon.entries.H1.navigation.next.source_path, "strongs/hebrew/2.htm");

  const sentinelsRoot = join(temporaryRoot, "sentinels");
  await writeLines("verse-words/strongs_verse_words.jsonl", [
    ...tokens,
    { ...tokens[0], chapter: 3, strong_code: "H0", strong_number: 0 },
    { ...tokens[0], chapter: 4, language: "greek", strong_code: "G0", strong_number: 0 },
  ]);
  await generateStrongData({ ...options, outputRoot: sentinelsRoot, identityPath: undefined });
  const sentinels = JSON.parse(await readFile(join(sentinelsRoot, "interlinear/books/genesis.json"), "utf8"));
  assert.deepEqual(sentinels.chapters[3][1][0].slice(4, 6), ["H0", 0], "Preserve Hebrew unmapped token sentinels.");
  assert.deepEqual(sentinels.chapters[4][1][0].slice(4, 6), ["G0", 0], "Preserve Greek unmapped token sentinels.");

  await writeLines("verse-words/strongs_verse_words.jsonl", [...tokens].reverse());
  await writeLines("lexicon/hebrew.jsonl", [...hebrewEntries].reverse());
  const reordered = await generateStrongData({ ...options, identityPath: undefined, check: true });
  assert.equal(reordered.mismatches, 0, "Input order must not affect generated runtime bytes.");
  assert.equal(reordered.identity.outputs_sha256, generated.identity.outputs_sha256);
  assert.notEqual(reordered.identity.inputs_sha256, generated.identity.inputs_sha256, "Raw source identity still records a changed extract.");

  await writeFile(bookPath, "damaged output");
  const mismatch = await generateStrongData({ ...options, identityPath: undefined, check: true });
  assert.equal(mismatch.mismatches, 1);
  assert.equal(mismatch.mismatch_details[0].path, "interlinear/books/genesis.json");
  assert.match(mismatch.mismatch_details[0].action, /source identity/);
  assert.equal(await readFile(bookPath, "utf8"), "damaged output", "Check must not repair mismatches.");
  const noWriteRoot = join(temporaryRoot, "must-not-exist");
  await writeLines("verse-words/strongs_verse_words.jsonl", [tokens[0], tokens[0]]);
  await assert.rejects(generateStrongData({ ...options, outputRoot: noWriteRoot }), /Duplicate token reference/);
  await assert.rejects(readdir(noWriteRoot), { code: "ENOENT" });
  await writeLines("verse-words/strongs_verse_words.jsonl", [{ ...tokens[0], book_id: "../escaped" }]);
  await assert.rejects(generateStrongData({ ...options, outputRoot: noWriteRoot }), /Invalid book ID/);
  await writeLines("verse-words/strongs_verse_words.jsonl", tokens);
  const invalidProvenancePath = join(temporaryRoot, "invalid-provenance.json");
  const provenance = JSON.parse(await readFile(new URL("../app/data/source-manifest.json", import.meta.url), "utf8"));
  await writeFile(invalidProvenancePath, JSON.stringify({ ...provenance, source_package: { ...provenance.source_package, classification: "UNREVIEWED" } }));
  await assert.rejects(generateStrongData({ ...options, outputRoot: noWriteRoot, provenancePath: invalidProvenancePath }), /reviewed package identity/);
  await assert.rejects(generateStrongData({ ...options, outputRoot: noWriteRoot, provenancePath: join(temporaryRoot, "absent-provenance.json") }), /Missing or invalid reviewed source provenance/);
  await assert.rejects(readdir(noWriteRoot), { code: "ENOENT" });
  await writeLines("lexicon/hebrew.jsonl", hebrewEntries);
  await assert.rejects(generateStrongData({ ...options, identityPath: bookPath }), /must not overwrite/);
  await assert.rejects(generateStrongData({ ...options, identityPath: join(strongsRoot, "lexicon/hebrew.jsonl") }), /must not overwrite/);
  await assert.rejects(generateStrongData({ ...options, identityPath: manifestPath }), /must not overwrite/);
  const linkedRoot = join(temporaryRoot, "linked-output");
  const linkTarget = join(temporaryRoot, "preserved-target");
  await mkdir(linkedRoot);
  await mkdir(linkTarget);
  await writeFile(join(linkTarget, "sentinel.txt"), "preserved");
  const linkPath = join(linkedRoot, "interlinear");
  await symlink(linkTarget, linkPath, process.platform === "win32" ? "junction" : "dir");
  try {
    await assert.rejects(generateStrongData({ ...options, outputRoot: linkedRoot, identityPath: undefined }), /symbolic links or junctions/);
    assert.deepEqual(await readdir(linkTarget), ["sentinel.txt"]);
  } finally {
    await unlink(linkPath);
  }
  await writeLines("lexicon/hebrew.jsonl", [hebrewEntries[0], hebrewEntries[0]]);
  await assert.rejects(generateStrongData({ ...options, outputRoot: noWriteRoot }), /Duplicate lexicon entry/);
  await assert.rejects(readdir(noWriteRoot), { code: "ENOENT" });
  await writeLines("lexicon/hebrew.jsonl", [{ ...hebrewEntries[0], strong_code: "G1000" }]);
  await assert.rejects(generateStrongData({ ...options, outputRoot: noWriteRoot }), /code\/number\/language disagreement/);

  const archiveRoot = join(temporaryRoot, "archive");
  await mkdir(join(archiveRoot, "wlc/genesis"), { recursive: true });
  await writeFile(join(archiveRoot, "wlc/genesis/1.htm"), '<p class="hebrew"><span class="reftext"><b>1</b></span>אָב</p>');
  const corpusOptions = { archiveRoot, manifestPath, outputRoot: join(temporaryRoot, "verses"), sourceDefinitions: { wlc: SOURCE_DEFINITIONS.wlc } };
  const corpusMissing = await generateSourceCorpus({ ...corpusOptions, check: true });
  assert.equal(corpusMissing.mismatches, 1);
  await assert.rejects(readdir(corpusOptions.outputRoot), { code: "ENOENT" });
  const corpus = await generateSourceCorpus(corpusOptions);
  assert.equal((await generateSourceCorpus({ ...corpusOptions, check: true })).mismatches, 0);
  assert.equal(corpus.identity.sources[0].alignment_authority, null);
  assert.equal(corpus.identity.sources[0].witness_id, "openbible:wlc");
  assert.equal(corpus.sources[0].verses_generated, 1);
  await writeFile(invalidProvenancePath, JSON.stringify({ ...provenance, original_language_sources: provenance.original_language_sources.map((source) => ({ ...source, versification: "unreviewed-remapping" })) }));
  await assert.rejects(generateSourceCorpus({ ...corpusOptions, provenancePath: invalidProvenancePath }), /witness\/versification authority disagrees/);
  await writeFile(join(archiveRoot, "wlc/genesis/01.htm"), '<p class="hebrew"><span class="reftext"><b>1</b></span>בֵּן</p>');
  await assert.rejects(generateSourceCorpus(corpusOptions), /duplicate chapter/);
} finally {
  // Only the unique task-created test directory is removed.
  await rm(temporaryRoot, { recursive: true });
}

console.log(JSON.stringify({ status: "ok", coverage: ["source-script extraction", "current runtime schemas and H0/G0 records", "deterministic generation and identity", "no-write comparison", "reviewed provenance and privacy", "invalid input rejection before writes", "junction and identity alias boundaries", "separate witness and authority contract"] }, null, 2));
