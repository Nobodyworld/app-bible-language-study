#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCapability, CAPABILITY_STATES } from "../src/capabilities.js";
import { configurePhysicalPackResolver, tryFetchJson } from "../src/data-service.js";
import { createPhysicalPackManager, PhysicalPackError } from "../src/physical-pack-manager.js";
import { MemoryPhysicalPackRegistry, PHYSICAL_PACK_DB_NAME } from "../src/physical-pack-registry.js";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageManifest = JSON.parse(await readFile(join(appRoot, "data", "package-manifest.json"), "utf8"));
const distributionManifest = JSON.parse(await readFile(join(appRoot, "data", "distribution-manifest.json"), "utf8"));
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
  const controls = { corruptPath: null, failPath: null, requests: [] };
  const fetchImpl = async (input) => {
    const url = new URL(input instanceof URL ? input.href : typeof input === "string" ? input : input.url);
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    controls.requests.push(url.href);
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

async function createInstalledSearchScenario(options = {}) {
  const scenarioRegistry = new MemoryPhysicalPackRegistry();
  const scenarioCaches = new MemoryCacheStorage();
  const scenarioFetch = createFixtureFetch();
  const scenarioManager = createPhysicalPackManager({
    registry: scenarioRegistry,
    cacheStorage: scenarioCaches,
    fetchImpl: scenarioFetch.fetchImpl,
    packageManifest,
    distributionManifest: options.distributionManifest || distributionManifest,
    appVersion: options.appVersion || "1.0.0",
    baseUrl,
    storage: options.storage || { estimate: async () => ({ usage: 0, quota: 1024 * 1024 }) },
    clock: () => ++now,
  });
  await scenarioManager.initialize();
  await scenarioManager.refreshCatalog("data/physical-pack-fixtures/catalog-v1.json");
  await scenarioManager.install("search-verses");
  await scenarioManager.setMode("managed_cache_packs");
  return { registry: scenarioRegistry, cacheStorage: scenarioCaches, fetch: scenarioFetch, manager: scenarioManager };
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
  distributionManifest,
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
assert.deepEqual(plan.required_pack_ids, ["search-verses", "commentary-verse-index"]);
assert.equal(plan.current_version, null);
assert.equal(plan.target_version, "fixture-v1");
assert.equal(plan.storage.known, true);
assert.equal(plan.storage.available, 1024 * 1024 - 1024);
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
await assert.rejects(() => manager.verify("search-verses"), (error) => error instanceof PhysicalPackError && error.code === "repair_required");
assert.equal((await registry.getRecord("search-verses")).state, "repair_required");
const beforeRepairPlan = await registry.listRecords();
const repairPlan = await manager.plan("search-verses", "repair");
assert.deepEqual(repairPlan.dependency_order, ["search-verses"]);
assert.deepEqual(repairPlan.required_pack_ids, ["search-verses"]);
assert.equal(repairPlan.files, catalogV1.packs.find((pack) => pack.pack_id === "search-verses").files);
assert.equal(repairPlan.bytes, catalogV1.packs.find((pack) => pack.pack_id === "search-verses").bytes);
assert.equal(repairPlan.current_version, "fixture-v1");
assert.equal(repairPlan.target_version, "fixture-v1");
assert.deepEqual(await registry.listRecords(), beforeRepairPlan, "repair planning must not mutate physical state");
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
  distributionManifest,
  appVersion: "1.0.0",
  baseUrl,
  clock: () => ++now,
});
await recoveredManager.initialize();
await recoveredManager.whenStartupReconciled();
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
  distributionManifest: { ...distributionManifest, bundled_fallback: false },
};
assert.equal(resolveCapability(packageManifest, {}, "search", managedOptions).state, CAPABILITY_STATES.notInstalled);
for (const capabilityId of ["crossrefs", "outlines", "strongs-overlay", "lexicon-language-metadata", "interlinear", "graph-word-map-analysis"]) {
  assert.equal(resolveCapability(packageManifest, {}, capabilityId, managedOptions).state, CAPABILITY_STATES.available, `${capabilityId} must remain bundled in managed mode`);
}
const fallbackSearch = resolveCapability(packageManifest, {}, "search", {
  ...managedOptions,
  distributionManifest,
});
assert.equal(fallbackSearch.state, CAPABILITY_STATES.available);
assert.equal(fallbackSearch.runtime_source, "bundled_fallback");
assert.equal(resolveCapability(packageManifest, {}, "search", {
  ...managedOptions,
  distributionManifest,
  physicalRecords: [rolledBack],
}).runtime_source, "managed_pack");
assert.equal(resolveCapability(packageManifest, { disabled_capability_ids: ["search"] }, "search", managedOptions).state, CAPABILITY_STATES.disabled);
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
await recoveredManager.remove("search-verses");
const removedFallback = await recoveredManager.resolve("data/search/manifest.json");
assert.equal(removedFallback.runtime_source, "bundled_fallback", "managed removal must immediately expose bundled fallback");

const strictRegistry = new MemoryPhysicalPackRegistry();
await strictRegistry.open();
await strictRegistry.setMeta("physical_data_mode", "managed_cache_packs");
const strictManager = createPhysicalPackManager({
  registry: strictRegistry,
  cacheStorage: new MemoryCacheStorage(),
  fetchImpl: fixtureFetch.fetchImpl,
  packageManifest,
  distributionManifest: { ...distributionManifest, bundled_fallback: false },
  appVersion: "1.0.0",
  baseUrl,
  clock: () => ++now,
});
await strictManager.initialize();
configurePhysicalPackResolver((path) => strictManager.resolve(path));
await assert.rejects(
  () => tryFetchJson("data/search/manifest.json"),
  (error) => error instanceof PhysicalPackError && error.code === "not_installed" && error.detail.managed_fallback_forbidden,
  "tryFetchJson must not erase a managed-pack error when fallback is forbidden",
);
configurePhysicalPackResolver(null);
await recoveredManager.setMode("bundled_static_data");
assert.equal(await recoveredManager.resolve("data/search/manifest.json"), null, "bundled mode must use the existing static fallback");

await assert.rejects(
  () => recoveredManager.refreshCatalog("data/physical-pack-fixtures/catalog-v1.json", { expectedSha256: `sha256:${"0".repeat(64)}` }),
  (error) => error instanceof PhysicalPackError && error.code === "corrupt",
);

for (const invalidUrl of [
  "https://example.com/catalog.json",
  "http://user:password@fixture/catalog.json",
  "//example.com/catalog.json",
  "ftp://fixture/catalog.json",
  "data/physical-pack-fixtures/catalog-v1.json#fragment",
  "http://[",
]) {
  const beforeRequests = fixtureFetch.controls.requests.length;
  await assert.rejects(
    () => recoveredManager.refreshCatalog(invalidUrl),
    (error) => error instanceof PhysicalPackError && error.code === "source_policy",
    `source policy must reject ${invalidUrl}`,
  );
  assert.equal(fixtureFetch.controls.requests.length, beforeRequests, `source policy fetched ${invalidUrl}`);
}
await recoveredManager.refreshCatalog("http://fixture/data/physical-pack-fixtures/catalog-v1.json");

const insufficientRegistry = new MemoryPhysicalPackRegistry();
const insufficientCaches = new MemoryCacheStorage();
const insufficientManager = createPhysicalPackManager({
  registry: insufficientRegistry,
  cacheStorage: insufficientCaches,
  fetchImpl: fixtureFetch.fetchImpl,
  packageManifest,
  distributionManifest,
  appVersion: "1.0.0",
  baseUrl,
  storage: { estimate: async () => ({ usage: 999, quota: 1000 }) },
  clock: () => ++now,
});
await insufficientManager.initialize();
await insufficientManager.refreshCatalog("data/physical-pack-fixtures/catalog-v1.json");
await assert.rejects(
  () => insufficientManager.install("search-verses"),
  (error) => error instanceof PhysicalPackError && error.code === "insufficient_storage" && error.detail.available === 1,
);
assert.deepEqual(await insufficientCaches.keys(), [], "insufficient quota must fail before staging cache creation");
assert.deepEqual(await insufficientRegistry.listRecords(), [], "insufficient quota must not create a pack record");

const unknownEstimate = await createInstalledSearchScenario({
  storage: { estimate: async () => { throw new Error("estimate unavailable"); } },
});
assert.equal((await unknownEstimate.manager.storageEstimate()).known, false);
assert.equal((await unknownEstimate.registry.getRecord("search-verses")).state, "active");

async function reloadScenario(scenario) {
  const reloaded = createPhysicalPackManager({
    registry: scenario.registry,
    cacheStorage: scenario.cacheStorage,
    fetchImpl: scenario.fetch.fetchImpl,
    packageManifest,
    distributionManifest,
    appVersion: "1.0.0",
    baseUrl,
    clock: () => ++now,
  });
  await reloaded.initialize();
  await reloaded.whenStartupReconciled();
  return reloaded;
}

const missingCacheScenario = await createInstalledSearchScenario();
const missingCacheRecord = await missingCacheScenario.registry.getRecord("search-verses");
await missingCacheScenario.cacheStorage.delete(missingCacheRecord.active_cache);
await reloadScenario(missingCacheScenario);
assert.equal((await missingCacheScenario.registry.getRecord("search-verses")).state, "repair_required");

const missingFileScenario = await createInstalledSearchScenario();
const missingFileRecord = await missingFileScenario.registry.getRecord("search-verses");
await (await missingFileScenario.cacheStorage.open(missingFileRecord.active_cache)).delete(new URL("data/search/manifest.json", baseUrl).href);
await reloadScenario(missingFileScenario);
assert.equal((await missingFileScenario.registry.getRecord("search-verses")).state, "repair_required");

async function replaceSearchManifest(scenario, transform, mediaType = "application/json") {
  const record = await scenario.registry.getRecord("search-verses");
  const cache = await scenario.cacheStorage.open(record.active_cache);
  const url = new URL("data/search/manifest.json", baseUrl).href;
  const response = await cache.match(url);
  const original = new Uint8Array(await response.arrayBuffer());
  const replacement = transform(original);
  await cache.put(url, new Response(replacement, { status: 200, headers: { "content-type": mediaType } }));
}

const digestDriftScenario = await createInstalledSearchScenario();
await replaceSearchManifest(digestDriftScenario, (bytes) => {
  const copy = new Uint8Array(bytes);
  copy[0] = copy[0] === 123 ? 91 : 123;
  return copy;
});
await reloadScenario(digestDriftScenario);
assert.equal((await digestDriftScenario.registry.getRecord("search-verses")).state, "corrupt");

const lengthDriftScenario = await createInstalledSearchScenario();
await replaceSearchManifest(lengthDriftScenario, () => new TextEncoder().encode("{}"));
await reloadScenario(lengthDriftScenario);
assert.equal((await lengthDriftScenario.registry.getRecord("search-verses")).state, "corrupt");

const mediaDriftScenario = await createInstalledSearchScenario();
await replaceSearchManifest(mediaDriftScenario, (bytes) => bytes, "text/plain");
await assert.rejects(() => mediaDriftScenario.manager.verify("search-verses"), (error) => error.code === "corrupt");

const inventoryDriftScenario = await createInstalledSearchScenario();
const inventoryRecord = await inventoryDriftScenario.registry.getRecord("search-verses");
await (await inventoryDriftScenario.cacheStorage.open(inventoryRecord.active_cache)).put(
  new URL("data/search/unexpected.json", baseUrl).href,
  new Response("{}", { headers: { "content-type": "application/json" } }),
);
await assert.rejects(() => inventoryDriftScenario.manager.verify("search-verses"), (error) => error.code === "corrupt");

const validRollbackScenario = await createInstalledSearchScenario();
await validRollbackScenario.manager.refreshCatalog("data/physical-pack-fixtures/catalog-v2.json");
await validRollbackScenario.manager.update("search-verses");
const validRollbackRecord = await validRollbackScenario.registry.getRecord("search-verses");
await validRollbackScenario.cacheStorage.delete(validRollbackRecord.active_cache);
await reloadScenario(validRollbackScenario);
const recoveredRollbackRecord = await validRollbackScenario.registry.getRecord("search-verses");
assert.equal(recoveredRollbackRecord.pack_version, "fixture-v1");
assert.equal(recoveredRollbackRecord.state, "update_available");
assert.equal(recoveredRollbackRecord.last_failure.code, "repair_required");

const invalidRollbackScenario = await createInstalledSearchScenario();
await invalidRollbackScenario.manager.refreshCatalog("data/physical-pack-fixtures/catalog-v2.json");
await invalidRollbackScenario.manager.update("search-verses");
const invalidRollbackRecord = await invalidRollbackScenario.registry.getRecord("search-verses");
await invalidRollbackScenario.cacheStorage.delete(invalidRollbackRecord.active_cache);
const rollbackCache = await invalidRollbackScenario.cacheStorage.open(invalidRollbackRecord.rollback.cache);
await rollbackCache.delete(new URL("data/search/manifest.json", baseUrl).href);
await reloadScenario(invalidRollbackScenario);
const rejectedRollbackRecord = await invalidRollbackScenario.registry.getRecord("search-verses");
assert.equal(rejectedRollbackRecord.state, "repair_required");
assert.equal(rejectedRollbackRecord.rollback, null);
assert.notEqual(rejectedRollbackRecord.active_cache, invalidRollbackRecord.rollback.cache, "invalid rollback must not be activated");

const interruptedRemovalScenario = await createInstalledSearchScenario();
const interruptedRemovalRecord = await interruptedRemovalScenario.registry.getRecord("search-verses");
await interruptedRemovalScenario.registry.putRecord({
  ...interruptedRemovalRecord,
  state: "removing",
  active_cache: null,
  rollback_cache: null,
  staging_cache: null,
  pending_deletions: [interruptedRemovalRecord.active_cache],
});
await reloadScenario(interruptedRemovalScenario);
assert.equal(await interruptedRemovalScenario.registry.getRecord("search-verses"), null);
assert.ok(!(await interruptedRemovalScenario.cacheStorage.keys()).includes(interruptedRemovalRecord.active_cache));

console.log(JSON.stringify({
  registry_database: PHYSICAL_PACK_DB_NAME,
  plan_cancel_mutation: false,
  lifecycle: ["install", "verify", "repair", "update", "rollback", "remove", "cleanup", "startup-reconcile"],
  progress_events: progress.length,
  final_mode: recoveredManager.snapshot().mode,
  history_entries: recoveredManager.snapshot().history.length,
  reconciliation_cases: ["active-cache-missing", "active-file-missing", "digest-drift", "byte-length-drift", "media-type-drift", "inventory-drift", "valid-rollback", "invalid-rollback", "interrupted-staging", "interrupted-removal", "orphan-staging"],
  source_policy_rejections: 6,
  storage_estimates: ["sufficient", "insufficient-before-staging", "unavailable-safe"],
}, null, 2));
