export const STUDY_WORKSPACE_WIDTH_MODES = Object.freeze({
  compact: "compact",
  standard: "standard",
  expanded: "expanded",
});

export const STUDY_WORKSPACE_WIDTH_DEFAULT = STUDY_WORKSPACE_WIDTH_MODES.standard;
export const STUDY_WORKSPACE_WIDTH_STORAGE_KEY = "bibleapp:study-workspace-width:v1";
export const STUDY_WORKSPACE_WIDTH_CONTROL_SELECTOR =
  "[data-study-workspace-width-mode], [data-study-workspace-width-option]";

const WIDTH_MODE_VALUES = new Set(Object.values(STUDY_WORKSPACE_WIDTH_MODES));
const READER_ROW_SELECTOR = ".verse-row, .source-bearing-segment";

export function normalizeStudyWorkspaceWidth(value) {
  return WIDTH_MODE_VALUES.has(value) ? value : STUDY_WORKSPACE_WIDTH_DEFAULT;
}

function availableStorage(storage) {
  if (storage !== undefined) return storage;
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function readStudyWorkspaceWidth(storage) {
  try {
    return normalizeStudyWorkspaceWidth(
      availableStorage(storage)?.getItem?.(STUDY_WORKSPACE_WIDTH_STORAGE_KEY),
    );
  } catch {
    return STUDY_WORKSPACE_WIDTH_DEFAULT;
  }
}

export function writeStudyWorkspaceWidth(mode, storage) {
  const normalizedMode = normalizeStudyWorkspaceWidth(mode);
  try {
    availableStorage(storage)?.setItem?.(STUDY_WORKSPACE_WIDTH_STORAGE_KEY, normalizedMode);
  } catch {
    // The in-memory UI choice remains usable when browser storage is unavailable.
  }
  return normalizedMode;
}

function attributeRoot(root) {
  return root?.documentElement || root || null;
}

function controlsFor(root, controls) {
  if (controls !== undefined && controls !== null) {
    if (typeof controls[Symbol.iterator] === "function") return [...controls];
    return [controls];
  }
  return [...(root?.querySelectorAll?.(STUDY_WORKSPACE_WIDTH_CONTROL_SELECTOR) || [])];
}

function controlMode(control) {
  return (
    control?.dataset?.studyWorkspaceWidthMode ||
    control?.getAttribute?.("data-study-workspace-width-mode") ||
    control?.dataset?.studyWorkspaceWidthOption ||
    control?.getAttribute?.("data-study-workspace-width-option") ||
    ""
  );
}

export function applyStudyWorkspaceWidth(root, mode, controls) {
  const normalizedMode = normalizeStudyWorkspaceWidth(mode);
  const target = attributeRoot(root);
  if (target?.dataset) {
    target.dataset.studyWorkspaceWidth = normalizedMode;
  } else {
    target?.setAttribute?.("data-study-workspace-width", normalizedMode);
  }

  controlsFor(root, controls).forEach((control) => {
    const candidate = controlMode(control);
    const active = WIDTH_MODE_VALUES.has(candidate) && candidate === normalizedMode;
    control?.setAttribute?.("aria-pressed", active ? "true" : "false");
  });
  return normalizedMode;
}

export function initializeStudyWorkspaceWidth({ root, storage, controls } = {}) {
  return applyStudyWorkspaceWidth(root, readStudyWorkspaceWidth(storage), controls);
}

function elementsWithin(root, selector) {
  if (!root) return [];
  const elements = [];
  if (root.matches?.(selector)) elements.push(root);
  root.querySelectorAll?.(selector)?.forEach((element) => elements.push(element));
  return [...new Set(elements)];
}

function elementRect(element) {
  try {
    const rect = element?.getBoundingClientRect?.();
    if (!rect || !Number.isFinite(rect.top)) return null;
    const height = Number.isFinite(rect.height)
      ? rect.height
      : Number.isFinite(rect.bottom)
        ? rect.bottom - rect.top
        : 0;
    const bottom = Number.isFinite(rect.bottom) ? rect.bottom : rect.top + height;
    return { top: rect.top, bottom, height: Math.max(0, height) };
  } catch {
    return null;
  }
}

function dataValue(element, name) {
  const value = element?.dataset?.[name];
  return value === undefined || value === null ? "" : String(value);
}

function containingReaderRow(element) {
  if (element?.matches?.(READER_ROW_SELECTOR)) return element;
  return element?.closest?.(READER_ROW_SELECTOR) || null;
}

function rowIdentity(row) {
  return {
    kind: row?.classList?.contains?.("source-bearing-segment") ? "segment" : "verse",
    segmentId: dataValue(row, "segmentId"),
    refKey: dataValue(row, "refKey"),
    verse: dataValue(row, "verse"),
  };
}

function anchorIdentity(element, kind) {
  const row = containingReaderRow(element);
  return {
    kind,
    row: rowIdentity(row),
    interlinearKey: kind === "word" ? dataValue(element, "interlinearKey") : "",
    strongCode: kind === "word" ? dataValue(element, "strongCode") : "",
    tokenIndex: kind === "word" ? dataValue(element, "tokenIndex") : "",
  };
}

function capturedAnchor(element, kind) {
  const rect = elementRect(element);
  if (!rect) return null;
  return {
    element,
    identity: anchorIdentity(element, kind),
    top: rect.top,
  };
}

function viewportHeight(readerRoot) {
  const viewHeight = Number(readerRoot?.ownerDocument?.defaultView?.innerHeight);
  if (Number.isFinite(viewHeight) && viewHeight > 0) return viewHeight;
  const documentHeight = Number(readerRoot?.ownerDocument?.documentElement?.clientHeight);
  return Number.isFinite(documentHeight) && documentHeight > 0 ? documentHeight : Infinity;
}

function isMeaningfullyVisible(element, height) {
  const rect = elementRect(element);
  if (!rect || rect.height <= 0) return false;
  const visibleHeight = Math.min(rect.bottom, height) - Math.max(rect.top, 0);
  const meaningfulHeight = Math.min(24, Math.max(1, rect.height * 0.2));
  return visibleHeight >= meaningfulHeight;
}

export function captureReaderAnchor(readerRoot) {
  const activeWord = elementsWithin(readerRoot, ".reader-context-word")[0];
  if (activeWord) return capturedAnchor(activeWord, "word");

  const activeVerse = elementsWithin(readerRoot, ".reader-context-verse")[0];
  if (activeVerse) return capturedAnchor(activeVerse, "row");

  const height = viewportHeight(readerRoot);
  const visibleRow = elementsWithin(readerRoot, READER_ROW_SELECTOR).find((row) =>
    isMeaningfullyVisible(row, height),
  );
  return visibleRow ? capturedAnchor(visibleRow, "row") : null;
}

function sameRowIdentity(element, expected) {
  const actual = rowIdentity(containingReaderRow(element));
  if (expected.kind && actual.kind !== expected.kind) return false;
  if (expected.segmentId) return actual.segmentId === expected.segmentId;
  if (expected.refKey) return actual.refKey === expected.refKey;
  return Boolean(expected.verse) && actual.verse === expected.verse;
}

function findWordAnchor(readerRoot, snapshot) {
  const identity = snapshot.identity;
  const candidates = elementsWithin(readerRoot, ".strong-token, [data-interlinear-key]");

  if (identity.interlinearKey) {
    const keyMatches = candidates.filter(
      (candidate) => dataValue(candidate, "interlinearKey") === identity.interlinearKey,
    );
    const rowMatch = keyMatches.find((candidate) => sameRowIdentity(candidate, identity.row));
    if (rowMatch) return rowMatch;
    if (keyMatches.length === 1) return keyMatches[0];
  }

  const hasTokenIdentity = Boolean(identity.tokenIndex || identity.strongCode);
  if (hasTokenIdentity) {
    const tokenMatch = candidates.find((candidate) => {
      if (identity.tokenIndex && dataValue(candidate, "tokenIndex") !== identity.tokenIndex) return false;
      if (identity.strongCode && dataValue(candidate, "strongCode") !== identity.strongCode) return false;
      return sameRowIdentity(candidate, identity.row);
    });
    if (tokenMatch) return tokenMatch;
  }

  return candidates.includes(snapshot.element) ? snapshot.element : null;
}

function findRowAnchor(readerRoot, snapshot) {
  const candidates = elementsWithin(readerRoot, READER_ROW_SELECTOR);
  return (
    candidates.find((candidate) => sameRowIdentity(candidate, snapshot.identity.row)) ||
    (candidates.includes(snapshot.element) ? snapshot.element : null)
  );
}

function findReaderAnchor(readerRoot, snapshot) {
  if (!readerRoot || !snapshot?.identity || !Number.isFinite(snapshot.top)) return null;
  return snapshot.identity.kind === "word"
    ? findWordAnchor(readerRoot, snapshot)
    : findRowAnchor(readerRoot, snapshot);
}

export function restoreReaderAnchor(snapshot, { readerRoot, window: suppliedWindow } = {}) {
  const element = findReaderAnchor(readerRoot, snapshot);
  const rect = elementRect(element);
  if (!element || !rect) return { restored: false, delta: 0, element: null };

  const delta = rect.top - snapshot.top;
  const view = suppliedWindow || readerRoot?.ownerDocument?.defaultView || null;
  if (Math.abs(delta) >= 0.5 && typeof view?.scrollBy === "function") {
    view.scrollBy(0, delta);
  }
  return { restored: true, delta, element };
}

function readScrollTop(scroller) {
  const scrollTop = Number(scroller?.scrollTop);
  return Number.isFinite(scrollTop) ? scrollTop : null;
}

function restoreScrollTop(scroller, scrollTop) {
  if (!scroller || scrollTop === null) return;
  try {
    scroller.scrollTop = scrollTop;
  } catch {
    // A disconnected panel scroller should not make a width change fail.
  }
}

export function bindStudyWorkspaceWidthControls({
  root,
  storage,
  controls,
  readerRoot,
  detailScroller,
  window: suppliedWindow,
} = {}) {
  const resolvedControls = controlsFor(root, controls);
  const listeners = [];

  resolvedControls.forEach((control) => {
    const listener = () => {
      const requestedMode = controlMode(control);
      if (!WIDTH_MODE_VALUES.has(requestedMode)) return;

      const readerAnchor = captureReaderAnchor(readerRoot);
      const detailScrollTop = readScrollTop(detailScroller);
      applyStudyWorkspaceWidth(root, requestedMode, resolvedControls);
      writeStudyWorkspaceWidth(requestedMode, storage);
      restoreReaderAnchor(readerAnchor, { readerRoot, window: suppliedWindow });
      restoreScrollTop(detailScroller, detailScrollTop);
    };
    control?.addEventListener?.("click", listener);
    listeners.push([control, listener]);
  });

  return function unbindStudyWorkspaceWidthControls() {
    listeners.forEach(([control, listener]) => control?.removeEventListener?.("click", listener));
  };
}
