#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  SPEECH_ATTRIBUTION_IDS,
  SPEECH_ATTRIBUTION_LEVELS,
  clearSpeechAttributionRange,
  interpretationPreview,
  normalizeSpeechAttributionRange,
  normalizeSpeechAttributionRanges,
  speechAttributionContract,
  speechAttributionForSegment,
  upsertSpeechAttributionRange,
} from "../app/src/user-annotation-contracts.js";

assert.deepEqual(SPEECH_ATTRIBUTION_IDS, ["red", "pink", "gray", "black"]);
for (const id of SPEECH_ATTRIBUTION_IDS) {
  const contract = SPEECH_ATTRIBUTION_LEVELS[id];
  assert.equal(contract.id, id);
  assert.ok(contract.label);
  assert.ok(contract.compactLabel);
  assert.ok(contract.cssClass.startsWith("speech-attribution-"));
  assert.ok(contract.colorToken.startsWith("--speech-attribution-"));
  assert.match(contract.tip, /Your annotation:/);
}
assert.equal(speechAttributionContract(" PINK "), SPEECH_ATTRIBUTION_LEVELS.pink);
assert.equal(speechAttributionContract("unknown"), null);

const legacy = normalizeSpeechAttributionRange({ start: 2, end: 7, text: "Jesus", source: "user" });
assert.deepEqual(
  { start: legacy.start, end: legacy.end, text: legacy.text, classification: legacy.classification, source: legacy.source, revision: legacy.revision },
  { start: 2, end: 7, text: "Jesus", classification: "red", source: "user", revision: 1 },
  "legacy red-letter ranges must normalize losslessly as red user annotations",
);
assert.equal(normalizeSpeechAttributionRange({ start: 4, end: 4 }), null);

const initial = normalizeSpeechAttributionRanges([
  { start: 10, end: 20, text: "outer", classification: "gray", updated_at: "2026-01-01T00:00:00Z" },
  { start: 12, end: 18, text: "inner", classification: "pink", updated_at: "2026-01-02T00:00:00Z" },
]);
assert.equal(speechAttributionForSegment(initial, 13, 15)?.classification, "pink", "most-specific covering range must win");

const sameSize = normalizeSpeechAttributionRanges([
  { start: 10, end: 20, classification: "gray", updated_at: "2026-01-01T00:00:00Z" },
  { start: 10, end: 20, classification: "red", updated_at: "2026-01-03T00:00:00Z" },
]);
assert.equal(speechAttributionForSegment(sameSize, 12, 14)?.classification, "red", "newest exact-span record must win tie-breaking");

const updated = upsertSpeechAttributionRange(initial, {
  start: 12,
  end: 18,
  text: "inner",
  classification: "black",
  revision: 2,
  updated_at: "2026-01-04T00:00:00Z",
});
assert.equal(updated.filter((range) => range.start === 12 && range.end === 18).length, 1, "exact-range reclassification must not duplicate records");
assert.equal(updated.find((range) => range.start === 12 && range.end === 18)?.classification, "black");
assert.equal(clearSpeechAttributionRange(updated, { start: 12, end: 18 }).some((range) => range.start === 12 && range.end === 18), false);

const preview = interpretationPreview({
  rendering: "servant",
  original: "δοῦλος",
  strong_code: "g1401",
});
assert.equal(preview.label, "Interpretation");
assert.equal(preview.saved, "servant");
assert.equal(preview.original, "δοῦλος");
assert.equal(preview.strongCode, "G1401");
assert.match(preview.accessibleText, /Saved interpretation: servant/);
assert.match(preview.accessibleText, /Original source wording: δοῦλος/);
assert.match(preview.accessibleText, /not replacement Scripture text/);
assert.equal(interpretationPreview({}), null);

console.log(JSON.stringify({
  status: "ok",
  speech_attribution_levels: SPEECH_ATTRIBUTION_IDS.length,
  legacy_red_letter_migration_contract: "PASS",
  overlap_resolution_contract: "PASS",
  interpretation_preview_contract: "PASS",
}, null, 2));
