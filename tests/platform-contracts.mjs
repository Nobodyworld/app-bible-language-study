#!/usr/bin/env node

import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { BrowserPhysicalPackRegistry } from "../app/src/physical-pack-registry.js";
import { BrowserDataAdapter } from "../app/src/platform/browser-data.js";
import { BrowserFileService } from "../app/src/platform/browser-files.js";
import { BrowserUserStorageAdapter } from "../app/src/platform/browser-user-storage.js";
import { assertPlatformContract, validatePlatformContract } from "../app/src/platform/platform-contract.js";
import {
  createCacheStoragePhysicalByteStore,
  createCancellationService,
  createFetchSourceService,
  createStorageEstimateService,
  createWebDigestService,
} from "../app/src/platform/physical-services.js";
import { LAB_STORAGE_IDENTITIES, STABLE_STORAGE_IDENTITIES } from "../app/src/platform/storage-identities.js";

function createLocalStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    snapshot: () => Object.fromEntries(values),
  };
}

class FakeBroadcastChannel {
  static channels = new Map();
  constructor(name) {
    this.name = name;
    this.listeners = new Set();
    if (!FakeBroadcastChannel.channels.has(name)) FakeBroadcastChannel.channels.set(name, new Set());
    FakeBroadcastChannel.channels.get(name).add(this);
  }
  addEventListener(type, listener) { if (type === "message") this.listeners.add(listener); }
  removeEventListener(type, listener) { if (type === "message") this.listeners.delete(listener); }
  postMessage(data) {
    for (const peer of FakeBroadcastChannel.channels.get(this.name) || []) {
      if (peer !== this) peer.listeners.forEach((listener) => listener({ data }));
    }
  }
  unref() {}
}

const localStorage = createLocalStorage();
const fallback = { version: 1, records: {} };
const definitions = [{ name: "tags", fallback }];
const stable = new BrowserUserStorageAdapter({
  profileId: "stable",
  identities: STABLE_STORAGE_IDENTITIES,
  localStorage,
  BroadcastChannelImpl: FakeBroadcastChannel,
});
const lab = new BrowserUserStorageAdapter({
  profileId: "lab",
  identities: LAB_STORAGE_IDENTITIES,
  localStorage,
  BroadcastChannelImpl: FakeBroadcastChannel,
});
await stable.initialize(definitions);
await lab.initialize(definitions);
stable.save("tags", { version: 1, records: { stable: true } });
assert.equal(lab.readCurrent("tags", fallback).records.stable, undefined, "Stable writes must not enter Lab memory");
const freshLab = new BrowserUserStorageAdapter({ profileId: "lab", identities: LAB_STORAGE_IDENTITIES, localStorage });
assert.equal((await freshLab.initialize(definitions)).values.tags.records.stable, undefined, "Stable fallback key must not enter fresh Lab");
lab.save("tags", { version: 1, records: { lab: true } });
const freshStable = new BrowserUserStorageAdapter({ profileId: "stable", identities: STABLE_STORAGE_IDENTITIES, localStorage });
assert.equal((await freshStable.initialize(definitions)).values.tags.records.lab, undefined, "Lab fallback key must not enter fresh Stable");

const stablePeer = new BrowserUserStorageAdapter({ profileId: "stable", identities: STABLE_STORAGE_IDENTITIES, localStorage, BroadcastChannelImpl: FakeBroadcastChannel });
const labPeer = new BrowserUserStorageAdapter({ profileId: "lab", identities: LAB_STORAGE_IDENTITIES, localStorage, BroadcastChannelImpl: FakeBroadcastChannel });
const notifications = { stable: 0, lab: 0 };
stablePeer.listen(() => { notifications.stable += 1; });
labPeer.listen(() => { notifications.lab += 1; });
stable.publish("tags");
assert.deepEqual(notifications, { stable: 1, lab: 0 });
lab.publish("tags");
assert.deepEqual(notifications, { stable: 1, lab: 1 });

let clickedDownload = null;
const fakeDocument = {
  createElement(tag) {
    assert.equal(tag, "a");
    return { click() { clickedDownload = { href: this.href, download: this.download }; } };
  },
};
class FakeBlob { constructor(parts, options) { this.parts = parts; this.type = options.type; } }
const fileService = new BrowserFileService({
  documentObject: fakeDocument,
  navigatorObject: { clipboard: { writeText: async (value) => { assert.equal(value, "copy me"); } } },
  BlobImpl: FakeBlob,
  URLImpl: { createObjectURL: () => "blob:test", revokeObjectURL: () => {} },
});
assert.equal((await fileService.saveTextFile({ text: "backup", suggestedName: "backup.json", mimeType: "application/json" })).status, "saved");
assert.deepEqual(clickedDownload, { href: "blob:test", download: "backup.json" });
assert.deepEqual(await fileService.readTextFile(null), { status: "cancelled" });
assert.deepEqual(await fileService.readTextFile({ name: "valid.json", text: async () => "{}" }), { status: "opened", name: "valid.json", text: "{}" });
assert.equal((await fileService.copyText("copy me")).status, "copied");
const fallbackCopy = new BrowserFileService({ navigatorObject: {} });
assert.equal((await fallbackCopy.copyText("copy me")).status, "fallback_required");

const dataAdapter = new BrowserDataAdapter(async (path) => new Response(JSON.stringify({ path }), { status: 200, headers: { "content-type": "application/json" } }));
assert.deepEqual(await dataAdapter.fetchJson("data/test.json"), { path: "data/test.json" });

class MemoryCache {
  constructor() { this.responses = new Map(); }
  async put(path, response) { this.responses.set(typeof path === "string" ? path : path.url, response.clone()); }
  async match(path) { return this.responses.get(typeof path === "string" ? path : path.url)?.clone(); }
  async keys() { return [...this.responses.keys()].map((url) => new Request(url)); }
}
class MemoryCacheStorage {
  constructor() { this.stores = new Map(); }
  async open(name) { if (!this.stores.has(name)) this.stores.set(name, new MemoryCache()); return this.stores.get(name); }
  async keys() { return [...this.stores.keys()]; }
  async delete(name) { return this.stores.delete(name); }
  async has(name) { return this.stores.has(name); }
}
const bytes = createCacheStoragePhysicalByteStore(new MemoryCacheStorage());
await bytes.createStore("bibleapp-pack:lab:test");
await bytes.writeVerifiedBytes("bibleapp-pack:lab:test", "http://fixture/data.json", new TextEncoder().encode("{}"), { mediaType: "application/json" });
assert.equal(await bytes.storeExists("bibleapp-pack:lab:test"), true);
assert.deepEqual(await bytes.enumerateStoredPaths("bibleapp-pack:lab:test"), ["http://fixture/data.json"]);
assert.equal(await (await bytes.readResponse("bibleapp-pack:lab:test", "http://fixture/data.json")).text(), "{}");
assert.equal(await bytes.deleteStore("bibleapp-pack:lab:test"), true);

const digest = createWebDigestService(webcrypto);
assert.equal(await digest.sha256(new TextEncoder().encode("test")), "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08");
assert.deepEqual(await createStorageEstimateService(null).estimate(), { usage: null, quota: null, supported: false });
await assert.rejects(async () => createCancellationService().throwIfAborted({ aborted: true }), (error) => error.name === "AbortError");
const source = createFetchSourceService(async () => new Response("source"));
assert.equal(await (await source.fetch("http://fixture/")).text(), "source");

assert.equal(new BrowserPhysicalPackRegistry(null, { dbName: "bibleapp-physical-packs-lab" }).dbName, "bibleapp-physical-packs-lab");

const validPlatform = {
  kind: "test",
  profile: { id: "stable" },
  environment: {
    platformKind: "test", applicationId: "bibleapp", applicationVersion: "1", profileId: "stable",
    baseUrl: "http://fixture/", supportedCapabilities: [], persistentDataPath: null, logsPath: null,
    temporaryPath: null, distributionPath: null,
  },
  userStorage: stable,
  files: fileService,
  data: dataAdapter,
  notifications: { listen() {}, publish() {} },
  physicalPacks: { registry: {}, bytes, source, digest, storageEstimate: createStorageEstimateService(null), cancellation: createCancellationService() },
};
assert.equal(assertPlatformContract(validPlatform), validPlatform);
assert.deepEqual(validatePlatformContract({}), [
  "platform.kind is required.",
  "platform.profile.id is required.",
  "platform.environment is required.",
  "platform.userStorage is required.",
  "platform.files is required.",
  "platform.data is required.",
  "platform.physicalPacks is required.",
  "platform.notifications is required.",
  "platform.userStorage.initialize must be a function.",
  "platform.userStorage.readCurrent must be a function.",
  "platform.userStorage.save must be a function.",
  "platform.userStorage.status must be a function.",
  "platform.files.saveTextFile must be a function.",
  "platform.files.openTextFile must be a function.",
  "platform.files.readTextFile must be a function.",
  "platform.files.copyText must be a function.",
  "platform.data.fetchResponse must be a function.",
  "platform.data.fetchJson must be a function.",
  "platform.notifications.listen must be a function.",
  "platform.notifications.publish must be a function.",
  "platform.physicalPacks.registry is required.",
  "platform.physicalPacks.bytes is required.",
  "platform.physicalPacks.source is required.",
  "platform.physicalPacks.digest is required.",
  "platform.physicalPacks.storageEstimate is required.",
  "platform.physicalPacks.cancellation is required.",
  "platform.environment.platformKind is required.",
  "platform.environment.applicationId is required.",
  "platform.environment.applicationVersion is required.",
  "platform.environment.profileId is required.",
  "platform.environment.baseUrl is required.",
  "platform.environment.supportedCapabilities is required.",
  "platform.environment.persistentDataPath is required.",
  "platform.environment.logsPath is required.",
  "platform.environment.temporaryPath is required.",
  "platform.environment.distributionPath is required.",
]);

console.log(JSON.stringify({
  stable_database: STABLE_STORAGE_IDENTITIES.userDatabase,
  lab_database: LAB_STORAGE_IDENTITIES.userDatabase,
  notification_isolation: notifications,
  file_results: ["saved", "cancelled", "opened", "copied", "fallback_required"],
  physical_byte_store: "explicit",
}, null, 2));
