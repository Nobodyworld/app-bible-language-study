import {
  interpretationPreview,
  normalizeSpeechAttributionRange,
  speechAttributionContract,
  speechAttributionPreview,
} from "./user-annotation-contracts.js";
import { annotationDiscoveryLabel, annotationSourceLabel, uiActionContract } from "./ui-contracts.js";
import { annotationPassageCorresponds, annotationRecordsNeedingReview, otherTranslationAnnotations, sameInterpretationSource, speechRangeIsCurrent } from "./annotation-records.js";
import { loadReaderCoreBookData } from "./data-service.js?v=pr13-live-qa-20260711e";
import { mapStrongChapterRanges } from "./strongs.js?v=pr13-live-qa-20260711e";
import { createSourceTokenTarget } from "./semantic-targets.js?v=pr13-live-qa-20260711e";

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
  if (preview.label === "Saved annotations") return [
    { kind: "title", text: preview.label },
    ...preview.lines.map(text => ({ kind: "line", text })),
    { kind: "note", text: "Your private annotations. Choose a saved source to open it." },
  ];
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

function discoveryRecords(ctx, reference, translation) {
  return otherTranslationAnnotations(ctx.state.workspaceStore, reference, translation, normalizeSpeechAttributionRange)
    .filter(item => annotationPassageCorresponds(ctx.state.manifest, translation, item.translation_id));
}

function discoveryDescription(ctx, item) {
  const code = ctx.state.manifest?.translations?.find(entry => entry.id === item.translation_id)?.code || item.translation_id.toUpperCase();
  const [bookId, chapter, verse] = item.reference_key.split(":");
  const book = ctx.state.manifest?.books?.find(entry => entry.id === bookId)?.name || bookId;
  const detail = item.kind === "interpretation"
    ? `Interpretation: ${item.record.rendering}. Original source: ${item.record.original || "Not recorded"}${item.record.strong_code ? ` (${item.record.strong_code})` : ""}.`
    : `Speech attribution: ${speechAttributionContract(item.record.classification).label}. Selected wording: ${item.record.text}.`;
  return { code, text: `${code} · ${book} ${chapter}:${verse}. ${detail}`, route: {
    translationId: item.translation_id, bookId, chapter: Number(chapter), verse: Number(verse),
  } };
}

function openDiscoveryList(ctx, reference, translation, trigger) {
  const documentObject = trigger.ownerDocument;
  documentObject.querySelector(".annotation-discovery-dialog")?.close();
  const dialog = documentObject.createElement("dialog");
  dialog.className = "annotation-discovery-dialog";
  dialog.setAttribute("aria-label", "Saved annotations from other translations");
  const heading = documentObject.createElement("h3");
  heading.textContent = "Saved annotations";
  const note = documentObject.createElement("p");
  note.textContent = "Your private choices in their original translations. Opening the list does not switch your reading passage.";
  const close = documentObject.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  close.addEventListener("click", () => dialog.close());
  const list = documentObject.createElement("ul");
  dialog.append(heading, note, list, close);
  const render = () => {
    list.replaceChildren();
    const records = discoveryRecords(ctx, reference, translation);
    if (!records.length) {
      const empty = documentObject.createElement("li");
      empty.textContent = "No annotations remain in other translations.";
      list.append(empty);
    }
    for (const item of records) {
      const description = discoveryDescription(ctx, item);
      const row = documentObject.createElement("li");
      const text = documentObject.createElement("p");
      text.textContent = description.text;
      const status = documentObject.createElement("p");
      status.setAttribute("role", "status");
      status.textContent = "Checking saved passage…";
      const open = documentObject.createElement("button");
      open.type = "button";
      open.className = "ui-action-control";
      open.dataset.uiAction = "open-annotation-source";
      open.textContent = annotationSourceLabel(description.code);
      open.title = uiActionContract("open-annotation-source").tip;
      open.setAttribute("aria-label", `${uiActionContract("open-annotation-source").label}. ${open.textContent}`);
      open.disabled = true;
      open.addEventListener("click", () => {
        dialog.close();
        void ctx.goToRoute(description.route);
      });
      row.append(text, status, open);
      list.append(row);
      void loadReaderCoreBookData(item.translation_id, description.route.bookId).then(({ verseBook: book, strongs }) => {
        if (!row.isConnected) return;
        const text = book?.chapters?.[description.route.chapter]?.[description.route.verse];
        open.disabled = !text;
        const token = item.kind === "interpretation" && mapStrongChapterRanges(
          book?.chapters?.[description.route.chapter], strongs?.chapters?.[description.route.chapter],
        )?.[description.route.verse]?.find(range => range.token.token_index === item.record.token_index)?.token;
        const exactSource = token && sameInterpretationSource(item.record, createSourceTokenTarget(item.reference_key, token, item.translation_id));
        status.textContent = !text ? "Saved source passage is unavailable; the record is preserved."
          : item.kind === "speech-attribution" && !speechRangeIsCurrent(item.record, item.reference_key, item.translation_id, text)
            ? "Saved wording no longer matches this passage. The annotation is preserved without coloring it."
            : item.kind === "interpretation" && !exactSource
              ? "The saved source token could not be verified in the current passage. Your wording is preserved; open the passage to review it."
              : "Open the saved passage to inspect its original context.";
      }).catch(() => { if (row.isConnected) status.textContent = "Saved source passage is unavailable; the record is preserved."; });
    }
  };
  dialog.__refreshAnnotationDiscovery = render;
  dialog.dataset.annotationDiscovery = "list";
  dialog.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dialog.close(); }
  });
  dialog.addEventListener("close", () => { dialog.remove(); if (trigger.isConnected && !trigger.hidden) trigger.focus({ preventScroll: true }); });
  documentObject.body.append(dialog);
  render();
  dialog.showModal();
  close.focus({ preventScroll: true });
}

export function createAnnotationDiscovery(ctx, reference, translation = ctx.state.translationId) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "annotation-discovery ui-action-control";
  button.dataset.uiAction = "saved-annotations";
  button.dataset.uiScope = "verse";
  button.dataset.annotationDiscovery = reference;
  button.setAttribute("aria-haspopup", "dialog");
  button.title = uiActionContract("saved-annotations").tip;
  const refresh = () => {
    const records = discoveryRecords(ctx, reference, translation);
    const codes = [...new Set(records.map(item => discoveryDescription(ctx, item).code))];
    button.hidden = !records.length;
    button.textContent = records.length ? annotationDiscoveryLabel(codes, records.length) : "";
    button.setAttribute("aria-label", `Saved annotations. ${button.textContent}`);
    clearUserAnnotationPreview(button);
    if (records.length) wireUserAnnotationPreview(button, {
      label: "Saved annotations", lines: records.map(item => discoveryDescription(ctx, item).text),
    }, { onActivate: () => openDiscoveryList(ctx, reference, translation, button) });
  };
  button.__refreshAnnotationDiscovery = refresh;
  refresh();
  return button;
}

export function refreshAnnotationDiscovery(documentObject = document) {
  documentObject.querySelectorAll("[data-annotation-discovery]").forEach(node => node.__refreshAnnotationDiscovery?.());
}

export function createAnnotationRecovery(ctx) {
  const records = annotationRecordsNeedingReview(ctx.state.workspaceStore, ctx.state.manifest,
    ctx.state.translationId, normalizeSpeechAttributionRange);
  if (!records.length) return null;
  const section = document.createElement("section");
  section.className = "diagnostic-section annotation-recovery";
  const heading = document.createElement("h4");
  heading.textContent = "Saved annotations to review";
  const intro = document.createElement("p");
  intro.textContent = "These records are preserved in your backup. Their source cannot safely be matched to the open translation.";
  const list = document.createElement("ul");
  for (const item of records) {
    const row = document.createElement("li");
    const record = item.record;
    const wording = record?.rendering || record?.text;
    const source = record?.original || record?.target?.token?.original;
    row.textContent = `${item.kind} · ${item.reference_key} · ${item.translation_id?.toUpperCase() || "Translation not recorded"}. ${item.reason}.`
      + (wording ? ` Saved wording: ${wording}.` : " Stored details remain in the backup.")
      + (source ? ` Original source: ${source}.` : "");
    list.append(row);
  }
  section.append(heading, intro, list);
  return section;
}
