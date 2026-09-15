import {
  interpretationPreview,
  normalizeSpeechAttributionRange,
  speechAttributionContract,
  speechAttributionPreview,
} from "./user-annotation-contracts.js";
import { uiActionContract } from "./ui-contracts.js";

const tooltipLayers = new WeakMap();
let tooltipSequence = 0;

function ensureTooltipLayer(documentObject) {
  if (tooltipLayers.has(documentObject)) return tooltipLayers.get(documentObject);
  const layer = documentObject.createElement("div");
  layer.className = "user-annotation-tooltip-layer";
  layer.id = `user-annotation-tooltip-${++tooltipSequence}`;
  layer.setAttribute("role", "tooltip");
  layer.hidden = true;
  documentObject.body.append(layer);
  const reposition = () => {
    const target = layer.__annotationTarget;
    if (!target) return;
    if (!target.isConnected) hideTooltip(layer);
    else positionTooltip(layer, target);
  };
  documentObject.defaultView.addEventListener("resize", reposition);
  documentObject.defaultView.addEventListener("scroll", reposition, true);
  documentObject.addEventListener("pointerdown", (event) => {
    layer.__selectingText = Boolean(event.target.closest?.(".verse-body"));
    if (!layer.contains(event.target) && !layer.__annotationTarget?.contains(event.target)) hideTooltip(layer);
    if (layer.__selectingText) hideTooltip(layer);
  }, true);
  documentObject.addEventListener("pointerup", () => { layer.__selectingText = false; });
  documentObject.addEventListener("pointercancel", () => { layer.__selectingText = false; });
  documentObject.addEventListener("selectionchange", () => {
    if (!documentObject.defaultView.getSelection()?.isCollapsed) hideTooltip(layer);
  });
  new documentObject.defaultView.MutationObserver(reposition).observe(documentObject.body, { childList: true, subtree: true });
  layer.addEventListener("mouseenter", () => clearTimeout(layer.__hideTimer));
  layer.addEventListener("mouseleave", () => hideTooltip(layer));
  documentObject.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !layer.hidden) {
      event.stopPropagation();
      hideTooltip(layer);
    }
  }, true);
  tooltipLayers.set(documentObject, layer);
  return layer;
}

function tooltipLines(preview) {
  if (!preview) return [];
  if (preview.label === "Interpretation") {
    return [
      { kind: "title", text: preview.label },
      { kind: "line", text: `Saved alternative: ${preview.saved}` },
      preview.original ? { kind: "line", text: `Original source: ${preview.original}` } : null,
      preview.strongCode ? { kind: "meta", text: `Strong's ${preview.strongCode}` } : null,
      { kind: "note", text: "Your saved alternative wording; Scripture text is unchanged." },
    ].filter(Boolean);
  }
  return [
    { kind: "title", text: preview.label },
    { kind: "line", text: preview.classificationLabel },
    preview.selectedText ? { kind: "line", text: `Selected text: ${preview.selectedText}` } : null,
    { kind: "note", text: "Your private attribution annotation; the app is not asserting authorship." },
  ].filter(Boolean);
}

function renderTooltip(layer, preview) {
  const documentObject = layer.ownerDocument;
  const fragment = documentObject.createDocumentFragment();
  for (const item of tooltipLines(preview)) {
    const node = documentObject.createElement(item.kind === "title" ? "strong" : "span");
    node.className = `user-annotation-tooltip-${item.kind}`;
    node.textContent = item.text;
    fragment.append(node);
  }
  layer.replaceChildren(fragment);
}

function positionTooltip(layer, target) {
  const windowObject = target.ownerDocument.defaultView;
  const margin = 10;
  const gap = 7;
  const targetRect = target.getBoundingClientRect();
  const layerRect = layer.getBoundingClientRect();
  const viewportWidth = windowObject.innerWidth || target.ownerDocument.documentElement.clientWidth;
  const viewportHeight = windowObject.innerHeight || target.ownerDocument.documentElement.clientHeight;
  const left = Math.min(
    Math.max(margin, targetRect.left + targetRect.width / 2 - layerRect.width / 2),
    Math.max(margin, viewportWidth - layerRect.width - margin),
  );
  const above = targetRect.top - layerRect.height - gap;
  const below = targetRect.bottom + gap;
  const top = above >= margin ? above : Math.min(below, Math.max(margin, viewportHeight - layerRect.height - margin));
  layer.style.left = `${left}px`;
  layer.style.top = `${top}px`;
}

function hideTooltip(layer, target = null) {
  if (target && layer.__annotationTarget !== target) return;
  layer.__annotationTarget = null;
  layer.hidden = true;
  layer.replaceChildren();
  layer.style.removeProperty("left");
  layer.style.removeProperty("top");
}

function showTooltip(target, preview) {
  if (!preview || !target?.isConnected) return;
  const layer = ensureTooltipLayer(target.ownerDocument);
  if (layer.__selectingText || !target.ownerDocument.defaultView.getSelection()?.isCollapsed) return;
  clearTimeout(layer.__hideTimer);
  layer.__annotationTarget = target;
  renderTooltip(layer, preview);
  layer.hidden = false;
  positionTooltip(layer, target);
}

export function wireUserAnnotationPreview(target, preview, { onActivate = null } = {}) {
  if (!target || !preview) return target;
  const layer = ensureTooltipLayer(target.ownerDocument);
  target.__userAnnotationPreview = preview;
  target.__userAnnotationActivate = onActivate;
  target.setAttribute("aria-describedby", layer.id);
  if (layer.__annotationTarget === target) showTooltip(target, preview);
  if (target.__userAnnotationWired) return target;
  target.__userAnnotationWired = true;
  target.addEventListener("mouseenter", () => showTooltip(target, target.__userAnnotationPreview));
  target.addEventListener("mouseleave", () => {
    if (target.ownerDocument.activeElement === target) return;
    layer.__hideTimer = setTimeout(() => hideTooltip(layer, target), 140);
  });
  target.addEventListener("focus", () => showTooltip(target, target.__userAnnotationPreview));
  target.addEventListener("blur", () => hideTooltip(layer, target));
  target.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && target.__userAnnotationPreview) {
      event.stopPropagation();
      hideTooltip(layer, target);
    }
  });
  target.addEventListener("click", (event) => {
    if (!target.__userAnnotationPreview) return;
    if (typeof target.__userAnnotationActivate === "function") {
      hideTooltip(layer, target);
      target.__userAnnotationActivate(event, target);
    } else showTooltip(target, target.__userAnnotationPreview);
  });
  return target;
}

export function clearUserAnnotationPreview(target) {
  target.__userAnnotationPreview = null;
  target.__userAnnotationActivate = null;
  target.removeAttribute("aria-describedby");
  const layer = tooltipLayers.get(target.ownerDocument);
  if (layer) hideTooltip(layer, target);
}

export function decorateSpeechAttributionElement(element, range) {
  const normalized = normalizeSpeechAttributionRange(range);
  if (!element || !normalized) return element;
  const contract = speechAttributionContract(normalized.classification);
  const preview = speechAttributionPreview(normalized);
  element.classList.add("speech-attribution", contract.cssClass);
  element.dataset.speechAttribution = normalized.classification;
  element.dataset.userAnnotation = "speech-attribution";
  element.title = preview.accessibleText;
  if (!element.hasAttribute("tabindex")) element.tabIndex = 0;
  element.setAttribute("aria-description", preview.accessibleText);
  wireUserAnnotationPreview(element, preview);
  return element;
}

export function createInterpretationMarker(record, {
  documentObject = globalThis.document,
  onActivate = null,
  visibleLabel = "Interpretation",
} = {}) {
  const preview = interpretationPreview(record);
  if (!documentObject || !preview) return null;
  const marker = documentObject.createElement("button");
  marker.type = "button";
  marker.className = "interpretation-marker ui-action-control";
  marker.dataset.uiAction = "interpretation";
  marker.dataset.userAnnotation = "interpretation";
  marker.textContent = visibleLabel;
  marker.dataset.uiTip = uiActionContract("interpretation").tip;
  marker.title = preview.accessibleText;
  marker.setAttribute("aria-label", `Interpretation. ${preview.accessibleText}`);
  marker.addEventListener("click", (event) => event.stopPropagation());
  wireUserAnnotationPreview(marker, preview, { onActivate });
  return marker;
}
