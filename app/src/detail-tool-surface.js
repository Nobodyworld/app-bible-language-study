import {
  activateOverlay,
  deactivateOverlay,
} from "./overlay-coordinator.js?v=pr13-live-qa-20260711e";

const TOOL_SURFACE_IDS = Object.freeze({
  surface: "detailToolSurface",
  title: "detailToolTitle",
  content: "detailToolContent",
  close: "detailToolClose",
  workArea: "detailWorkArea",
});

const DEFAULT_FOCUS_SELECTOR = [
  "[autofocus]:not([disabled])",
  "button:not([disabled])",
  "input:not([disabled]):not([type=\"hidden\"])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  "[tabindex]:not([tabindex=\"-1\"])",
].join(", ");

let activeSession = null;
let sessionGeneration = 0;

const overlayOwner = {
  document: null,
  isConnected: () => Boolean(activeSession?.surface?.isConnected),
  close: ({ restoreFocus = false } = {}) => {
    closeContainedDetailTool({
      restoreFocus,
      reason: restoreFocus ? "escape" : "overlay-replaced",
    });
  },
};

function getDocument(trigger) {
  const document = trigger?.ownerDocument || globalThis.document;
  return document && typeof document.getElementById === "function" ? document : null;
}

function getSurfaceElements(document) {
  if (!document) return null;
  const elements = Object.fromEntries(
    Object.entries(TOOL_SURFACE_IDS).map(([name, id]) => [name, document.getElementById(id)]),
  );
  return Object.values(elements).every(Boolean) ? elements : null;
}

function attributeState(element, name) {
  return {
    present: element.hasAttribute(name),
    value: element.getAttribute(name),
  };
}

function restoreAttribute(element, name, state) {
  if (state.present) element.setAttribute(name, state.value ?? "");
  else element.removeAttribute(name);
}

function captureWorkAreaState(workArea) {
  return {
    ariaHidden: attributeState(workArea, "aria-hidden"),
    inert: attributeState(workArea, "inert"),
    supportsInert: "inert" in workArea,
    inertValue: "inert" in workArea ? Boolean(workArea.inert) : false,
  };
}

function disableWorkArea(session) {
  const { workArea } = session;
  if (session.workAreaState.supportsInert) workArea.inert = true;
  else workArea.setAttribute("inert", "");
  workArea.setAttribute("aria-hidden", "true");
}

function restoreWorkArea(session) {
  const { workArea, workAreaState } = session;
  if (!workArea || !workAreaState) return;
  if (workAreaState.supportsInert) workArea.inert = workAreaState.inertValue;
  restoreAttribute(workArea, "inert", workAreaState.inert);
  restoreAttribute(workArea, "aria-hidden", workAreaState.ariaHidden);
}

function setTriggerExpanded(trigger, expanded) {
  trigger?.setAttribute?.("aria-expanded", expanded ? "true" : "false");
}

function connectedElement(value) {
  return value?.isConnected ? value : null;
}

function callResolver(resolver, session) {
  if (typeof resolver !== "function") return resolver || null;
  try {
    return resolver({
      kind: session.kind,
      targetId: session.targetId,
      trigger: session.trigger,
      surface: session.surface,
      content: session.contentHost,
    });
  } catch {
    return null;
  }
}

function queryFocusTarget(scope, selector) {
  if (!scope || typeof selector !== "string" || !selector.trim()) return null;
  try {
    return scope.querySelector(selector);
  } catch {
    return null;
  }
}

function focusElement(element) {
  if (!connectedElement(element) || typeof element.focus !== "function") return false;
  try {
    element.focus({ preventScroll: true });
    return true;
  } catch {
    try {
      element.focus();
      return true;
    } catch {
      return false;
    }
  }
}

function requestFrame(document, callback) {
  const view = document?.defaultView;
  if (typeof view?.requestAnimationFrame === "function") {
    const id = view.requestAnimationFrame(callback);
    return () => view.cancelAnimationFrame?.(id);
  }
  const timer = globalThis.setTimeout(callback, 0);
  return () => globalThis.clearTimeout(timer);
}

function resolveInitialFocus(session) {
  let requested = callResolver(session.initialFocus, session);
  if (typeof requested === "string") {
    requested = queryFocusTarget(session.contentHost, requested)
      || queryFocusTarget(session.surface, requested);
  }
  return connectedElement(requested)
    || queryFocusTarget(session.contentHost, DEFAULT_FOCUS_SELECTOR)
    || connectedElement(session.closeButton);
}

function resolveRestoreFocus(session) {
  if (connectedElement(session.trigger)) return session.trigger;

  let replacement = callResolver(session.resolveTrigger, session);
  if (typeof replacement === "string") replacement = queryFocusTarget(session.document, replacement);
  if (connectedElement(replacement)) return replacement;

  let fallback = callResolver(session.focusFallback, session);
  if (typeof fallback === "string") fallback = queryFocusTarget(session.document, fallback);
  if (connectedElement(fallback)) return fallback;

  return queryFocusTarget(
    session.document,
    "#clearDetail:not([disabled]), #detailBack:not([disabled]), #detailForward:not([disabled]), .detail-header button:not([disabled])",
  );
}

function scheduleInitialFocus(session) {
  const expectedGeneration = session.generation;
  session.cancelInitialFocus = requestFrame(session.document, () => {
    session.cancelInitialFocus = null;
    if (activeSession !== session || sessionGeneration !== expectedGeneration) return;
    focusElement(resolveInitialFocus(session));
  });
}

function scheduleRestoreFocus(session, expectedGeneration) {
  requestFrame(session.document, () => {
    if (sessionGeneration !== expectedGeneration || activeSession) return;
    focusElement(resolveRestoreFocus(session));
  });
}

function notifyClosed(session, reason) {
  if (typeof session.onClose !== "function") return;
  try {
    session.onClose({
      reason,
      kind: session.kind,
      targetId: session.targetId,
    });
  } catch {
    // A tool callback must not strand the shared surface or its inert work area.
  }
}

function resetSurface(session) {
  const { surface, contentHost } = session;
  if (surface) {
    surface.hidden = true;
    surface.setAttribute("aria-hidden", "true");
    delete surface.dataset.toolKind;
    delete surface.dataset.targetId;
    delete surface.dataset.toolTargetId;
  }
  contentHost?.replaceChildren();
}

function teardownSession(session, { reason, reset = true } = {}) {
  session.cancelInitialFocus?.();
  session.cancelInitialFocus = null;
  session.cancelTriggerSync?.();
  session.cancelTriggerSync = null;
  session.observer?.disconnect();
  session.observer = null;
  session.closeButton?.removeEventListener("click", session.onCloseClick);
  setTriggerExpanded(session.trigger, false);
  restoreWorkArea(session);
  if (reset) resetSurface(session);
  notifyClosed(session, reason);
}

function appendContent(contentHost, content, session) {
  let resolved = typeof content === "function"
    ? content({
      kind: session.kind,
      targetId: session.targetId,
      surface: session.surface,
      content: contentHost,
    })
    : content;

  contentHost.replaceChildren();
  if (resolved == null) return;
  if (Array.isArray(resolved)) {
    contentHost.append(...resolved);
    return;
  }
  contentHost.append(resolved);
}

function scheduleTriggerSync(session) {
  if (session.cancelTriggerSync || activeSession !== session) return;
  const expectedGeneration = session.generation;
  session.cancelTriggerSync = requestFrame(session.document, () => {
    session.cancelTriggerSync = null;
    if (activeSession !== session || sessionGeneration !== expectedGeneration) return;
    if (!session.surface.isConnected || !session.workArea.isConnected) {
      dismissContainedDetailTool("surface-disconnected");
      return;
    }
    syncContainedDetailToolTrigger();
  });
}

function observeSession(session) {
  const MutationObserver = session.document.defaultView?.MutationObserver
    || globalThis.MutationObserver;
  const root = session.document.documentElement;
  if (typeof MutationObserver !== "function" || !root) return;
  session.observer = new MutationObserver(() => scheduleTriggerSync(session));
  session.observer.observe(root, { childList: true, subtree: true });
}

export function openContainedDetailTool({
  kind,
  title,
  targetId = "",
  content,
  trigger = null,
  resolveTrigger = null,
  initialFocus = null,
  onClose = null,
  focusFallback = null,
} = {}) {
  const normalizedKind = String(kind || "").trim();
  const document = getDocument(trigger);
  let elements = getSurfaceElements(document);
  if (!normalizedKind || !elements) return false;

  if (activeSession) {
    const previous = activeSession;
    activeSession = null;
    deactivateOverlay(overlayOwner);
    teardownSession(previous, { reason: "replaced" });
    elements = getSurfaceElements(document);
    if (!elements) return false;
  }

  const session = {
    generation: ++sessionGeneration,
    document,
    kind: normalizedKind,
    targetId: targetId == null ? "" : String(targetId),
    trigger,
    resolveTrigger,
    initialFocus,
    onClose,
    focusFallback,
    surface: elements.surface,
    titleNode: elements.title,
    contentHost: elements.content,
    closeButton: elements.close,
    workArea: elements.workArea,
    workAreaState: captureWorkAreaState(elements.workArea),
    observer: null,
    cancelInitialFocus: null,
    cancelTriggerSync: null,
    onCloseClick: null,
  };
  activeSession = session;

  session.titleNode.textContent = String(title || "Study tool");
  session.surface.dataset.toolKind = session.kind;
  session.surface.dataset.targetId = session.targetId;
  session.surface.dataset.toolTargetId = session.targetId;
  session.surface.hidden = false;
  session.surface.setAttribute("aria-hidden", "false");
  appendContent(session.contentHost, content, session);
  disableWorkArea(session);
  setTriggerExpanded(session.trigger, true);

  session.onCloseClick = () => {
    closeContainedDetailTool({ restoreFocus: true, reason: "close-button" });
  };
  session.closeButton.addEventListener("click", session.onCloseClick);

  overlayOwner.document = document;
  activateOverlay(overlayOwner);
  observeSession(session);
  // Move focus before activation returns so a replacement never leaves focus
  // stranded in the newly inert work area. The frame pass reinforces this
  // after any click/default-focus bookkeeping or synchronous content update.
  focusElement(resolveInitialFocus(session));
  scheduleInitialFocus(session);
  return true;
}

export function closeContainedDetailTool({
  restoreFocus = true,
  reason = "close",
} = {}) {
  const session = activeSession;
  if (!session) return false;

  activeSession = null;
  const closedGeneration = ++sessionGeneration;
  deactivateOverlay(overlayOwner);
  teardownSession(session, { reason });
  if (!activeSession) overlayOwner.document = null;
  if (restoreFocus) scheduleRestoreFocus(session, closedGeneration);
  return true;
}

export function dismissContainedDetailTool(reason = "dismissed") {
  return closeContainedDetailTool({ restoreFocus: false, reason });
}

export function isContainedDetailToolOpen(kind) {
  if (!activeSession) return false;
  if (kind == null) return true;
  return activeSession.kind === String(kind).trim();
}

export function syncContainedDetailToolTrigger() {
  const session = activeSession;
  if (!session) return null;

  if (connectedElement(session.trigger)) {
    setTriggerExpanded(session.trigger, true);
    return session.trigger;
  }

  let replacement = callResolver(session.resolveTrigger, session);
  if (typeof replacement === "string") replacement = queryFocusTarget(session.document, replacement);
  replacement = connectedElement(replacement);

  if (replacement && replacement !== session.trigger) {
    setTriggerExpanded(session.trigger, false);
    session.trigger = replacement;
  }

  if (connectedElement(session.trigger)) {
    setTriggerExpanded(session.trigger, true);
    return session.trigger;
  }

  closeContainedDetailTool({ restoreFocus: true, reason: "trigger-disconnected" });
  return null;
}
