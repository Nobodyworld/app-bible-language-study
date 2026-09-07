#!/usr/bin/env node

import { readFile, readdir, mkdir, writeFile, lstat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DATA_ROOT = resolve(HERE, "..", "data");
const HEBREW_PATTERN = /[\u0590-\u05ff]/u;
const GREEK_PATTERN = /[\u0370-\u03ff\u1f00-\u1fff]/u;

export const SOURCE_DEFINITIONS = Object.freeze({
  wlc: {
    code: "WLC",
    name: "Westminster Leningrad Codex",
    language: "hebrew",
    testament: "old",
    witness_id: "openbible:wlc",
    versification: "openbible:wlc:source-references",
  },
  wlco: {
    code: "WLCO",
    name: "WLC — Consonants Only",
    language: "hebrew",
    testament: "old",
    witness_id: "openbible:wlco",
    versification: "openbible:wlco:source-references",
  },
  nestle: {
    code: "Nestle 1904",
    name: "Nestle Greek New Testament 1904",
    language: "greek",
    testament: "new",
    witness_id: "openbible:nestle-1904",
    versification: "openbible:nestle-1904:source-references",
  },
  tr94: {
    code: "TR94",
    name: "Scrivener’s Textus Receptus 1894",
    language: "greek",
    testament: "new",
    witness_id: "openbible:tr-1894",
    versification: "openbible:tr-1894:source-references",
  },
});

export const INTERLINEAR_SCHEMA = Object.freeze([
  "token_index", "original", "transliteration", "morphology", "strong_code",
  "strong_number", "english", "gloss", "language",
]);

// These are separate authorities. A Strong's link never asserts that two witnesses
// have the same text or versification, or that an unaligned token has an alignment.
export const SOURCE_AUTHORITY_CONTRACT = Object.freeze({
  schema_version: 1,
  authority_kinds: ["text", "lemma", "morphology", "alignment"],
  identity_fields: ["witness_id", "versification", "source_reference"],
  missing_alignment: null,
  unaligned_records: "retain-with-source-reference; never infer a canonical alignment",
  additional_witness_outputs: "sources/<witness-namespace>/<authority-kind>",
});

const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function safeSegment(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9]+(?:[_-][a-z0-9]+)*$/.test(value)) {
    throw new Error(`Invalid ${label}: expected a lowercase source/book namespace, without path separators.`);
  }
  return value;
}

function containedPath(root, path) {
  const target = resolve(root, path);
  const rel = relative(resolve(root), target);
  if (!rel || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(rel)) {
    throw new Error("Output path must be contained within its declared output root.");
  }
  return target;
}

function isWithin(root, target) {
  const rel = relative(resolve(root), resolve(target));
  return !rel || (rel !== ".." && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(rel));
}

async function rejectLinkedPath(target) {
  let current = resolve(target);
  for (;;) {
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error("Output paths must not contain symbolic links or junctions.");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort(compare).map((key) => [key, stableObject(value[key])]));
  }
  return value;
}

function readBookCatalog(manifest) {
  if (!Array.isArray(manifest.books) || !manifest.books.length) throw new Error("Book manifest has no books.");
  const catalog = new Map();
  for (const book of manifest.books) {
    const id = safeSegment(book.id, "book ID");
    if (catalog.has(id)) throw new Error(`Duplicate book ID in manifest: ${id}`);
    catalog.set(id, book);
  }
  return catalog;
}

async function readReviewedProvenance(provenancePath, sourceDefinitions = {}) {
  let provenance;
  try { provenance = JSON.parse(await readFile(provenancePath, "utf8")); }
  catch { throw new Error("Missing or invalid reviewed source provenance; supply --provenance-path before importing."); }
  const source = provenance.source_package;
  if (provenance.schema_version !== 1 || source?.classification !== "OPENBIBLE_CONFIRMED"
    || !/^[a-f0-9]{64}$/.test(source.archive_sha256 || "") || !source.name || !source.archive_filename
    || !source.reviewed_at || !source.default_rights || !Array.isArray(provenance.exceptions) || !provenance.exceptions.length
    || provenance.exceptions.some((entry) => !entry.scope || !entry.terms)) {
    throw new Error("Source provenance must retain the reviewed package identity, rights declaration, and attached exceptions; no outputs written.");
  }
  for (const [id, definition] of Object.entries(sourceDefinitions)) {
    const entry = provenance.original_language_sources?.find((sourceEntry) => sourceEntry.id === id);
    if (!entry) throw new Error(`Source ${id} is absent from reviewed provenance; no outputs written.`);
    if (entry.witness_id !== definition.witness_id || entry.versification !== definition.versification || entry.authority !== "text") {
      throw new Error(`Source ${id} witness/versification authority disagrees with reviewed provenance; no outputs written.`);
    }
  }
  return {
    input: { path: "reviewed-source-provenance", sha256: sha256(JSON.stringify(stableObject(provenance))) },
    declaration: {
      source_package: source,
      exceptions: provenance.exceptions,
      archive_binding: "reviewed declaration; input files are hashed separately, not asserted to reconstruct the archive",
    },
  };
}

function generationIdentity(kind, inputs, outputs, sources, counts) {
  const orderedInputs = inputs.sort((a, b) => compare(a.path, b.path));
  const orderedOutputs = outputs.map(({ path, content }) => ({ path, bytes: Buffer.byteLength(content), sha256: sha256(content) }))
    .sort((a, b) => compare(a.path, b.path));
  const identity = {
    schema_version: 1,
    generator: "app/tools/import-original-language-sources.mjs",
    generator_contract: 1,
    kind,
    sources,
    counts,
    inputs: orderedInputs,
    inputs_sha256: sha256(JSON.stringify(orderedInputs)),
    outputs: orderedOutputs,
    outputs_sha256: sha256(JSON.stringify(orderedOutputs)),
  };
  return { ...identity, identity_sha256: sha256(JSON.stringify(identity)) };
}

async function reconcileOutputs({ outputRoot, outputs, identity, identityPath, check, inputRoots = [], inputFiles = [] }) {
  const mismatchDetails = [];
  const artifacts = outputs.map(({ path, content }) => ({ path, target: containedPath(outputRoot, path), content }));
  if (identityPath) {
    const target = resolve(identityPath);
    if (artifacts.some((artifact) => !relative(artifact.target, target)) || inputRoots.some((root) => isWithin(root, target))
      || inputFiles.some((file) => !relative(resolve(file), target))) {
      throw new Error("Generation identity must not overwrite a source input or a generated corpus file.");
    }
    artifacts.push({ path: "generation identity", target, content: `${JSON.stringify(identity, null, 2)}\n` });
  }
  // Validate every path before the first write, including pre-existing junctions.
  for (const { target } of artifacts) {
    if (inputRoots.some((root) => isWithin(root, target)) || inputFiles.some((file) => !relative(resolve(file), target))) {
      throw new Error("Generated outputs must not overwrite source inputs.");
    }
    await rejectLinkedPath(target);
  }
  for (const { path, target, content } of artifacts) {
    if (check) {
      let current;
      try { current = await readFile(target, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
      if (current?.replace(/\r\n/g, "\n") !== content) {
        mismatchDetails.push({
          path,
          reason: current === undefined ? "missing output" : "content differs",
          expected_sha256: sha256(content),
          actual_sha256: current === undefined ? null : sha256(current.replace(/\r\n/g, "\n")),
          action: "Confirm the input source identity and review the generated diff before regenerating this output without --check.",
        });
      }
    } else {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    }
  }
  return { check, mismatches: mismatchDetails.length, mismatch_details: mismatchDetails, identity };
}

const BOOK_ALIASES = Object.freeze({
  canticles: "songs",
  psalm: "psalms",
  song: "songs",
  song_of_songs: "songs",
});

const NAMED_ENTITIES = Object.freeze({
  amp: "&",
  apos: "'",
  gt: ">",
  hellip: "…",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  mdash: "—",
  nbsp: " ",
  ndash: "–",
  quot: '"',
  rdquo: "”",
  rsquo: "’",
});

export function canonicalBookId(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return BOOK_ALIASES[normalized] || normalized;
}

export function decodeHtmlEntities(value) {
  return String(value || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, key) => {
    if (key[0] === "#") {
      const hexadecimal = key[1]?.toLowerCase() === "x";
      const number = Number.parseInt(key.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      return Number.isFinite(number) && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff)
        ? String.fromCodePoint(number) : entity;
    }
    return NAMED_ENTITIES[key.toLowerCase()] ?? entity;
  });
}

function htmlToSourceText(fragment) {
  return decodeHtmlEntities(String(fragment || "").replace(/<[^>]+>/g, " "))
    .replace(/[\u200e\u200f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .normalize("NFC");
}

function hasExpectedScript(text, language) {
  return language === "hebrew" ? HEBREW_PATTERN.test(text) : GREEK_PATTERN.test(text);
}

export function extractChapterVerses(html, language) {
  if (language !== "hebrew" && language !== "greek") throw new Error(`Unsupported language: ${language}`);
  const paragraphClass = language === "hebrew" ? "hebrew" : "greek";
  const paragraphPattern = new RegExp(
    `<p\\b[^>]*class=["'][^"']*\\b${paragraphClass}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/p>`,
    "gi",
  );
  const markerPattern = /<span\b[^>]*class=["'][^"']*\breftext\b[^"']*["'][^>]*>[\s\S]*?<b\b[^>]*>(\d+)<\/b>[\s\S]*?<\/span>/gi;
  const verses = {};
  const duplicates = [];
  const emptyReferences = [];

  for (const paragraphMatch of String(html || "").matchAll(paragraphPattern)) {
    const paragraph = paragraphMatch[1];
    const markers = [...paragraph.matchAll(markerPattern)];
    for (let index = 0; index < markers.length; index += 1) {
      const marker = markers[index];
      const verse = String(Number(marker[1]));
      const start = (marker.index || 0) + marker[0].length;
      const end = index + 1 < markers.length ? markers[index + 1].index : paragraph.length;
      const text = htmlToSourceText(paragraph.slice(start, end));
      if (!text || !hasExpectedScript(text, language)) {
        emptyReferences.push(verse);
        continue;
      }
      if (Object.hasOwn(verses, verse)) duplicates.push(verse);
      else verses[verse] = text;
    }
  }

  return { verses, duplicates, emptyReferences };
}

function numericEntries(object) {
  return Object.entries(object).sort((left, right) => Number(left[0]) - Number(right[0]));
}

export function stableBookJson(payload) {
  const chapters = {};
  for (const [chapter, verses] of numericEntries(payload.chapters || {})) {
    chapters[chapter] = Object.fromEntries(numericEntries(verses));
  }
  return `${JSON.stringify({ book: payload.book, chapters, translation: payload.translation })}\n`;
}

function parseArgs(argv) {
  const args = { check: false };
  const valueFlags = new Map([
    ["--archive-root", "archiveRoot"], ["--strongs-root", "strongsRoot"],
    ["--output-root", "outputRoot"], ["--data-root", "dataRoot"],
    ["--manifest-path", "manifestPath"], ["--identity-output", "identityPath"],
    ["--provenance-path", "provenancePath"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--check") args.check = true;
    else if (valueFlags.has(value)) {
      const argument = argv[++index];
      if (!argument || argument.startsWith("--")) throw new Error(`${value} requires a path.`);
      args[valueFlags.get(value)] = resolve(argument);
    }
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (Boolean(args.archiveRoot) === Boolean(args.strongsRoot)) throw new Error("Specify exactly one of --archive-root or --strongs-root.");
  if (args.strongsRoot && args.outputRoot) throw new Error("Strong's imports use --data-root; --output-root is reserved for source verse corpora.");
  if (args.archiveRoot && args.dataRoot) throw new Error("Source verse imports use --output-root; --data-root is reserved for Strong's imports.");
  return args;
}

async function fileNames(path) {
  try {
    return (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return [];
  }
}

async function findSourceBookDirectory(sourceRoot, bookId) {
  const candidates = [bookId, ...Object.entries(BOOK_ALIASES).filter(([, canonical]) => canonical === bookId).map(([alias]) => alias)];
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  const directories = new Map();
  for (const entry of entries.filter((entry) => entry.isDirectory()).sort((a, b) => compare(a.name, b.name))) {
    const id = canonicalBookId(entry.name);
    if (directories.has(id)) throw new Error(`Duplicate source book directory for ${id}.`);
    directories.set(id, entry.name);
  }
  const match = candidates.map(canonicalBookId).find((candidate) => directories.has(candidate));
  return match ? join(sourceRoot, directories.get(match)) : null;
}

export async function generateSourceCorpus({ archiveRoot, outputRoot = join(APP_DATA_ROOT, "verses"), check = false, manifestPath = join(APP_DATA_ROOT, "manifest.json"), provenancePath = join(APP_DATA_ROOT, "source-manifest.json"), identityPath, sourceDefinitions = SOURCE_DEFINITIONS }) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  readBookCatalog(manifest);
  const provenance = await readReviewedProvenance(provenancePath, sourceDefinitions);
  const oldTestamentIds = new Set(manifest.books.slice(0, 39).map((book) => book.id));
  const newTestamentIds = new Set(manifest.books.slice(39).map((book) => book.id));
  const summaries = [];
  const outputs = [];
  const inputs = [{ path: "book-catalog", sha256: sha256(JSON.stringify(stableObject(manifest.books))) }, provenance.input];

  for (const [sourceId, definition] of Object.entries(sourceDefinitions).sort(([a], [b]) => compare(a, b))) {
    safeSegment(sourceId, "source ID");
    if (!definition.witness_id || !definition.versification) throw new Error(`Source ${sourceId} needs a witness identity and source-specific versification.`);
    const sourceRoot = resolve(archiveRoot, sourceId);
    const allowedBooks = definition.testament === "old" ? oldTestamentIds : newTestamentIds;
    const summary = {
      source_id: sourceId,
      books_generated: 0,
      chapters_generated: 0,
      verses_generated: 0,
      skipped_files: 0,
      malformed_files: 0,
      duplicate_references: 0,
      empty_references: 0,
      duplicate_reference_samples: [],
      empty_reference_samples: [],
      malformed_file_samples: [],
      sample_references: [],
    };

    for (const book of manifest.books) {
      if (!allowedBooks.has(book.id)) continue;
      const bookDirectory = await findSourceBookDirectory(sourceRoot, book.id);
      if (!bookDirectory) {
        throw new Error(`Missing source book: ${sourceId}/${book.id}. Check the archive root and source identity.`);
      }
      const chapterFiles = (await fileNames(bookDirectory))
        .filter((name) => /^\d+\.html?$/i.test(name))
        .sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10) || compare(left, right));
      const chapters = {};
      const chapterNumbers = new Set();

      for (const name of chapterFiles) {
        const chapter = String(Number.parseInt(name, 10));
        if (chapter === "0" || chapterNumbers.has(chapter)) throw new Error(`Invalid or duplicate chapter: ${sourceId}/${book.id}/${chapter}.`);
        chapterNumbers.add(chapter);
        const raw = await readFile(join(bookDirectory, name));
        inputs.push({ path: `${sourceId}/${book.id}/${name}`, sha256: sha256(raw) });
        try {
          const parsed = extractChapterVerses(raw.toString("utf8"), definition.language);
          summary.duplicate_references += parsed.duplicates.length;
          summary.empty_references += parsed.emptyReferences.length;
          for (const verse of parsed.duplicates) {
            if (summary.duplicate_reference_samples.length < 20) {
              summary.duplicate_reference_samples.push(`${book.id} ${chapter}:${verse}`);
            }
          }
          for (const verse of parsed.emptyReferences) {
            if (summary.empty_reference_samples.length < 20) {
              summary.empty_reference_samples.push(`${book.id} ${chapter}:${verse}`);
            }
          }
          if (Object.keys(parsed.verses).length) {
            chapters[chapter] = parsed.verses;
            summary.chapters_generated += 1;
            summary.verses_generated += Object.keys(parsed.verses).length;
            if (summary.sample_references.length < 3) {
              summary.sample_references.push(`${book.id} ${chapter}:${Object.keys(parsed.verses)[0]}`);
            }
          } else {
            summary.skipped_files += 1;
          }
        } catch {
          summary.malformed_files += 1;
          if (summary.malformed_file_samples.length < 20) summary.malformed_file_samples.push(`${book.id}/${name}`);
        }
      }

      if (!Object.keys(chapters).length) throw new Error(`No source verses generated for ${sourceId}/${book.id}; check source format and language.`);
      summary.books_generated += 1;
      const content = stableBookJson({
        book,
        chapters,
        translation: { id: sourceId, code: definition.code, name: definition.name },
      });
      outputs.push({ path: `${sourceId}/${book.id}.json`, content });
    }
    summaries.push(summary);
  }

  const invalid = summaries.filter((source) => source.malformed_files || source.duplicate_references);
  if (invalid.length) throw new Error(`Source validation failed; no outputs written: ${JSON.stringify(invalid)}`);
  const identity = generationIdentity("original-language-text", inputs, outputs,
    Object.entries(sourceDefinitions).sort(([a], [b]) => compare(a, b)).map(([id, definition]) => ({
      id, witness_id: definition.witness_id, versification: definition.versification,
      authority: "text", namespace: `verses/${id}`, alignment_authority: null,
    })), summaries);
  return { ...await reconcileOutputs({ outputRoot, outputs, identity, identityPath, check, inputRoots: [archiveRoot], inputFiles: [manifestPath, provenancePath] }), provenance: provenance.declaration, sources: summaries };
}

// Keep archive-relative provenance already used by the application. The retired
// Python candidate removed every source_path, including useful public references.
export function sanitizeSourceProvenance(value) {
  if (Array.isArray(value)) return value.map(sanitizeSourceProvenance);
  if (!value || typeof value !== "object") return value;
  const entries = [];
  for (const key of Object.keys(value).sort(compare)) {
    const item = value[key];
    if (key === "source_path" && (typeof item !== "string" || !/^(?:strongs|wlc|wlco|nestle|tr94)\/[a-z0-9_./-]+$/i.test(item)
      || item.split("/").some((part) => !part || part === "." || part === ".."))) continue;
    entries.push([key, sanitizeSourceProvenance(item)]);
  }
  return Object.fromEntries(entries);
}

async function readJsonLines(root, path, consume, inputs) {
  const stream = createReadStream(containedPath(root, path));
  const hash = createHash("sha256");
  stream.on("data", (chunk) => hash.update(chunk));
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let lineNumber = 0;
  let count = 0;
  try {
    for await (const line of lines) {
      lineNumber += 1;
      if (!line.trim()) continue;
      let record;
      try { record = JSON.parse(line); } catch { throw new Error(`Invalid JSON at ${path}:${lineNumber}.`); }
      if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error(`Expected an object at ${path}:${lineNumber}.`);
      consume(record, `${path}:${lineNumber}`);
      count += 1;
    }
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`Missing source input: ${path}. Supply a complete reviewed Strong's extract root.`);
    throw error;
  } finally {
    lines.close();
    stream.destroy();
  }
  if (!count) throw new Error(`Source input is empty: ${path}. No outputs written.`);
  inputs.push({ path, records: count, sha256: `sha256:${hash.digest("hex")}` });
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${label}: expected a positive integer.`);
  return value;
}

export function strongChunkId(number) {
  positiveInteger(number, "Strong's number");
  return String(Math.floor(number / 1000) * 1000).padStart(4, "0");
}

function verifyStrongReference(record, language, location, { allowMissing = false } = {}) {
  if (allowMissing && !record.strong_code && record.strong_number == null) return;
  // Some reviewed extracts explicitly use H0/G0 for an unmapped source token.
  // Preserve that legacy sentinel in token records; it is not a lexicon entry.
  if (allowMissing && record.strong_number === 0 && record.strong_code === `${language === "hebrew" ? "H" : "G"}0`) return;
  const number = positiveInteger(record.strong_number, `Strong's number at ${location}`);
  if (record.strong_code !== `${language === "hebrew" ? "H" : "G"}${number}`) {
    throw new Error(`Strong's code/number/language disagreement at ${location}.`);
  }
}

/**
 * Import reviewed extracts using the current runtime wrappers and nine token
 * columns. No text/lemma/morphology is substituted from another authority.
 * This does not reconstruct a source extract from already-derived runtime data.
 */
export async function generateStrongData({ strongsRoot, outputRoot = APP_DATA_ROOT, check = false, manifestPath = join(APP_DATA_ROOT, "manifest.json"), provenancePath = join(APP_DATA_ROOT, "source-manifest.json"), identityPath }) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const catalog = readBookCatalog(manifest);
  const provenance = await readReviewedProvenance(provenancePath);
  const inputs = [{ path: "book-catalog", sha256: sha256(JSON.stringify(stableObject(manifest.books))) }, provenance.input];
  const grouped = new Map();
  const recordsByLanguage = { greek: 0, hebrew: 0 };
  const outputs = [];
  let recordCount = 0;
  await readJsonLines(strongsRoot, "verse-words/strongs_verse_words.jsonl", (record, location) => {
    const bookId = safeSegment(record.book_id, `book ID at ${location}`);
    if (!catalog.has(bookId)) throw new Error(`Unknown source book ${bookId} at ${location}; add a reviewed source-specific catalog instead of remapping the reference.`);
    const chapter = String(positiveInteger(record.chapter, `chapter at ${location}`));
    const verse = String(positiveInteger(record.verse, `verse at ${location}`));
    const index = positiveInteger(record.token_index, `token index at ${location}`);
    const language = record.language;
    if (language !== "hebrew" && language !== "greek") throw new Error(`Unsupported token language at ${location}.`);
    verifyStrongReference(record, language, location, { allowMissing: true });
    if (!grouped.has(bookId)) grouped.set(bookId, new Map());
    const chapters = grouped.get(bookId);
    if (!chapters.has(chapter)) chapters.set(chapter, new Map());
    const verses = chapters.get(chapter);
    if (!verses.has(verse)) verses.set(verse, new Map());
    const tokens = verses.get(verse);
    if (tokens.has(index)) throw new Error(`Duplicate token reference ${bookId} ${chapter}:${verse} token ${index} at ${location}.`);
    for (const field of ["original", "transliteration", "morphology", "strong_code", "english", "gloss"]) {
      if (record[field] != null && typeof record[field] !== "string") throw new Error(`Invalid ${field} at ${location}: expected text.`);
    }
    tokens.set(index, [index, record.original || "", record.transliteration || "", record.morphology || "",
      record.strong_code || "", record.strong_number ?? null, record.english || "", record.gloss || "", language]);
    recordsByLanguage[language] += 1;
    recordCount += 1;
  }, inputs);

  const versesByBook = {};
  for (const [bookId, book] of catalog) {
    const sourceChapters = grouped.get(bookId);
    if (!sourceChapters) throw new Error(`Missing word-analysis book ${bookId}; no outputs written. Use the catalog belonging to the reviewed extract.`);
    const chapters = {};
    versesByBook[bookId] = 0;
    for (const [chapter, sourceVerses] of [...sourceChapters].sort(([a], [b]) => Number(a) - Number(b))) {
      const verses = {};
      for (const [verse, tokens] of [...sourceVerses].sort(([a], [b]) => Number(a) - Number(b))) {
        verses[verse] = [...tokens].sort(([a], [b]) => a - b).map(([, token]) => token);
        versesByBook[bookId] += 1;
      }
      chapters[chapter] = verses;
    }
    // Match current tracked wrapper and no-trailing-newline serialization.
    outputs.push({ path: `interlinear/books/${bookId}.json`, content: JSON.stringify({ book, chapters }) });
  }

  const lexiconCounts = {};
  const chunksByLanguage = {};
  for (const language of ["hebrew", "greek"]) {
    const chunks = new Map();
    let count = 0;
    await readJsonLines(strongsRoot, `lexicon/${language}.jsonl`, (raw, location) => {
      if (raw.language !== language) throw new Error(`Lexicon language disagrees with its source namespace at ${location}.`);
      verifyStrongReference(raw, language, location);
      const entry = sanitizeSourceProvenance(raw);
      const chunkId = strongChunkId(entry.strong_number);
      if (!chunks.has(chunkId)) chunks.set(chunkId, new Map());
      const entries = chunks.get(chunkId);
      if (entries.has(entry.strong_code)) throw new Error(`Duplicate lexicon entry ${entry.strong_code} at ${location}.`);
      entries.set(entry.strong_code, entry);
      count += 1;
    }, inputs);
    chunksByLanguage[language] = [...chunks.keys()].sort(compare);
    for (const chunkId of chunksByLanguage[language]) {
      const entries = Object.fromEntries([...chunks.get(chunkId)].sort(([a], [b]) => Number(a.slice(1)) - Number(b.slice(1))));
      outputs.push({ path: `lexicon/${language}/${chunkId}.json`, content: JSON.stringify({ schema_version: 1, language, entries }) });
    }
    lexiconCounts[`${language}_entries`] = count;
  }
  const counts = {
    interlinear: { book_files: grouped.size, verse_word_records: recordCount, records_by_language: recordsByLanguage, verses_by_book: versesByBook },
    lexicon: { ...lexiconCounts, chunks_by_language: chunksByLanguage, chunk_size: 1000 },
  };
  const sources = [
    { id: "openbible:strongs-word-extract", witness_id: "openbible:strongs-verse-pages", versification: "openbible:strongs:source-references", namespace: "interlinear/books", authorities: { text: "extract:original", lemma: "extract:strong_code", morphology: "extract:morphology", alignment: null } },
    { id: "openbible:strongs-lexicon-extract", witness_id: "openbible:strongs-lexicon-pages", namespace: "lexicon/<language>/<numeric-chunk>", authority: "lemma" },
  ];
  const identity = generationIdentity("strongs-derived-data", inputs, outputs, sources, counts);
  return { ...await reconcileOutputs({ outputRoot, outputs, identity, identityPath, check, inputRoots: [strongsRoot], inputFiles: [manifestPath, provenancePath] }), provenance: provenance.declaration, counts };
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = args.strongsRoot
      ? await generateStrongData({ ...args, outputRoot: args.dataRoot || APP_DATA_ROOT })
      : await generateSourceCorpus(args);
    console.log(JSON.stringify(result, null, 2));
    if (result.mismatches) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
