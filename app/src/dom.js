import { PANEL_EVENTS, PANEL_MODES, transitionPanelMode } from "./ui-contracts.js";

export const els = {
  homeButton: document.querySelector("#homeButton"),
  status: document.querySelector("#statusText"),
  translation: document.querySelector("#translationSelect"),
  book: document.querySelector("#bookSelect"),
  bookPickerButton: document.querySelector("#bookPickerButton"),
  bookPickerPanel: document.querySelector("#bookPickerPanel"),
  chapter: document.querySelector("#chapterSelect"),
  chapterPickerButton: document.querySelector("#chapterPickerButton"),
  chapterPickerPanel: document.querySelector("#chapterPickerPanel"),
  title: document.querySelector("#chapterTitle"),
  bookTagControl: document.querySelector("#bookTagControl"),
  chapterTagControl: document.querySelector("#chapterTagControl"),
  content: document.querySelector("#chapterContent"),
  detailTitle: document.querySelector("#detailTitle"),
  detailContext: document.querySelector("#detailContext"),
  detail: document.querySelector("#detailContent"),
  detailPane: document.querySelector(".detail-pane"),
  detailBack: document.querySelector("#detailBack"),
  detailForward: document.querySelector("#detailForward"),
  clearDetail: document.querySelector("#clearDetail"),
  prev: document.querySelector("#prevChapter"),
  next: document.querySelector("#nextChapter"),
  prevFloat: document.querySelector("#prevChapterFloat"),
  nextFloat: document.querySelector("#nextChapterFloat"),
  showOutline: document.querySelector("#showOutline"),
  showInterlinear: document.querySelector("#showInterlinear"),
  showSearch: document.querySelector("#showSearch"),
  openStudyPanel: document.querySelector("#openStudyPanel"),
  showTags: document.querySelector("#showTags"),
  showMyData: document.querySelector("#showMyData"),
  themeToggle: document.querySelector("#themeToggle"),
};

export function option(value, label) {
  const item = document.createElement("option");
  item.value = value;
  item.textContent = label;
  return item;
}

export function sortedNumericKeys(object) {
  return Object.keys(object || {}).sort((a, b) => Number(a) - Number(b));
}

export function setStatus(text) {
  els.status.textContent = text;
}

const defaultDetailText =
  "Select a footnote, cross-reference, commentary, outline item, language-study token, search result, Study Mark, or My Data tool.";
const detailHistory = [];
const detailForwardHistory = [];
let currentDetailTransient = false;
let transientBase = null;
let detailPanelMode = PANEL_MODES.follow;
let currentDetailReaderContext = null;

// Reader location history for tracking book/chapter/verse navigation
let readerLocationHistory = [];
let readerLocationForwardHistory = [];
let lastTrackedLocation = null;

function updateDetailHistoryButtons() {
  if (els.detailBack) {
    els.detailBack.disabled = detailHistory.length === 0 && readerLocationHistory.length === 0;
  }
  if (els.detailForward) {
    els.detailForward.disabled = detailForwardHistory.length === 0 && readerLocationForwardHistory.length === 0;
  }
  const locked = detailPanelMode === PANEL_MODES.locked;
  if (els.detailPane) {
    els.detailPane.dataset.hoverLocked = locked ? "true" : "false";
    els.detailPane.dataset.panelMode = detailPanelMode;
  }
  els.showOutline?.setAttribute("aria-pressed", els.detailTitle?.textContent === "Outline" ? "true" : "false");
  els.showInterlinear?.setAttribute(
    "aria-pressed",
    els.detailTitle?.textContent === "Language Study" ? "true" : "false",
  );
  document.body.classList.toggle("detail-locked", locked);
}

function isDefaultDetail() {
  return els.detailTitle.textContent === "Details" && els.detail.textContent.trim().startsWith("Select a ");
}

function canStoreCurrentDetail() {
  return Boolean(els.detail?.childNodes?.length) && !isDefaultDetail();
}

function snapshotReaderContextFromDom() {
  const word = document.querySelector(".reader-context-word");
  const verseRow =
    word?.closest?.(".verse-row, .source-bearing-segment") ||
    document.querySelector(".reader-context-verse");
  if (!verseRow) return null;
  return {
    verse: verseRow.dataset.verse || null,
    segment_id: verseRow.dataset.segmentId || word?.dataset?.segmentId || null,
    word: word
      ? {
          interlinearKey: word.dataset.interlinearKey || "",
          strongCode: word.dataset.strongCode || "",
          tokenIndex: word.dataset.tokenIndex || "",
        }
      : null,
  };
}

function cloneReaderContext(context) {
  return context ? JSON.parse(JSON.stringify(context)) : null;
}

function snapshotDetail() {
  return {
    title: els.detailTitle.textContent,
    contextNodes: els.detailContext ? [...els.detailContext.childNodes] : [],
    contextHidden: els.detailContext ? els.detailContext.hidden : true,
    nodes: [...els.detail.childNodes],
    readerContext: cloneReaderContext(currentDetailReaderContext) || snapshotReaderContextFromDom(),
  };
}

function notifyDetailRestored(snapshot) {
  if (!els.detail) return;
  els.detail.dispatchEvent(new CustomEvent("detail:restore", { bubbles: false, detail: snapshot }));
  els.detail.querySelectorAll("[data-detail-restore]").forEach((node) => {
    node.dispatchEvent(new CustomEvent("detail:restore", { bubbles: false, detail: snapshot }));
  });
}

function restoreDetail(snapshot) {
  els.detailTitle.textContent = snapshot.title;
  setDetailContext(null);
  if (els.detailContext) {
    els.detailContext.replaceChildren(...(snapshot.contextNodes || []));
    els.detailContext.hidden = Boolean(snapshot.contextHidden);
  }
  els.detail.replaceChildren(...snapshot.nodes);
  currentDetailReaderContext = cloneReaderContext(snapshot.readerContext);
  notifyDetailRestored(snapshot);
}

function extractContextNode(node, options = {}) {
  if (options.context) return options.context;
  if (!node?.querySelector) return null;
  const directTabs = [...node.children].find((child) => child.classList?.contains("verse-context-tabs"));
  if (directTabs) {
    directTabs.remove();
    return directTabs;
  }
  return null;
}

function setDetailContext(node) {
  if (!els.detailContext) return;
  els.detailContext.replaceChildren();
  if (!node) {
    els.detailContext.hidden = true;
    return;
  }
  els.detailContext.append(node);
  els.detailContext.hidden = false;
}

function revealDetailOnMobile(options = {}) {
  if (options.transient || options.history === "replace" || options.reveal === false || !els.detailPane) return;
  if (window.innerWidth > 960) return;
  window.requestAnimationFrame(() => {
    els.detailPane.classList.add("visible");
  });
}

export function setDetail(title, node, options = {}) {
  const historyMode = options.history || "push";
  const sameTitle = els.detailTitle.textContent === title;
  const storedCurrent = currentDetailTransient ? transientBase : canStoreCurrentDetail() ? snapshotDetail() : null;
  if (historyMode === "push" && storedCurrent && (!sameTitle || options.forceHistory || currentDetailTransient)) {
    detailHistory.push(storedCurrent);
    detailForwardHistory.length = 0;
  }
  if (options.lock === true || (!options.transient && historyMode === "push")) {
    detailPanelMode = transitionPanelMode(detailPanelMode, PANEL_EVENTS.activate);
  } else if (options.lock === false) {
    detailPanelMode = transitionPanelMode(detailPanelMode, PANEL_EVENTS.disengage);
  }
  if (options.transient && !currentDetailTransient) {
    transientBase = canStoreCurrentDetail() ? snapshotDetail() : null;
  } else if (!options.transient) {
    transientBase = null;
  }
  const contextNode = extractContextNode(node, options);
  els.detailTitle.textContent = title;
  setDetailContext(contextNode);
  els.detail.replaceChildren(node);
  currentDetailReaderContext = Object.prototype.hasOwnProperty.call(options, "readerContext")
    ? cloneReaderContext(options.readerContext)
    : null;
  currentDetailTransient = Boolean(options.transient);
  updateDetailHistoryButtons();
  revealDetailOnMobile(options);
}

export function isDetailHoverLocked() {
  return detailPanelMode === PANEL_MODES.locked;
}

export function setDetailHoverLocked(locked) {
  detailPanelMode = transitionPanelMode(
    detailPanelMode,
    locked ? PANEL_EVENTS.activate : PANEL_EVENTS.disengage,
  );
  updateDetailHistoryButtons();
}

export function setDetailMessage(title, message, options = {}) {
  const node = document.createElement("p");
  node.textContent = message;
  setDetail(title, node, options);
}

export function goBackDetail() {
  const previousDetail = detailHistory.pop();

  if (previousDetail) {
    if (canStoreCurrentDetail()) detailForwardHistory.push(snapshotDetail());
    transientBase = null;
    currentDetailTransient = false;
    detailPanelMode = transitionPanelMode(detailPanelMode, PANEL_EVENTS.activate);
    restoreDetail(previousDetail);
    updateDetailHistoryButtons();
    return;
  }

  const previousLocation = readerLocationHistory.pop();

  if (!previousLocation) {
    updateDetailHistoryButtons();
    return;
  }

  if (lastTrackedLocation) readerLocationForwardHistory.push(lastTrackedLocation);

  transientBase = null;
  currentDetailTransient = false;
  detailPanelMode = transitionPanelMode(detailPanelMode, PANEL_EVENTS.activate);

  lastTrackedLocation = { ...previousLocation };
  updateDetailHistoryButtons();
  return previousLocation;
}

export function goForwardDetail() {
  const nextDetail = detailForwardHistory.pop();

  if (nextDetail) {
    if (canStoreCurrentDetail()) detailHistory.push(snapshotDetail());
    transientBase = null;
    currentDetailTransient = false;
    detailPanelMode = transitionPanelMode(detailPanelMode, PANEL_EVENTS.activate);
    restoreDetail(nextDetail);
    updateDetailHistoryButtons();
    return;
  }

  const nextLocation = readerLocationForwardHistory.pop();

  if (!nextLocation) {
    updateDetailHistoryButtons();
    return;
  }

  if (lastTrackedLocation) readerLocationHistory.push(lastTrackedLocation);

  transientBase = null;
  currentDetailTransient = false;
  detailPanelMode = transitionPanelMode(detailPanelMode, PANEL_EVENTS.activate);

  lastTrackedLocation = { ...nextLocation };
  updateDetailHistoryButtons();
  return nextLocation;
}

function resetDetailContent(title, message) {
  detailHistory.length = 0;
  detailForwardHistory.length = 0;
  transientBase = null;
  currentDetailTransient = false;
  detailPanelMode = transitionPanelMode(detailPanelMode, PANEL_EVENTS.reset);
  currentDetailReaderContext = null;
  els.detailTitle.textContent = title;
  setDetailContext(null);
  els.detail.textContent = message;
  els.detailPane?.classList.remove("visible");
  updateDetailHistoryButtons();
}

export function resetDetailForNavigation(title = "Details", message = defaultDetailText) {
  resetDetailContent(title, message);
}

export function resetDetail(title = "Details", message = defaultDetailText) {
  readerLocationHistory.length = 0;
  readerLocationForwardHistory.length = 0;
  lastTrackedLocation = null;
  resetDetailContent(title, message);
}

// Track reader location changes for back/forward navigation
export function trackReaderLocation(location) {
  if (!location) return;
  const locationKey = `${location.bookId}:${location.chapter}:${location.verse || ''}`;
  const lastKey = lastTrackedLocation ? `${lastTrackedLocation.bookId}:${lastTrackedLocation.chapter}:${lastTrackedLocation.verse || ''}` : null;

  if (locationKey !== lastKey && lastTrackedLocation) {
    readerLocationHistory.push({ ...lastTrackedLocation });
    readerLocationForwardHistory.length = 0;
  }
  lastTrackedLocation = { ...location };
  updateDetailHistoryButtons();
}

export function textNode(text) {
  return document.createTextNode(text);
}

export function createDetailList(items, renderItem) {
  const list = document.createElement("ul");
  list.className = "detail-list";
  items.forEach((item) => {
    const li = document.createElement("li");
    renderItem(li, item);
    list.append(li);
  });
  return list;
}

export function addToolButton(parent, label, title, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mini-button";
  button.textContent = label;
  button.title = title;
  button.addEventListener("click", handler);
  parent.append(button);
}
