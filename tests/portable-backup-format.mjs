import assert from "node:assert/strict";
import { compactUserDataBackup } from "../app/src/portable-backup.js";

const fresh = () => ({ kind: "bibleapp:user-data", version: 3, exported_at: "2026-09-14T00:00:00Z", stores: {
  tags: { version: 4, tags: { favorite: { id: "favorite", on_apply_job_type: null } }, tag_assertions: {}, quarantined_records: [], job_events: [] },
  workspace: { version: 3, token_renderings: {}, verse_drafts: {}, job_events: [] },
  assertions: { version: 1, assertions: {}, events: [], quarantined_records: [] },
  polls: { version: 1, responses: {}, events: [], aggregates: {} },
  packages: { version: 1, installed_feature_pack_ids: [], installed_package_ids: [], disabled_feature_pack_ids: [], disabled_capability_ids: [], operations: [], physical_data_mode: "bundled_static_data", updated_at: null },
} });
const input = fresh();
const before = JSON.stringify(input);
const small = compactUserDataBackup(input);
assert.equal(JSON.stringify(input), before, "serialization must not mutate stores");
assert.equal(small.version, 3);
assert.equal(small.kind, input.kind);
assert.equal(small.exported_at, input.exported_at);
assert.equal(Object.hasOwn(small.stores, "polls"), false);
assert.equal(Object.hasOwn(small.stores, "packages"), false);
assert.equal(Object.hasOwn(small.stores.tags, "job_events"), false);
assert.equal(Object.hasOwn(small.stores.workspace, "job_events"), false);
assert.equal(Object.hasOwn(small.stores.tags.tags.favorite, "on_apply_job_type"), false);
assert.deepEqual(small.stores.assertions, input.stores.assertions);
assert.deepEqual(compactUserDataBackup(small), small, "serialization is idempotent");
for (const name of ["tags", "workspace"]) {
  const populated = fresh();
  populated.stores[name].job_events = [{ id: "historic:1", type: "completed", detail: "preserve" }];
  assert.deepEqual(compactUserDataBackup(populated).stores[name].job_events, populated.stores[name].job_events);
}
for (const [key, value] of [["responses", { saved: { note: "preserve" } }], ["events", [{ id: "event:1" }]], ["aggregates", { historical: 1 }], ["unknown", "preserve"], ["version", 2], ["events", null]]) {
  const populated = fresh(); populated.stores.polls[key] = value;
  assert.deepEqual(compactUserDataBackup(populated).stores.polls, populated.stores.polls, `preserve poll ${key}`);
}
for (const [key, value] of [["physical_data_mode", "managed_cache_packs"], ["operations", [{ id: "op:1" }]], ["disabled_capability_ids", ["search"]], ["installed_package_ids", ["pack:1"]], ["updated_at", "2026-01-01"], ["unknown", true], ["version", 2]]) {
  const populated = fresh(); populated.stores.packages[key] = value;
  assert.deepEqual(compactUserDataBackup(populated).stores.packages, populated.stores.packages, `preserve package ${key}`);
}
const historic = fresh();
historic.stores.tags.tags.favorite.on_apply_job_type = "legacy-job";
historic.stores.tags.quarantined_records.push({ raw: "retain" });
historic.stores.workspace.token_renderings = { "john:1:1": { 2: { rendering: "origin" } } };
historic.stores.workspace.verse_drafts = { "john:1:1": { draft_text: "retain" } };
const retained = compactUserDataBackup(historic);
assert.equal(retained.stores.tags.tags.favorite.on_apply_job_type, "legacy-job");
assert.deepEqual(retained.stores.tags.quarantined_records, historic.stores.tags.quarantined_records);
assert.deepEqual(retained.stores.workspace.token_renderings, historic.stores.workspace.token_renderings);
assert.deepEqual(retained.stores.workspace.verse_drafts, historic.stores.workspace.verse_drafts);
for (const version of [1, 2, 4]) {
  const other = fresh(); other.version = version;
  assert.deepEqual(compactUserDataBackup(other), other, "other versions are not rewritten");
}
console.log("PASS: portable backup serialization (empty defaults omitted, populated/unknown records preserved)");
