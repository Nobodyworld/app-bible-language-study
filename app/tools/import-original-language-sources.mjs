#!/usr/bin/env node

import { readFile, readdir, mkdir, writeFile, lstat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import {
  TEXTUAL_COMPARISON_SCHEMA_VERSION,
  TEXTUAL_COMPARISON_CONTRACT,
  SEPTUAGINT_PHASE1_BOUNDARY,
  assertValidTextualComparisonRecord,
  sourceTokenIdentityKey,
} from "../src/textual-comparison-contracts.js";

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
    source_token_namespace: "openbible:wlc",
    versification: "openbible:wlc:source-references",
    representation: { id: "pointed", unicode_normalization: "NFC", display: "Pointed Hebrew" },
  },
  wlco: {
    code: "WLCO",
    name: "WLC — Consonants Only",
    language: "hebrew",
    testament: "old",
    witness_id: "openbible:wlc",
    source_token_namespace: "openbible:wlc",
    versification: "openbible:wlc:source-references",
    representation: { id: "consonants-only", unicode_normalization: "NFC", display: "Consonants-only Hebrew" },
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
  source_token_identity_fields: ["witness_id", "versification", "source_reference", "token_index"],
  witness_vote_key: "witness_id",
  representation_identity: "Display/normalization metadata and output paths do not create witnesses or source-token identities; WLC/WLCO share one canonical Hebrew base.",
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
    if (entry.source_token_namespace !== definition.source_token_namespace
      || JSON.stringify(stableObject(entry.representation)) !== JSON.stringify(stableObject(definition.representation))) {
      throw new Error(`Source ${id} source-token/representation metadata disagrees with reviewed provenance; no outputs written.`);
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

async function reconcileOutputs({ outputRoot, outputs, identity, identityPath, check, inputRoots = [], inputFiles = [], strictBytes = false, exclusiveRoot = null }) {
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
  if (exclusiveRoot) {
    await rejectLinkedPath(exclusiveRoot);
    const expected = new Set(artifacts.map(({ target }) => resolve(target)));
    async function inspect(directory) {
      let entries;
      try { entries = await readdir(directory, { withFileTypes: true }); }
      catch (error) { if (error.code === "ENOENT") return; throw error; }
      for (const entry of entries.sort((a, b) => compare(a.name, b.name))) {
        const target = join(directory, entry.name);
        if (entry.isSymbolicLink()) throw new Error("Output paths must not contain symbolic links or junctions.");
        if (entry.isDirectory()) await inspect(target);
        else if (!expected.has(resolve(target))) mismatchDetails.push({
          path: relative(outputRoot, target).replaceAll("\\", "/"), reason: "unexpected output",
          action: "Review the stale file in this exclusively owned namespace; the importer never deletes it automatically.",
        });
      }
    }
    await inspect(exclusiveRoot);
    if (!check && mismatchDetails.length) throw new Error(`Unexpected files in owned output namespace; no outputs written: ${JSON.stringify(mismatchDetails)}`);
  }
  for (const { path, target, content } of artifacts) {
    if (check) {
      let current;
      try { current = await readFile(target, strictBytes ? undefined : "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
      const comparable = strictBytes ? current : current?.replace(/\r\n/g, "\n");
      if (strictBytes ? !comparable?.equals(Buffer.from(content)) : comparable !== content) {
        mismatchDetails.push({
          path,
          reason: current === undefined ? "missing output" : "content differs",
          expected_sha256: sha256(content),
          actual_sha256: comparable === undefined ? null : sha256(comparable),
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
    ["--swete-root", "sweteRoot"], ["--verse-map-path", "verseMapPath"],
    ["--app-verses-root", "appVersesRoot"],
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
  if ([args.archiveRoot, args.strongsRoot, args.sweteRoot].filter(Boolean).length !== 1) throw new Error("Specify exactly one of --archive-root, --strongs-root or --swete-root.");
  if (args.sweteRoot && (!args.outputRoot || args.dataRoot || args.manifestPath || args.identityPath)) {
    throw new Error("Swete requires --output-root and owns its manifest; --data-root, --manifest-path and --identity-output do not apply.");
  }
  if (!args.sweteRoot && (args.verseMapPath || args.appVersesRoot)) throw new Error("Verse-map options require --swete-root.");
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
      ...(definition.source_token_namespace ? { source_token_namespace: definition.source_token_namespace } : {}),
      ...(definition.representation ? { representation: definition.representation } : {}),
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

export const SWETE_SOURCE_REVISION = "26bad3eb42bba98471d154c954e36a6f30a0279d";
export const SWETE_TRANSFORMATION = "swete-source-lines-v1";
const SWETE_INPUT_MANIFEST = join(HERE, "source-inputs", "swete-pinned.json");
const SWETE_VERSE_MAPS = join(HERE, "source-inputs", "swete-verse-maps.json");
const SWETE_NAMESPACE = "sources/swete-lxx/text";
const SWETE_WITNESS = SEPTUAGINT_PHASE1_BOUNDARY.greek_text.witness_id;
const SWETE_VERSIFICATION = SEPTUAGINT_PHASE1_BOUNDARY.greek_text.versification;
const jsonText = (value) => `${JSON.stringify(stableObject(value))}\n`;

function exactKeys(record, keys, label) {
  if (!record || typeof record !== "object" || Array.isArray(record)
    || Object.keys(record).some((key) => !keys.includes(key))) throw new Error(`Invalid or unsupported fields in ${label}.`);
}

function requireDigest(value, label) {
  if (!/^sha256:[a-f0-9]{64}$/.test(value || "")) throw new Error(`Missing or invalid SHA-256 for ${label}.`);
}

function sourcePath(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*(?:\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)*$/.test(value)) {
    throw new Error("Source file identity must be a safe relative logical path.");
  }
  return value;
}

async function inputJson(path, label) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch { throw new Error(`Missing or invalid ${label}; supply the matching explicit input.`); }
}

async function verifiedInput(root, file) {
  sourcePath(file.path);
  requireDigest(file.sha256, file.path);
  if (!Number.isSafeInteger(file.bytes) || file.bytes <= 0) throw new Error(`Invalid source byte count: ${file.path}.`);
  const target = containedPath(root, file.path);
  await rejectLinkedPath(target);
  let raw;
  try { raw = await readFile(target); }
  catch { throw new Error(`Missing source input: ${file.path}; supply the pinned file.`); }
  if (raw.length !== file.bytes || sha256(raw) !== file.sha256) throw new Error(`Source identity mismatch: ${file.path}; expected ${file.sha256}. No outputs written.`);
  if (file.git_blob) {
    const blob = createHash("sha1").update(`blob ${raw.length}\0`).update(raw).digest("hex");
    if (blob !== file.git_blob) throw new Error(`Pinned Git blob mismatch: ${file.path}.`);
  }
  return raw;
}

/** Preserve literal source references and every line-token, including artifacts.
 * A recurring source block continues token_index and increments segment_index.
 * Source line is recoverable even when upstream references recur out of order.
 */
export function parseSweteText(raw, { path, book_id }) {
  sourcePath(path);
  if (!/^[1-9][0-9]*$/.test(book_id)) throw new Error("Invalid Swete source book identity.");
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw); }
  catch { throw new Error(`Malformed UTF-8: ${path}.`); }
  const lines = text.split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop();
  const units = new Map();
  const tokens = [];
  const counts = { tokens: 0, source_units: 0, recurring_blocks: 0, non_greek_tokens: 0, control_tokens: 0, normalized_tokens: 0 };
  let previous = null;
  for (const [offset, line] of lines.entries()) {
    const match = /^([1-9][0-9]*)\.((?:0|[1-9][0-9]*)|prologue|iva|ivb)\.((?:0|[1-9][0-9]*)(?:[A-Za-z][0-9]*)?) (\S+)$/u.exec(line);
    if (!match) throw new Error(`Malformed Swete line: ${path}:${offset + 1}; expected book.chapter.verse and one surface token.`);
    if (match[1] !== book_id) throw new Error(`Source book identity mismatch: ${path}:${offset + 1}.`);
    const ref = match.slice(1, 4).join(".");
    if (!units.has(ref)) units.set(ref, { source_reference: ref, chapter: match[2], verse: match[3], tokens: 0, segments: 0 });
    const unit = units.get(ref);
    if (previous !== ref) {
      if (unit.segments) counts.recurring_blocks += 1;
      unit.segments += 1;
    }
    unit.tokens += 1;
    const surface = match[4];
    if (!/\p{Script=Greek}/u.test(surface)) counts.non_greek_tokens += 1;
    if (/\p{C}/u.test(surface)) counts.control_tokens += 1;
    if (surface.normalize("NFC") !== surface) counts.normalized_tokens += 1;
    tokens.push({ source_reference: ref, token_index: unit.tokens, segment_index: unit.segments, source_line: offset + 1, surface });
    previous = ref;
  }
  if (!tokens.length) throw new Error(`Empty Swete source: ${path}.`);
  counts.tokens = tokens.length;
  counts.source_units = units.size;
  return { units: [...units.values()], tokens, counts };
}

async function sweteDeclaration(path) {
  const declaration = await inputJson(path, "Swete source manifest");
  const pinned = await inputJson(SWETE_INPUT_MANIFEST, "maintained Swete pin");
  if (declaration.profile === "pinned") {
    if (declaration.revision !== SWETE_SOURCE_REVISION || jsonText(declaration) !== jsonText(pinned)) {
      throw new Error("Stale or wrong Swete source identity; use the maintained pinned manifest. No outputs written.");
    }
  } else {
    // Synthetic input is an explicit testing lane, never a production identity.
    exactKeys(declaration, ["schema_version", "profile", "source_id", "revision", "license_id", "attribution", "files", "notices"], "synthetic source manifest");
    if (declaration.profile !== "synthetic" || declaration.source_id !== "fixture:swete"
      || declaration.revision !== "synthetic-v1" || declaration.license_id !== "CC0-1.0") {
      throw new Error("Unapproved Swete identity; only the pinned source or explicitly synthetic fixtures are accepted.");
    }
  }
  if (declaration.schema_version !== 1 || !declaration.attribution || !Array.isArray(declaration.files)
    || !declaration.files.length || !Array.isArray(declaration.notices)) throw new Error("Invalid Swete source manifest.");
  const paths = new Set();
  const books = new Set();
  for (const file of [...declaration.files, ...declaration.notices]) {
    exactKeys(file, ["path", "bytes", "sha256", "git_blob", "book_id"], "source file identity");
    sourcePath(file.path);
    const caseKey = file.path.toLowerCase();
    if (paths.has(caseKey)) throw new Error(`Duplicate/colliding source file identity: ${file.path}.`);
    paths.add(caseKey);
    if (declaration.files.includes(file)) {
      if (!/^[1-9][0-9]*$/.test(file.book_id) || books.has(file.book_id)) throw new Error("Duplicate/colliding or invalid source book identity.");
      books.add(file.book_id);
    }
  }
  return declaration;
}

/** Full coverage reconciliation over supplied source units and actual app refs.
 * Unlisted references get unavailable maps, never numeric identity fallbacks.
 */
export function reconcileSweteVerseMaps(sourceReferences, canonicalReferences, records, revision) {
  const sourceSet = new Set(sourceReferences);
  const canonicalSet = new Set(canonicalReferences);
  if (sourceSet.size !== sourceReferences.length || canonicalSet.size !== canonicalReferences.length) throw new Error("Duplicate/colliding reference inventory identity.");
  if (!Array.isArray(records)) throw new Error("Verse maps must be an array.");
  const ids = new Set();
  const bySource = new Map();
  const byTarget = new Map();
  const maps = [];
  const confirmedTypes = new Set(["exact", "split", "merged", "moved"]);
  for (const raw of records) {
    exactKeys(raw, TEXTUAL_COMPARISON_CONTRACT.record_types.verseMap, "verseMap");
    assertValidTextualComparisonRecord("verseMap", raw);
    for (const item of raw.provenance) exactKeys(item, ["source_id", "revision", "authority"], "verse-map provenance");
    if (raw.witness_id !== SWETE_WITNESS || raw.source_versification !== SWETE_VERSIFICATION) throw new Error("Wrong verse-map witness/versification identity.");
    if (raw.provenance.some((p) => p.authority !== "versification")) throw new Error("Verse-map provenance must have versification authority only.");
    if (ids.has(raw.id)) throw new Error(`Duplicate/colliding verse-map identity: ${raw.id}.`);
    ids.add(raw.id);
    for (const ref of raw.source_references) {
      if (!sourceSet.has(ref)) throw new Error(`Orphan verse-map source reference: ${ref}.`);
      if (bySource.has(ref)) throw new Error(`Duplicate/colliding verse-map source reference: ${ref}; express merged/split groups in one record.`);
      bySource.set(ref, raw);
    }
    for (const ref of raw.canonical_references) {
      if (!canonicalSet.has(ref)) throw new Error(`Unknown app verse-map target: ${ref}; supply actual matching app records.`);
      if (byTarget.has(ref)) throw new Error(`Duplicate/colliding verse-map target: ${ref}; express merged/split groups in one record.`);
      byTarget.set(ref, raw);
    }
    maps.push(raw);
  }
  for (const ref of sourceReferences) {
    if (bySource.has(ref)) continue;
    const map = {
      schema_version: TEXTUAL_COMPARISON_SCHEMA_VERSION,
      id: `verse-map:swete:unavailable:${ref}`, witness_id: SWETE_WITNESS,
      source_versification: SWETE_VERSIFICATION, source_references: [ref], canonical_references: [],
      map_type: "unavailable", review_status: "unreviewed",
      provenance: [{ source_id: SWETE_TRANSFORMATION, revision, authority: "versification" }],
    };
    if (ids.has(map.id)) throw new Error(`Duplicate/colliding generated verse-map identity: ${map.id}.`);
    ids.add(map.id);
    assertValidTextualComparisonRecord("verseMap", map);
    maps.push(map);
    bySource.set(ref, map);
  }
  const counts = { mapped: 0, source_only: 0, unmapped: 0, app_targets: byTarget.size, unreferenced_app_units: canonicalSet.size - byTarget.size, map_types: {} };
  const canonicalBySource = new Map();
  const stateBySource = new Map();
  for (const [ref, map] of bySource) {
    const confirmed = ["reviewed", "source-provided"].includes(map.review_status);
    const state = confirmed && confirmedTypes.has(map.map_type) ? "mapped" : confirmed && map.map_type === "source-only" ? "source_only" : "unmapped";
    counts[state] += 1;
    stateBySource.set(ref, state);
    // Split/multiple targets and candidates cannot supply one token app position.
    canonicalBySource.set(ref, state === "mapped" && map.canonical_references.length === 1 ? map.canonical_references[0] : null);
  }
  for (const map of maps) counts.map_types[map.map_type] = (counts.map_types[map.map_type] || 0) + 1;
  return { maps: maps.map(stableObject).sort((a, b) => compare(a.id, b.id)), canonicalBySource, stateBySource, counts };
}

export function assertSweteSourceToken(token) {
  exactKeys(token, [...TEXTUAL_COMPARISON_CONTRACT.record_types.sourceToken, "source_file", "source_line"], "Swete sourceToken");
  assertValidTextualComparisonRecord("sourceToken", token);
  if (token.witness_id !== SWETE_WITNESS || token.versification !== SWETE_VERSIFICATION
    || token.lemma !== null || token.morphology !== null || token.transliteration !== null || token.external_ids.length
    || token.provenance.some((p) => p.authority !== "text")) throw new Error("Unsupported Swete annotation, external identity or alignment authority.");
}

export async function generateSweteCorpus({ sweteRoot, outputRoot, check = false, provenancePath = SWETE_INPUT_MANIFEST,
  verseMapPath = SWETE_VERSE_MAPS, appVersesRoot = join(APP_DATA_ROOT, "verses", "wlc") }) {
  const started = performance.now();
  if (!sweteRoot || !outputRoot) throw new Error("Swete requires explicit source and output roots.");
  const declaration = await sweteDeclaration(provenancePath);
  const inputRoots = [sweteRoot, appVersesRoot];
  const inputFiles = [provenancePath, verseMapPath, SWETE_INPUT_MANIFEST];
  const namespaceRoot = containedPath(outputRoot, SWETE_NAMESPACE);
  const inputs = [{ path: "swete-source-manifest", sha256: sha256(jsonText(declaration)) }];
  const books = [];
  const counts = { books: 0, source_units: 0, tokens: 0, raw_text_bytes: 0, notice_bytes: 0, parse_failures: 0, duplicate_identities: 0,
    recurring_blocks: 0, non_greek_tokens: 0, control_tokens: 0, normalized_tokens: 0 };
  let parseMs = 0;
  for (const file of [...declaration.files].sort((a, b) => compare(a.path, b.path))) {
    const raw = await verifiedInput(sweteRoot, file);
    inputs.push({ ...file });
    counts.raw_text_bytes += raw.length;
    const parseStart = performance.now();
    const parsed = parseSweteText(raw, file);
    parseMs += performance.now() - parseStart;
    for (const key of Object.keys(parsed.counts)) counts[key] += parsed.counts[key];
    books.push({ file, ...parsed });
  }
  counts.books = books.length;
  const outputs = [];
  for (const file of declaration.notices) {
    const raw = await verifiedInput(sweteRoot, file);
    inputs.push({ ...file });
    counts.notice_bytes += raw.length;
    outputs.push({ path: `${SWETE_NAMESPACE}/notices/${file.path}`, content: new TextDecoder("utf-8", { fatal: true }).decode(raw) });
  }
  const mapping = await inputJson(verseMapPath, "Swete verse-map manifest");
  exactKeys(mapping, ["schema_version", "source_revision", "app_witness_id", "app_files", "authorities", "records"], "verse-map manifest");
  if (mapping.schema_version !== 1 || mapping.source_revision !== declaration.revision || mapping.app_witness_id !== "openbible:wlc"
    || !Array.isArray(mapping.app_files) || !Array.isArray(mapping.authorities)) throw new Error("Stale or wrong verse-map source identity.");
  inputs.push({ path: "swete-verse-map-manifest", sha256: sha256(jsonText(mapping)) });
  const canonicalReferences = [];
  const appBooks = new Set();
  for (const file of mapping.app_files) {
    exactKeys(file, ["path", "book_id", "bytes", "sha256"], "app reference source");
    safeSegment(file.book_id, "app book ID");
    if (appBooks.has(file.book_id) || file.path !== `${file.book_id}.json`) throw new Error("Duplicate/colliding app book or file identity.");
    appBooks.add(file.book_id);
    const raw = await verifiedInput(appVersesRoot, file);
    inputs.push({ ...file, path: `app-reference/${file.path}` });
    const book = JSON.parse(raw);
    if (book.book?.id !== file.book_id || !book.chapters || typeof book.chapters !== "object" || Array.isArray(book.chapters)) throw new Error("Wrong app book reference identity.");
    for (const [chapter, verses] of Object.entries(book.chapters)) {
      if (!/^[1-9][0-9]*$/.test(chapter) || !verses || typeof verses !== "object" || Array.isArray(verses)) throw new Error("Invalid app chapter inventory.");
      for (const [verse, surface] of Object.entries(verses)) {
        if (!/^[1-9][0-9]*$/.test(verse) || typeof surface !== "string" || !surface.trim()) throw new Error("Invalid app verse inventory.");
        canonicalReferences.push(`${file.book_id}/${chapter}/${verse}`);
      }
    }
  }
  for (const authority of mapping.authorities) {
    exactKeys(authority, ["source_id", "revision", "authority", "license_id", "attribution", "source_url", "sha256", "changes"], "mapping authority");
    if (authority.authority !== "versification" || !authority.license_id || !authority.attribution || !authority.changes
      || !/^https:\/\/(github\.com|raw\.githubusercontent\.com)\//.test(authority.source_url || "")) throw new Error("Missing versification rights/provenance.");
    requireDigest(authority.sha256, "mapping authority");
  }
  if (!Array.isArray(mapping.records) || mapping.records.some((record) => !Array.isArray(record.provenance)
    || record.provenance.some((p) => !mapping.authorities.some((a) => a.source_id === p.source_id && a.revision === p.revision)))) {
    throw new Error("Verse-map records lack declared revision-qualified provenance.");
  }
  const coverage = reconcileSweteVerseMaps(books.flatMap((book) => book.units.map((unit) => unit.source_reference)), canonicalReferences, mapping.records, SWETE_TRANSFORMATION);
  const sourceProvenance = [{ source_id: declaration.source_id, revision: declaration.revision, authority: "text" }];
  const witness = {
    schema_version: TEXTUAL_COMPARISON_SCHEMA_VERSION, id: SWETE_WITNESS, language: "greek", script: "Greek",
    canon: declaration.profile === "pinned" ? "swete:pinned-source-book-inventory" : "fixture:synthetic",
    edition: { name: declaration.profile === "pinned" ? "Swete Septuagint" : "Synthetic Swete parser fixture", version: declaration.revision },
    coverage: books.map(({ file, units }) => ({ source_book_id: file.book_id, scope: declaration.profile === "pinned" ? "complete" : "partial",
      source_references: declaration.profile === "pinned" ? [] : units.map((unit) => unit.source_reference) })),
    versification: SWETE_VERSIFICATION, normalization_profile: "source-verbatim-with-nfc-alias",
    representations: [{ id: "source-text", display: "Source text", normalization_profile: "source-verbatim-with-nfc-alias" }],
    rights: { license_id: declaration.license_id, delivery: "local-proof-only; separate data license; not a distributed optional pack" },
    provenance: sourceProvenance,
  };
  assertValidTextualComparisonRecord("textWitness", witness);
  outputs.push({ path: `${SWETE_NAMESPACE}/witness.json`, content: jsonText(witness) });
  const bookCounts = [];
  for (const book of books) {
    const seen = new Set();
    const tokenLines = [];
    for (const raw of book.tokens) {
      const token = {
        schema_version: TEXTUAL_COMPARISON_SCHEMA_VERSION, id: `token:swete:${raw.source_reference}:${raw.token_index}`,
        witness_id: SWETE_WITNESS, versification: SWETE_VERSIFICATION, representation_id: "source-text",
        ...raw, source_file: book.file.path, canonical_reference: coverage.canonicalBySource.get(raw.source_reference),
        normalized_forms: { nfc: raw.surface.normalize("NFC") }, lemma: null, morphology: null, transliteration: null, external_ids: [],
        provenance: sourceProvenance,
      };
      assertSweteSourceToken(token);
      const key = sourceTokenIdentityKey(token);
      if (seen.has(key)) throw new Error(`Duplicate/colliding source token identity: ${token.id}.`);
      seen.add(key);
      tokenLines.push(jsonText(token));
    }
    outputs.push({ path: `${SWETE_NAMESPACE}/tokens/${book.file.book_id}.jsonl`, content: tokenLines.join("") });
    const summary = { source_book_id: book.file.book_id, ...book.counts, mapped: 0, source_only: 0, unmapped: 0 };
    for (const unit of book.units) summary[coverage.stateBySource.get(unit.source_reference)] += 1;
    bookCounts.push(summary);
  }
  outputs.push({ path: `${SWETE_NAMESPACE}/verse-maps.jsonl`, content: coverage.maps.map(jsonText).join("") });
  const rights = { source: declaration, mapping_authorities: mapping.authorities, transformations: [
    { id: SWETE_TRANSFORMATION, version: 1, changes: "Parse literal source references; enumerate every line-token per reference across recurring blocks; preserve surfaces and source lines; add NFC aliases; apply only explicit verse maps; retain unmapped records." },
  ], unsupported: { lemma: null, morphology: null, strongs: null, hebrew_greek_word_alignment: "unsupported", alternate_vorlage: "unsupported" } };
  outputs.push({ path: `${SWETE_NAMESPACE}/provenance.json`, content: jsonText(rights) });
  outputs.push({ path: `${SWETE_NAMESPACE}/NOTICE.txt`, content: `${declaration.attribution}\nData license: ${declaration.license_id}\n${declaration.profile === "pinned" ? "https://creativecommons.org/licenses/by-sa/4.0/\nSwete text and project data adaptations retain CC BY-SA 4.0. Application code is separately MIT.\n" : "Synthetic fixture text only; CC0-1.0.\n"}Retain source notices and mapping component credits in provenance.json. Changes: literal reference parsing, source-order token enumeration, NFC aliases and explicit verse-map projection. No endorsement is implied.\n` });
  const transformInputs = ["app/tools/import-original-language-sources.mjs", "app/src/textual-comparison-contracts.js"];
  for (const path of transformInputs) inputs.push({ path, sha256: sha256((await readFile(resolve(HERE, "../..", path), "utf8")).replace(/\r\n/g, "\n")) });
  counts.output_records = counts.tokens + coverage.maps.length + 1;
  counts.output_files = outputs.length + 1;
  counts.output_payload_bytes = outputs.reduce((sum, item) => sum + Buffer.byteLength(item.content), 0);
  const identity = generationIdentity("swete-text", inputs, outputs, [{ witness_id: SWETE_WITNESS, namespace: SWETE_NAMESPACE,
    transformation: SWETE_TRANSFORMATION, source: declaration, coverage: { ...coverage.counts, books: bookCounts },
    readiness: "local-text-proof; full-corpus-mapping-and-optional-pack-not-ready", unsupported: rights.unsupported }], counts);
  const result = await reconcileOutputs({ outputRoot, outputs, identity, identityPath: join(namespaceRoot, "manifest.json"), check,
    inputRoots, inputFiles, strictBytes: true, exclusiveRoot: namespaceRoot });
  return { ...result, counts, coverage: coverage.counts, measurements: {
    parse_ms: Number(parseMs.toFixed(3)), total_ms: Number((performance.now() - started).toFixed(3)),
    generated_files: outputs.length + 1,
    generated_bytes: identity.outputs.reduce((sum, item) => sum + item.bytes, 0) + Buffer.byteLength(`${JSON.stringify(identity, null, 2)}\n`),
  } };
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = args.sweteRoot ? await generateSweteCorpus(args) : args.strongsRoot
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
