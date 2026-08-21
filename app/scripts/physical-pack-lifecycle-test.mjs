#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCapability, CAPABILITY_STATES } from "../src/capabilities.js";
import { createPhysicalPackManager, PhysicalPackError } from "../src/physical-pack-manager.js";
import { MemoryPhysicalPackRegistry, PHYSICAL_PACK_DB_NAME } from "../src/physical-pack-registry.js";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageManifest = JSON.parse(await readFile(join(appRoot, "data", "package-manifest.json"), "utf8"));
const baseUrl = "http://fixture/";

function requestKey(input) {
  if (typeof input === "string") return input;
  return input.url;
}

class MemoryCache {
  constructor() {
    this.responses = new Map();
  }

  async put(input, response) {
    this.responses.set(requestKey(input), response.clone());
  }

  async match(input) {
    return this.responses.get(requestKey(input))?.clone() || undefined;
  }

  async delete(input) {
    return this.responses.delete(requestKey(input));
  }

  async keys() {
    return [...this.responses.keys()].map((url) => new Request(url));
  }
}

class MemoryCacheStorage {
  constructor() {
    this.caches = new Map();
  }

  async open(name) {
    if (!this.caches.has(name)) this.caches.set(name, new MemoryCache());
    return this.caches.get(name);
  }

  async delete(name) {
    return this.caches.delete(name);
  }

  async has(name) {
    return this.caches.has(name);
  }

  async keys() {
    return [...this.caches.keys()];
  }
}

function createFixtureFetch() {
  const controls = { corruptPath: null, failPath: null };
  const fetchImpl = async (input) => {
    const url = new URL(input instanceof URL ? input.href : typeof input === "string" ? input : input.url);
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    if (controls.failPath && relative.endsWith(controls.failPath)) return new Response("failed", { status: 503 });
    try {
      let body = await readFile(join(appRoot, relative));
      if (controls.corruptPath && relative.endsWith(controls.corruptPath)) body = Buffer.from("{}\n");
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    } catch {
      return new Response("missing", { status: 404 });
    }
  };
  return { controls, fetchImpl };
}

const registry = new MemoryPhysicalPackRegistry();
const cacheStorage = new MemoryCacheStorage();
const fixtureFetch = createFixtureFetch();
let now = Date.parse("2026-08-21T12:00:00.000Z");
const manager = createPhysicalPackManager({
  registry,
  cacheStorage,
  fetchImpl: fixtureFetch.fetchImpl,
  packageManifest,
  appVersion: "1.0.0",
  baseUrl,
  storage: { estimate: async () => ({ usage: 1024, quota: 1024 * 1024 }) },
  clock: () => ++now,
});

await manager.initialize();
assert.equal(PHYSICAL_PACK_DB_NAME, "bibleapp-physical-packs");
assert.equal(manager.snapshot().mode, "bundled_static_data");
assert.deepEqual(await registry.listRecords(), []);

const catalogV1 = await manager.refreshCatalog("data/physical-pack-fixtures/catalog-v1.json");
assert.equal(catalogV1.catalog_version, "fixture-v1");
const plan = await manager.plan("commentary-verse-index");
assert.equal(plan.mutates, false);
assert.deepEqual(plan.dependency_order, ["search-verses", "commentary-verse-index"]);
assert.deepEqual(await registry.listRecords(), [], "planning and cancelling must not mutate physical state");

const progress = [];
await manager.install("commentary-verse-index", { onProgress: (value) => progress.push(value) });
assert.ok(progress.some((item) => item.phase === "staging"));
assert.ok(progress.some((item) => item.phase === "active"));
assert.equal((await registry.getRecord("search-verses")).state, "active");
assert.equal((await registry.getRecord("commentary-verse-index")).state, "active");

await manager.setMode("managed_cache_packs");
const resolved = await manager.resolve("data/search/manifest.json?v=test");
assert.equal(resolved.pack_id, "search-verses");
assert.equal((await resolved.response.json()).version, 1);

const searchRecord = await registry.getRecord("search-verses");
const activeCache = await cacheStorage.open(searchRecord.active_cache);
await activeCache.delete(new URL("data/search/manifest.json", baseUrl).href);
await assert.rejects(() => manager.verify("search-verses"), (error) => error instanceof PhysicalPackError && error.code === "corrupt");
assert.equal((await registry.getRecord("search-verses")).state, "corrupt");
await manager.repair("search-verses");
assert.ok(["rollback_available", "active"].includes((await registry.getRecord("search-verses")).state));
assert.equal((await (await manager.resolve("data/search/manifest.json")).response.json()).version, 1);

const catalogV2 = await manager.refreshCatalog("data/physical-pack-fixtures/catalog-v2.json");
assert.equal(catalogV2.catalog_version, "fixture-v2");
assert.equal((await registry.getRecord("search-verses")).state, "update_available");
await manager.update("search-verses");
const updated = await registry.getRecord("search-verses");
assert.equal(updated.pack_version, "fixture-v2");
assert.ok(updated.rollback_cache, "update must retain a rollback cache");
assert.equal((await (await manager.resolve("data/search/manifest.json")).response.json()).version, 2);

fixtureFetch.controls.failPath = "data/search/manifest.json";
await assert.rejects(() => manager.repair("search-verses"), /HTTP 503/);
fixtureFetch.controls.failPath = null;
const preserved = await registry.getRecord("search-verses");
assert.equal(preserved.pack_version, "fixture-v2", "failed repair must preserve the last active version");
assert.ok(preserved.active_cache);

await manager.rollback("search-verses");
const rolledBack = await registry.getRecord("search-verses");
assert.equal(rolledBack.pack_version, "fixture-v1");
assert.equal((await (await manager.resolve("data/search/manifest.json")).response.json()).version, 1);

const interruptedActive = await registry.getRecord("search-verses");
const stagingName = "bibleapp-pack:staging-orphan:search-verses:fixture-v2:0000000000000000";
await cacheStorage.open(stagingName);
await registry.putRecord({
  ...interruptedActive,
  state: "staging",
  staging_cache: stagingName,
  previous_active: interruptedActive,
});
const recoveredManager = createPhysicalPackManager({
  registry,
  cacheStorage,
  fetchImpl: fixtureFetch.fetchImpl,
  packageManifest,
  appVersion: "1.0.0",
  baseUrl,
  clock: () => ++now,
});
await recoveredManager.initialize();
assert.equal((await registry.getRecord("search-verses")).pack_version, "fixture-v1");
assert.ok(!(await cacheStorage.keys()).includes(stagingName));

const orphanName = "bibleapp-pack:active-orphan:test:v1:0000000000000000";
await cacheStorage.open(orphanName);
await recoveredManager.refreshSnapshot();
assert.ok(recoveredManager.snapshot().orphan_caches.includes(orphanName));
const cleanup = await recoveredManager.cleanup();
assert.ok(cleanup.orphan_caches_removed >= 1);
assert.ok(!(await cacheStorage.keys()).includes(orphanName));

const managedOptions = {
  physicalDataMode: "managed_cache_packs",
  assumeBundledFullAccess: false,
  physicalRecords: [],
};
assert.equal(resolveCapability(packageManifest, {}, "search", managedOptions).state, CAPABILITY_STATES.notInstalled);
assert.equal(resolveCapability(packageManifest, {}, "search", {
  ...managedOptions,
  physicalRecords: [{ ...rolledBack, state: "corrupt" }],
}).state, CAPABILITY_STATES.corrupt);
assert.equal(resolveCapability(packageManifest, {}, "commentary", {
  ...managedOptions,
  physicalRecords: [await registry.getRecord("commentary-verse-index")],
}).state, CAPABILITY_STATES.dependencyMissing);

await assert.rejects(
  () => recoveredManager.remove("search-verses"),
  (error) => error instanceof PhysicalPackError && error.code === "dependency_missing",
);
await recoveredManager.remove("commentary-verse-index");
assert.equal(await registry.getRecord("commentary-verse-index"), null);
await recoveredManager.setMode("bundled_static_data");
assert.equal(await recoveredManager.resolve("data/search/manifest.json"), null, "bundled mode must use the existing static fallback");

await assert.rejects(
  () => recoveredManager.refreshCatalog("data/physical-pack-fixtures/catalog-v1.json", { expectedSha256: `sha256:${"0".repeat(64)}` }),
  (error) => error instanceof PhysicalPackError && error.code === "corrupt",
);

console.log(JSON.stringify({
  registry_database: PHYSICAL_PACK_DB_NAME,
  plan_cancel_mutation: false,
  lifecycle: ["install", "verify", "repair", "update", "rollback", "remove", "cleanup", "startup-reconcile"],
  progress_events: progress.length,
  final_mode: recoveredManager.snapshot().mode,
  history_entries: recoveredManager.snapshot().history.length,
}, null, 2));
