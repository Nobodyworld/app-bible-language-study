const ACTIVE_OPTION_SELECTOR = ".reader-picker-option.active";
const PICKER_READY_TIMEOUT_MS = 1800;
const PICKER_VIEWPORT_MARGIN = 10;
const PICKER_TRIGGER_GAP = 6;
const PICKER_SETTLE_FRAME_COUNT = 3;
const PICKER_CONTEXT_SETTLE_DURATION_MS = 400;
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
let pendingPickerContext = null;
let pickerScrollAnchorState = null;
let activePickerContext = null;

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

function capturePickerContext() {
  const reader = document.getElementById("chapterContent");
  const detail = document.getElementById("detailContent");
  return {
    pageX: window.scrollX,
    pageY: window.scrollY,
    readerScrollLeft: reader?.scrollLeft || 0,
    readerScrollTop: reader?.scrollTop || 0,
    detailScrollLeft: detail?.scrollLeft || 0,
    detailScrollTop: detail?.scrollTop || 0,
  };
}

function capturePickerContextBeforeOpen(event) {
  const button = event.target?.closest?.("#bookPickerButton, #chapterPickerButton");
  pendingPickerContext = button
    ? { buttonId: button.id, snapshot: capturePickerContext() }
    : null;
}

function pickerContextFor(button) {
  const snapshot =
    pendingPickerContext?.buttonId === button?.id
      ? pendingPickerContext.snapshot
      : capturePickerContext();
  pendingPickerContext = null;
  return snapshot;
}

function restorePickerContext(snapshot) {
  if (!snapshot) return;
  const reader = document.getElementById("chapterContent");
  const detail = document.getElementById("detailContent");
  if (reader) {
    reader.scrollLeft = snapshot.readerScrollLeft;
    reader.scrollTop = snapshot.readerScrollTop;
  }
  if (detail) {
    detail.scrollLeft = snapshot.detailScrollLeft;
    detail.scrollTop = snapshot.detailScrollTop;
  }
  if (window.scrollX !== snapshot.pageX || window.scrollY !== snapshot.pageY) {
    window.scrollTo({ left: snapshot.pageX, top: snapshot.pageY, behavior: "auto" });
  }
}

function suspendPickerScrollAnchoring() {
  if (!pickerScrollAnchorState) {
    const targets = [
      document.documentElement,
      document.body,
      document.getElementById("chapterContent"),
      document.getElementById("detailContent"),
    ].filter(Boolean);
    pickerScrollAnchorState = {
      targets: targets.map((target) => ({
        target,
        previous: target.style.overflowAnchor,
      })),
      releaseTimer: 0,
    };
    pickerScrollAnchorState.targets.forEach(({ target }) => {
      target.style.overflowAnchor = "none";
    });
  }
  window.clearTimeout(pickerScrollAnchorState.releaseTimer);
  pickerScrollAnchorState.releaseTimer = window.setTimeout(() => {
    pickerScrollAnchorState?.targets.forEach(({ target, previous }) => {
      if (previous) target.style.overflowAnchor = previous;
      else target.style.removeProperty("overflow-anchor");
    });
    pickerScrollAnchorState = null;
  }, PICKER_CONTEXT_SETTLE_DURATION_MS);
}

function activeOptionScroller(panel) {
  const active = panel?.querySelector(ACTIVE_OPTION_SELECTOR);
  const scroller = active?.closest?.(".book-picker-list, .chapter-picker-grid");
  return active && scroller ? { active, scroller } : null;
}

function revealActivePickerOption(panel) {
  const target = activeOptionScroller(panel);
  if (!target) return;
  const { active, scroller } = target;
  const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  if (maxScrollTop <= 0) return;
  const activeCenter = active.offsetTop + active.offsetHeight / 2;
  const nextScrollTop = activeCenter - scroller.clientHeight / 2;
  scroller.scrollTop = Math.max(0, Math.min(maxScrollTop, nextScrollTop));
}

function positionPickerPanel(button, panel) {
  if (!button || !panel || panel.hidden) return;
  const triggerRect = button.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  const maxWidth = Math.max(160, viewportWidth - PICKER_VIEWPORT_MARGIN * 2);
  const availableBelow = Math.max(
    0,
    viewportHeight - triggerRect.bottom - PICKER_TRIGGER_GAP - PICKER_VIEWPORT_MARGIN,
  );
  const availableAbove = Math.max(
    0,
    triggerRect.top - PICKER_TRIGGER_GAP - PICKER_VIEWPORT_MARGIN,
  );
  const placeAbove = availableBelow < 240 && availableAbove > availableBelow;
  const availableHeight = Math.max(120, placeAbove ? availableAbove : availableBelow);

  panel.dataset.positioned = "true";
  panel.dataset.placement = placeAbove ? "above" : "below";
  panel.style.position = "fixed";
  panel.style.transform = "none";
  panel.style.maxWidth = `${maxWidth}px`;
  panel.style.maxHeight = `${availableHeight}px`;
  panel.style.setProperty("--reader-picker-available-height", `${availableHeight}px`);
  panel.style.left = "0px";
  panel.style.top = "0px";
  panel.style.removeProperty("width");

  const naturalRect = panel.getBoundingClientRect();
  const width = Math.min(naturalRect.width, maxWidth);
  const left = Math.max(
    PICKER_VIEWPORT_MARGIN,
    Math.min(triggerRect.left, viewportWidth - PICKER_VIEWPORT_MARGIN - width),
  );
  const measuredHeight = Math.min(naturalRect.height, availableHeight);
  const top = placeAbove
    ? Math.max(PICKER_VIEWPORT_MARGIN, triggerRect.top - PICKER_TRIGGER_GAP - measuredHeight)
    : Math.min(
        viewportHeight - PICKER_VIEWPORT_MARGIN - measuredHeight,
        triggerRect.bottom + PICKER_TRIGGER_GAP,
      );

  panel.style.width = `${width}px`;
  panel.style.left = `${left}px`;
  panel.style.top = `${Math.max(PICKER_VIEWPORT_MARGIN, top)}px`;
}

function settleOpenPicker(button, panel, snapshot = capturePickerContext()) {
  if (!button || !panel || panel.hidden || button.getAttribute("aria-expanded") !== "true") return;
  activePickerContext = { buttonId: button.id, snapshot };
  let remainingFrames = PICKER_SETTLE_FRAME_COUNT;
  const contextSettleStartedAt = window.performance.now();
  suspendPickerScrollAnchoring();
  const restoreWhileOpen = () => {
    if (!panel || panel.hidden || button?.getAttribute("aria-expanded") !== "true") return;
    restorePickerContext(snapshot);
    if (window.performance.now() - contextSettleStartedAt < PICKER_CONTEXT_SETTLE_DURATION_MS) {
      window.requestAnimationFrame(restoreWhileOpen);
    }
  };
  const settle = () => {
    if (!panel || panel.hidden || button?.getAttribute("aria-expanded") !== "true") return;
    positionPickerPanel(button, panel);
    revealActivePickerOption(panel);
    restoreWhileOpen();
    if (remainingFrames <= 0) return;
    remainingFrames -= 1;
    window.requestAnimationFrame(settle);
  };
  window.requestAnimationFrame(settle);
  window.requestAnimationFrame(restoreWhileOpen);
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

function openChapterPickerAfterBookSelection(selection) {
  const bookButton = document.getElementById("bookPickerButton");
  const bookPanel = document.getElementById("bookPickerPanel");
  const chapterButton = document.getElementById("chapterPickerButton");
  const chapterPanel = document.getElementById("chapterPickerPanel");
  const bookSelect = document.getElementById("bookSelect");
  const chapterSelect = document.getElementById("chapterSelect");
  const chapterTitle = document.getElementById("chapterTitle");
  const expectedHash = `#/read/${selection.translationId}/${selection.bookId}/${selection.chapter}`;

  waitForPickerOptions(
    chapterPanel,
    () => {
      const activeChapter = chapterPanel?.querySelector(ACTIVE_OPTION_SELECTOR);
      return (
        window.location.hash === expectedHash &&
        bookSelect?.value === selection.bookId &&
        chapterSelect?.value === selection.chapter &&
        bookButton?.textContent?.trim() === selection.bookLabel &&
        chapterButton?.textContent?.trim() === selection.chapter &&
        chapterButton?.getAttribute("aria-label") === `Chapter: ${selection.chapter}` &&
        activeChapter?.textContent?.trim() === selection.chapter &&
        activeChapter?.getAttribute("aria-pressed") === "true" &&
        chapterTitle?.textContent?.trim() === `${selection.bookLabel} ${selection.chapter}` &&
        Boolean(document.querySelector(`#chapterContent .verse-row[data-verse="1"]`))
      );
    },
    () => {
      setPickerExpanded(bookButton, bookPanel, false);
      setPickerExpanded(chapterButton, chapterPanel, true);
      chapterButton?.focus?.({ preventScroll: true });
      settleOpenPicker(chapterButton, chapterPanel);
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
    const button = document.getElementById("bookPickerButton");
    settleOpenPicker(
      button,
      document.getElementById("bookPickerPanel"),
      pickerContextFor(button),
    );
    scheduleFrozenReaderHighlightRefresh();
    return;
  }

  if (target.closest("#chapterPickerButton")) {
    const button = document.getElementById("chapterPickerButton");
    settleOpenPicker(
      button,
      document.getElementById("chapterPickerPanel"),
      pickerContextFor(button),
    );
    scheduleFrozenReaderHighlightRefresh();
    return;
  }

  const selectedBook = target.closest("#bookPickerPanel .reader-picker-option");
  if (selectedBook) {
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
  if (event.key === "Escape" && document.querySelector(".detail-pane.visible")) return;
  if (event.key === "Escape" && document.querySelector("#detailToolSurface:not([hidden])")) return;
  if (
    event.key === "Escape" &&
    document.querySelector(
      '#bookPickerButton[aria-expanded="true"], #chapterPickerButton[aria-expanded="true"]',
    )
  ) {
    return;
  }
  if (event.key === "Escape") clearFrozenReaderHighlight();
  else scheduleFrozenReaderHighlightRefresh();
}

function bindNavigationReset(selector, eventName) {
  document.querySelector(selector)?.addEventListener(eventName, () => clearFrozenReaderHighlight({ removeClasses: false }));
}

document.addEventListener("click", capturePickerContextBeforeOpen, true);
document.addEventListener("click", handleReaderPickerClick);
document.addEventListener("reader:book-selection-complete", (event) => {
  if (!event.detail?.translationId || !event.detail?.bookId || !event.detail?.chapter) return;
  openChapterPickerAfterBookSelection(event.detail);
});
document.addEventListener("pointerdown", handleReaderFreezePointerDown, true);
document.addEventListener("keydown", handleFrozenHighlightKeydown, true);
bindNavigationReset("#translationSelect", "change");
bindNavigationReset("#bookSelect", "change");
bindNavigationReset("#chapterSelect", "change");
window.addEventListener("hashchange", () => clearFrozenReaderHighlight({ removeClasses: false }));
window.addEventListener("popstate", () => clearFrozenReaderHighlight({ removeClasses: false }));
window.addEventListener(
  "resize",
  () => {
    const pairs = [
      [document.getElementById("bookPickerButton"), document.getElementById("bookPickerPanel")],
      [document.getElementById("chapterPickerButton"), document.getElementById("chapterPickerPanel")],
    ];
    pairs.forEach(([button, panel]) => {
      if (button?.getAttribute("aria-expanded") === "true" && panel && !panel.hidden) {
        const snapshot =
          activePickerContext?.buttonId === button.id
            ? activePickerContext.snapshot
            : capturePickerContext();
        settleOpenPicker(button, panel, snapshot);
      }
    });
  },
  { passive: true },
);
