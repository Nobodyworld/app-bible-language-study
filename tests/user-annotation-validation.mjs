import assert from "node:assert/strict";
import {
  interpretationPreview,
  normalizeSpeechAttributionRange,
  normalizeSpeechAttributionRanges,
  speechAttributionContract,
  speechAttributionForSegment,
  speechAttributionPreview,
} from "../app/src/user-annotation-contracts.js";

let checks = 0;
const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const valid = { start: 0, end: 4, text: "Word", classification: "pink", revision: 2, extension: { keep: true } };
const before = structuredClone(valid);
equal(normalizeSpeechAttributionRange(valid), { ...valid, source: "user", updated_at: "" });
equal(valid, before, "normalization must not mutate the caller's record");
equal(normalizeSpeechAttributionRange({ start: "0", end: "4", text: "Word" })?.classification, "red", "legacy numeric strings remain supported");
equal(normalizeSpeechAttributionRange({ start: 0, end: 4 })?.classification, "red", "only a missing classification defaults to legacy red");
for (const classification of ["future-state", "__proto__", "constructor", "toString", "", null]) {
  equal(speechAttributionContract(classification), null);
  equal(normalizeSpeechAttributionRange({ ...valid, classification }), null, "unknown explicit classification must remain opaque, not become red");
  equal(speechAttributionPreview({ ...valid, classification }), null);
}
for (const range of [null, [], false, 1, "record", {}, { start: -1, end: 4 }, { start: 0.5, end: 4 }, { start: 0, end: 4.5 }, { start: null, end: 4 }, { start: "", end: 4 }, { start: false, end: 4 }, { start: 0, end: Number.MAX_SAFE_INTEGER + 1 }, { start: 4, end: 4 }, { start: 4, end: 3 }, { ...valid, revision: "invalid" }, { ...valid, revision: Infinity }]) {
  equal(normalizeSpeechAttributionRange(range), null, "malformed ranges cannot participate in rendering");
}
equal(normalizeSpeechAttributionRanges([null, valid, { ...valid, classification: "future-state" }]).length, 1);
equal(speechAttributionForSegment([valid], -1, 2), null);
equal(speechAttributionForSegment([valid], 0.5, 2), null);
equal(speechAttributionForSegment([valid], 0, 4)?.classification, "pink");
equal(interpretationPreview(null), null);
equal(interpretationPreview([]), null);
console.log(`PASS: annotation validation (${checks} checks)`);
