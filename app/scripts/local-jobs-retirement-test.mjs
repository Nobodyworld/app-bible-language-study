import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import * as stores from "../src/stores.js";
import { createMemoryUserStorageAdapter } from "../src/platform/browser-user-storage.js";
import { createSourceTokenTarget, createVerseTarget, deriveTagTargetIndex, deriveVerseTagsFromAssertions } from "../src/semantic-targets.js";

const adapter = createMemoryUserStorageAdapter();
stores.configureUserStorageAdapter(adapter);
const state = {};
const verse = createVerseTarget("john:1:1");
const token = createSourceTokenTarget("john:1:1", { token_index: 2, strong_code: "G3056", original: "λόγος" });
const indexes = (value) => {
  assert.deepEqual(value.tagStore.tag_target_index, deriveTagTargetIndex(value.tagStore.tag_assertions));
  assert.deepEqual(value.tagStore.verse_tags, deriveVerseTagsFromAssertions(value.tagStore.tag_assertions));
};
const jobs = (value) => [value.tagStore.job_events, value.workspaceStore.job_events];
stores.setTagAssertion(state, verse, "favorite", true);
stores.setTagAssertion(state, token, "inquiry", true, { note: "What does this mean?" });
stores.setTagAssertion(state, token, "inquiry", true, { note: "Revised question" });
const tag = stores.createCustomTag(state, { label: "Retirement fixture" });
stores.updateCustomTag(state, tag.id, { label: "Updated fixture" });
stores.setTagAssertion(state, verse, tag.id, true);
indexes(state);
stores.deleteCustomTag(state, tag.id);
stores.setTagAssertion(state, verse, "favorite", false);
indexes(state);
stores.setTagAssertion(state, verse, "favorite", true);
stores.setTokenRendering(state, token, "Word");
stores.setTokenRendering(state, token, "Logos");
stores.deleteTokenRendering(state, token);
stores.setTokenRendering(state, token, "Word");
stores.setVerseDraft(state, "john:1:1", "Preserved draft");
stores.addRedLetterRange(state, "john:1:1", { start: 0, end: 4, text: "Word" });
assert.deepEqual(jobs(state), [[], []]);
indexes(state);
const relaunched = {};
stores.ensureStores(relaunched);
indexes(relaunched);
assert.equal(stores.getTokenRendering(relaunched, token).rendering, "Word");
assert.equal(Object.values(relaunched.tagStore.tag_assertions).find((a) => a.tag_id === "tag:inquiry").note, "Revised question");

const fixture = stores.createUserDataExport(relaunched);
const statusOnly = stores.normalizeTagStore({ job_events: [{ id: "status-only", type: "legacy", status: "completed", result: { retained: true } }] });
assert.equal(statusOnly.job_events[0].state, "completed");
assert.deepEqual(statusOnly.job_events[0].result, { retained: true });
const states = ["queued", "planned", "running", "completed", "failed", "cancelled", "simulation_only"];
const history = Array.from({ length: 225 }, (_, index) => ({
  id: `legacy:${index}`, schema_version: 1, type: index % 2 ? "inquiry-analysis" : "unknown-legacy-processor",
  job_type: index % 2 ? "inquiry-analysis" : "unknown-legacy-processor",
  state: states[index % states.length], status: states[index % states.length],
  created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  payload: { target: token, nested: { values: [index, "historical input"] } },
  result: { processor: "historical", findings: [index], result_status: "current" },
  extension: { retained: true },
}));
fixture.stores.tags.job_events = structuredClone(history);
fixture.stores.workspace.job_events = structuredClone(history);
fixture.stores.workspace.available_job_types = ["historical-only"];
fixture.stores.packages.operations = [{ id: "package:history", action: "install", state: "completed" }];
for (const mode of ["merge", "replace"]) {
  const target = {};
  stores.importUserData(target, fixture, mode);
  assert.deepEqual(jobs(target), [history, history]);
  indexes(target);
  assert.equal(stores.getTokenRendering(target, token).rendering, "Word");
  assert.equal(target.workspaceStore.verse_drafts["john:1:1"].draft_text, "Preserved draft");
  assert.deepEqual(target.workspaceStore.red_letter_ranges, fixture.stores.workspace.red_letter_ranges);
  assert.deepEqual(target.packageStore.operations, fixture.stores.packages.operations);
  const incoming = structuredClone(fixture);
  incoming.stores.tags.job_events = [{ ...history[0], result: { incoming: true } }, { ...history[0], id: "legacy:extra" }];
  stores.importUserData(target, incoming, "merge");
  assert.equal(target.tagStore.job_events.length, 226);
  assert.deepEqual(target.tagStore.job_events.find((j) => j.id === "legacy:0").result, { incoming: true });
  const before = structuredClone(jobs(target));
  stores.setTagAssertion(target, token, "inquiry", true, { note: "Post-import question" });
  stores.setTokenRendering(target, token, "Post-import meaning");
  stores.setVerseDraft(target, "john:1:1", "Post-import draft");
  assert.deepEqual(jobs(target), before, "Study saves must not execute or stale historical results");
  const exported = stores.createUserDataExport(target);
  assert.equal(exported.version, 3);
  assert.deepEqual([exported.stores.tags.job_events, exported.stores.workspace.job_events], before);
  for (const malformed of [null, { ...fixture, stores: [] }, { ...fixture, version: 99 },
    { ...fixture, stores: { tags: { job_events: {} } } },
    { ...fixture, stores: { workspace: { job_events: [{ id: "missing-type" }] } } }]) {
    const prior = structuredClone(target);
    const backups = adapter.readCurrent("importBackups", {});
    assert.throws(() => stores.importUserData(target, malformed, mode));
    assert.deepEqual(target, prior);
    assert.deepEqual(adapter.readCurrent("importBackups", {}), backups);
  }
  const recoverable = stores.createUserDataExport(target);
  stores.importUserData(target, { kind: fixture.kind, version: 3, stores: {} }, "replace");
  const backup = adapter.readCurrent("importBackups", {}).backups.at(-1).exported_user_data;
  assert.deepEqual(backup.stores, recoverable.stores);
  stores.importUserData(target, backup, "replace");
  assert.deepEqual(stores.createUserDataExport(target).stores, recoverable.stores);
}
for (const name of ["getAllJobEvents", "requestTagIndexRefresh", "updateJobStatus", "completeJob"]) {
  assert.equal(name in stores, false, `${name} must be retired`);
}
for (const path of ["../src/job-processor.js", "../src/views/jobs-view.js"]) {
  await assert.rejects(access(new URL(path, import.meta.url)), { code: "ENOENT" });
}
const view = await readFile(new URL("../src/views/user-data-view.js", import.meta.url), "utf8");
assert.doesNotMatch(view, /Local job console|Tag jobs|Workspace jobs|Refresh Study Marks index|renderJobsDiagnostics/);
console.log(JSON.stringify({ local_jobs_retirement: "PASS", history_records_per_store: 225, modes: ["merge", "replace"], direct_indexes: "PASS", recovery: "PASS" }));
