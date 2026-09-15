import {
  interpretationPreview,
  normalizeSpeechAttributionRange,
  speechAttributionContract,
  speechAttributionPreview,
} from "./user-annotation-contracts.js";

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
  layer.__annotationTarget = target;
  renderTooltip(layer, preview);
  layer.hidden = false;
  positionTooltip(layer, target);
}

export function wireUserAnnotationPreview(target, preview, { onActivate = null } = {}) {
  if (!target || !preview) return target;
  const layer = ensureTooltipLayer(target.ownerDocument);
  target.setAttribute("aria-describedby", layer.id);
  target.addEventListener("mouseenter", () => showTooltip(target, preview));
  target.addEventListener("mouseleave", () => hideTooltip(layer, target));
  target.addEventListener("focus", () => showTooltip(target, preview));
  target.addEventListener("blur", () => hideTooltip(layer, target));
  target.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideTooltip(layer, target);
  });
  if (typeof onActivate === "function") {
    target.addEventListener("click", (event) => onActivate(event, target));
  }
  return target;
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
  marker.title = preview.accessibleText;
  marker.setAttribute("aria-label", preview.accessibleText);
  wireUserAnnotationPreview(marker, preview, { onActivate });
  return marker;
}
