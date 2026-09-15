import assert from "node:assert/strict";
import { applySpeechAttributionRange, clearSpeechAttribution, configureUserStorageAdapter, createUserDataExport, getSpeechAttributionRanges, importUserData, setTokenRendering } from "../app/src/stores.js";
import { createMemoryUserStorageAdapter } from "../app/src/platform/browser-user-storage.js";
import { createSourceTokenTarget } from "../app/src/semantic-targets.js?v=pr13-live-qa-20260711e";
import { compactUserDataBackup } from "../app/src/portable-backup.js";

configureUserStorageAdapter(createMemoryUserStorageAdapter());
const source = {};
const target = createSourceTokenTarget({ translation_id: "bsb", book_id: "john", chapter: 1, verse: 1 }, { token_index: 2, original: "λόγος", strong_code: "G3056", language: "greek" }, "bsb");
assert.ok(target, "fixture needs an exact source-token identity");
assert.ok(setTokenRendering(source, target, "word"));
source.workspaceStore.extension = { retained: true };
source.workspaceStore.red_letter_ranges["john:1:1"] = [
  { start: 0, end: 2, text: "In", legacy: { retained: true } },
  ...["red", "pink", "gray", "black"].map((classification, index) => ({
    start: index * 5 + 3, end: index * 5 + 6, text: classification, classification,
    updated_at: "2026-01-02T00:00:00Z", extension: { classification },
  })),
  { future_record: { retained: true } },
];
// Normalize via the same v3 import path before comparing complete snapshots.
importUserData(source, createUserDataExport(source), "replace");
const full = createUserDataExport(source);
const compact = compactUserDataBackup(full);
assert.equal(Object.hasOwn(compact.stores, "polls"), false);
for (const mode of ["merge", "replace"]) {
  configureUserStorageAdapter(createMemoryUserStorageAdapter());
  const restored = {};
  importUserData(restored, compact, mode);
  assert.deepEqual(createUserDataExport(restored).stores, full.stores, `${mode} restores omitted defaults and saved token renderings`);
  assert.equal(getSpeechAttributionRanges(restored, "john:1:1")[0].classification, "red");
  assert.equal(getSpeechAttributionRanges(restored, "john:1:1").length, 5);
  const before = createUserDataExport(restored).stores;
  const malformed = JSON.parse(JSON.stringify(compact));
  malformed.stores.tags.job_events = [{}];
  assert.throws(() => importUserData(restored, malformed, mode), /No local data was changed/);
  assert.deepEqual(createUserDataExport(restored).stores, before, "malformed history is atomic");
}
configureUserStorageAdapter(createMemoryUserStorageAdapter());
const merged = {};
importUserData(merged, compact, "replace");
const incoming = structuredClone(compact);
incoming.stores.workspace.extra_backup_field = "retained";
incoming.stores.workspace.red_letter_ranges["john:1:1"] = [
  { start: 3, end: 6, classification: "black", updated_at: "2026-01-03T00:00:00Z", new_field: true },
  { start: 8, end: 11, classification: "gray", updated_at: "2026-01-01T00:00:00Z" },
  { start: 13, end: 16, classification: "pink", updated_at: "2026-01-02T00:00:00Z" },
  { start: 25, end: 29, classification: "gray", text: "new" },
];
importUserData(merged, incoming, "merge");
const ranges = getSpeechAttributionRanges(merged, "john:1:1");
assert.equal(ranges.length, 6, "incoming verse list must retain unrelated ranges");
assert.equal(ranges.find(r => r.start === 3).classification, "black", "newer record wins");
assert.equal(ranges.find(r => r.start === 8).classification, "pink", "older incoming record does not replace newer local data");
assert.equal(ranges.find(r => r.start === 13).classification, "pink", "incoming wins timestamp ties");
assert.deepEqual(ranges.find(r => r.start === 3).extension, { classification: "red" });
assert.equal(ranges.find(r => r.start === 3).new_field, true);
assert.deepEqual(merged.workspaceStore.extension, { retained: true });
assert.equal(merged.workspaceStore.extra_backup_field, "retained");
applySpeechAttributionRange(merged, "john:1:1", { start: 0, end: 2 }, "pink");
clearSpeechAttribution(merged, "john:1:1", { start: 25, end: 29 });
assert.deepEqual(merged.workspaceStore.red_letter_ranges["john:1:1"].at(-1), { future_record: { retained: true } }, "opaque historical records survive updates/clear");
const beforeReplace = createUserDataExport(merged);
importUserData(merged, compact, "replace");
assert.deepEqual(createUserDataExport(merged).stores, full.stores);
assert.equal(beforeReplace.stores.workspace.red_letter_ranges["john:1:1"][0].classification, "pink");
console.log("PASS: portable version-3 backup merge/replace round-trip and malformed-history rejection");
