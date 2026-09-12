import { fetchLexiconEntry } from "./data-service.js?v=pr13-live-qa-20260711e";

const SEE_REFERENCE_PATTERN = /see (GREEK|HEBREW) ([^\n]+)/gu;
const COMPARE_REFERENCE_PATTERN = /\b(compare(?:\s+with)?\s+)([\p{L}\p{M}'’\-]+)/giu;

export function compactStrongDefinition(entry) {
  return (
    entry?.short_definition ||
    entry?.meaning ||
    entry?.concordance_definition ||
    String(entry?.strongs_concordance || "").split("\n").map((line) => line.trim()).find(Boolean) ||
    ""
  );
}

export function strongReferencePreview(entry, ref, label) {
  if (!entry) return `${label}${ref?.strong_code ? ` (${ref.strong_code})` : ""}`;
  const original = entry.original_word || label;
  const transliteration = entry.transliteration && entry.transliteration !== original ? entry.transliteration : "";
  const language = entry.language === "hebrew" ? "Hebrew" : entry.language === "greek" ? "Greek" : "";
  return [original, transliteration, ref?.strong_code, language, compactStrongDefinition(entry)].filter(Boolean).join(" · ");
}

function refreshVisibleTooltip(button) {
  if (!button.isConnected) return;
  if (!button.matches(":hover") && document.activeElement !== button) return;
  button.dispatchEvent(new Event("pointerover", { bubbles: true }));
}

function normalizedReferenceLabel(value) {
  return String(value || "")
    .trim()
    .replace(/[).,;:]+$/g, "")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();
}

function referenceLabels(ref) {
  return [
    ref?.label,
    ref?.original_word,
    ref?.transliteration,
    ref?.xlit,
    ref?.lemma,
    ref?.strong_code,
  ]
    .map(normalizedReferenceLabel)
    .filter(Boolean);
}

function findStrongReference(refs, label, language = "") {
  const key = normalizedReferenceLabel(label);
  if (!key) return null;
  return refs.find((item) => {
    if (language && item?.language !== language) return false;
    return referenceLabels(item).includes(key);
  }) || null;
}

export function strongReferenceDisplayLabel(ref, label = ref?.label || ref?.strong_code || "Strong's") {
  const code = String(ref?.strong_code || "").toUpperCase();
  const value = String(label || "").trim();
  return code === "G1" && normalizedReferenceLabel(value) === "a" ? "a-" : value;
}

export function createStrongReferenceControl(ref, { label = ref?.label || ref?.strong_code || "Strong's", onActivate } = {}) {
  const code = /^[HG]\d+$/u.test(String(ref?.strong_code || "").toUpperCase())
    ? String(ref.strong_code).toUpperCase()
    : "";
  if (!code) return null;
  const item = { ...ref, strong_code: code };
  const displayLabel = strongReferenceDisplayLabel(item, label);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "strong-inline-link definition-tooltip";
  button.textContent = displayLabel;
  button.dataset.tooltip = `${displayLabel} (${code}) — Loading definition…`;
  button.setAttribute("aria-label", `Open Strong's ${displayLabel}, ${code}`);
  let hydration;
  const hydrate = () => {
    if (!hydration) {
      hydration = fetchLexiconEntry(code).catch(() => null).then((entry) => {
        button.dataset.tooltip = strongReferencePreview(entry, item, displayLabel);
        button.dataset.previewReady = "true";
        refreshVisibleTooltip(button);
        return entry;
      });
    }
    return hydration;
  };
  button.addEventListener("pointerenter", hydrate);
  button.addEventListener("focus", hydrate);
  button.addEventListener("pointerdown", hydrate);
  button.addEventListener("click", () => onActivate?.(item));
  return button;
}

export function resolveStrongSeeSegments(text, refs = []) {
  const value = String(text || "");
  const matches = [];

  SEE_REFERENCE_PATTERN.lastIndex = 0;
  for (const match of value.matchAll(SEE_REFERENCE_PATTERN)) {
    const language = match[1].toLowerCase();
    const rawLabel = match[2].trim();
    const label = rawLabel.replace(/[).,;:]+$/g, "");
    const labelOffset = match[0].lastIndexOf(match[2]);
    const start = match.index + labelOffset;
    matches.push({
      start,
      end: start + label.length,
      prefixStart: match.index,
      label,
      language,
      ref: findStrongReference(refs, label, language),
    });
  }
  SEE_REFERENCE_PATTERN.lastIndex = 0;

  COMPARE_REFERENCE_PATTERN.lastIndex = 0;
  for (const match of value.matchAll(COMPARE_REFERENCE_PATTERN)) {
    const label = match[2];
    const start = match.index + match[1].length;
    matches.push({
      start,
      end: start + label.length,
      prefixStart: match.index,
      label,
      language: "",
      ref: findStrongReference(refs, label),
    });
  }
  COMPARE_REFERENCE_PATTERN.lastIndex = 0;

  matches.sort((a, b) => a.start - b.start || a.end - b.end);
  const segments = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start < cursor) continue;
    if (match.start > cursor) segments.push({ text: value.slice(cursor, match.start) });
    segments.push({
      text: "",
      label: match.label,
      language: match.language || match.ref?.language || "",
      ref: match.ref,
    });
    cursor = match.end;
  }
  if (cursor < value.length) segments.push({ text: value.slice(cursor) });
  return segments;
}
