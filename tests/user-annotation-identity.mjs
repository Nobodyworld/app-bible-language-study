import assert from "node:assert/strict";
import {
  applySpeechAttributionRange, changeSpeechAttributionRange, clearSpeechAttribution,
  configureUserStorageAdapter, createUserDataBackup, createUserDataExport,
  deleteTokenRendering, getSpeechAttributionRanges, getTokenRendering,
  getTokenRenderings, getUserDataSummary, importUserData, initStores, normalizeTokenRendering, setTokenRendering,
} from "../app/src/stores.js";
import { createMemoryUserStorageAdapter } from "../app/src/platform/browser-user-storage.js";
import { createSourceTokenTarget } from "../app/src/semantic-targets.js";
import { annotationPassageCorresponds, annotationRecordsNeedingReview, interpretationRecordsAt, mergeInterpretationCollections, otherTranslationAnnotations } from "../app/src/annotation-records.js";
import { normalizeSpeechAttributionRange } from "../app/src/user-annotation-contracts.js";

const key = "john:1:1";
const source = { token_index: 2, original: "λόγος", strong_code: "G3056", language: "greek" };
const bsb = createSourceTokenTarget(key, source, "bsb");
const kjv = createSourceTokenTarget(key, source, "kjv");
const changed = createSourceTokenTarget(key, { ...source, original: "ἄλλος" }, "bsb");
const speech = translation_id => ({ translation_id, reference_key: key, start: 0, end: 2, text: "In" });
const fresh = () => { configureUserStorageAdapter(createMemoryUserStorageAdapter()); return { translationId: "bsb" }; };
const cases = [];
async function check(name, run) {
  try { await run(); cases.push({ name, status: "PASS" }); }
  catch (error) { cases.push({ name, status: "FAIL", message: error.message }); }
}

await check("Independent exact targets, source guard, foreign delete and counts", () => {
  const state = fresh();
  setTokenRendering(state, bsb, "BSB alternative");
  assert.equal(deleteTokenRendering(state, kjv), false);
  assert.equal(setTokenRendering(state, changed, "changed source"), null);
  assert.equal(deleteTokenRendering(state, changed), false);
  setTokenRendering(state, kjv, "KJV alternative");
  assert.equal(getTokenRendering(state, bsb).rendering, "BSB alternative");
  assert.equal(getTokenRendering(state, kjv).rendering, "KJV alternative");
  assert.equal(Object.keys(getTokenRenderings(state, key, "bsb")).length, 1);
  assert.deepEqual(getTokenRenderings(state, key, "???"), {});
  assert.equal(getUserDataSummary(state).token_renderings, 2);
  deleteTokenRendering(state, bsb);
  assert.equal(getTokenRendering(state, kjv).rendering, "KJV alternative");
});

await check("Speech translation and text anchors isolate change, clear and rendering", () => {
  const state = fresh();
  assert(applySpeechAttributionRange(state, key, speech("bsb"), "red"));
  assert.equal(clearSpeechAttribution(state, key, speech("kjv")), false);
  assert.equal(changeSpeechAttributionRange(state, key, speech("kjv"), "black"), false);
  assert(applySpeechAttributionRange(state, key, speech("kjv"), "pink"));
  assert.equal(getSpeechAttributionRanges(state, key, "bsb", "In the beginning")[0].classification, "red");
  assert.equal(getSpeechAttributionRanges(state, key, "kjv", "In the beginning")[0].classification, "pink");
  assert.deepEqual(getSpeechAttributionRanges(state, key, "bsb", "At the beginning"), []);
  assert.deepEqual(getSpeechAttributionRanges(state, key, "???", "In the beginning"), []);
  assert.equal(clearSpeechAttribution(state, key, { ...speech("bsb"), text: "At" }), false);
  assert.equal(changeSpeechAttributionRange(state, key, { ...speech("bsb"), edition_id: "kjv" }, "gray"), false);
  assert(clearSpeechAttribution(state, key, speech("kjv")));
  assert.equal(getSpeechAttributionRanges(state, key, "bsb").length, 1);
});

await check("Raw unknown/conflicting metadata and opaque values survive idempotent imports", () => {
  const state = fresh();
  const payload = createUserDataExport(state);
  const unscoped = { rendering: "unknown origin", original: "λόγος", extension: { keep: true } };
  const conflict = { rendering: "conflict", translation_id: "kjv", target: bsb };
  payload.stores.workspace.token_renderings[key] = { 2: unscoped, 3: conflict, strange: [null, "future"] };
  payload.stores.workspace.red_letter_ranges[key] = [
    { start: 0, end: 2, text: "In", unknown: true },
    { ...speech("bsb"), edition_id: "kjv" },
    { ...speech("bsb"), classification: "future" }, null,
  ];
  importUserData(state, payload, "replace");
  assert.equal(getTokenRendering(state, bsb), null);
  assert.equal(getUserDataSummary(state).token_renderings, 0);
  assert.deepEqual(otherTranslationAnnotations(state.workspaceStore, key, "kjv", normalizeSpeechAttributionRange), []);
  const first = createUserDataExport(state).stores;
  for (let i = 0; i < 3; i++) importUserData(state, payload, "merge");
  assert.deepEqual(createUserDataExport(state).stores, first);
  const values = Object.values(state.workspaceStore.token_renderings[key]);
  assert(values.some(value => JSON.stringify(value) === JSON.stringify(unscoped)));
  assert(values.some(value => JSON.stringify(value) === JSON.stringify(conflict)));
});

await check("The collection layer rejects raw missing identity before a defaulting normalizer", () => {
  const collection = mergeInterpretationCollections({}, { [key]: { 2: { rendering: "unknown" } } }, value => ({
    ...value, target: bsb, target_id: bsb.target_id, translation_id: "bsb", reference_key: key,
  }));
  assert.deepEqual(interpretationRecordsAt(collection, key), []);
  assert.deepEqual(interpretationRecordsAt({ [key]: { [bsb.target_id]: { target_id: bsb.target_id, reference_key: key, translation_id: "bsb" } } }, key, "???"), []);
});

await check("Reload, merge, replace and recovery retain both translations and extra fields", async () => {
  const state = fresh();
  const adapter = createMemoryUserStorageAdapter();
  await initStores(state, adapter);
  for (const target of [bsb, kjv]) {
    setTokenRendering(state, target, target.translation_id);
    applySpeechAttributionRange(state, key, { ...speech(target.translation_id), extra: [1, 2] }, "red");
  }
  const restarted = { translationId: "kjv" };
  await initStores(restarted, adapter);
  const snapshot = createUserDataExport(restarted);
  for (const mode of ["merge", "replace"]) {
    importUserData(restarted, snapshot, mode);
    assert.equal(getTokenRendering(restarted, bsb).rendering, "bsb");
    assert.equal(getTokenRendering(restarted, kjv).rendering, "kjv");
    assert.equal(getSpeechAttributionRanges(restarted, key, "bsb").length, 1);
    assert.equal(getSpeechAttributionRanges(restarted, key, "kjv").length, 1);
  }
  const backup = createUserDataBackup(restarted);
  deleteTokenRendering(restarted, bsb);
  clearSpeechAttribution(restarted, key, speech("bsb"));
  importUserData(restarted, backup.exported_user_data, "replace");
  assert.deepEqual(createUserDataExport(restarted).stores, snapshot.stores);
});

await check("A rejected complete merge candidate leaves stores and recovery snapshots unchanged", () => {
  const state = fresh();
  setTokenRendering(state, bsb, "retain");
  applySpeechAttributionRange(state, key, speech("bsb"), "red");
  const before = createUserDataExport(state).stores;
  const backups = getUserDataSummary(state).import_backups;
  const payload = createUserDataExport(state);
  payload.stores.tags.tags.injected = { id: "injected", label: "Incoming", custom: true };
  payload.stores.workspace.red_letter_ranges[key] = { opaque: "conflicting shape" };
  assert.throws(() => importUserData(state, payload, "merge"), /no (?:local data|records) (?:was|were) changed/i);
  assert.deepEqual(createUserDataExport(state).stores, before);
  assert.equal(getUserDataSummary(state).import_backups, backups);
});

await check("Conflicting exact keys stay opaque and unknown nested fields survive editing and merge", () => {
  const state = fresh();
  const payload = createUserDataExport(state);
  const saved = {
    rendering: "retained", translation_id: "bsb", target: { ...bsb, extra: { keep: 1 }, token: { ...bsb.token, future: [1] } },
    target_id: bsb.target_id, extension: [1], updated_at: "2026-01-01T00:00:00Z",
  };
  payload.stores.workspace.token_renderings[key] = { [bsb.target_id]: saved };
  importUserData(state, payload, "replace");
  setTokenRendering(state, bsb, "updated");
  assert.deepEqual(getTokenRendering(state, bsb).target.extra, { keep: 1 });
  assert.deepEqual(getTokenRendering(state, bsb).target.token.future, [1]);
  assert.deepEqual(getTokenRendering(state, bsb).extension, [1]);
  importUserData(state, payload, "merge");
  assert.equal(getTokenRendering(state, bsb).rendering, "updated");
  for (const record of [
    { ...saved, target_id: kjv.target_id },
    { ...saved, target: { ...bsb, target_id: kjv.target_id } },
    { ...saved, original: "different source" },
    { ...saved, token_index: 3 },
    { ...saved, reference_key: "john:1:2" },
  ]) {
    const result = mergeInterpretationCollections({}, { [key]: { [bsb.target_id]: record } }, normalizeTokenRendering);
    assert.deepEqual(interpretationRecordsAt(result, key), []);
    assert.deepEqual(Object.values(result[key]), [record]);
  }
});

await check("Opaque collection shapes are idempotent or reject atomically in both merge directions", () => {
  for (const field of ["token_renderings", "red_letter_ranges"]) {
    for (const opaque of [null, "future", { future: true }]) {
      if (field === "token_renderings" && typeof opaque === "object" && opaque) continue;
      const state = fresh();
      const backup = createUserDataExport(state);
      backup.stores.workspace[field][key] = opaque;
      importUserData(state, backup, "replace");
      const before = createUserDataExport(state);
      importUserData(state, backup, "merge");
      assert.deepEqual(createUserDataExport(state).stores, before.stores);
      const canonical = fresh();
      setTokenRendering(canonical, bsb, "canonical");
      applySpeechAttributionRange(canonical, key, speech("bsb"), "red");
      const valid = createUserDataExport(canonical);
      assert.throws(() => importUserData(state, valid, "merge"), /No local data was changed/);
      assert.deepEqual(createUserDataExport(state).stores, before.stores);
      const canonicalBefore = createUserDataExport(canonical).stores;
      assert.throws(() => importUserData(canonical, backup, "merge"), /No local data was changed/);
      assert.deepEqual(createUserDataExport(canonical).stores, canonicalBefore);
    }
  }
});

await check("Discovery uses catalog passage correspondence and rejects unknown or different schemes", () => {
  const manifest = { translations: [{ id: "bsb" }, { id: "kjv" }, { id: "different", versification: "different" }] };
  assert(annotationPassageCorresponds(manifest, "bsb", "kjv"));
  assert.equal(annotationPassageCorresponds(manifest, "bsb", "missing"), false);
  assert.equal(annotationPassageCorresponds(manifest, "bsb", "different"), false);
  assert.equal(annotationPassageCorresponds(manifest, "???", "kjv"), false);
  const state = fresh();
  setTokenRendering(state, createSourceTokenTarget(key, source, "missing"), "missing source wording");
  state.workspaceStore.token_renderings[key]["@preserved:2"] = { rendering: "unknown wording" };
  const before = JSON.stringify(state.workspaceStore);
  const review = annotationRecordsNeedingReview(state.workspaceStore, manifest, "bsb", normalizeSpeechAttributionRange);
  assert.equal(review.length, 2);
  assert(review.some(item => item.translation_id === "" && item.reason.includes("not recorded")));
  assert(review.some(item => item.translation_id === "missing" && item.reason.includes("unavailable")));
  assert.equal(JSON.stringify(state.workspaceStore), before, "discovery is read-only");
});

await check("Explicit edits survive an imported future timestamp and reimport of the older revision", () => {
  const state = fresh();
  setTokenRendering(state, bsb, "old wording");
  applySpeechAttributionRange(state, key, speech("bsb"), "red");
  const backup = createUserDataExport(state);
  backup.stores.workspace.token_renderings[key][bsb.target_id].updated_at = "2099-01-01T00:00:00Z";
  backup.stores.workspace.red_letter_ranges[key][0].updated_at = "2099-01-01T00:00:00Z";
  importUserData(state, backup, "replace");
  changeSpeechAttributionRange(state, key, speech("bsb"), "gray");
  setTokenRendering(state, bsb, "new wording");
  assert.equal(getSpeechAttributionRanges(state, key)[0].classification, "gray");
  importUserData(state, backup, "merge");
  assert.equal(getSpeechAttributionRanges(state, key)[0].classification, "gray");
  assert.equal(getTokenRendering(state, bsb).rendering, "new wording");
});

await check("Distinct legacy token slots and non-string wording remain separate opaque records", () => {
  const state = fresh();
  const payload = createUserDataExport(state);
  const unscoped = { rendering: "same wording" };
  const malformed = { translation_id: "bsb", rendering: { future: "structured wording" } };
  payload.stores.workspace.token_renderings[key] = { 2: unscoped, 3: unscoped, 4: malformed };
  importUserData(state, payload, "replace");
  const first = createUserDataExport(state).stores;
  assert.equal(Object.keys(first.workspace.token_renderings[key]).length, 3);
  assert.equal(getUserDataSummary(state).token_renderings, 0);
  assert.deepEqual(Object.values(first.workspace.token_renderings[key]), [unscoped, unscoped, malformed]);
  for (let i = 0; i < 3; i++) importUserData(state, payload, "merge");
  assert.deepEqual(createUserDataExport(state).stores, first);
});

console.log(JSON.stringify({ annotation_identity: cases }, null, 2));
assert.equal(cases.filter(test => test.status === "FAIL").length, 0, "annotation identity regressions");
