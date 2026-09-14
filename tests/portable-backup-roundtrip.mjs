import assert from "node:assert/strict";
import { configureUserStorageAdapter, createUserDataExport, importUserData, setTokenRendering } from "../app/src/stores.js";
import { createMemoryUserStorageAdapter } from "../app/src/platform/browser-user-storage.js";
import { createSourceTokenTarget } from "../app/src/semantic-targets.js?v=pr13-live-qa-20260711e";
import { compactUserDataBackup } from "../app/src/portable-backup.js";

configureUserStorageAdapter(createMemoryUserStorageAdapter());
const source = {};
const target = createSourceTokenTarget({ translation_id: "bsb", book_id: "john", chapter: 1, verse: 1 }, { token_index: 2, original: "λόγος", strong_code: "G3056", language: "greek" }, "bsb");
assert.ok(target, "fixture needs an exact source-token identity");
assert.ok(setTokenRendering(source, target, "word"));
const full = createUserDataExport(source);
const compact = compactUserDataBackup(full);
assert.equal(Object.hasOwn(compact.stores, "polls"), false);
for (const mode of ["merge", "replace"]) {
  configureUserStorageAdapter(createMemoryUserStorageAdapter());
  const restored = {};
  importUserData(restored, compact, mode);
  assert.deepEqual(createUserDataExport(restored).stores, full.stores, `${mode} restores omitted defaults and saved token renderings`);
  const before = createUserDataExport(restored).stores;
  const malformed = JSON.parse(JSON.stringify(compact));
  malformed.stores.tags.job_events = [{}];
  assert.throws(() => importUserData(restored, malformed, mode), /No local data was changed/);
  assert.deepEqual(createUserDataExport(restored).stores, before, "malformed history is atomic");
}
console.log("PASS: portable version-3 backup merge/replace round-trip and malformed-history rejection");
