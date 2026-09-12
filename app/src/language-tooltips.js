import { loadLanguageMetadata } from "./data-service.js?v=pr13-live-qa-20260711e";
import { analyzeOriginalWord, gematriaValueForUnit, languageUnitDisplayGlyph, wordHasLanguageScript } from "./language.js";

const HEBREW_RUN = /[\u0591-\u05c7\u05d0-\u05ea]+/gu;
const GREEK_RUN = /[\u0300-\u036f\u0370-\u03ff\u1f00-\u1fff]+/gu;
const TRANSLITERATION_SYMBOLS = new Map([
  ["ā", "macron marking a long a vowel in the bundled OpenBible transliteration convention"],
  ["ē", "macron marking a long e vowel in the bundled OpenBible transliteration convention"],
  ["ī", "macron marking a long i vowel in the bundled OpenBible transliteration convention"],
  ["ō", "macron marking a long o vowel in the bundled OpenBible transliteration convention"],
  ["ū", "macron marking a long u vowel in the bundled OpenBible transliteration convention"],
  ["â", "circumflex marking the convention-specific a-vowel distinction or contraction in bundled Strong's data"],
  ["ê", "circumflex marking the convention-specific e-vowel distinction or contraction in bundled Strong's data"],
  ["î", "circumflex marking the convention-specific i-vowel distinction or contraction in bundled Strong's data"],
  ["ô", "circumflex marking the convention-specific o-vowel distinction or contraction in bundled Strong's data"],
  ["û", "circumflex marking the convention-specific u-vowel distinction or contraction in bundled Strong's data"],
  ["ḥ", "dot below distinguishing the Hebrew consonant represented by h from an unmarked Latin h"],
  ["ṣ", "dot below distinguishing the Hebrew consonant represented by s from an unmarked Latin s"],
  ["ṭ", "dot below distinguishing the Hebrew consonant represented by t from an unmarked Latin t"],
  ["ḏ", "line below distinguishing the Hebrew consonant represented by d from an unmarked Latin d"],
  ["ḵ", "line below distinguishing the Hebrew consonant represented by k from an unmarked Latin k"],
  ["ṯ", "line below distinguishing the Hebrew consonant represented by t from an unmarked Latin t"],
  ["š", "caron representing the Hebrew sh consonant in the bundled OpenBible transliteration convention"],
  ["ś", "acute mark distinguishing this Hebrew s consonant from the convention's other s forms"],
  ["‘", "source-language consonant marker representing Hebrew ayin; it is not punctuation"],
  ["’", "source-language consonant marker representing Hebrew aleph; it is not punctuation"],
  ["ʿ", "source-language consonant marker representing Hebrew ayin; it is not punctuation"],
  ["·", "middle dot separating syllables or morphemes; the separator itself is not pronounced"],
]);
let tooltipLayer = null;
let activeTooltipTarget = null;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function tooltipTarget(node) {
  return node?.closest?.(
    ".language-letter-hover[data-tooltip], .letter-unit[data-tooltip], .transliteration-symbol[data-tooltip], .definition-tooltip[data-tooltip], .strong-token[data-tooltip]:not([data-suppress-tooltip]), .strong-token[data-layer-tooltip]:not([data-suppress-tooltip])",
  ) || null;
}

function tooltipText(target) {
  return target?.dataset?.layerTooltip || target?.dataset?.tooltip || "";
}

function isReaderStrongTooltip(target) {
  return Boolean(target?.classList?.contains("strong-token"));
}

function detachReaderStrongPseudoTooltip(target) {
  if (!isReaderStrongTooltip(target) || !target.dataset.tooltip) return;
  target.dataset.layerTooltip = target.dataset.tooltip;
  delete target.dataset.tooltip;
}

function restoreReaderStrongPseudoTooltip(target) {
  if (!isReaderStrongTooltip(target) || !target.dataset.layerTooltip) return;
  target.dataset.tooltip = target.dataset.layerTooltip;
  delete target.dataset.layerTooltip;
}

function ensureTooltipLayer() {
  if (typeof document === "undefined") return null;
  if (tooltipLayer) return tooltipLayer;

  tooltipLayer = document.createElement("div");
  tooltipLayer.className = "language-tooltip-layer";
  // Placement below is synchronous. The global reduced-motion duration must
  // not turn its default transition-property:all into a move from (0, 0).
  // Keep this with the inline geometry owned by this positioning controller.
  tooltipLayer.style.transitionProperty = "none";
  tooltipLayer.setAttribute("role", "tooltip");
  tooltipLayer.hidden = true;
  document.body.append(tooltipLayer);

  function hideTooltip() {
    const previousTarget = activeTooltipTarget;
    activeTooltipTarget = null;
    tooltipLayer.hidden = true;
    tooltipLayer.textContent = "";
    restoreReaderStrongPseudoTooltip(previousTarget);
  }

  function positionTooltip(target) {
    if (!target || !target.isConnected || tooltipLayer.hidden) return;
    const rect = target.getBoundingClientRect();
    const margin = 10;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const panelRect = target.closest?.(".detail-pane")?.getBoundingClientRect();
    const bounds = panelRect
      ? {
          left: Math.max(margin, panelRect.left + margin),
          right: Math.min(viewportWidth - margin, panelRect.right - margin),
          top: Math.max(margin, panelRect.top + margin),
          bottom: Math.min(viewportHeight - margin, panelRect.bottom - margin),
        }
      : { left: margin, right: viewportWidth - margin, top: margin, bottom: viewportHeight - margin };
    tooltipLayer.style.maxWidth = `${Math.max(120, Math.min(320, bounds.right - bounds.left))}px`;
    const tooltipRect = tooltipLayer.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const above = rect.top - tooltipRect.height - margin;
    const below = rect.bottom + margin;
    const top = above >= bounds.top ? above : below;
    tooltipLayer.style.left = `${clamp(centerX - tooltipRect.width / 2, bounds.left, bounds.right - tooltipRect.width)}px`;
    tooltipLayer.style.top = `${clamp(top, bounds.top, bounds.bottom - tooltipRect.height)}px`;
  }

  function showTooltip(target) {
    const text = tooltipText(target);
    if (!text) {
      hideTooltip();
      return;
    }
    if (activeTooltipTarget && activeTooltipTarget !== target) {
      restoreReaderStrongPseudoTooltip(activeTooltipTarget);
    }
    activeTooltipTarget = target;
    detachReaderStrongPseudoTooltip(target);
    tooltipLayer.textContent = text;
    tooltipLayer.hidden = false;
    tooltipLayer.style.left = "0px";
    tooltipLayer.style.top = "0px";
    positionTooltip(target);
  }

  document.addEventListener("pointerover", (event) => {
    const target = tooltipTarget(event.target);
    if (target) showTooltip(target);
  });
  document.addEventListener("mouseover", (event) => {
    const target = tooltipTarget(event.target);
    if (target) showTooltip(target);
  });
  document.addEventListener("pointermove", (event) => {
    const target = tooltipTarget(event.target) || activeTooltipTarget;
    if (target === activeTooltipTarget) positionTooltip(target);
  });
  document.addEventListener("mousemove", (event) => {
    const target = tooltipTarget(event.target) || activeTooltipTarget;
    if (target === activeTooltipTarget) positionTooltip(target);
  });
  document.addEventListener("pointerout", (event) => {
    if (!activeTooltipTarget) return;
    const next = event.relatedTarget;
    if (!next || !activeTooltipTarget.contains(next)) hideTooltip();
  });
  document.addEventListener("mouseout", (event) => {
    if (!activeTooltipTarget) return;
    const next = event.relatedTarget;
    if (!next || !activeTooltipTarget.contains(next)) hideTooltip();
  });
  document.addEventListener("focusin", (event) => {
    const target = tooltipTarget(event.target);
    if (target) showTooltip(target);
  });
  document.addEventListener("focusout", (event) => {
    if (activeTooltipTarget && event.target === activeTooltipTarget) hideTooltip();
  });
  document.addEventListener("click", (event) => {
    const target = tooltipTarget(event.target);
    if (target?.classList.contains("transliteration-symbol")) {
      event.stopPropagation();
      showTooltip(target);
      return;
    }
    if (isReaderStrongTooltip(activeTooltipTarget)) {
      hideTooltip();
      return;
    }
    if (activeTooltipTarget?.classList.contains("transliteration-symbol")) hideTooltip();
  });
  window.addEventListener("scroll", () => positionTooltip(activeTooltipTarget), true);
  window.addEventListener("resize", () => positionTooltip(activeTooltipTarget));

  return tooltipLayer;
}

function displayMarkChar(record) {
  const char = record.mark?.char || record.char || "";
  return char.match(/\p{Mark}/u) ? `\u25CC${char}` : char;
}

export function languageUnitText(unit) {
  return languageUnitDisplayGlyph(unit);
}

export function transliterationSymbolDescription(character, sourceLabel = "Bundled Strong's/interlinear transliteration") {
  const description = TRANSLITERATION_SYMBOLS.get(character);
  if (!description) return "";
  return `${character}: ${description}.`;
}

export function setTransliterationTextWithTooltips(node, text, options = {}) {
  const source = String(text || "");
  const sourceLabel = options.sourceLabel || "Bundled Strong's/interlinear transliteration";
  node.dataset.transliterationConvention = "bundled-strongs-interlinear";
  node.setAttribute(
    "aria-description",
    `${sourceLabel}; scholarly transliteration, not exact pronunciation.`,
  );
  node.title = `${sourceLabel}; scholarly transliteration, not exact pronunciation.`;
  node.replaceChildren();
  ensureTooltipLayer();
  for (const character of source) {
    const description = transliterationSymbolDescription(character, sourceLabel);
    if (!description) {
      node.append(document.createTextNode(character));
      continue;
    }
    const symbol = document.createElement("span");
    symbol.className = "transliteration-symbol";
    symbol.textContent = character;
    symbol.dataset.tooltip = description;
    symbol.setAttribute("aria-label", description);
    symbol.tabIndex = 0;
    node.append(symbol);
  }
  return Boolean(source);
}

function wordInfoText(wordInfo) {
  if (!wordInfo) return "";
  if (typeof wordInfo === "string") return wordInfo;
  return [wordInfo.meaning, wordInfo.strongCode, wordInfo.transliteration].filter(Boolean).join(" - ");
}

export function languageUnitTooltip(unit, language, options = {}) {
  ensureTooltipLayer();
  const letter = unit.letter;
  const letterName = letter?.name || unit.marks?.[0]?.mark?.name || unit.code_point;
  const sound = letter?.transliteration || letter?.sound || "";
  const value = language === "hebrew" ? gematriaValueForUnit(unit) : 0;
  const glyph = languageUnitText(unit);
  const context = wordInfoText(options.wordInfo);
  const parts = [];
  if (context) parts.push(`word: ${context}`, "");
  parts.push(`${glyph}  ${letterName}`);
  if (sound) parts.push(`sound: ${sound}`);
  if (value) parts.push(`gematria: ${value}`);

  const markText = (unit.marks || [])
    .map((record) => {
      const mark = record.mark;
      return [displayMarkChar(record), mark?.short_label || mark?.name || record.code_point].filter(Boolean).join(" ");
    })
    .filter(Boolean)
    .join(", ");
  if (markText) parts.push(`marks: ${markText}`);
  return parts.join("\n");
}

function normalizeLookupKey(text, language) {
  const normalized = String(text || "").normalize("NFD");
  const letterPattern = language === "greek" ? /[\u0370-\u03ff\u1f00-\u1fff]/gu : /[\u05d0-\u05ea]/gu;
  return Array.from(normalized.matchAll(letterPattern), (match) => match[0]).join("");
}

function lookupWordInfo(text, language, options) {
  if (options.wordInfo) return options.wordInfo;
  const lookup = options.wordInfoLookup;
  if (!lookup) return null;
  const exact = String(text || "").normalize("NFD");
  return lookup.get(exact) || lookup.get(normalizeLookupKey(text, language)) || null;
}

function renderAnalyzedRun(text, language, metadata, options = {}) {
  const word = document.createElement("span");
  word.className = `language-word-hover ${language}`;
  ensureTooltipLayer();
  const analysis = analyzeOriginalWord(text, language, metadata);
  const wordInfo = lookupWordInfo(text, language, options);
  analysis.units.forEach((unit) => {
    const span = document.createElement("span");
    span.className = unit.standalone ? "language-letter-hover mark-hover" : "language-letter-hover";
    span.textContent = languageUnitText(unit);
    span.dataset.tooltip = languageUnitTooltip(unit, language, { wordInfo });
    span.setAttribute("aria-label", span.dataset.tooltip);
    span.tabIndex = 0;
    word.append(span);
  });
  return word;
}

export function initializeLanguageTooltips() {
  ensureTooltipLayer();
}

export function renderLanguageTextWithTooltips(text, language, metadata, options = {}) {
  const source = String(text || "");
  const pattern = language === "greek" ? GREEK_RUN : HEBREW_RUN;
  const fragment = document.createDocumentFragment();
  let cursor = 0;

  for (const match of source.matchAll(pattern)) {
    const index = match.index || 0;
    if (index > cursor) fragment.append(document.createTextNode(source.slice(cursor, index)));
    fragment.append(renderAnalyzedRun(match[0], language, metadata, options));
    cursor = index + match[0].length;
  }

  if (cursor < source.length) fragment.append(document.createTextNode(source.slice(cursor)));
  return fragment;
}

export function setLanguageTextWithTooltips(node, text, language, options = {}) {
  const source = String(text || "");
  node.textContent = source;
  if ((language !== "hebrew" && language !== "greek") || !wordHasLanguageScript(source, language)) return false;

  loadLanguageMetadata(language)
    .then((metadata) => {
      if (!metadata) return;
      node.replaceChildren(renderLanguageTextWithTooltips(source, language, metadata, options));
    })
    .catch(() => {
      node.textContent = source;
    });
  return true;
}

// This module is part of the statically imported Study surface. Install the
// shared fixed layer once so Reader Strong tokens get viewport-safe previews
// before any language-specific detail happens to initialize it.
if (typeof document !== "undefined") ensureTooltipLayer();
