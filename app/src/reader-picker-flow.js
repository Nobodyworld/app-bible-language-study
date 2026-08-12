const ACTIVE_OPTION_SELECTOR = ".reader-picker-option.active";
const PICKER_READY_TIMEOUT_MS = 1800;
const FROZEN_HIGHLIGHT_REFRESH_DELAYS_MS = [0, 40, 120, 300, 700, 1300, 1900];
const READER_BACKGROUND_RESET_SELECTOR = [
  "button",
  "a",
  "input",
  "select",
  "textarea",
  "summary",
  "label",
  "[role='button']",
  ".verse-context-tabs",
  ".detail-floating-nav",
  "#detailToolSurface",
  ".strong-token",
  ".language-word-hover",
  ".language-letter-hover",
  ".letter-unit",
].join(", ");
const READER_NAVIGATION_RESET_SELECTOR = [
  "#homeButton",
  "#prevChapter",
  "#nextChapter",
  "#prevChapterFloat",
  "#nextChapterFloat",
  "#translationSelect",
  "#bookSelect",
  "#chapterSelect",
  "#bookPickerPanel .reader-picker-option",
  "#chapterPickerPanel .reader-picker-option",
].join(", ");

let frozenReaderToken = null;
let frozenReaderRow = null;
let frozenReaderContext = null;
let frozenHighlightObserver = null;

function afterPickerPaint(callback) {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(callback);
  });
}

function currentReaderScope() {
  return {
    bookId: document.getElementById("bookSelect")?.value || "",
    chapter: document.getElementById("chapterSelect")?.value || "",
  };
}

function sameReaderScope(left, right = currentReaderScope()) {
  return Boolean(left?.bookId && left?.chapter && left.bookId === right.bookId && left.chapter === right.chapter);
}

function setPickerExpanded(button, panel, expanded) {
  if (!button || !panel) return;
  button.setAttribute("aria-expanded", expanded ? "true" : "false");
  panel.hidden = !expanded;
}

function scrollActivePickerOptionIntoView(panel) {
  if (!panel) return;
  afterPickerPaint(() => {
    if (panel.hidden) return;
    panel.querySelector(ACTIVE_OPTION_SELECTOR)?.scrollIntoView({
      block: "center",
      inline: "nearest",
    });
  });
}

function waitForPickerOptions(panel, isReady, callback) {
  const startedAt = Date.now();
  const check = () => {
    if (!panel || Date.now() - startedAt > PICKER_READY_TIMEOUT_MS) return;
    if (panel.querySelector(ACTIVE_OPTION_SELECTOR) && isReady()) {
      callback();
      return;
    }
    window.requestAnimationFrame(check);
  };
  window.requestAnimationFrame(check);
}

function openChapterPickerAfterBookSelection(selectedBookLabel) {
  const bookButton = document.getElementById("bookPickerButton");
  const bookPanel = document.getElementById("bookPickerPanel");
  const chapterButton = document.getElementById("chapterPickerButton");
  const chapterPanel = document.getElementById("chapterPickerPanel");

  waitForPickerOptions(
    chapterPanel,
    () =>
      bookButton?.textContent?.trim() === selectedBookLabel &&
      chapterButton?.textContent?.trim() === "1",
    () => {
      setPickerExpanded(bookButton, bookPanel, false);
      setPickerExpanded(chapterButton, chapterPanel, true);
      scrollActivePickerOptionIntoView(chapterPanel);
    },
  );
}

function disconnectFrozenHighlightObserver() {
  frozenHighlightObserver?.disconnect();
  frozenHighlightObserver = null;
}

function captureFrozenReaderContext(token, row) {
  const scope = currentReaderScope();
  return {
    bookId: scope.bookId,
    chapter: scope.chapter,
    verse: row?.dataset?.verse || token?.dataset?.verse || "",
    segmentId: row?.dataset?.segmentId || token?.dataset?.segmentId || "",
    refKey: row?.dataset?.refKey || "",
    interlinearKey: token?.dataset?.interlinearKey || "",
    strongCode: token?.dataset?.strongCode || "",
    tokenIndex: token?.dataset?.tokenIndex || "",
  };
}

function findFrozenReaderRow() {
  if (!sameReaderScope(frozenReaderContext)) {
    clearFrozenReaderHighlight({ removeClasses: false });
    return null;
  }
  if (frozenReaderRow?.isConnected) return frozenReaderRow;
  if (!frozenReaderContext?.verse) return null;
  const rows = [...document.querySelectorAll("#chapterContent .verse-row, #chapterContent .source-bearing-segment")];
  const bySegment = frozenReaderContext.segmentId
    ? rows.find((row) => row.dataset.segmentId === frozenReaderContext.segmentId)
    : null;
  if (bySegment) return bySegment;
  return rows.find((row) => row.dataset.refKey && row.dataset.refKey === frozenReaderContext.refKey) ||
    rows.find((row) => row.dataset.verse === frozenReaderContext.verse) ||
    null;
}

function findFrozenReaderToken(row) {
  if (frozenReaderToken?.isConnected && row?.contains(frozenReaderToken)) return frozenReaderToken;
  if (!row || !frozenReaderContext) return null;
  const tokens = [...row.querySelectorAll(".strong-token")];
  const byInterlinearKey = frozenReaderContext.interlinearKey
    ? tokens.find((token) => token.dataset.interlinearKey === frozenReaderContext.interlinearKey)
    : null;
  if (byInterlinearKey) return byInterlinearKey;
  const byStrongAndIndex = frozenReaderContext.strongCode && frozenReaderContext.tokenIndex
    ? tokens.find(
        (token) =>
          token.dataset.strongCode === frozenReaderContext.strongCode &&
          token.dataset.tokenIndex === frozenReaderContext.tokenIndex,
      )
    : null;
  if (byStrongAndIndex) return byStrongAndIndex;
  return frozenReaderContext.strongCode
    ? tokens.find((token) => token.dataset.strongCode === frozenReaderContext.strongCode) || null
    : null;
}

function refreshFrozenReaderNodes() {
  const row = findFrozenReaderRow();
  const token = findFrozenReaderToken(row);
  if (!row || !token) return false;
  frozenReaderRow = row;
  frozenReaderToken = token;
  return true;
}

function applyFrozenReaderHighlight() {
  if (!frozenReaderContext) return;
  if (!refreshFrozenReaderNodes()) return;
  frozenReaderRow.classList.add("reader-context-verse");
  frozenReaderToken.classList.add("reader-context-word");
}

function scheduleFrozenReaderHighlightRefresh() {
  if (!frozenReaderContext) return;
  FROZEN_HIGHLIGHT_REFRESH_DELAYS_MS.forEach((delay) => {
    window.setTimeout(applyFrozenReaderHighlight, delay);
  });
  window.requestAnimationFrame(applyFrozenReaderHighlight);
  afterPickerPaint(applyFrozenReaderHighlight);
}

function observeFrozenReaderHighlight() {
  disconnectFrozenHighlightObserver();
  if (!frozenReaderContext) return;
  frozenHighlightObserver = new MutationObserver(() => {
    window.requestAnimationFrame(applyFrozenReaderHighlight);
  });
  const chapterContent = document.getElementById("chapterContent");
  if (chapterContent) {
    frozenHighlightObserver.observe(chapterContent, {
      childList: true,
      subtree: true,
    });
  }
  if (frozenReaderToken) {
    frozenHighlightObserver.observe(frozenReaderToken, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }
  if (frozenReaderRow) {
    frozenHighlightObserver.observe(frozenReaderRow, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }
}

function freezeReaderHighlight(token) {
  const row = token?.closest?.(".verse-row, .source-bearing-segment");
  if (!token || !row) return;
  frozenReaderToken = token;
  frozenReaderRow = row;
  frozenReaderContext = captureFrozenReaderContext(token, row);
  observeFrozenReaderHighlight();
  scheduleFrozenReaderHighlightRefresh();
}

function clearFrozenReaderHighlight(options = {}) {
  const removeClasses = options.removeClasses !== false;
  disconnectFrozenHighlightObserver();
  if (removeClasses) {
    frozenReaderToken?.classList?.remove("reader-context-word");
    frozenReaderRow?.classList?.remove("reader-context-verse");
  }
  frozenReaderToken = null;
  frozenReaderRow = null;
  frozenReaderContext = null;
}

function handleReaderPickerClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;

  if (target.closest("#bookPickerButton")) {
    scrollActivePickerOptionIntoView(document.getElementById("bookPickerPanel"));
    scheduleFrozenReaderHighlightRefresh();
    return;
  }

  if (target.closest("#chapterPickerButton")) {
    scrollActivePickerOptionIntoView(document.getElementById("chapterPickerPanel"));
    scheduleFrozenReaderHighlightRefresh();
    return;
  }

  const selectedBook = target.closest("#bookPickerPanel .reader-picker-option");
  if (selectedBook) {
    openChapterPickerAfterBookSelection(selectedBook.textContent.trim());
    clearFrozenReaderHighlight({ removeClasses: false });
    return;
  }

  const readerToken = target.closest("#chapterContent .strong-token");
  if (readerToken) {
    freezeReaderHighlight(readerToken);
    return;
  }

  scheduleFrozenReaderHighlightRefresh();
}

function handleReaderFreezePointerDown(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const readerToken = target.closest("#chapterContent .strong-token");
  if (readerToken) {
    freezeReaderHighlight(readerToken);
    return;
  }

  if (target.closest(READER_NAVIGATION_RESET_SELECTOR)) {
    clearFrozenReaderHighlight({ removeClasses: false });
    return;
  }

  if (target.closest("#clearDetail")) {
    clearFrozenReaderHighlight();
    return;
  }

  if (!target.closest(READER_BACKGROUND_RESET_SELECTOR)) {
    clearFrozenReaderHighlight();
    return;
  }

  scheduleFrozenReaderHighlightRefresh();
}

function handleFrozenHighlightKeydown(event) {
  if (event.key === "Escape" && document.querySelector("#detailToolSurface:not([hidden])")) return;
  if (event.key === "Escape") clearFrozenReaderHighlight();
  else scheduleFrozenReaderHighlightRefresh();
}

function bindNavigationReset(selector, eventName) {
  document.querySelector(selector)?.addEventListener(eventName, () => clearFrozenReaderHighlight({ removeClasses: false }));
}

document.addEventListener("click", handleReaderPickerClick);
document.addEventListener("pointerdown", handleReaderFreezePointerDown, true);
document.addEventListener("keydown", handleFrozenHighlightKeydown, true);
bindNavigationReset("#translationSelect", "change");
bindNavigationReset("#bookSelect", "change");
bindNavigationReset("#chapterSelect", "change");
window.addEventListener("hashchange", () => clearFrozenReaderHighlight({ removeClasses: false }));
window.addEventListener("popstate", () => clearFrozenReaderHighlight({ removeClasses: false }));
