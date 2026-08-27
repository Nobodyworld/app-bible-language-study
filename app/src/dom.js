import {
  DETAIL_SCROLL_POLICIES,
  PANEL_EVENTS,
  PANEL_MODES,
  normalizeDetailScrollPolicy,
  normalizeDetailViewId,
  transitionPanelMode,
} from "./ui-contracts.js";
import { dismissContainedDetailTool } from "./detail-tool-surface.js";
import { closeStudyWorkspace, openStudyWorkspace } from "./portrait-workspace.js";

export const els = {
  homeButton: document.querySelector("#homeButton"),
  status: document.querySelector("#statusText"),
  compactStatus: document.querySelector("#compactStatusText"),
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
  detailModeStatus: document.querySelector("#detailModeStatus"),
  detailContext: document.querySelector("#detailContext"),
  detailWorkArea: document.querySelector("#detailWorkArea"),
  detail: document.querySelector("#detailContent"),
  detailPane: document.querySelector(".detail-pane"),
  detailBack: document.querySelector("#detailBack"),
  detailForward: document.querySelector("#detailForward"),
  clearDetail: document.querySelector("#clearDetail"),
  hideStudyWorkspace: document.querySelector("#hideStudyWorkspace"),
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
  const value = String(text || "");
  const isLoaded = /\bdata loaded\b/i.test(value);
  const isLoading = /\bloading\b/i.test(value);
  const isError = /\b(?:failed|error|warning|could not|unavailable)\b/i.test(value);
  const statusState = isError ? "error" : isLoading ? "loading" : isLoaded ? "loaded" : "message";
  const showCompactLoaded = statusState === "loaded";

  els.status.textContent = value;
  els.status.dataset.statusState = statusState;
  if (els.compactStatus) {
    els.compactStatus.textContent = showCompactLoaded ? "Loaded" : "";
    els.compactStatus.hidden = !showCompactLoaded;
  }
}

const defaultDetailText =
  "Select a footnote, cross-reference, commentary, outline item, language-study token, search result, Study Mark, or My Data tool.";
const detailHistory = [];
const detailForwardHistory = [];
let currentDetailTransient = false;
let transientBase = null;
let detailPanelMode = PANEL_MODES.follow;
let currentDetailViewId = "";
let currentDetailReaderContext = null;
let detailIntentGeneration = 0;

let readerNavigationAvailability = { back: false, forward: false };

function updateDetailHistoryButtons() {
  if (els.detailBack) {
    els.detailBack.disabled = detailHistory.length === 0 && !readerNavigationAvailability.back;
  }
  if (els.detailForward) {
    els.detailForward.disabled = detailForwardHistory.length === 0 && !readerNavigationAvailability.forward;
  }
  const locked = detailPanelMode === PANEL_MODES.locked;
  if (els.detailPane) {
    els.detailPane.dataset.hoverLocked = locked ? "true" : "false";
    els.detailPane.dataset.panelMode = detailPanelMode;
  }
  if (els.detailModeStatus) {
    const visibleMode = locked ? "Locked" : "Following";
    els.detailModeStatus.textContent = visibleMode;
    els.detailModeStatus.setAttribute("aria-label", `Study workspace mode: ${visibleMode}`);
  }
  els.showOutline?.setAttribute("aria-pressed", currentDetailViewId === "outline" ? "true" : "false");
  els.showInterlinear?.setAttribute(
    "aria-pressed",
    currentDetailViewId === "language-study" ? "true" : "false",
  );
  document.body.classList.toggle("detail-locked", locked);
}

function setDisplayedDetailView(viewId) {
  currentDetailViewId = normalizeDetailViewId(viewId);
  [els.detailPane, els.detail].forEach((node) => {
    if (!node) return;
    if (currentDetailViewId) node.dataset.displayedView = currentDetailViewId;
    else delete node.dataset.displayedView;
  });
}

export function getDisplayedDetailView() {
  return currentDetailViewId;
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
    viewId: currentDetailViewId,
    contextNodes: els.detailContext ? [...els.detailContext.childNodes] : [],
    contextHidden: els.detailContext ? els.detailContext.hidden : true,
    nodes: [...els.detail.childNodes],
    readerContext: cloneReaderContext(currentDetailReaderContext) || snapshotReaderContextFromDom(),
    scrollTop: els.detail?.scrollTop || 0,
  };
}

function notifyDetailRestored(snapshot) {
  if (!els.detail) return;
  els.detail.dispatchEvent(new CustomEvent("detail:restore", { bubbles: false, detail: snapshot }));
  els.detail.querySelectorAll("[data-detail-restore]").forEach((node) => {
    node.dispatchEvent(new CustomEvent("detail:restore", { bubbles: false, detail: snapshot }));
  });
}

function restoreDetail(snapshot, detailIntent) {
  dismissContainedDetailTool("history-restore");
  els.detailTitle.textContent = snapshot.title;
  setDisplayedDetailView(snapshot.viewId);
  setDetailContext(null);
  if (els.detailContext) {
    els.detailContext.replaceChildren(...(snapshot.contextNodes || []));
    els.detailContext.hidden = Boolean(snapshot.contextHidden);
  }
  els.detail.replaceChildren(...snapshot.nodes);
  currentDetailReaderContext = cloneReaderContext(snapshot.readerContext);
  notifyDetailRestored(snapshot);
  window.requestAnimationFrame(() => {
    if (els.detail && isDetailIntentCurrent(detailIntent)) els.detail.scrollTop = Number(snapshot.scrollTop) || 0;
  });
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

function applyDetailScrollPolicy(policy, scrollTop, detailIntent) {
  if (!els.detail || policy === DETAIL_SCROLL_POLICIES.revealSection) return;
  const targetScrollTop =
    policy === DETAIL_SCROLL_POLICIES.preserve || policy === DETAIL_SCROLL_POLICIES.restore
      ? Number(scrollTop) || 0
      : 0;
  els.detail.scrollTop = targetScrollTop;
  window.requestAnimationFrame(() => {
    if (isDetailIntentCurrent(detailIntent) && els.detail) els.detail.scrollTop = targetScrollTop;
  });
}

function revealDetailOnMobile(options = {}) {
  if (
    options.transient ||
    (options.history === "replace" && !options.invoker) ||
    options.reveal === false ||
    !els.detailPane
  ) return;
  if (!window.matchMedia("(max-width: 768px)").matches) return;
  openStudyWorkspace({ invoker: options.invoker || document.activeElement, focus: options.focus !== false });
}

export function beginDetailIntent() {
  detailIntentGeneration += 1;
  return detailIntentGeneration;
}

export function currentDetailIntent() {
  return detailIntentGeneration;
}

export function isDetailIntentCurrent(token) {
  return token === detailIntentGeneration;
}

function claimDetailMutation(options) {
  if (Object.prototype.hasOwnProperty.call(options, "detailIntent")) {
    return isDetailIntentCurrent(options.detailIntent) ? options.detailIntent : null;
  }
  return beginDetailIntent();
}

export function setDetail(title, node, options = {}) {
  const detailIntent = claimDetailMutation(options);
  if (detailIntent === null) return null;
  dismissContainedDetailTool("detail-change");
  const historyMode = options.history || "push";
  const sameTitle = els.detailTitle.textContent === title;
  const nextViewId = normalizeDetailViewId(options.viewId);
  const sameView = Boolean(nextViewId) && nextViewId === currentDetailViewId;
  const previousScrollTop = Number(els.detail?.scrollTop) || 0;
  const defaultScrollPolicy =
    !options.transient && historyMode === "replace" && sameView
      ? DETAIL_SCROLL_POLICIES.preserve
      : DETAIL_SCROLL_POLICIES.reset;
  const scrollPolicy = normalizeDetailScrollPolicy(options.scrollPolicy, defaultScrollPolicy);
  const storedCurrent = currentDetailTransient ? transientBase : canStoreCurrentDetail() ? snapshotDetail() : null;
  if (
    historyMode === "push" &&
    storedCurrent &&
    (!sameTitle || !sameView || options.forceHistory || currentDetailTransient)
  ) {
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
  setDisplayedDetailView(nextViewId);
  setDetailContext(contextNode);
  els.detail.replaceChildren(node);
  currentDetailReaderContext = Object.prototype.hasOwnProperty.call(options, "readerContext")
    ? cloneReaderContext(options.readerContext)
    : null;
  currentDetailTransient = Boolean(options.transient);
  applyDetailScrollPolicy(scrollPolicy, previousScrollTop, detailIntent);
  updateDetailHistoryButtons();
  revealDetailOnMobile(options);
  return detailIntent;
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
  return setDetail(title, node, options);
}

export function goBackDetail() {
  const detailIntent = beginDetailIntent();
  dismissContainedDetailTool("history-back");
  const previousDetail = detailHistory.pop();

  if (previousDetail) {
    if (canStoreCurrentDetail()) detailForwardHistory.push(snapshotDetail());
    transientBase = null;
    currentDetailTransient = false;
    detailPanelMode = transitionPanelMode(detailPanelMode, PANEL_EVENTS.activate);
    restoreDetail(previousDetail, detailIntent);
    updateDetailHistoryButtons();
    return true;
  }
  updateDetailHistoryButtons();
  return false;
}

export function goForwardDetail() {
  const detailIntent = beginDetailIntent();
  dismissContainedDetailTool("history-forward");
  const nextDetail = detailForwardHistory.pop();

  if (nextDetail) {
    if (canStoreCurrentDetail()) detailHistory.push(snapshotDetail());
    transientBase = null;
    currentDetailTransient = false;
    detailPanelMode = transitionPanelMode(detailPanelMode, PANEL_EVENTS.activate);
    restoreDetail(nextDetail, detailIntent);
    updateDetailHistoryButtons();
    return true;
  }
  updateDetailHistoryButtons();
  return false;
}

function resetDetailContent(title, message) {
  const detailIntent = beginDetailIntent();
  dismissContainedDetailTool("detail-reset");
  detailHistory.length = 0;
  detailForwardHistory.length = 0;
  transientBase = null;
  currentDetailTransient = false;
  detailPanelMode = transitionPanelMode(detailPanelMode, PANEL_EVENTS.reset);
  currentDetailReaderContext = null;
  els.detailTitle.textContent = title;
  setDisplayedDetailView("");
  setDetailContext(null);
  els.detail.textContent = message;
  applyDetailScrollPolicy(DETAIL_SCROLL_POLICIES.reset, 0, detailIntent);
  updateDetailHistoryButtons();
}

export function resetDetailForNavigation(title = "Details", message = defaultDetailText) {
  resetDetailContent(title, message);
  if (window.matchMedia("(max-width: 768px)").matches) {
    closeStudyWorkspace({ restoreFocus: false });
  }
}

export function resetDetail(title = "Details", message = defaultDetailText) {
  resetDetailContent(title, message);
}

export function setReaderNavigationAvailability({ back = false, forward = false } = {}) {
  readerNavigationAvailability = { back: back === true, forward: forward === true };
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
