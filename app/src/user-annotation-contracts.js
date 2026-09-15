export const SPEECH_ATTRIBUTION_IDS = Object.freeze(["red", "pink", "gray", "black"]);

const defineSpeechAttribution = (value) => Object.freeze(value);

export const SPEECH_ATTRIBUTION_LEVELS = Object.freeze({
  red: defineSpeechAttribution({
    id: "red",
    label: "Attributed",
    compactLabel: "Red",
    cssClass: "speech-attribution-red",
    colorToken: "--speech-attribution-red",
    tip: "Your annotation: confidently attributed to the intended speaker.",
  }),
  pink: defineSpeechAttribution({
    id: "pink",
    label: "Possibly attributed",
    compactLabel: "Pink",
    cssClass: "speech-attribution-pink",
    colorToken: "--speech-attribution-pink",
    tip: "Your annotation: attribution is plausible but uncertain.",
  }),
  gray: defineSpeechAttribution({
    id: "gray",
    label: "Unlikely attributed",
    compactLabel: "Gray",
    cssClass: "speech-attribution-gray",
    colorToken: "--speech-attribution-gray",
    tip: "Your annotation: attribution is doubtful.",
  }),
  black: defineSpeechAttribution({
    id: "black",
    label: "Not attributed",
    compactLabel: "Black",
    cssClass: "speech-attribution-black",
    colorToken: "--speech-attribution-black",
    tip: "Your annotation: not attributed to the intended speaker.",
  }),
});

export function speechAttributionContract(classification) {
  const id = String(classification || "").trim().toLowerCase();
  return SPEECH_ATTRIBUTION_LEVELS[id] || null;
}

export function normalizeSpeechAttributionRange(range = {}, { legacyDefault = "red" } = {}) {
  const start = Number(range.start);
  const end = Number(range.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const classification = speechAttributionContract(range.classification)?.id
    || speechAttributionContract(legacyDefault)?.id
    || "red";
  return {
    ...range,
    start,
    end,
    text: String(range.text || ""),
    classification,
    source: range.source || "user",
    revision: Math.max(1, Number(range.revision || 1)),
    updated_at: String(range.updated_at || ""),
  };
}

export function normalizeSpeechAttributionRanges(ranges = []) {
  if (!Array.isArray(ranges)) return [];
  return ranges
    .map((range) => normalizeSpeechAttributionRange(range))
    .filter(Boolean)
    .sort((a, b) => a.start - b.start || a.end - b.end || a.classification.localeCompare(b.classification));
}

export function upsertSpeechAttributionRange(ranges, nextRange) {
  const normalized = normalizeSpeechAttributionRange(nextRange);
  if (!normalized) return normalizeSpeechAttributionRanges(ranges);
  const withoutExact = normalizeSpeechAttributionRanges(ranges)
    .filter((range) => range.start !== normalized.start || range.end !== normalized.end);
  return [...withoutExact, normalized]
    .sort((a, b) => a.start - b.start || a.end - b.end || a.classification.localeCompare(b.classification));
}

export function clearSpeechAttributionRange(ranges, targetRange) {
  const target = normalizeSpeechAttributionRange(targetRange);
  if (!target) return normalizeSpeechAttributionRanges(ranges);
  return normalizeSpeechAttributionRanges(ranges)
    .filter((range) => range.start !== target.start || range.end !== target.end);
}

function updatedTime(range) {
  const value = Date.parse(range.updated_at || "");
  return Number.isFinite(value) ? value : 0;
}

export function speechAttributionForSegment(ranges, start, end) {
  const segmentStart = Number(start);
  const segmentEnd = Number(end);
  if (!Number.isFinite(segmentStart) || !Number.isFinite(segmentEnd) || segmentEnd <= segmentStart) return null;
  const candidates = normalizeSpeechAttributionRanges(ranges)
    .filter((range) => range.start <= segmentStart && range.end >= segmentEnd)
    .sort((a, b) => {
      const spanDifference = (a.end - a.start) - (b.end - b.start);
      if (spanDifference) return spanDifference;
      return updatedTime(b) - updatedTime(a);
    });
  return candidates[0] || null;
}

export function speechAttributionPreview(range = {}) {
  const normalized = normalizeSpeechAttributionRange(range);
  if (!normalized) return null;
  const contract = speechAttributionContract(normalized.classification);
  return {
    label: "Speech attribution",
    classification: normalized.classification,
    classificationLabel: contract.label,
    selectedText: normalized.text,
    accessibleText: [
      `Speech attribution: ${contract.label}.`,
      normalized.text ? `Selected text: ${normalized.text}.` : "",
      contract.tip,
      "This is your private annotation, not an attribution asserted by the app.",
    ].filter(Boolean).join(" "),
  };
}

export function interpretationPreview(record = {}) {
  const saved = String(record.rendering || "").trim();
  if (!saved) return null;
  const original = String(record.original || record.target?.token?.original || "").trim();
  const strongCode = String(record.strong_code || record.target?.token?.strong_code || "").trim().toUpperCase();
  return {
    label: "Interpretation",
    saved,
    original,
    strongCode: strongCode || null,
    accessibleText: [
      `Saved interpretation: ${saved}.`,
      original ? `Original source wording: ${original}.` : "",
      strongCode ? `Strong's ${strongCode}.` : "",
      "This is your saved alternative wording, not replacement Scripture text.",
    ].filter(Boolean).join(" "),
  };
}
