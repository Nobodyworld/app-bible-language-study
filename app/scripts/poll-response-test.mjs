#!/usr/bin/env node

import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import * as polls from "../src/semantic-polls.js";
import * as stores from "../src/stores.js";
import { createMemoryUserStorageAdapter } from "../src/platform/browser-user-storage.js";
import { createSourceTokenTarget, createVerseTarget } from "../src/semantic-targets.js";
import { assertValidJsonSchema } from "./schema-validation.mjs";
import { historicalPollStore, historicalPropositions } from "../../tests/fixtures/legacy-polls.mjs";

const fixture = historicalPollStore();
const schema = JSON.parse(await readFile(new URL("../schemas/poll-response.schema.json", import.meta.url), "utf8"));
assert.equal(historicalPropositions.length, 3);
for (const record of Object.values(fixture.responses)) assertValidJsonSchema(record, schema);
assert.throws(() => assertValidJsonSchema({ ...Object.values(fixture.responses)[0], status: "invalid" }, schema));
assert.throws(() => assertValidJsonSchema({ ...Object.values(fixture.responses)[0], proposition_version: 0 }, schema));
assert.deepEqual(Object.keys(polls).sort(), ["aggregatePollResponses", "normalizePollResponse"]);
for (const name of ["setPollResponse", "deletePollResponse"]) assert.equal(name in stores, false);
await assert.rejects(access(new URL("../data/semantic/interpretation-propositions.json", import.meta.url)), { code: "ENOENT" });
const manifest = JSON.parse(await readFile(new URL("../data/semantic/manifest.json", import.meta.url), "utf8"));
assert.deepEqual(Object.keys(manifest.files).sort(), ["tag_definitions", "tag_relations"]);
assert.deepEqual(Object.keys(manifest.counts).sort(), ["tag_definitions", "tag_relations"]);
assert.doesNotMatch(await readFile(new URL("../src/views/user-data-view.js", import.meta.url), "utf8"), /poll/i);

function assertPreserved(actual, expected = fixture) {
  assert.deepEqual(actual.responses, expected.responses);
  assert.deepEqual(actual.events, expected.events);
  assert.deepEqual(actual.extension, expected.extension);
  assert.equal(actual.version, 1);
  assert.equal("obsolete" in actual.aggregates, false, "Stored aggregate caches are always rebuilt");
}

const adapter = createMemoryUserStorageAdapter({ polls: fixture });
const writes = [];
const save = adapter.save.bind(adapter);
adapter.save = (name, value) => { writes.push(name); return save(name, value); };
const state = {};
await stores.initStores(state, adapter);
assertPreserved(state.pollStore);
assert.deepEqual(adapter.readCurrent("polls"), fixture, "Startup must not rewrite the historical store");
assert.equal(writes.includes("polls"), false);
assert.equal(Object.keys(state.pollStore.aggregates).length, 4);
assert.equal(state.pollStore.aggregates[`${historicalPropositions[0].id}@v1`], undefined, "Tombstones do not contribute");
assert.equal(state.pollStore.aggregates[`${historicalPropositions[1].id}@v1`].responses.agree, 1);
assert.equal(state.pollStore.aggregates[`${historicalPropositions[1].id}@v2`].responses.uncertain, 1);
assert.equal(state.pollStore.aggregates["proposition:unlisted-proposition@v7"].responses.qualified_assent, 1);
for (const answer of ["constructor", "__proto__", "toString"]) {
  const record = { ...Object.values(fixture.responses)[1], response: answer };
  const counts = polls.aggregatePollResponses({ first: record, second: { ...record, id: "poll-response:another-actor" } })[`${record.proposition_id}@v1`].responses;
  assert.equal(Object.hasOwn(counts, answer), true);
  assert.equal(counts[answer], 2, "Any historical answer must remain a numeric own-key count");
  assert.deepEqual(JSON.parse(JSON.stringify(counts)), { [answer]: 2 });
}

// Ordinary study actions and summaries must leave poll history and legacy jobs passive.
const token = createSourceTokenTarget("john:1:1", { token_index: 2, strong_code: "G3056", original: "λόγος" });
stores.setTagAssertion(state, createVerseTarget("john:1:1"), "favorite", true);
stores.setTagAssertion(state, token, "inquiry", true, { note: "Preserved inquiry" });
stores.setTokenRendering(state, token, "Preserved meaning");
stores.setVerseDraft(state, "john:1:1", "Preserved draft");
assert.equal(Object.keys(stores.getUserDataSummary(state)).some((key) => key.startsWith("poll_")), false);
assertPreserved(state.pollStore);
assert.equal(writes.includes("polls"), false);
assert.deepEqual([state.tagStore.job_events, state.workspaceStore.job_events], [[], []]);
const portable = stores.createUserDataExport(state);
assert.equal(portable.kind, "bibleapp:user-data");
assert.equal(portable.version, 3);
assertPreserved(portable.stores.polls);

for (const mode of ["merge", "replace"]) {
  const modeAdapter = createMemoryUserStorageAdapter();
  const target = {};
  await stores.initStores(target, modeAdapter);
  const imported = structuredClone(portable);
  stores.importUserData(target, imported, mode);
  assert.deepEqual(imported, portable, "Reading a backup must not mutate its input");
  assertPreserved(target.pollStore);
  const pollOnly = { kind: portable.kind, version: 3, stores: { polls: historicalPollStore() } };
  const id = Object.keys(fixture.responses)[1];
  pollOnly.stores.polls.responses = {
    [id]: { ...fixture.responses[id], status: "deleted", deleted_at: "2024-01-01T00:00:00.000Z", updated_at: "2024-01-01T00:00:00.000Z", deletion_policy: "tombstone" },
  };
  const replacementEvent = { ...fixture.events[0], extension: { incoming: true } };
  const extraEvent = { ...fixture.events.at(-1), id: "event:poll-response:extra" };
  pollOnly.stores.polls.events = [replacementEvent, extraEvent];
  pollOnly.stores.polls.extension = { incoming: true };
  pollOnly.stores.polls.incoming_extension = { preserved: true };
  target.pollStore.local_extension = { preserved: true };
  stores.importUserData(target, pollOnly, "merge");
  assert.deepEqual(target.pollStore.responses[id], pollOnly.stores.polls.responses[id], "Incoming duplicate IDs win, regardless of timestamps");
  assert.equal(Object.keys(target.pollStore.responses).length, 5, "Distinct versions and actors must survive");
  assert.deepEqual(target.pollStore.events, [replacementEvent, ...fixture.events.slice(1), extraEvent]);
  assert.equal(target.pollStore.events.length, 606, "No 200/500-event truncation");
  assert.deepEqual(target.pollStore.extension, { incoming: true });
  assert.deepEqual(target.pollStore.local_extension, { preserved: true });
  assert.deepEqual(target.pollStore.incoming_extension, { preserved: true });
  assert.equal(target.pollStore.aggregates[`${historicalPropositions[1].id}@v1`], undefined);
  assert.equal(stores.getTokenRendering(target, token).rendering, "Preserved meaning");
  assert.equal(target.workspaceStore.verse_drafts["john:1:1"].draft_text, "Preserved draft");
  assert.ok(Object.values(target.tagStore.tag_assertions).some((item) => item.note === "Preserved inquiry"));

  const beforeRepeat = stores.createUserDataExport(target).stores;
  stores.importUserData(target, pollOnly, "merge");
  assert.deepEqual(stores.createUserDataExport(target).stores, beforeRepeat, "Repeated merge is idempotent");
  const relaunched = {};
  await stores.initStores(relaunched, modeAdapter);
  assert.deepEqual(stores.createUserDataExport(relaunched).stores, beforeRepeat, "Relaunch preserves the entire portable store set");
  for (const malformed of [null, { ...portable, version: 99 }, { ...portable, stores: [] },
    ...[null, [], "invalid"].map((pollStore) => ({ ...portable, stores: { polls: pollStore } }))]) {
    const prior = structuredClone(relaunched);
    const backups = modeAdapter.readCurrent("importBackups", {});
    assert.throws(() => stores.importUserData(relaunched, malformed, mode));
    assert.deepEqual(relaunched, prior);
    assert.deepEqual(modeAdapter.readCurrent("importBackups", {}), backups, "Malformed imports cannot create a recovery snapshot");
    assert.deepEqual(modeAdapter.readCurrent("polls"), prior.pollStore);
  }
  const recoverable = stores.createUserDataExport(relaunched);
  stores.importUserData(relaunched, { kind: portable.kind, version: 3, stores: {} }, "replace");
  const recovery = modeAdapter.readCurrent("importBackups", {}).backups.at(-1).exported_user_data;
  assert.deepEqual(recovery.stores, recoverable.stores);
  stores.importUserData(relaunched, recovery, "replace");
  assert.deepEqual(stores.createUserDataExport(relaunched).stores, recoverable.stores);
}

// Preserve the existing record-filtering policy and sparse legacy defaults.
const sparse = { id: "poll-response:sparse", proposition_id: "proposition:never-packaged", response: "custom historical answer", created_at: "2020-01-01T00:00:00.000Z", extension: { retained: true } };
for (const mode of ["merge", "replace"]) {
  const target = {};
  await stores.initStores(target, createMemoryUserStorageAdapter());
  stores.importUserData(target, { kind: portable.kind, version: 3, stores: { polls: {
    responses: { sparse, missingIdentity: { response: "agree" }, invalid: null },
    events: [fixture.events[0], null, { id: "missing-response-id", event_type: "invalid" }],
  } } }, mode);
  assert.deepEqual(target.pollStore.responses[sparse.id], {
    ...sparse, schema_version: 1, proposition_version: 1,
    actor: { actor_type: "user", actor_id: "user:local" }, confidence: 1, status: "active",
    visibility: "private", viewed_aggregate_before_response: false, updated_at: sparse.created_at, supersedes: null,
  });
  assert.equal(Object.keys(target.pollStore.responses).length, 1);
  assert.deepEqual(target.pollStore.events, [fixture.events[0]]);
  assert.equal(target.pollStore.responses[sparse.id].proposition_target, undefined, "Do not invent a historical target");
}

console.log(JSON.stringify({ poll_retirement: "PASS", historical_responses: 5, history_events: 605, merged_events: 606,
  modes: ["merge", "replace"], catalog_independent: true, extensions_and_tombstones: "PASS", startup_and_relaunch: "PASS", recovery: "PASS" }));
