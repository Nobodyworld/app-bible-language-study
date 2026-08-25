import { buildReferenceContext } from "./reference-context.js";
import { normalizeTarget } from "./semantic-targets.js?v=pr13-live-qa-20260711e";

export const READER_NAVIGATION_STATE_KEY = "bibleAppReaderNavigation";
export const READER_NAVIGATION_SNAPSHOT_VERSION = 1;

function finiteScroll(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function finiteIndex(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function clean(value) {
  return String(value || "").trim();
}

function cloneSerializable(value) {
  if (value == null) return null;
  return JSON.parse(JSON.stringify(value));
}

function normalizeFocus(focus) {
  if (!focus || typeof focus !== "object") return null;
  const kind = clean(focus.kind);
  if (!kind) return null;
  return {
    kind,
    id: clean(focus.id) || null,
    verse: clean(focus.verse) || null,
    segmentId: clean(focus.segmentId) || null,
    interlinearKey: clean(focus.interlinearKey) || null,
    strongCode: clean(focus.strongCode) || null,
    tokenIndex: clean(focus.tokenIndex) || null,
    bookId: clean(focus.bookId).toLowerCase() || null,
    chapter: clean(focus.chapter) || null,
    label: clean(focus.label) || null,
  };
}

export function createReaderNavigationSnapshot(input = {}) {
  if (!input || typeof input !== "object") return null;
  if (
    Object.prototype.hasOwnProperty.call(input, "version") &&
    input.version !== READER_NAVIGATION_SNAPSHOT_VERSION
  ) {
    return null;
  }
  const translationId = clean(input.translationId || input.translation_id).toLowerCase();
  const bookId = clean(input.bookId || input.book_id).toLowerCase();
  const chapter = clean(input.chapter);
  if (!translationId || !bookId || !chapter) return null;

  const readerContext = input.readerContext
    ? buildReferenceContext(input.readerContext)
    : buildReferenceContext({ translationId, bookId, chapter, verse: input.verse });
  const textSpanTarget = normalizeTarget(input.textSpanTarget);
  const navigationIndex = finiteIndex(input.navigationIndex);
  const navigationMaxIndex = Math.max(navigationIndex, finiteIndex(input.navigationMaxIndex));
  const hasRouteVerse = Object.prototype.hasOwnProperty.call(input, "verse");
  if (
    readerContext.translation_id !== translationId ||
    readerContext.book_id !== bookId ||
    String(readerContext.chapter || "") !== chapter
  ) {
    return null;
  }
  if (textSpanTarget) {
    const ref = textSpanTarget.reference || {};
    if (
      textSpanTarget.translation_id !== translationId ||
      ref.book_id !== bookId ||
      String(ref.chapter || "") !== chapter
    ) {
      return null;
    }
  }

  return {
    version: READER_NAVIGATION_SNAPSHOT_VERSION,
    translationId,
    bookId,
    chapter,
    verse: clean(hasRouteVerse ? input.verse : readerContext.verse) || null,
    pageX: finiteScroll(input.pageX),
    pageY: finiteScroll(input.pageY),
    navigationIndex,
    navigationMaxIndex,
    readerContext: cloneSerializable(readerContext),
    textSpanTarget: textSpanTarget?.target_type === "text_span" ? cloneSerializable(textSpanTarget) : null,
    focus: normalizeFocus(input.focus),
  };
}

export function readerNavigationLocationKey(snapshot) {
  if (!snapshot) return "";
  return [snapshot.translationId, snapshot.bookId, snapshot.chapter, snapshot.verse || ""].join(":");
}

export function historyStateWithReaderSnapshot(historyState, snapshot) {
  const normalized = createReaderNavigationSnapshot(snapshot);
  if (!normalized) return historyState && typeof historyState === "object" ? { ...historyState } : null;
  return {
    ...(historyState && typeof historyState === "object" ? historyState : {}),
    [READER_NAVIGATION_STATE_KEY]: normalized,
  };
}

export function readerSnapshotFromHistoryState(historyState) {
  if (!historyState || typeof historyState !== "object") return null;
  return createReaderNavigationSnapshot(historyState[READER_NAVIGATION_STATE_KEY]);
}
