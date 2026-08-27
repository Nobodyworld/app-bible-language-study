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
const hideButtonLabel = document.querySelector("#hideStudyWorkspaceLabel");
const clearButton = document.querySelector("#clearDetail");
const showButton = document.querySelector("#showStudyWorkspace");
const openButton = document.querySelector("#openStudyPanel");
const desktopMedia = window.matchMedia("(min-width: 769px)");
const mobileMedia = window.matchMedia("(max-width: 768px)");
const WORKSPACE_SETTLE_FRAME_COUNT = 3;
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

let workspaceTransitionGeneration = 0;
let drawerTransitionGeneration = 0;
let hiddenStateDetailScrollTop = null;
let hiddenStateScrollX = null;
let hiddenStateScrollY = null;
let drawerInvoker = null;
const fallbackTabIndexes = new Map();

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

function focusElement(element, { suppressReaderSnapshot = false } = {}) {
  if (!element?.isConnected || typeof element.focus !== "function") return false;
  if (suppressReaderSnapshot) element.setAttribute("data-study-drawer-focus-restore", "true");
  try {
    element.focus({ preventScroll: true });
    return document.activeElement === element;
  } catch {
    return false;
  } finally {
    if (suppressReaderSnapshot) element.removeAttribute("data-study-drawer-focus-restore");
  }
}

function isRendered(element) {
  if (!element?.isConnected || element.hidden || element.getAttribute?.("aria-hidden") === "true") return false;
  if (element.closest?.("[hidden], [inert], [aria-hidden='true']")) return false;
  const style = window.getComputedStyle?.(element);
  if (style?.display === "none" || style?.visibility === "hidden") return false;
  return element.getClientRects?.().length > 0;
}

function isExternalInvoker(element) {
  return Boolean(
    element?.isConnected &&
    !detailPane?.contains(element) &&
    element.matches?.(FOCUSABLE_SELECTOR) &&
    !element.disabled &&
    element.tabIndex >= 0 &&
    isRendered(element)
  );
}

function rememberDrawerInvoker(element) {
  if (isExternalInvoker(element)) drawerInvoker = element;
}

function setFallbackFocusDisabled(disabled) {
  if (!detailPane || "inert" in detailPane) return;
  if (disabled) {
    detailPane.querySelectorAll(FOCUSABLE_SELECTOR).forEach((node) => {
      if (!fallbackTabIndexes.has(node)) fallbackTabIndexes.set(node, node.getAttribute("tabindex"));
      node.setAttribute("tabindex", "-1");
    });
    return;
  }
  fallbackTabIndexes.forEach((tabIndex, node) => {
    if (!node.isConnected) return;
    if (tabIndex === null) node.removeAttribute("tabindex");
    else node.setAttribute("tabindex", tabIndex);
  });
  fallbackTabIndexes.clear();
}

function setPaneInert(inert) {
  if (!detailPane) return;
  if ("inert" in detailPane) detailPane.inert = inert;
  else if (inert) detailPane.setAttribute("inert", "");
  else detailPane.removeAttribute("inert");
  setFallbackFocusDisabled(inert);
}

function syncPaneDisclosure(open) {
  openButton?.setAttribute("aria-expanded", String(open));
  hideButton?.setAttribute("aria-expanded", String(open));
}

function updateAdaptiveHideButton() {
  if (!hideButton) return;
  const mobile = mobileMedia.matches;
  const visibleLabel = mobile ? "Close" : "Hide";
  const accessibleLabel = mobile ? "Close study panel" : "Hide study workspace";
  if (hideButtonLabel) hideButtonLabel.textContent = visibleLabel;
  hideButton.setAttribute("aria-label", accessibleLabel);
  hideButton.title = accessibleLabel;
}

function drawerFocusableControls() {
  return [...(detailPane?.querySelectorAll(FOCUSABLE_SELECTOR) || [])].filter(
    (node) => !node.disabled && node.tabIndex >= 0 && isRendered(node),
  );
}

function initialDrawerFocus() {
  return (
    detailPane?.querySelector("#detailContext [aria-current='page']:not([disabled])") ||
    detailPane?.querySelector("#detailBack:not([disabled])") ||
    clearButton ||
    hideButton
  );
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
    setPaneInert(true);
  } else {
    hiddenStateDetailScrollTop = null;
    hiddenStateScrollX = null;
    hiddenStateScrollY = null;
    delete root.dataset.studyWorkspaceHidden;
    detailPane?.removeAttribute("aria-hidden");
    setPaneInert(false);
  }

  if (hideButton) hideButton.setAttribute("aria-expanded", String(!hidden));
  if (showButton) {
    showButton.hidden = !hidden;
    showButton.setAttribute("aria-expanded", String(!hidden));
  }

  if (restoreFocus) {
    focusElement(hidden ? showButton : hideButton);
  }

  settleWorkspaceTransition(snapshot);
}

export function isMobileStudyWorkspaceOpen() {
  return Boolean(mobileMedia.matches && detailPane?.classList.contains("visible"));
}

export function openStudyWorkspace({ invoker = null, focus = true } = {}) {
  if (!detailPane) return false;
  if (!mobileMedia.matches) {
    if (root.dataset.studyWorkspaceHidden === "true") setWorkspaceHidden(false, { restoreFocus: focus });
    return true;
  }

  rememberDrawerInvoker(invoker || document.activeElement);
  const wasOpen = isMobileStudyWorkspaceOpen();
  const generation = ++drawerTransitionGeneration;
  setPaneInert(false);
  detailPane.setAttribute("aria-hidden", "false");
  detailPane.classList.add("visible");
  syncPaneDisclosure(true);

  if (focus && !wasOpen) {
    window.requestAnimationFrame(() => {
      if (generation !== drawerTransitionGeneration || !isMobileStudyWorkspaceOpen()) return;
      focusElement(initialDrawerFocus());
    });
  }
  return true;
}

export function closeStudyWorkspace({ restoreFocus = true } = {}) {
  if (!detailPane) return false;
  if (!mobileMedia.matches) {
    setWorkspaceHidden(true, { restoreFocus });
    return true;
  }

  const generation = ++drawerTransitionGeneration;
  const restoreTarget = isExternalInvoker(drawerInvoker) ? drawerInvoker : openButton;
  const restoredBeforeClose = restoreFocus
    ? focusElement(restoreTarget, { suppressReaderSnapshot: true })
    : false;
  detailPane.classList.remove("visible");
  detailPane.setAttribute("aria-hidden", "true");
  setPaneInert(true);
  syncPaneDisclosure(false);
  if (restoreFocus && (!restoredBeforeClose || !isExternalInvoker(document.activeElement))) {
    focusElement(openButton, { suppressReaderSnapshot: true });
  }
  const settledRestoreTarget = isExternalInvoker(document.activeElement) ? document.activeElement : openButton;
  if (restoreFocus) {
    window.requestAnimationFrame(() => {
      if (generation !== drawerTransitionGeneration || isMobileStudyWorkspaceOpen()) return;
      if (!isExternalInvoker(document.activeElement)) {
        focusElement(
          isExternalInvoker(settledRestoreTarget) ? settledRestoreTarget : openButton,
          { suppressReaderSnapshot: true },
        );
      }
    });
  }
  return true;
}

export function focusStudyWorkspaceAfterClear() {
  if (!isMobileStudyWorkspaceOpen()) return false;
  return focusElement(clearButton || initialDrawerFocus());
}

function syncResponsiveWorkspace() {
  updateAdaptiveHideButton();
  if (mobileMedia.matches) {
    if (root.dataset.studyWorkspaceHidden === "true") setWorkspaceHidden(false, { restoreFocus: false });
    if (!detailPane?.classList.contains("visible")) closeStudyWorkspace({ restoreFocus: false });
    return;
  }

  ++drawerTransitionGeneration;
  detailPane?.classList.remove("visible");
  if (root.dataset.studyWorkspaceHidden === "true") {
    detailPane?.setAttribute("aria-hidden", "true");
    setPaneInert(true);
  } else {
    detailPane?.removeAttribute("aria-hidden");
    setPaneInert(false);
  }
  syncPaneDisclosure(root.dataset.studyWorkspaceHidden !== "true");
}

function rememberExternalInteraction(event) {
  const target = event.target?.closest?.(
    "#openStudyPanel, .strong-token, .verse-number, .verse-study-button, .fn-marker, .reference-hover, .toolbar-button",
  );
  rememberDrawerInvoker(target);
}

document.addEventListener("pointerdown", rememberExternalInteraction, true);
document.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") rememberExternalInteraction(event);
  if (!isMobileStudyWorkspaceOpen()) return;

  if (event.key === "Escape") {
    if (event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    closeStudyWorkspace({ restoreFocus: true });
    return;
  }

  if (event.key !== "Tab") return;
  const controls = drawerFocusableControls();
  if (!controls.length) return;
  const first = controls[0];
  const last = controls[controls.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !detailPane.contains(active))) {
    event.preventDefault();
    focusElement(last);
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    focusElement(first);
  }
});

hideButton?.addEventListener("click", () => {
  if (mobileMedia.matches) closeStudyWorkspace({ restoreFocus: true });
  else setWorkspaceHidden(true);
});
showButton?.addEventListener("click", () => setWorkspaceHidden(false));

mobileMedia.addEventListener?.("change", syncResponsiveWorkspace);

window.addEventListener("resize", updateHeaderBlockSize, { passive: true });
if (typeof ResizeObserver === "function" && header) {
  new ResizeObserver(updateHeaderBlockSize).observe(header);
}
if (document.fonts?.ready) {
  document.fonts.ready.then(updateHeaderBlockSize).catch(() => {});
}
syncResponsiveWorkspace();
updateHeaderBlockSize();
window.requestAnimationFrame(updateHeaderBlockSize);
