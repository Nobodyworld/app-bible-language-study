#!/usr/bin/env node

import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCapability, CAPABILITY_STATES } from "../src/capabilities.js";
import { configurePhysicalPackResolver, tryFetchJson } from "../src/data-service.js";
import { createPhysicalPackManager as createPhysicalPackManagerImpl, PhysicalPackError } from "../src/physical-pack-manager.js";
import { MemoryPhysicalPackRegistry, PHYSICAL_PACK_DB_NAME } from "../src/physical-pack-registry.js";
import { createWebDigestService } from "../src/platform/physical-services.js";

const digestService = createWebDigestService(webcrypto);
const createPhysicalPackManager = (options = {}) => createPhysicalPackManagerImpl({ digestService, ...options });

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageManifest = JSON.parse(await readFile(join(appRoot, "data", "package-manifest.json"), "utf8"));
const distributionManifest = JSON.parse(await readFile(join(appRoot, "data", "distribution-manifest.json"), "utf8"));
const fixtureCatalogV1 = JSON.parse(await readFile(join(appRoot, "data", "physical-pack-fixtures", "catalog-v1.json"), "utf8"));
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

async function initializeWithPersistedCatalog(catalog, catalogUrl, options = {}) {
  const storedRegistry = new MemoryPhysicalPackRegistry({
    metadata: {
      catalog,
      catalog_url: catalogUrl,
      physical_data_mode: "managed_cache_packs",
    },
  });
  const storedFetch = createFixtureFetch();
  const storedManager = createPhysicalPackManager({
    registry: storedRegistry,
    cacheStorage: new MemoryCacheStorage(),
    fetchImpl: storedFetch.fetchImpl,
    packageManifest,
    distributionManifest,
    appVersion: options.appVersion || "1.0.0",
    baseUrl,
    clock: () => ++now,
  });
  await storedManager.initialize();
  await storedManager.whenStartupReconciled();
  return { manager: storedManager, registry: storedRegistry, fetch: storedFetch };
}

const validStoredCatalog = await initializeWithPersistedCatalog(
  fixtureCatalogV1,
  "data/physical-pack-fixtures/catalog-v1.json",
);
assert.equal(validStoredCatalog.manager.snapshot().catalog.catalog_version, "fixture-v1");
assert.equal(validStoredCatalog.manager.snapshot().catalog_url, "http://fixture/data/physical-pack-fixtures/catalog-v1.json");
assert.equal(validStoredCatalog.fetch.controls.requests.length, 0, "valid persisted catalog must not require a network fetch");

const invalidStoredCatalogCases = [
  ["malformed", "invalid", "data/physical-pack-fixtures/catalog-v1.json", "1.0.0"],
  ["wrong-kind", { ...fixtureCatalogV1, kind: "bibleapp:not-a-catalog" }, "data/physical-pack-fixtures/catalog-v1.json", "1.0.0"],
  ["wrong-schema", { ...fixtureCatalogV1, schema_version: 2 }, "data/physical-pack-fixtures/catalog-v1.json", "1.0.0"],
  ["package-mismatch", { ...fixtureCatalogV1, package_identity: { ...fixtureCatalogV1.package_identity, content_sha256: `sha256:${"0".repeat(64)}` } }, "data/physical-pack-fixtures/catalog-v1.json", "1.0.0"],
  ["below-minimum", { ...fixtureCatalogV1, compatibility: { minimum_app_version: "1.0.1", maximum_app_version_exclusive: "2.0.0" } }, "data/physical-pack-fixtures/catalog-v1.json", "1.0.0"],
  ["exclusive-maximum", { ...fixtureCatalogV1, compatibility: { minimum_app_version: "0.9.0", maximum_app_version_exclusive: "1.0.0" } }, "data/physical-pack-fixtures/catalog-v1.json", "1.0.0"],
  ["cross-origin-url", fixtureCatalogV1, "https://example.com/catalog.json", "1.0.0"],
  ["credential-url", fixtureCatalogV1, "http://user:password@fixture/catalog.json", "1.0.0"],
  ["fragment-url", fixtureCatalogV1, "data/physical-pack-fixtures/catalog-v1.json#fragment", "1.0.0"],
];
let rejectedStoredCatalog;
for (const [label, catalog, catalogUrl, appVersion] of invalidStoredCatalogCases) {
  const rejected = await initializeWithPersistedCatalog(catalog, catalogUrl, { appVersion });
  assert.equal(rejected.fetch.controls.requests.length, 0, `${label} persisted catalog was fetched before validation`);
  assert.equal(rejected.manager.snapshot().catalog, null, `${label} persisted catalog remained authoritative`);
  assert.equal(rejected.manager.snapshot().catalog_url, null, `${label} persisted catalog URL remained authoritative`);
  assert.equal(rejected.manager.snapshot().mode, "bundled_static_data", `${label} persisted catalog did not fail safely to bundled data`);
  assert.equal(await rejected.registry.getMeta("catalog", "missing"), null);
  assert.equal(await rejected.registry.getMeta("catalog_url", "missing"), null);
  assert(rejected.manager.snapshot().history.some((entry) => entry.detail?.catalog_rejected === true), `${label} rejection was not recorded`);
  await assert.rejects(() => rejected.manager.plan("search-verses"), (error) => error.code === "not_installed");
  if (label === "malformed") rejectedStoredCatalog = rejected;
}
await rejectedStoredCatalog.manager.refreshCatalog("data/physical-pack-fixtures/catalog-v1.json");
assert.equal(rejectedStoredCatalog.manager.snapshot().catalog.catalog_version, "fixture-v1", "valid refresh did not recover rejected persisted catalog authority");

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

async function reloadScenario(scenario, options = {}) {
  const reloaded = createPhysicalPackManager({
    registry: scenario.registry,
    cacheStorage: scenario.cacheStorage,
    fetchImpl: scenario.fetch.fetchImpl,
    packageManifest,
    distributionManifest: options.distributionManifest || distributionManifest,
    appVersion: options.appVersion || "1.0.0",
    baseUrl,
    beforeStoredPackVerification: options.beforeStoredPackVerification || null,
    clock: () => ++now,
  });
  await reloaded.initialize();
  await reloaded.whenStartupReconciled();
  return reloaded;
}

async function createUpdatedSearchScenario() {
  const scenario = await createInstalledSearchScenario();
  await scenario.manager.refreshCatalog("data/physical-pack-fixtures/catalog-v2.json");
  await scenario.manager.update("search-verses");
  return scenario;
}

async function replaceRollbackSearchManifest(scenario, transform) {
  const record = await scenario.registry.getRecord("search-verses");
  const cache = await scenario.cacheStorage.open(record.rollback.cache);
  const url = new URL("data/search/manifest.json", baseUrl).href;
  const response = await cache.match(url);
  const original = new Uint8Array(await response.arrayBuffer());
  await cache.put(url, new Response(transform(original), {
    status: 200,
    headers: { "content-type": "application/json" },
  }));
  return record.rollback.cache;
}

async function assertRollbackLoss(scenario, expectedState, expectedVersion, invalidCache) {
  const reloaded = await reloadScenario(scenario);
  const record = await scenario.registry.getRecord("search-verses");
  assert.equal(record.state, expectedState);
  assert.equal(record.pack_version, expectedVersion);
  assert.equal(record.rollback, null);
  assert.equal(record.rollback_cache, null);
  assert.equal(record.last_failure.code, "rollback_lost");
  assert.notEqual(record.state, "rollback_available");
  assert.equal((await (await reloaded.resolve("data/search/manifest.json")).response.json()).version, expectedVersion === "fixture-v2" ? 2 : 1);
  assert(reloaded.snapshot().history.some((entry) => entry.detail?.rollback_lost === true), "rollback loss must be recorded in history");
  if (invalidCache) assert(!(await scenario.cacheStorage.keys()).includes(invalidCache), "invalid rollback cache should be deleted when possible");
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

const validActiveAndRollbackScenario = await createUpdatedSearchScenario();
const validActiveAndRollbackBefore = await validActiveAndRollbackScenario.registry.getRecord("search-verses");
const validActiveAndRollbackManager = await reloadScenario(validActiveAndRollbackScenario);
const validActiveAndRollbackAfter = await validActiveAndRollbackScenario.registry.getRecord("search-verses");
assert.equal(validActiveAndRollbackAfter.state, "rollback_available");
assert.equal(validActiveAndRollbackAfter.rollback_cache, validActiveAndRollbackBefore.rollback_cache);
assert.equal((await (await validActiveAndRollbackManager.resolve("data/search/manifest.json")).response.json()).version, 2);

const combinedUpdateRollbackScenario = await createInstalledSearchScenario();
await combinedUpdateRollbackScenario.manager.repair("search-verses");
let combinedUpdateRollbackRecord = await combinedUpdateRollbackScenario.registry.getRecord("search-verses");
assert.equal(combinedUpdateRollbackRecord.state, "rollback_available");
assert.ok(combinedUpdateRollbackRecord.rollback_cache);
await combinedUpdateRollbackScenario.manager.refreshCatalog("data/physical-pack-fixtures/catalog-v2.json");
combinedUpdateRollbackRecord = await combinedUpdateRollbackScenario.registry.getRecord("search-verses");
assert.equal(combinedUpdateRollbackRecord.state, "update_available");
assert.ok(combinedUpdateRollbackRecord.rollback_cache, "catalog update must not erase retained rollback authority");
const combinedUpdateRollbackReloaded = await reloadScenario(combinedUpdateRollbackScenario);
combinedUpdateRollbackRecord = await combinedUpdateRollbackScenario.registry.getRecord("search-verses");
assert.equal(combinedUpdateRollbackRecord.state, "update_available");
assert.ok(combinedUpdateRollbackRecord.rollback_cache, "startup reconciliation must retain rollback while an update is available");
await combinedUpdateRollbackReloaded.verify("search-verses");
combinedUpdateRollbackRecord = await combinedUpdateRollbackScenario.registry.getRecord("search-verses");
assert.equal(combinedUpdateRollbackRecord.state, "update_available", "explicit Verify erased update availability");
assert.ok(combinedUpdateRollbackRecord.rollback_cache);
await combinedUpdateRollbackReloaded.update("search-verses");
combinedUpdateRollbackRecord = await combinedUpdateRollbackScenario.registry.getRecord("search-verses");
assert.equal(combinedUpdateRollbackRecord.pack_version, "fixture-v2");
assert.ok(combinedUpdateRollbackRecord.rollback_cache, "successful update did not retain the previous compatible active copy");

const missingRollbackCacheScenario = await createUpdatedSearchScenario();
const missingRollbackCacheRecord = await missingRollbackCacheScenario.registry.getRecord("search-verses");
await missingRollbackCacheScenario.cacheStorage.delete(missingRollbackCacheRecord.rollback.cache);
await assertRollbackLoss(missingRollbackCacheScenario, "active", "fixture-v2", missingRollbackCacheRecord.rollback.cache);

const missingRollbackFileScenario = await createUpdatedSearchScenario();
const missingRollbackFileRecord = await missingRollbackFileScenario.registry.getRecord("search-verses");
await (await missingRollbackFileScenario.cacheStorage.open(missingRollbackFileRecord.rollback.cache)).delete(new URL("data/search/manifest.json", baseUrl).href);
await assertRollbackLoss(missingRollbackFileScenario, "active", "fixture-v2", missingRollbackFileRecord.rollback.cache);

const rollbackLengthDriftScenario = await createUpdatedSearchScenario();
const rollbackLengthCache = await replaceRollbackSearchManifest(rollbackLengthDriftScenario, () => new TextEncoder().encode("{}"));
await assertRollbackLoss(rollbackLengthDriftScenario, "active", "fixture-v2", rollbackLengthCache);

const rollbackDigestDriftScenario = await createInstalledSearchScenario();
await rollbackDigestDriftScenario.manager.repair("search-verses");
await rollbackDigestDriftScenario.manager.refreshCatalog("data/physical-pack-fixtures/catalog-v2.json");
const rollbackDigestCache = await replaceRollbackSearchManifest(rollbackDigestDriftScenario, (bytes) => {
  const copy = new Uint8Array(bytes);
  copy[0] = copy[0] === 123 ? 91 : 123;
  return copy;
});
await assertRollbackLoss(rollbackDigestDriftScenario, "update_available", "fixture-v1", rollbackDigestCache);

const explicitInvalidRollbackScenario = await createUpdatedSearchScenario();
const explicitInvalidRollbackCache = await replaceRollbackSearchManifest(explicitInvalidRollbackScenario, () => new TextEncoder().encode("{}"));
await assert.rejects(() => explicitInvalidRollbackScenario.manager.rollback("search-verses"), (error) => error.code === "corrupt");
const explicitInvalidRollbackRecord = await explicitInvalidRollbackScenario.registry.getRecord("search-verses");
assert.equal(explicitInvalidRollbackRecord.state, "active");
assert.equal(explicitInvalidRollbackRecord.pack_version, "fixture-v2");
assert.equal(explicitInvalidRollbackRecord.rollback, null);
assert.equal(explicitInvalidRollbackRecord.rollback_cache, null);
assert.equal((await (await explicitInvalidRollbackScenario.manager.resolve("data/search/manifest.json")).response.json()).version, 2);
assert(!(await explicitInvalidRollbackScenario.cacheStorage.keys()).includes(explicitInvalidRollbackCache));
assert(explicitInvalidRollbackScenario.manager.snapshot().history.some((entry) => entry.action === "rollback" && entry.state === "failed" && entry.detail?.rollback_lost));

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

async function mutatePersistedManifests(scenario, { active = null, rollback = null } = {}) {
  const record = await scenario.registry.getRecord("search-verses");
  const next = structuredClone(record);
  if (active) next.active_manifest = active(structuredClone(next.active_manifest));
  if (rollback && next.rollback?.manifest) next.rollback.manifest = rollback(structuredClone(next.rollback.manifest));
  await scenario.registry.putRecord(next);
  return { before: record, mutated: next };
}

const incompatiblePackageIdentity = (manifest) => ({
  ...manifest,
  package_identity: { ...manifest.package_identity, content_sha256: `sha256:${"f".repeat(64)}` },
});
const belowSemanticMinimum = (manifest) => ({
  ...manifest,
  compatibility: { minimum_app_version: "1.0.1", maximum_app_version_exclusive: "2.0.0" },
});
const atExclusiveSemanticMaximum = (manifest) => ({
  ...manifest,
  compatibility: { minimum_app_version: "0.9.0", maximum_app_version_exclusive: "1.0.0" },
});

async function assertIncompatibleActive(transform, label, options = {}) {
  const scenario = await createInstalledSearchScenario({ distributionManifest: options.distributionManifest });
  const { before } = await mutatePersistedManifests(scenario, { active: transform });
  const reloaded = await reloadScenario(scenario, { distributionManifest: options.distributionManifest });
  const record = await scenario.registry.getRecord("search-verses");
  assert.equal(record.state, "incompatible", `${label} did not become incompatible`);
  assert.equal(record.active_cache, before.active_cache, `${label} deleted the recoverable active cache`);
  assert.equal(record.last_failure.code, "incompatible_version");
  return { scenario, reloaded, record };
}

const incompatiblePackageScenario = await assertIncompatibleActive(incompatiblePackageIdentity, "package identity mismatch");
const fallbackIncompatibleResolution = await incompatiblePackageScenario.reloaded.resolve("data/search/manifest.json");
assert.equal(fallbackIncompatibleResolution.runtime_source, "bundled_fallback");
assert.equal(resolveCapability(packageManifest, {}, "search", {
  physicalDataMode: "managed_cache_packs",
  physicalRecords: incompatiblePackageScenario.reloaded.snapshot().records,
  distributionManifest,
}).runtime_source, "bundled_fallback");
await incompatiblePackageScenario.reloaded.refreshCatalog("data/physical-pack-fixtures/catalog-v2.json");
await incompatiblePackageScenario.reloaded.update("search-verses");
const compatibleReplacementRecord = await incompatiblePackageScenario.scenario.registry.getRecord("search-verses");
assert.equal(compatibleReplacementRecord.pack_version, "fixture-v2");
assert.equal(compatibleReplacementRecord.state, "active");
assert.equal((await (await incompatiblePackageScenario.reloaded.resolve("data/search/manifest.json")).response.json()).version, 2);
await assertIncompatibleActive(belowSemanticMinimum, "app below semantic minimum");
await assertIncompatibleActive(atExclusiveSemanticMaximum, "app at exclusive semantic maximum");

const compatibleActiveScenario = await createInstalledSearchScenario();
const compatibleActiveReloaded = await reloadScenario(compatibleActiveScenario);
assert.equal((await compatibleActiveScenario.registry.getRecord("search-verses")).state, "active");
assert.equal((await (await compatibleActiveReloaded.resolve("data/search/manifest.json")).response.json()).version, 1);

const schemaInvalidActiveScenario = await createInstalledSearchScenario();
await mutatePersistedManifests(schemaInvalidActiveScenario, {
  active: (manifest) => ({ ...manifest, schema_version: 2 }),
});
await reloadScenario(schemaInvalidActiveScenario);
assert.equal((await schemaInvalidActiveScenario.registry.getRecord("search-verses")).state, "corrupt");

const compatibleActiveIncompatibleRollback = await createInstalledSearchScenario();
await compatibleActiveIncompatibleRollback.manager.repair("search-verses");
await compatibleActiveIncompatibleRollback.manager.refreshCatalog("data/physical-pack-fixtures/catalog-v2.json");
const incompatibleRollbackClaim = await mutatePersistedManifests(compatibleActiveIncompatibleRollback, { rollback: belowSemanticMinimum });
await reloadScenario(compatibleActiveIncompatibleRollback);
const activeAfterIncompatibleRollback = await compatibleActiveIncompatibleRollback.registry.getRecord("search-verses");
assert.equal(activeAfterIncompatibleRollback.state, "update_available");
assert.equal(activeAfterIncompatibleRollback.pack_version, "fixture-v1");
assert.equal(activeAfterIncompatibleRollback.rollback, null);
assert.equal(activeAfterIncompatibleRollback.rollback_cache, null);
assert.equal(activeAfterIncompatibleRollback.last_failure.code, "rollback_lost");
assert((await compatibleActiveIncompatibleRollback.cacheStorage.keys()).includes(incompatibleRollbackClaim.before.rollback_cache), "incompatible rollback bytes were silently deleted");

const incompatibleActiveCompatibleRollback = await createUpdatedSearchScenario();
await mutatePersistedManifests(incompatibleActiveCompatibleRollback, { active: belowSemanticMinimum });
const promotedCompatibleRollbackManager = await reloadScenario(incompatibleActiveCompatibleRollback);
const promotedCompatibleRollback = await incompatibleActiveCompatibleRollback.registry.getRecord("search-verses");
assert.equal(promotedCompatibleRollback.pack_version, "fixture-v1");
assert.equal(promotedCompatibleRollback.state, "update_available");
assert.equal(promotedCompatibleRollback.rollback, null);
assert.equal((await (await promotedCompatibleRollbackManager.resolve("data/search/manifest.json")).response.json()).version, 1);

const bothIncompatibleScenario = await createUpdatedSearchScenario();
const bothIncompatibleBefore = await mutatePersistedManifests(bothIncompatibleScenario, {
  active: belowSemanticMinimum,
  rollback: atExclusiveSemanticMaximum,
});
await reloadScenario(bothIncompatibleScenario);
const bothIncompatibleRecord = await bothIncompatibleScenario.registry.getRecord("search-verses");
assert.equal(bothIncompatibleRecord.state, "incompatible");
assert.equal(bothIncompatibleRecord.active_cache, bothIncompatibleBefore.before.active_cache);
assert.equal(bothIncompatibleRecord.rollback, null);
assert.equal(bothIncompatibleRecord.rollback_cache, null);

const strictDistribution = { ...distributionManifest, bundled_fallback: false };
const strictIncompatibleScenario = await assertIncompatibleActive(incompatiblePackageIdentity, "strict incompatible active", {
  distributionManifest: strictDistribution,
});
await assert.rejects(
  () => strictIncompatibleScenario.reloaded.resolve("data/search/manifest.json"),
  (error) => error.code === "incompatible_version" && error.detail.managed_fallback_forbidden,
);
assert.equal(resolveCapability(packageManifest, {}, "search", {
  physicalDataMode: "managed_cache_packs",
  physicalRecords: strictIncompatibleScenario.reloaded.snapshot().records,
  distributionManifest: strictDistribution,
}).state, CAPABILITY_STATES.incompatibleVersion);

const pendingVerificationScenario = await createInstalledSearchScenario();
let releaseVerification;
const verificationGate = new Promise((resolveGate) => { releaseVerification = resolveGate; });
const pendingVerificationManager = createPhysicalPackManager({
  registry: pendingVerificationScenario.registry,
  cacheStorage: pendingVerificationScenario.cacheStorage,
  fetchImpl: pendingVerificationScenario.fetch.fetchImpl,
  packageManifest,
  distributionManifest,
  appVersion: "1.0.0",
  baseUrl,
  beforeStoredPackVerification: async () => verificationGate,
  clock: () => ++now,
});
await pendingVerificationManager.initialize();
assert.equal((await pendingVerificationScenario.registry.getRecord("search-verses")).state, "startup_verifying");
assert.equal((await pendingVerificationManager.resolve("data/search/manifest.json")).runtime_source, "bundled_fallback", "managed bytes were read before startup verification completed");
releaseVerification();
await pendingVerificationManager.whenStartupReconciled();
assert.equal((await (await pendingVerificationManager.resolve("data/search/manifest.json")).response.json()).version, 1);

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
  reconciliation_cases: ["persisted-catalog-validation", "persisted-manifest-validation", "active-cache-missing", "active-file-missing", "digest-drift", "byte-length-drift", "media-type-drift", "inventory-drift", "valid-active-valid-rollback", "update-plus-rollback", "rollback-cache-missing", "rollback-file-missing", "rollback-length-drift", "rollback-digest-drift", "explicit-invalid-rollback", "compatible-active-incompatible-rollback", "incompatible-active-compatible-rollback", "both-incompatible", "strict-incompatible", "valid-rollback-recovery", "invalid-rollback-recovery", "interrupted-staging", "interrupted-removal", "orphan-staging"],
  persisted_catalog_rejections: invalidStoredCatalogCases.map(([label]) => label),
  source_policy_rejections: 6,
  storage_estimates: ["sufficient", "insufficient-before-staging", "unavailable-safe"],
}, null, 2));
