import {
  captureReaderAnchor,
  restoreReaderAnchor,
} from "./study-workspace-width.js";

const root = document.documentElement;
const header = document.querySelector(".app-header");
const readerRoot = document.querySelector("#chapterContent");
const detailPane = document.querySelector("#detailPane");
const detailScroller = document.querySelector("#detailContent");
const hideButton = document.querySelector("#hideStudyWorkspace");
const showButton = document.querySelector("#showStudyWorkspace");
const bookPickerButton = document.querySelector("#bookPickerButton");
const bookPickerPanel = document.querySelector("#bookPickerPanel");
const chapterPickerButton = document.querySelector("#chapterPickerButton");
const chapterPickerPanel = document.querySelector("#chapterPickerPanel");
const desktopMedia = window.matchMedia("(min-width: 769px)");
const WORKSPACE_SETTLE_FRAME_COUNT = 3;

let workspaceTransitionGeneration = 0;
let hiddenStateScrollX = null;
let hiddenStateScrollY = null;

function updateHeaderBlockSize() {
  const height = Math.ceil(header?.getBoundingClientRect?.().height || 0);
  if (height > 0) root.style.setProperty("--app-header-block-size", `${height}px`);
}

function currentDetailScrollTop() {
  const value = Number(detailScroller?.scrollTop);
  return Number.isFinite(value) ? value : 0;
}

function restoreDetailScrollTop(value) {
  if (!detailScroller) return;
  detailScroller.scrollTop = value;
}

function restoreWorkspaceTransition(snapshot) {
  if (!snapshot || snapshot.generation !== workspaceTransitionGeneration) return false;
  const result = restoreReaderAnchor(snapshot.readerAnchor, { readerRoot, window });
  if (!result.restored && (window.scrollX !== snapshot.pageX || window.scrollY !== snapshot.pageY)) {
    window.scrollTo({ left: snapshot.pageX, top: snapshot.pageY, behavior: "auto" });
  } else if (result.restored && snapshot.snapPageY !== null &&
             (window.scrollX !== snapshot.snapPageX || window.scrollY !== snapshot.snapPageY)) {
    window.scrollTo({ left: snapshot.snapPageX, top: snapshot.snapPageY, behavior: "auto" });
  }
  restoreDetailScrollTop(snapshot.detailScrollTop);
  updateHeaderBlockSize();
  return true;
}

function settleWorkspaceTransition(snapshot) {
  // A layout read inside restoreReaderAnchor forces the new grid geometry now,
  // before the opposite control can be activated. Repeating the correction over
  // subsequent frames absorbs delayed font, scrollbar, and sticky-size reflow.
  restoreWorkspaceTransition(snapshot);
  let remainingFrames = WORKSPACE_SETTLE_FRAME_COUNT;

  const settle = () => {
    if (!restoreWorkspaceTransition(snapshot)) return;
    if (remainingFrames <= 0) return;
    remainingFrames -= 1;
    window.requestAnimationFrame(settle);
  };

  window.requestAnimationFrame(settle);
}

function setWorkspaceHidden(hidden, { restoreFocus = true } = {}) {
  if (hidden && !desktopMedia.matches) return;

  const snapshot = {
    generation: ++workspaceTransitionGeneration,
    readerAnchor: captureReaderAnchor(readerRoot),
    detailScrollTop: currentDetailScrollTop(),
    pageX: window.scrollX,
    pageY: window.scrollY,
    snapPageX: hidden ? null : (hiddenStateScrollX ?? null),
    snapPageY: hidden ? null : (hiddenStateScrollY ?? null),
  };

  if (hidden) {
    hiddenStateScrollX = window.scrollX;
    hiddenStateScrollY = window.scrollY;
    root.dataset.studyWorkspaceHidden = "true";
    detailPane?.setAttribute("aria-hidden", "true");
  } else {
    hiddenStateScrollX = null;
    hiddenStateScrollY = null;
    delete root.dataset.studyWorkspaceHidden;
    detailPane?.removeAttribute("aria-hidden");
  }

  if (hideButton) hideButton.setAttribute("aria-expanded", String(!hidden));
  if (showButton) {
    showButton.hidden = !hidden;
    showButton.setAttribute("aria-expanded", String(!hidden));
  }

  if (restoreFocus) {
    (hidden ? showButton : hideButton)?.focus?.({ preventScroll: true });
  }

  settleWorkspaceTransition(snapshot);
}

function centerActiveOption(panel) {
  if (!panel || panel.hidden) return;
  const active = panel.querySelector(".reader-picker-option.active");
  const scroller = active?.closest?.(".book-picker-list, .chapter-picker-grid");
  if (!active || !scroller) return;

  const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  if (maxScrollTop <= 0) return;
  const target = active.offsetTop - (scroller.clientHeight - active.offsetHeight) / 2;
  scroller.scrollTop = Math.max(0, Math.min(maxScrollTop, target));
}

function settlePicker(panel) {
  const pageX = window.scrollX;
  const pageY = window.scrollY;
  let remainingFrames = WORKSPACE_SETTLE_FRAME_COUNT;

  const settle = () => {
    if (remainingFrames > 0) {
      remainingFrames -= 1;
      window.requestAnimationFrame(settle);
      return;
    }
    if (!panel || panel.hidden) return;
    centerActiveOption(panel);
    if (window.scrollX !== pageX || window.scrollY !== pageY) {
      window.scrollTo({ left: pageX, top: pageY, behavior: "auto" });
    }
  };

  window.requestAnimationFrame(settle);
}

hideButton?.addEventListener("click", () => setWorkspaceHidden(true));
showButton?.addEventListener("click", () => setWorkspaceHidden(false));
bookPickerButton?.addEventListener("click", () => settlePicker(bookPickerPanel));
chapterPickerButton?.addEventListener("click", () => settlePicker(chapterPickerPanel));
document.addEventListener("click", (event) => {
  if (event.target.closest?.("#bookPickerPanel .reader-picker-option")) {
    settlePicker(chapterPickerPanel);
  }
});

desktopMedia.addEventListener?.("change", (event) => {
  if (!event.matches && root.dataset.studyWorkspaceHidden === "true") {
    setWorkspaceHidden(false, { restoreFocus: false });
  }
  updateHeaderBlockSize();
});

window.addEventListener("resize", updateHeaderBlockSize, { passive: true });
if (typeof ResizeObserver === "function" && header) {
  new ResizeObserver(updateHeaderBlockSize).observe(header);
}
if (document.fonts?.ready) {
  document.fonts.ready.then(updateHeaderBlockSize).catch(() => {});
}
updateHeaderBlockSize();
window.requestAnimationFrame(updateHeaderBlockSize);
