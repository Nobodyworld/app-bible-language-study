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
const desktopMedia = window.matchMedia("(min-width: 769px)");
const WORKSPACE_SETTLE_FRAME_COUNT = 3;

let workspaceTransitionGeneration = 0;
let hiddenStateDetailScrollTop = null;
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

  const liveDetailScrollTop = currentDetailScrollTop();
  const snapshot = {
    generation: ++workspaceTransitionGeneration,
    readerAnchor: captureReaderAnchor(readerRoot),
    detailScrollTop: hidden
      ? liveDetailScrollTop
      : (hiddenStateDetailScrollTop ?? liveDetailScrollTop),
    pageX: window.scrollX,
    pageY: window.scrollY,
    snapPageX: hidden ? null : (hiddenStateScrollX ?? null),
    snapPageY: hidden ? null : (hiddenStateScrollY ?? null),
  };

  if (hidden) {
    hiddenStateDetailScrollTop = liveDetailScrollTop;
    hiddenStateScrollX = window.scrollX;
    hiddenStateScrollY = window.scrollY;
    root.dataset.studyWorkspaceHidden = "true";
    detailPane?.setAttribute("aria-hidden", "true");
  } else {
    hiddenStateDetailScrollTop = null;
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

hideButton?.addEventListener("click", () => setWorkspaceHidden(true));
showButton?.addEventListener("click", () => setWorkspaceHidden(false));

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
