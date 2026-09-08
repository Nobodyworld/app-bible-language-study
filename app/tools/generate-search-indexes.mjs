#!/usr/bin/env node

// Current exact Search authority. These occurrence postings intentionally preserve
// the existing matcher, including duplicates; changing them is a runtime migration.
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_DATA_ROOT = fileURLToPath(new URL("../data/", import.meta.url));
const GENERATOR = "app/tools/generate-search-indexes.mjs";
const COLLECTIONS = ["verses", "lexicon", "outlines", "commentaries"];
const LEXICON_FIELDS = ["summary", "meaning", "short_definition", "concordance_definition", "original_word", "transliteration"];
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => JSON.stringify(value);

export function indexTerms(value) {
  return String(value || "").normalize("NFKD").replace(/\p{Mark}/gu, "").toLowerCase().match(/[a-z0-9]+/g) || [];
}

function addTerms(terms, value, ref) {
  for (const term of indexTerms(value)) (terms[term] ||= []).push(ref);
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}: expected an object.`);
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label}: expected an array.`);
  return value;
}

function requireId(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9]+(?:[_-][a-z0-9]+)*$/.test(value)) throw new Error(`${label}: invalid namespaced path identifier.`);
  return value;
}

function numericKeys(value, label) {
  const keys = Object.keys(requireObject(value, label));
  if (keys.some((key) => !/^[1-9]\d*$/.test(key))) throw new Error(`${label}: expected positive integer reference keys; source-specific versification requires an explicit adapter.`);
  return keys.sort((a, b) => Number(a) - Number(b));
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, received ${actual}. Reconcile the canonical source and its declared identity/count before generating.`);
}

async function safePath(root, relativePath, allowMissing = false) {
  if (typeof relativePath !== "string" || !relativePath || relativePath.includes("\\") || relativePath.split("/").some((part) => !part || part === "." || part === "..") || /[:\0]/.test(relativePath)) {
    throw new Error("Unsafe data-relative path; absolute paths and traversal are forbidden.");
  }
  const target = resolve(root, ...relativePath.split("/"));
  if (!target.startsWith(`${root}${sep}`)) throw new Error("Data path escapes its root.");
  let current = root;
  for (const part of relativePath.split("/")) {
    current = join(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new Error(`${relativePath}: symbolic links/reparse paths are not allowed.`);
    } catch (error) {
      if (allowMissing && error.code === "ENOENT") break;
      if (error.code === "ENOENT") throw new Error(`${relativePath}: missing canonical input. Restore or reconcile the declared source; generation cannot silently skip it.`);
      throw error;
    }
  }
  return target;
}

async function buildSearchIndexes({ dataRoot = DEFAULT_DATA_ROOT, check = false }, allowMismatches = false) {
  const requestedRoot = resolve(dataRoot);
  if ((await lstat(requestedRoot)).isSymbolicLink()) throw new Error("Data root must not be a symbolic link/reparse path.");
  const root = await realpath(requestedRoot);
  const inputs = new Map();
  const generated = Object.fromEntries(COLLECTIONS.map((name) => [name, []]));
  const mismatches = [];
  let changed = 0;
  const readJson = async (path) => {
    const bytes = await readFile(await safePath(root, path));
    inputs.set(path, { path, bytes: bytes.length, sha256: sha256(bytes) });
    try { return JSON.parse(bytes.toString("utf8")); }
    catch { throw new Error(`${path}: invalid JSON; repair the canonical source before generating.`); }
  };
  const listJson = async (path) => {
    const entries = await readdir(await safePath(root, path), { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new Error(`${path}: symbolic links/reparse paths are not allowed.`);
      if (!entry.isFile() || !entry.name.endsWith(".json")) throw new Error(`${path}: unexpected entry ${entry.name}; reconcile the canonical shard inventory.`);
      files.push(entry.name);
    }
    if (!files.length) throw new Error(`${path}: no canonical JSON shards found.`);
    return files.sort(compare);
  };
  const emit = async (path, payload) => {
    const bytes = Buffer.from(json(payload));
    const target = await safePath(root, path, true);
    let current;
    try { current = await readFile(target); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (!current?.equals(bytes)) {
      if (check) mismatches.push(`${path}: ${current ? `expected SHA-256 ${sha256(bytes)}, found ${sha256(current)}` : "missing generated output"}`);
      else { await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes); changed += 1; }
    }
    return { bytes: bytes.length, sha256: sha256(bytes) };
  };
  const manifest = await readJson("manifest.json");
  const rights = await readJson("source-manifest.json");
  const editions = await readJson("text-editions.json");
  const commentaryMetadata = await readJson("commentaries/metadata.json");
  if (rights.source_package?.classification !== "OPENBIBLE_CONFIRMED" || !rights.source_package?.default_rights || !/^[a-f0-9]{64}$/.test(rights.source_package?.archive_sha256 || "") || !Array.isArray(rights.exceptions) ||
      !rights.exceptions.length || rights.exceptions.some((entry) => !entry.scope || !entry.terms) ||
      !rights.exceptions.some((entry) => Array.isArray(entry.notices) && entry.notices.length && entry.notices.every((notice) => typeof notice === "string" && notice.trim()))) {
    throw new Error("source-manifest.json: confirmed source-package classification/digest/rights and retained exception notices are required.");
  }
  const books = requireArray(manifest.books, "manifest.json books").map((book) => requireId(book.id, "book id")).sort(compare);
  const translations = requireArray(manifest.translations, "manifest.json translations").map((translation) => requireId(translation.id, "translation id")).sort(compare);
  const sources = requireArray(commentaryMetadata.sources, "commentaries/metadata.json sources").map((source) => requireId(source.id, "commentary source id")).sort(compare);
  for (const [label, ids] of [["books", books], ["translations", translations], ["commentary sources", sources]]) {
    if (!ids.length || new Set(ids).size !== ids.length) throw new Error(`${label}: empty or duplicate source identities.`);
  }
  // Source lists come from canonical metadata, never the previously generated manifest.
  // An undeclared file fails instead of silently expanding a lane or overwriting one.
  const expectBooks = async (path) => {
    assertEqual(json(await listJson(path)), json(books.map((id) => `${id}.json`)), `${path} book inventory`);
  };
  for (const translation of translations) await expectBooks(`verses/${translation}`);
  await expectBooks("outlines/books");
  for (const source of sources) await expectBooks(`commentaries/source/${source}`);
  for (const translation of translations) {
    const edition = requireArray(editions.editions, "text-editions.json editions").find((entry) => entry.id === translation);
    if (!edition?.license_note) throw new Error(`text-editions.json: ${translation} requires retained edition rights.`);
    assertEqual(edition.coverage?.books, books.length, `${translation} edition book count`);
  }
  // Validate the complete output tree before a write, including unknown files.
  const expectedPaths = new Set(["search/manifest.json"]);
  for (const id of translations) for (const book of books) expectedPaths.add(`search/verses/${id}/${book}.json`);
  for (const language of ["hebrew", "greek"]) expectedPaths.add(`search/lexicon/${language}.json`);
  for (const book of books) expectedPaths.add(`search/outlines/${book}.json`);
  for (const id of sources) for (const book of books) expectedPaths.add(`search/commentaries/${id}/${book}.json`);
  const inspectOutputs = async (path) => {
    const directory = await safePath(root, path, true);
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) { if (error.code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      const child = `${path}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`${child}: symbolic links/reparse paths are not allowed.`);
      if (entry.isDirectory()) await inspectOutputs(child);
      else if (!entry.isFile() || !expectedPaths.has(child)) throw new Error(`${child}: unexpected Search output; reconcile it explicitly. This generator never removes files.`);
    }
  };
  await inspectOutputs("search");
  const emitShard = async (collection, descriptor, payload, sourcePaths, records) => {
    const digest = await emit(descriptor.path, payload);
    generated[collection].push({ ...descriptor, records, term_count: Object.keys(payload.terms).length, posting_count: Object.values(payload.terms).reduce((sum, refs) => sum + refs.length, 0), ...digest,
      inputs: sourcePaths.map((path) => inputs.get(path)) });
  };
  for (const translation of translations) {
    let translationRecords = 0;
    for (const book of books) {
      const inputPath = `verses/${translation}/${book}.json`;
      const source = await readJson(inputPath);
      assertEqual(source.book?.id, book, `${inputPath} book identity`);
      assertEqual(source.translation?.id, translation, `${inputPath} translation identity`);
      const terms = Object.create(null);
      let records = 0;
      for (const chapter of numericKeys(source.chapters, inputPath)) for (const verse of numericKeys(source.chapters[chapter], `${inputPath} chapter ${chapter}`)) {
        const text = source.chapters[chapter][verse];
        if (typeof text !== "string" || !text.trim()) throw new Error(`${inputPath} ${chapter}:${verse}: expected nonempty source text.`);
        addTerms(terms, text, [chapter, verse]); records += 1;
      }
      translationRecords += records;
      await emitShard("verses", { translation_id: translation, book_id: book, path: `search/verses/${translation}/${book}.json` }, { translation_id: translation, book_id: book, terms }, [inputPath], records);
    }
    assertEqual(translationRecords, manifest.counts?.verses_by_translation?.[translation], `${translation} verse count`);
  }
  for (const language of ["hebrew", "greek"]) {
    const terms = Object.create(null);
    const sourcePaths = [];
    const seen = new Set();
    let records = 0;
    for (const file of await listJson(`lexicon/${language}`)) {
      if (!/^\d{4}\.json$/.test(file)) throw new Error(`lexicon/${language}: unexpected chunk name ${file}.`);
      const path = `lexicon/${language}/${file}`;
      const source = await readJson(path);
      assertEqual(source.language, language, `${path} language identity`);
      sourcePaths.push(path);
      const prefix = language === "hebrew" ? "H" : "G";
      const entries = requireObject(source.entries, `${path} entries`);
      for (const code of Object.keys(entries).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))) {
        const entry = entries[code];
        if (!new RegExp(`^${prefix}[1-9]\\d*$`).test(code) || entry.strong_code !== code || seen.has(code)) throw new Error(`${path}: invalid, duplicate, or mismatched Strong's identity ${code}.`);
        assertEqual(entry.language, language, `${path} ${code} language identity`);
        assertEqual(entry.strong_number, Number(code.slice(1)), `${path} ${code} Strong's number`);
        for (const field of LEXICON_FIELDS) if (entry[field] != null && typeof entry[field] !== "string") throw new Error(`${path} ${code}: ${field} must be a string when present.`);
        assertEqual(`${String(Math.floor(Number(code.slice(1)) / 1000) * 1000).padStart(4, "0")}.json`, file, `${path} Strong's chunk identity`);
        seen.add(code);
        addTerms(terms, LEXICON_FIELDS.map((field) => entry[field] || "").join(" "), code); records += 1;
      }
    }
    await emitShard("lexicon", { language, path: `search/lexicon/${language}.json` }, { language, terms }, sourcePaths, records);
  }
  for (const book of books) {
    const inputPath = `outlines/books/${book}.json`;
    const source = await readJson(inputPath);
    assertEqual(source.book?.id, book, `${inputPath} book identity`);
    const terms = Object.create(null);
    const items = requireArray(source.items, `${inputPath} items`);
    items.forEach((item, index) => addTerms(terms, [item.marker, item.title, item.reference?.label].filter(Boolean).join(" "), index));
    await emitShard("outlines", { book_id: book, path: `search/outlines/${book}.json` }, { book_id: book, terms }, [inputPath], items.length);
  }
  for (const sourceId of sources) {
    let sourceRecords = 0;
    for (const book of books) {
      const inputPath = `commentaries/source/${sourceId}/${book}.json`;
      const source = await readJson(inputPath);
      assertEqual(source.book?.id, book, `${inputPath} book identity`);
      assertEqual(source.source?.id, sourceId, `${inputPath} commentary identity`);
      const terms = Object.create(null);
      let records = 0;
      for (const chapter of numericKeys(source.chapters, inputPath)) for (const verse of numericKeys(source.chapters[chapter], `${inputPath} chapter ${chapter}`)) {
        requireArray(source.chapters[chapter][verse], `${inputPath} ${chapter}:${verse}`).forEach((entry, index) => {
          if (typeof entry.commentary_html !== "string") throw new Error(`${inputPath} ${chapter}:${verse}[${index}]: commentary_html must be a string.`);
          // Preserve the tracked lexical treatment of HTML/entities, not DOM display decoding.
          addTerms(terms, entry.commentary_html.replace(/<[^>]+>/g, " "), [chapter, verse, index]); records += 1;
        });
      }
      sourceRecords += records;
      await emitShard("commentaries", { source_id: sourceId, book_id: book, path: `search/commentaries/${sourceId}/${book}.json` }, { source_id: sourceId, book_id: book, terms }, [inputPath], records);
    }
    assertEqual(sourceRecords, commentaryMetadata.source_entries_by_source?.[sourceId], `${sourceId} commentary entry count`);
  }
  const counts = Object.fromEntries(COLLECTIONS.flatMap((collection) => {
    const shards = generated[collection];
    return [[`${collection}_shards`, shards.length], [`${collection}_records`, shards.reduce((sum, shard) => sum + shard.records, 0)], [`${collection}_terms`, shards.reduce((sum, shard) => sum + shard.term_count, 0)], [`${collection}_postings`, shards.reduce((sum, shard) => sum + shard.posting_count, 0)]];
  }));
  assertEqual(counts.commentaries_records, commentaryMetadata.counts?.source_entries, "commentary aggregate record count");
  const sourceIdentities = [
    ...translations.map((id) => ({ namespace: `verses/${id}`, witness_id: `openbible:text:${id}`, authority: "text", versification: `source:${id}`, source_paths: [`verses/${id}`], output_namespace: `search/verses/${id}` })),
    ...["hebrew", "greek"].map((id) => ({ namespace: `lexicon/${id}`, witness_id: `openbible:strongs:${id}`, authority: "lexicon", source_paths: [`lexicon/${id}`], output_namespace: `search/lexicon/${id}.json` })),
    { namespace: "outlines", witness_id: "openbible:outline", authority: "outline", versification: "source:outline-reference", source_paths: ["outlines/books"], output_namespace: "search/outlines" },
    ...sources.map((id) => ({ namespace: `commentaries/${id}`, witness_id: `openbible:commentary:${id}`, authority: "commentary", versification: `source:commentary:${id}`, source_paths: [`commentaries/source/${id}`], output_namespace: `search/commentaries/${id}` })),
  ];
  const sourceInputs = [...inputs.values()].sort((a, b) => compare(a.path, b.path));
  const outputIdentities = COLLECTIONS.flatMap((collection) => generated[collection].map(({ path, bytes, sha256: digest }) => ({ path, bytes, sha256: digest }))).sort((a, b) => compare(a.path, b.path));
  const result = {
    schema_version: 1,
    generator: GENERATOR,
    contract: "exact-search-occurrence-postings-v1",
    normalization: { unicode: "NFKD", remove_marks: true, lowercase: true, token_pattern: "[a-z0-9]+", index_min_length: 1, index_stopwords_removed: false, duplicate_postings: "preserved", commentary_html: "replace tags with spaces; retain entity spelling", term_order: "first occurrence in stable record/field order; JSON integer keys ascend", reference_order: "numeric chapter/verse/Strong's; source array order" },
    source_manifest: "data/source-manifest.json",
    source_package_sha256: rights.source_package.archive_sha256,
    source_identities: sourceIdentities,
    authority_boundaries: { source_list: "declared translations, lexicon languages, outline books, commentary sources", excluded: ["original-language-source-text", "lemma", "morphology", "alignment"], alignment_required: false, extension_policy: "New witnesses and versification need explicit namespaced adapters; never merge by reference alone or infer alignment." },
    identity: { algorithm: "sha256", input_digest: sha256(json(sourceInputs)), output_digest: sha256(json(outputIdentities)), manifest_digest_scope: "all manifest fields except identity.manifest_digest" },
    metadata_inputs: ["manifest.json", "source-manifest.json", "text-editions.json", "commentaries/metadata.json"].map((path) => inputs.get(path)),
    counts,
    generated,
  };
  result.identity.manifest_digest = sha256(json(result));
  await emit("search/manifest.json", result);
  if (mismatches.length && !allowMismatches) throw new Error(`Search check found ${mismatches.length} mismatch(es):\n${mismatches.slice(0,20).join("\n")}${mismatches.length > 20 ? `\n... ${mismatches.length - 20} additional mismatches.` : ""}\nRun npm run search:generate, review source/output identities and counts, then run npm run search:check.`);
  return { check, changed_files: changed, counts, identity: result.identity };
}

/** Generate only current Search outputs. check=true performs no writes or mkdir.
 * A write run first validates every canonical source/count and output path without
 * writes, so malformed late sources cannot leave partially regenerated indexes.
 */
export async function generateSearchIndexes({ dataRoot = DEFAULT_DATA_ROOT, check = false } = {}) {
  const validation = await buildSearchIndexes({ dataRoot, check: true }, !check);
  if (check) return validation;
  return buildSearchIndexes({ dataRoot, check: false });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--check") || args.length > 1) {
    console.error("Usage: node app/tools/generate-search-indexes.mjs [--check]"); process.exitCode = 1;
  } else {
    generateSearchIndexes({ check: args.includes("--check") }).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(error.message); process.exitCode = 1; });
  }
}
