import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { test } from "node:test";
import { PhysicalPackManager } from "../app/src/physical-pack-manager.js";
import { MemoryPhysicalPackRegistry } from "../app/src/physical-pack-registry.js";
import { canonicalAggregateFrame, physicalPackCacheName } from "../app/src/physical-pack-contract.js";
import { createWebDigestService, createCacheStoragePhysicalByteStore } from "../app/src/platform/physical-services.js";

const hash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const baseUrl = "https://fixture.invalid/";
const packageIdentity = { schema_version: 1, package_id: "test-package", content_sha256: hash("package") };
const compatibility = { minimum_app_version: "1.0.0", maximum_app_version_exclusive: "2.0.0" };
const provenance = { license_note: "Synthetic test fixture", notice_path: "NOTICE.md", source_manifest_path: "source.json", source_refs: ["synthetic"] };

function fixture(version) {
  const body = json({ version });
  const files = [{ path: "data/search/manifest.json", bytes: Buffer.byteLength(body), media_type: "application/json", sha256: hash(body) }];
  const manifest = {
    kind: "bibleapp:physical-pack-manifest", schema_version: 1,
    pack_id: "search-verses", pack_version: version, label: "Search fixture", description: "Synthetic source",
    package_identity: packageIdentity, compatibility, dependencies: [], provided_capabilities: ["search"],
    inventory_sha256: hash(json(files)), aggregate_sha256: hash(canonicalAggregateFrame(files)), files,
    totals: { files: 1, bytes: files[0].bytes, transfer_bytes: files[0].bytes }, provenance,
    generator: { name: "failure-test", version: "1", candidate_sha: "0".repeat(40) },
  };
  const entry = {
    pack_id: manifest.pack_id, pack_version: version,
    manifest_path: `packs/${version}/manifest.json`, manifest_sha256: hash(json(manifest)),
    dependencies: [], provided_capabilities: ["search"], files: 1,
    bytes: files[0].bytes, transfer_bytes: files[0].bytes, ...provenance,
  };
  return { manifest, entry, body };
}

class MemoryCaches {
  stores = new Map();
  async open(name) {
    if (!this.stores.has(name)) this.stores.set(name, new Map());
    const data = this.stores.get(name);
    return {
      put: async (key, response) => data.set(String(key), response.clone()),
      match: async (key) => data.get(String(key))?.clone(),
      keys: async () => [...data.keys()].map((url) => ({ url })),
    };
  }
  async keys() { return [...this.stores.keys()]; }
  async has(name) { return this.stores.has(name); }
  async delete(name) { return this.stores.delete(name); }
}

async function setup() {
  const registry = new MemoryPhysicalPackRegistry();
  const caches = new MemoryCaches();
  const bytes = createCacheStoragePhysicalByteStore(caches);
  const versions = new Map(["v1", "v2"].map((version) => [version, fixture(version)]));
  const manager = new PhysicalPackManager({
    registry, byteStore: bytes, digestService: createWebDigestService(webcrypto), baseUrl,
    packageManifest: { schema_version: 1, packages: [{ id: packageIdentity.package_id, sha256: packageIdentity.content_sha256 }] },
    sourceLoader: {
      async fetch(input) {
        const path = new URL(input, baseUrl).pathname;
        const version = path.split("/")[2];
        const value = versions.get(version);
        assert.ok(value, `Unexpected source: ${path}`);
        return new Response(path.endsWith("/files/data/search/manifest.json") ? value.body : json(value.manifest), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  });
  await manager.initialize();
  const select = (version) => {
    manager.catalog = { catalog_version: version, packs: [versions.get(version).entry] };
    manager.catalogUrl = `${baseUrl}catalog.json`;
  };
  select("v1");
  return { registry, caches, bytes, manager, select };
}

async function assertActive(scenario, version) {
  const record = await scenario.registry.getRecord("search-verses");
  assert.equal(record.pack_version, version);
  assert.ok(["active", "rollback_available"].includes(record.state));
  assert.equal(await scenario.bytes.storeExists(record.active_cache), true);
  const result = await scenario.manager.verifyStoredPack({ cacheName: record.active_cache, manifest: record.active_manifest });
  assert.equal(result.files, 1);
  return record;
}

for (const action of ["install", "update", "repair"]) {
  test(`${action}: a post-commit history failure preserves the committed version`, async () => {
    const s = await setup();
    let previous;
    if (action !== "install") {
      previous = await s.manager.install("search-verses");
      if (action === "update") s.select("v2");
    }
    s.registry.appendHistory = async () => { throw new Error("history unavailable"); };
    await assert.rejects(s.manager[action]("search-verses"), (error) => error.code === "post_activation_failed" && error.detail.activation_committed === true);
    const record = await assertActive(s, action === "update" ? "v2" : "v1");
    if (previous) {
      assert.equal(record.rollback_cache, previous.active_cache);
      assert.equal(await s.bytes.storeExists(previous.active_cache), true);
    }
  });
}

test("a throwing final progress observer cannot undo activation", async () => {
  const s = await setup();
  await assert.rejects(s.manager.install("search-verses", { onProgress(value) {
    if (value.phase === "active") throw new Error("observer failed");
  } }), (error) => error.code === "post_activation_failed");
  await assertActive(s, "v1");
});

test("cleanup plus history failure after activation preserves active data and orphan evidence", async () => {
  const s = await setup();
  const remove = s.bytes.deleteStore.bind(s.bytes);
  s.bytes.deleteStore = async (name) => {
    if (name.includes(":staging-")) throw new Error("staging locked");
    return remove(name);
  };
  s.registry.appendHistory = async () => { throw new Error("history locked"); };
  await assert.rejects(s.manager.install("search-verses"), (error) => error.code === "post_activation_failed");
  await assertActive(s, "v1");
  assert.ok((await s.bytes.listStoreIdentities()).some((name) => name.includes(":staging-")));
});

test("failed activation write removes only the uncommitted candidate", async () => {
  const s = await setup();
  const previous = await s.manager.install("search-verses");
  s.select("v2");
  const put = s.registry.putRecord.bind(s.registry);
  s.registry.putRecord = async (record) => {
    if (record.pack_version === "v2" && record.state === "rollback_available") throw new Error("commit rejected");
    return put(record);
  };
  await assert.rejects(s.manager.update("search-verses"), /commit rejected/);
  assert.equal((await assertActive(s, "v1")).active_cache, previous.active_cache);
  assert.deepEqual(await s.bytes.listStoreIdentities(), [previous.active_cache]);
});

test("cancellation after the final staged file is checked before the commit", async () => {
  const s = await setup();
  const controller = new AbortController();
  await assert.rejects(s.manager.install("search-verses", { signal: controller.signal, onProgress(value) {
    if (value.phase === "staging" && value.completed === value.total) controller.abort();
  } }), (error) => error.name === "AbortError");
  assert.deepEqual(await s.bytes.listStoreIdentities(), []);
  assert.equal((await s.registry.getRecord("search-verses")).active_cache, null);
});

async function pendingScenario() {
  const s = await setup();
  const names = ["one", "two"].map((id) => physicalPackCacheName("search-verses", "v1", hash(id), `staging-${id}`));
  for (const name of names) await s.bytes.createStore(name);
  await s.registry.putRecord({ pack_id: "search-verses", state: "removing", active_cache: null, pending_deletions: names });
  return { ...s, names };
}

for (const failure of ["throw", "false", "true-with-residue"]) {
  test(`startup removal preserves pending identity when deletion returns ${failure}`, async () => {
    const s = await pendingScenario();
    const remove = s.bytes.deleteStore.bind(s.bytes);
    const calls = [];
    s.bytes.deleteStore = async (name) => {
      calls.push(name);
      if (name === s.names[1]) {
        if (failure === "throw") throw new Error("locked");
        return failure === "true-with-residue";
      }
      return remove(name);
    };
    await s.manager.reconcileStartup();
    const record = await s.registry.getRecord("search-verses");
    assert.ok(record, "failed deletion must retain a registry record");
    assert.equal(record.state, "removing");
    assert.deepEqual(record.pending_deletions, [s.names[1]]);
    assert.equal(record.last_failure.code, "cleanup_failed");
    assert.equal(calls.filter((name) => name === s.names[1]).length, 1, "pending staging must not be swept as an orphan");
    assert.equal((await s.registry.listHistory()).some((entry) => entry.detail.removal_completed === true), false);
    s.bytes.deleteStore = remove;
    await s.manager.reconcileStartup();
    assert.equal(await s.registry.getRecord("search-verses"), null);
    assert.deepEqual(await s.bytes.listStoreIdentities(), []);
  });
}

test("explicit retry consumes pending identities even when active authority is already cleared", async () => {
  const s = await pendingScenario();
  assert.equal(await s.manager.remove("search-verses"), true);
  assert.deepEqual(await s.bytes.listStoreIdentities(), []);
  assert.equal(await s.registry.getRecord("search-verses"), null);
});

test("already absent stores are an idempotent successful deletion", async () => {
  const s = await pendingScenario();
  await s.bytes.deleteStore(s.names[0]);
  await s.manager.reconcileStartup();
  assert.equal(await s.registry.getRecord("search-verses"), null);
});

test("a registry deletion failure retains the durable removal intent for the next attempt", async () => {
  const s = await pendingScenario();
  const removeRecord = s.registry.deleteRecord.bind(s.registry);
  s.registry.deleteRecord = async () => { throw new Error("registry unavailable"); };
  await assert.rejects(s.manager.reconcileStartup(), /registry unavailable/);
  assert.ok(await s.registry.getRecord("search-verses"));
  assert.equal((await s.registry.listHistory()).some((entry) => entry.detail.removal_completed), false);
  s.registry.deleteRecord = removeRecord;
  await s.manager.reconcileStartup();
  assert.equal(await s.registry.getRecord("search-verses"), null);
});

test("history failure after successful explicit removal must not recreate a malformed record", async () => {
  const s = await setup();
  await s.manager.install("search-verses");
  s.registry.appendHistory = async () => { throw new Error("history unavailable"); };
  await assert.rejects(s.manager.remove("search-verses"), /history unavailable/);
  assert.deepEqual(await s.registry.listRecords(), []);
  assert.deepEqual(await s.bytes.listStoreIdentities(), []);
});

test("another profile's pending identity is never deleted", async () => {
  const s = await pendingScenario();
  const foreign = physicalPackCacheName("search-verses", "v1", hash("lab"), "active", "bibleapp-pack:lab:");
  await s.bytes.createStore(foreign);
  await s.registry.putRecord({ pack_id: "search-verses", state: "removing", active_cache: null, pending_deletions: [foreign] });
  await s.manager.reconcileStartup();
  assert.equal(await s.bytes.storeExists(foreign), true);
  assert.deepEqual((await s.registry.getRecord("search-verses")).pending_deletions, [foreign]);
});
