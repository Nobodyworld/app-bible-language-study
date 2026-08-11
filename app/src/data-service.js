import { DATA_ROOT } from "./config.js";

const cache = new Map();
const pendingCache = new Map();
const languageMetadataCache = new Map();
const LANGUAGE_METADATA_VERSION = "clean-app-v1-sofit4";
const STUDY_DATA_VERSION = "clean-app-v1-strongs-restore1";

// Translations that ship a Strong's overlay (word-to-word tagging) like BSB.
const STRONGS_OVERLAY_TRANSLATIONS = new Set(["bsb", "kjv", "ylt"]);

function versionedStudyPath(path) {
  return `${path}?v=${STUDY_DATA_VERSION}`;
}

export async function fetchJson(path) {
  if (cache.has(path)) return cache.get(path);
  if (pendingCache.has(path)) return pendingCache.get(path);
  const pending = fetch(path)
    .then(async (response) => {
      if (!response.ok) throw new Error(`Could not load ${path}`);
      const value = await response.json();
      cache.set(path, value);
      return value;
    })
    .finally(() => pendingCache.delete(path));
  pendingCache.set(path, pending);
  return pending;
}

export async function tryFetchJson(path) {
  try {
    return await fetchJson(path);
  } catch {
    return null;
  }
}

export function loadManifest() {
  return fetchJson(`${DATA_ROOT}/manifest.json?v=pr13-live-qa-20260711e`);
}

async function datasetAvailable(key) {
  const manifest = await tryFetchJson(`${DATA_ROOT}/manifest.json`);
  const optional = manifest?.optional_datasets;
  // Default to available unless the manifest explicitly marks the dataset as absent.
  return optional?.[key] !== false;
}

export async function translationCanLoadBook(translationId, bookId) {
  return Boolean(await tryFetchJson(`${DATA_ROOT}/verses/${translationId}/${bookId}.json`));
}

export async function loadReaderCoreBookData(translationId, bookId) {
  const verseBook = await fetchJson(`${DATA_ROOT}/verses/${translationId}/${bookId}.json`);

  if (translationId !== "bsb") {
    const hasOverlay = STRONGS_OVERLAY_TRANSLATIONS.has(translationId) && (await datasetAvailable("strongs"));
    const strongs = hasOverlay
      ? await tryFetchJson(versionedStudyPath(`${DATA_ROOT}/strongs/${translationId}/books/${bookId}.json`))
      : null;
    return {
      verseBook,
      footnotes: null,
      presentation: null,
      strongs,
    };
  }

  const [hasFootnotes, hasPresentation, hasStrongs] = await Promise.all([
    datasetAvailable("footnotes"),
    datasetAvailable("presentation"),
    datasetAvailable("strongs"),
  ]);
  const [footnotes, presentation, strongs] = await Promise.all([
    hasFootnotes ? tryFetchJson(versionedStudyPath(`${DATA_ROOT}/footnotes/bsb/${bookId}.json`)) : null,
    hasPresentation ? tryFetchJson(versionedStudyPath(`${DATA_ROOT}/presentation/bsb/books/${bookId}.json`)) : null,
    hasStrongs ? tryFetchJson(versionedStudyPath(`${DATA_ROOT}/strongs/bsb/books/${bookId}.json`)) : null,
  ]);

  return {
    verseBook,
    footnotes,
    presentation,
    strongs,
  };
}

async function loadOptionalBookDataset(datasetKey, path) {
  if (!(await datasetAvailable(datasetKey))) {
    return { availability: "unavailable", data: null };
  }
  return { availability: "available", data: await fetchJson(versionedStudyPath(path)) };
}

export function loadBookCrossrefs(bookId) {
  return loadOptionalBookDataset("crossrefs", `${DATA_ROOT}/crossrefs/${bookId}.json`);
}

export function loadBookOutline(bookId) {
  return loadOptionalBookDataset("outlines", `${DATA_ROOT}/outlines/books/${bookId}.json`);
}

export function loadBookInterlinear(bookId) {
  return loadOptionalBookDataset("interlinear", `${DATA_ROOT}/interlinear/books/${bookId}.json`);
}

export function fetchCommentaryAggregate(bookId) {
  return tryFetchJson(versionedStudyPath(`${DATA_ROOT}/commentaries/verses/${bookId}.json`));
}

export function fetchCommentarySource(sourceId, bookId) {
  return tryFetchJson(versionedStudyPath(`${DATA_ROOT}/commentaries/source/${sourceId}/${bookId}.json`));
}

export function fetchSearchManifest() {
  return tryFetchJson(`${DATA_ROOT}/search/manifest.json`);
}

export function fetchSearchShard(path) {
  return tryFetchJson(`${DATA_ROOT}/${path}`);
}

export async function fetchVerseBook(translationId, bookId) {
  return tryFetchJson(`${DATA_ROOT}/verses/${translationId}/${bookId}.json`);
}

export async function fetchWordMapBook(translationId, bookId) {
  return tryFetchJson(versionedStudyPath(`${DATA_ROOT}/analysis/word-map/${translationId}/${bookId}.json`));
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function passageVerseRange(reference) {
  const start = Number(reference.verse_start || reference.verse || 1);
  const end = Number(reference.verse_end || reference.verse_start || reference.verse || start);
  return {
    start: Number.isFinite(start) && start > 0 ? start : 1,
    end: Number.isFinite(end) && end >= start ? end : start,
  };
}

export async function resolvePassageText(translationId, reference) {
  if (!reference?.book_id || !reference?.chapter) return null;
  const { start, end } = passageVerseRange(reference);
  const candidates = uniqueValues([translationId, "bsb"]);

  for (const candidate of candidates) {
    const book = await fetchVerseBook(candidate, reference.book_id);
    const chapter = book?.chapters?.[String(reference.chapter)];
    if (!chapter) continue;

    const verses = [];
    for (let verse = start; verse <= end; verse += 1) {
      const text = chapter[String(verse)];
      if (text) verses.push({ verse, text });
    }

    if (verses.length) {
      return {
        book,
        translation_id: candidate,
        translation_code: book.translation?.code || candidate.toUpperCase(),
        verses,
        text: verses.map((item) => `${item.verse}. ${item.text}`).join(" "),
      };
    }
  }

  return null;
}

export async function loadLanguageMetadata(language) {
  if (language !== "hebrew" && language !== "greek") return null;
  if (languageMetadataCache.has(language)) return languageMetadataCache.get(language);
  const promise = Promise.all([
    fetchJson(`${DATA_ROOT}/language/${language}/alphabet.json?v=${LANGUAGE_METADATA_VERSION}`),
    fetchJson(`${DATA_ROOT}/language/${language}/marks.json?v=${LANGUAGE_METADATA_VERSION}`),
  ]).then(([alphabet, marks]) => ({ alphabet, marks }));
  languageMetadataCache.set(language, promise);
  return promise;
}

function lexiconChunkId(strongNumber) {
  return String(Math.floor(Number(strongNumber || 0) / 1000) * 1000).padStart(4, "0");
}

export async function fetchLexiconEntry(strongCode) {
  const match = String(strongCode || "").match(/^([HG])(\d+)/i);
  if (!match) return null;
  const prefix = match[1].toUpperCase();
  const number = Number(match[2]);
  const language = prefix === "H" ? "hebrew" : "greek";
  const chunk = await tryFetchJson(versionedStudyPath(`${DATA_ROOT}/lexicon/${language}/${lexiconChunkId(number)}.json`));
  return chunk?.entries?.[`${prefix}${number}`] || null;
}

export async function loadOriginalSourceTexts({ manifest, bookId, chapter }, language, verse) {
  const candidateIds = language === "greek" ? ["nestle", "tr94"] : ["wlc", "wlco"];
  const sourceDefinitions = manifest?.original_language_sources || [];
  const availableSourceIds = new Set(sourceDefinitions.map((item) => item.id));
  const sourceIds = candidateIds.filter((sourceId) => availableSourceIds.has(sourceId));
  const results = [];
  for (const sourceId of sourceIds) {
    const book = await tryFetchJson(`${DATA_ROOT}/verses/${sourceId}/${bookId}.json`);
    const text = book?.chapters?.[chapter]?.[verse];
    const sourceDefinition = sourceDefinitions.find((item) => item.id === sourceId);
    if (text) {
      results.push({
        id: sourceId,
        code: sourceDefinition?.code || sourceId.toUpperCase(),
        label: sourceDefinition?.name || sourceDefinition?.code || sourceId.toUpperCase(),
        language: sourceDefinition?.language || language,
        script: sourceDefinition?.script || (language === "hebrew" ? "Hebrew" : "Greek"),
        variant: sourceDefinition?.variant || null,
        text,
      });
    }
  }
  return results;
}
