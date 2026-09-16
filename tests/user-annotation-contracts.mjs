#!/usr/bin/env node

import "./user-annotation-validation.mjs";
import "./user-annotation-identity.mjs";
import assert from "node:assert/strict";
import {
  addRedLetterRange, applySpeechAttributionRange, changeSpeechAttributionRange,
  clearSpeechAttribution, configureUserStorageAdapter, createUserDataExport,
  getSpeechAttributionRanges, getTokenRendering, importUserData, initStores, setTokenRendering,
} from "../app/src/stores.js";
import { createBrowserUserStorageAdapter, createMemoryUserStorageAdapter } from "../app/src/platform/browser-user-storage.js";
import { createTauriUserStorageAdapter } from "../app/src/platform/tauri-user-storage.js";
import { createSourceTokenTarget } from "../app/src/semantic-targets.js";
import {
  SPEECH_ATTRIBUTION_IDS,
  SPEECH_ATTRIBUTION_LEVELS,
  clearSpeechAttributionRange,
  interpretationPreview,
  normalizeSpeechAttributionRange,
  normalizeSpeechAttributionRanges,
  speechAttributionContract,
  speechAttributionForSegment,
  speechAttributionPreview,
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

const attributionPreview = speechAttributionPreview({
  start: 2,
  end: 7,
  text: "Jesus",
  classification: "pink",
});
assert.equal(attributionPreview.label, "Speech attribution");
assert.equal(attributionPreview.classification, "pink");
assert.equal(attributionPreview.classificationLabel, "Possibly attributed");
assert.match(attributionPreview.accessibleText, /Selected text: Jesus/);
assert.match(attributionPreview.accessibleText, /private annotation/);
assert.equal(speechAttributionPreview({ start: 1, end: 1 }), null);

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

configureUserStorageAdapter(createMemoryUserStorageAdapter());
const state = { translationId: "bsb" };
const key = "john:1:1";
assert.equal(addRedLetterRange(state, key, { start: 0, end: 12, text: "In the beginning", historical: { keep: true } }), true);
for (const id of SPEECH_ATTRIBUTION_IDS) {
  assert.equal(changeSpeechAttributionRange(state, key, { start: 0, end: 12, text: "In the beginning" }, id), true);
  const ranges = getSpeechAttributionRanges(state, key);
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].classification, id);
  assert.deepEqual(ranges[0].historical, { keep: true });
  assert.equal(ranges[0].text, "In the beginning");
}
assert.equal(changeSpeechAttributionRange(state, key, { start: 12, end: 15 }, "pink"), false);
assert.equal(applySpeechAttributionRange(state, key, { start: 3, end: 6, text: "the" }, "pink"), true);
assert.equal(speechAttributionForSegment(getSpeechAttributionRanges(state, key), 3, 6).classification, "pink");
assert.equal(clearSpeechAttribution(state, key, { start: 3, end: 6, text: "the" }), true);
assert.equal(getSpeechAttributionRanges(state, key).length, 1, "clear must preserve neighboring ranges");
assert.equal(clearSpeechAttribution(state, key, { start: 3, end: 6 }), false);
assert.equal(applySpeechAttributionRange(state, key, { start: 5, end: 4 }, "gray"), false);
assert.equal(applySpeechAttributionRange(state, key, { start: 3, end: 6 }, "invalid"), false);

const token = { token_index: 2, original: "λόγος", strong_code: "G3056" };
const target = createSourceTokenTarget(key, token, "bsb");
setTokenRendering(state, target, "word");
assert.equal(getTokenRendering(state, createSourceTokenTarget(key, token, "kjv")), null, "same numeric index in another translation is not the saved source token");
assert.equal(getTokenRendering(state, createSourceTokenTarget(key, { ...token, token_index: 3 }, "bsb")), null);
assert.equal(getTokenRendering(state, createSourceTokenTarget(key, { ...token, strong_code: "G746" }, "bsb")), null, "a changed source token must not inherit the old interpretation");

// Real browser/native adapter code against isolated backing stores. The native
// command harness proves adapter serialization/restart, not a WebView launch.
const localValues = new Map();
const localStorage = {
  getItem: key => localValues.get(key) ?? null,
  setItem: (key, value) => localValues.set(key, String(value)),
  removeItem: key => localValues.delete(key),
};
const nativeValues = new Map();
function adapterFor(backend, profileId) {
  if (backend === "browser") return createBrowserUserStorageAdapter({ profileId, localStorage });
  return createTauriUserStorageAdapter({ profileId, bridge: { async invoke(command, args = {}) {
    const key = `${profileId}:${args.storeId}`;
    if (command === "read_user_store") return nativeValues.has(key)
      ? { status: "ok", value: structuredClone(nativeValues.get(key)) } : { status: "missing" };
    if (command === "write_user_store") { nativeValues.set(key, structuredClone(args.value)); return { status: "saved" }; }
    if (command === "native_flush_status") return { status: "flushed", pendingWrites: 0, profileId };
    throw new Error(`Unexpected command ${command}`);
  } } });
}
for (const backend of ["browser", "native"]) {
  for (const profile of ["stable", "lab"]) {
    const adapter = adapterFor(backend, profile);
    const fresh = { translationId: "bsb" };
    await initStores(fresh, adapter);
    assert.equal(getSpeechAttributionRanges(fresh, key).length, 0, `${backend}/${profile} starts isolated`);
    for (const [index, classification] of SPEECH_ATTRIBUTION_IDS.entries()) {
      applySpeechAttributionRange(fresh, key, { start: index * 3, end: index * 3 + 2, text: profile }, classification);
    }
    setTokenRendering(fresh, target, profile);
    if (backend === "native") await adapter.flush();
    const restarted = { translationId: "bsb" };
    await initStores(restarted, adapterFor(backend, profile));
    assert.deepEqual(getSpeechAttributionRanges(restarted, key), getSpeechAttributionRanges(fresh, key));
    assert.equal(getTokenRendering(restarted, target).rendering, profile);
    const backup = createUserDataExport(restarted);
    assert.equal(backup.version, 3);
    for (const mode of ["merge", "replace"]) {
      importUserData(restarted, backup, mode);
      assert.deepEqual(getSpeechAttributionRanges(restarted, key), getSpeechAttributionRanges(fresh, key));
    }
  }
  const stableAgain = {};
  await initStores(stableAgain, adapterFor(backend, "stable"));
  assert.equal(getTokenRendering(stableAgain, target).rendering, "stable", "Lab writes must never change Stable");
}

console.log(JSON.stringify({
  status: "ok",
  speech_attribution_levels: SPEECH_ATTRIBUTION_IDS.length,
  legacy_red_letter_migration_contract: "PASS",
  overlap_resolution_contract: "PASS",
  speech_attribution_preview_contract: "PASS",
  interpretation_preview_contract: "PASS",
  apply_change_clear_unknown_fields: "PASS",
  browser_and_native_adapter_restart_and_profile_isolation: "PASS",
}, null, 2));
