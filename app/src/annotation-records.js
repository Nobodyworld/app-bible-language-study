// Collection identity for the existing workspace annotation stores. No second
// persistence layer: indexes and discovery results are always derived records.
const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
export const recordObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const copy = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const put = (object, key, value) => Object.defineProperty(object, key, {
  value, enumerable: true, configurable: true, writable: true,
});

export function annotationTranslationId(value) {
  if (typeof value !== "string") return "";
  const id = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]*$/.test(id)
    && !["__proto__", "prototype", "constructor"].includes(id) ? id : "";
}

// Conflicting metadata is not an invitation to choose the active translation.
export function explicitAnnotationTranslation(record) {
  if (!recordObject(record)) return "";
  const values = [record.translation_id, record.edition_id,
    record.target?.translation_id, record.target?.edition_id].filter(value => value !== undefined);
  if (!values.length) return "";
  const ids = values.map(annotationTranslationId);
  return ids.every(id => id && id === ids[0]) ? ids[0] : "";
}

export function sameInterpretationSource(left, right) {
  const leftId = left?.target_id || left?.target?.target_id;
  const rightId = right?.target_id || right?.target?.target_id;
  if (!leftId || leftId !== rightId) return false;
  for (const field of ["strong_code", "original", "language"]) {
    const a = left?.[field] || left?.token?.[field] || left?.target?.token?.[field];
    const b = right?.[field] || right?.token?.[field] || right?.target?.token?.[field];
    if (a && b && String(a) !== String(b)) return false;
  }
  return true;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!recordObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}
const signature = value => JSON.stringify(stableValue(value));

function retainOpaque(bucket, key, record) {
  // Opaque entries never masquerade as canonical target IDs. Retain exact bytes
  // of the JSON value, including unknown fields, without duplicate imports.
  const serialized = signature(record);
  if (Object.entries(bucket).some(([name, value]) => name.startsWith("@preserved:") && signature(value) === serialized)) return;
  let suffix = 0;
  let name = `@preserved:${key}`;
  while (own(bucket, name)) name = `@preserved:${key}:${++suffix}`;
  put(bucket, name, copy(record));
}

function newerRecord(previous, incoming) {
  const a = Date.parse(previous?.updated_at || "");
  const b = Date.parse(incoming?.updated_at || "");
  if (Number.isFinite(a) && (!Number.isFinite(b) || a > b)) return { ...incoming, ...previous };
  if (a === b && Number(previous?.revision || 0) > Number(incoming?.revision || 0)) return { ...incoming, ...previous };
  return { ...previous, ...incoming };
}

export function mergeInterpretationCollections(current, incoming, normalizeRecord) {
  if (typeof normalizeRecord !== "function") throw new TypeError("An interpretation normalizer is required.");
  const result = {};
  for (const collection of [current, incoming]) {
    if (collection === undefined || collection === null) continue;
    if (!recordObject(collection)) throw new TypeError("token_renderings must be an object; no records were changed.");
    for (const [reference, entries] of Object.entries(collection)) {
      if (!recordObject(entries)) {
        if (own(result, reference) && signature(result[reference]) !== signature(entries)) {
          throw new TypeError(`Cannot merge opaque interpretations for ${reference}; no records were changed.`);
        }
        put(result, reference, copy(entries));
        continue;
      }
      if (own(result, reference) && !recordObject(result[reference])) {
        throw new TypeError(`Cannot replace opaque interpretations for ${reference}; no records were changed.`);
      }
      const bucket = own(result, reference) ? result[reference] : {};
      for (const [key, value] of Object.entries(entries)) {
        const record = !key.startsWith("@preserved:") ? normalizeRecord(value, {
          reference_key: reference,
          ...( /^[1-9]\d*$/.test(key) ? { token_index: Number(key) } : {} ),
        }) : null;
        if (!record || !explicitAnnotationTranslation(record) || !record.target_id) {
          retainOpaque(bucket, key.replace(/^@preserved:/, ""), value);
          continue;
        }
        const id = record.target_id;
        if (!own(bucket, id)) put(bucket, id, copy(record));
        else if (sameInterpretationSource(bucket[id], record)) put(bucket, id, newerRecord(bucket[id], record));
        else retainOpaque(bucket, id, record);
      }
      if (Object.keys(bucket).length) put(result, reference, bucket);
    }
  }
  return result;
}

export function interpretationRecordsAt(collection, reference, translationId = "") {
  const entries = collection?.[reference];
  if (!recordObject(entries)) return [];
  const translation = annotationTranslationId(translationId);
  return Object.entries(entries).filter(([key, value]) => !key.startsWith("@preserved:")
    && recordObject(value) && key === value.target_id
    && value.reference_key === reference && explicitAnnotationTranslation(value)
    && (!translation || explicitAnnotationTranslation(value) === translation))
    .map(([, value]) => value);
}

export function speechRangeIdentity(range, reference = range?.reference_key) {
  const translation = explicitAnnotationTranslation(range);
  if (!translation || !reference || (range.reference_key && range.reference_key !== reference)
    || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end)
    || range.start < 0 || range.end <= range.start || typeof range.text !== "string" || !range.text.length) return "";
  return JSON.stringify([translation, reference, range.start, range.end, range.text]);
}

export function speechRangeIsCurrent(range, reference, translationId, text) {
  return Boolean(speechRangeIdentity(range, reference))
    && explicitAnnotationTranslation(range) === annotationTranslationId(translationId)
    && typeof text === "string" && range.end <= text.length
    && text.slice(range.start, range.end) === range.text;
}

export function mergeSpeechCollections(current, incoming, normalizeRange) {
  const result = {};
  for (const collection of [current, incoming]) {
    if (collection === undefined || collection === null) continue;
    if (!recordObject(collection)) throw new TypeError("red_letter_ranges must be an object; no records were changed.");
    for (const [reference, values] of Object.entries(collection)) {
      if (!Array.isArray(values)) {
        if (own(result, reference) && signature(result[reference]) !== signature(values)) {
          throw new TypeError(`Cannot merge opaque speech annotations for ${reference}; no records were changed.`);
        }
        put(result, reference, copy(values));
        continue;
      }
      if (own(result, reference) && !Array.isArray(result[reference])) {
        throw new TypeError(`Cannot replace opaque speech annotations for ${reference}; no records were changed.`);
      }
      const exact = new Map();
      const opaque = new Map();
      for (const value of [...(result[reference] || []), ...values]) {
        const normalized = normalizeRange(value);
        const id = normalized && speechRangeIdentity(normalized, reference);
        if (!id) opaque.set(signature(value), copy(value));
        else {
          const next = { ...normalized, translation_id: explicitAnnotationTranslation(normalized), reference_key: reference };
          exact.set(id, exact.has(id) ? newerRecord(exact.get(id), next) : next);
        }
      }
      const sorted = [...exact].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, value]) => value);
      put(result, reference, [...sorted, ...opaque.values()]);
    }
  }
  return result;
}

export function otherTranslationAnnotations(workspace, reference, currentTranslation, normalizeRange) {
  const current = annotationTranslationId(currentTranslation);
  if (!current) return [];
  const found = new Map();
  for (const record of interpretationRecordsAt(workspace?.token_renderings, reference)) {
    const translation = explicitAnnotationTranslation(record);
    if (translation === current) continue;
    found.set(`interpretation:${record.target_id}`, {
      id: `interpretation:${record.target_id}`, kind: "interpretation",
      translation_id: translation, reference_key: reference, record: copy(record),
    });
  }
  const ranges = workspace?.red_letter_ranges?.[reference];
  for (const value of Array.isArray(ranges) ? ranges : []) {
    const range = normalizeRange(value);
    const id = range && speechRangeIdentity(range, reference);
    const translation = range && explicitAnnotationTranslation(range);
    if (!id || translation === current) continue;
    found.set(`speech:${id}`, {
      id: `speech:${id}`, kind: "speech-attribution", translation_id: translation,
      reference_key: reference, record: copy(range),
    });
  }
  return [...found.values()].sort((a, b) => a.translation_id.localeCompare(b.translation_id) || a.id.localeCompare(b.id));
}
