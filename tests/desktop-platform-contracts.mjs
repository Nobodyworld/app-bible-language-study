#!/usr/bin/env node

import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ApplicationPlatformStartupError, resolveApplicationPlatform } from "../app/src/platform/application-platform.js";
import { inspectGlobalTauri, TauriBridgeError } from "../app/src/platform/tauri-bridge.js";
import { createTauriDataAdapter } from "../app/src/platform/tauri-data.js";
import { createTauriFileService } from "../app/src/platform/tauri-files.js";
import { createTauriPhysicalPackServices } from "../app/src/platform/tauri-physical.js";
import { createTauriPlatform } from "../app/src/platform/tauri-platform.js";
import { createTauriRuntimeService } from "../app/src/platform/tauri-runtime.js";
import { createTauriUserStorageAdapter } from "../app/src/platform/tauri-user-storage.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function javascriptFiles(root) {
  const result = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...await javascriptFiles(candidate));
    else if (entry.isFile() && /\.(?:js|mjs)$/.test(entry.name)) result.push(candidate);
  }
  return result;
}

for (const file of await javascriptFiles(path.join(repoRoot, "app"))) {
  const source = await fs.readFile(file, "utf8");
  if (file.endsWith(`${path.sep}tauri-bridge.js`)) continue;
  assert.equal(source.includes("__TAURI__"), false, `Direct Tauri global access escaped the bridge module: ${path.relative(repoRoot, file)}`);
}

assert.deepEqual(inspectGlobalTauri({}), { present: false, bridge: null });
assert.throws(() => inspectGlobalTauri({ __TAURI__: {} }), (error) => error instanceof TauriBridgeError && error.code === "malformed_tauri_bridge");
await assert.rejects(
  resolveApplicationPlatform({ windowObject: { __TAURI__: {} } }),
  (error) => error instanceof ApplicationPlatformStartupError && error.code === "malformed_tauri_bridge",
);

function createNativeHarness(options = {}) {
  const stores = options.stores || new Map();
  const calls = [];
  const remainingWriteFailures = new Map(
    Object.entries(options.failWriteCounts || {}).map(([storeName, count]) => [storeName, Number(count)]),
  );
  const bridge = {
    async invoke(command, args = {}) {
      calls.push({ command, args: structuredClone(args) });
      if (command === "desktop_environment") {
        return {
          applicationId: "com.nobodyworld.bibleappreader",
          applicationVersion: "1.0.0",
          profileId: args.profileId,
          persistentDataPath: `native-data/${args.profileId}`,
          logsPath: "native-logs",
          temporaryPath: `native-temp/${args.profileId}`,
          distributionPath: "packaged-assets",
        };
      }
      if (command === "read_user_store") {
        if (options.corruptStore === args.storeId) return { status: "corrupt", temporaryFiles: 1 };
        const key = `${args.profileId}:${args.storeId}`;
        return stores.has(key) ? { status: "ok", value: structuredClone(stores.get(key)), temporaryFiles: 0 } : { status: "missing", temporaryFiles: 0 };
      }
      if (command === "write_user_store") {
        const remainingFailures = remainingWriteFailures.get(args.storeId) || 0;
        if (options.failWrite || remainingFailures > 0) {
          if (remainingFailures > 0) remainingWriteFailures.set(args.storeId, remainingFailures - 1);
          throw Object.assign(new Error("C:\\private\\owner\\denied"), { code: "write_failed" });
        }
        stores.set(`${args.profileId}:${args.storeId}`, structuredClone(args.value));
        return { status: "saved", recoveredCorrupt: Boolean(args.recoverCorrupt) };
      }
      if (command === "native_flush_status") return { status: "flushed", profileId: args.profileId, pendingWrites: args.pendingWrites };
      if (command === "read_packaged_data") return { status: "ok", text: '{"ok":true}', mediaType: "application/json; charset=utf-8" };
      if (command === "save_backup") return options.saveResult || { status: "cancelled" };
      if (command === "open_backup") {
        if (options.openError) throw options.openError;
        return options.openResult || { status: "cancelled" };
      }
      if (command === "open_external_url") return null;
      throw new Error(`Unexpected native command: ${command}`);
    },
  };
  return { bridge, calls, stores };
}

const definitions = [
  { name: "tags", fallback: { version: 1, records: {} } },
  { name: "workspace", fallback: { version: 1 } },
];
const shared = new Map();
const stableHarness = createNativeHarness({ stores: shared });
const labHarness = createNativeHarness({ stores: shared });
const stableStorage = createTauriUserStorageAdapter({ bridge: stableHarness.bridge, profileId: "stable" });
const labStorage = createTauriUserStorageAdapter({ bridge: labHarness.bridge, profileId: "lab" });
await stableStorage.initialize(definitions);
await labStorage.initialize(definitions);
let nativeSelfNotifications = 0;
stableStorage.listen(() => { nativeSelfNotifications += 1; });
stableStorage.save("tags", { version: 1, records: { stable: true } });
labStorage.save("tags", { version: 1, records: { lab: true } });
assert.equal((await stableStorage.flush()).status, "flushed");
assert.equal((await labStorage.flush()).status, "flushed");
assert.equal(nativeSelfNotifications, 0, "A native write in the current window must not masquerade as another-window activity");
assert.equal(shared.get("stable:tags").records.lab, undefined);
assert.equal(shared.get("lab:tags").records.stable, undefined);
assert.equal(stableStorage.identities.notificationChannel, "bibleapp:native:stable:user-data");
assert.equal(labStorage.identities.notificationChannel, "bibleapp:native:lab:user-data");

const failingStorage = createTauriUserStorageAdapter({ bridge: createNativeHarness({ failWrite: true }).bridge, profileId: "stable" });
await failingStorage.initialize(definitions);
failingStorage.save("tags", { version: 1, records: { unsafe: true } });
await assert.rejects(failingStorage.flush(), /\[local path\]/);
assert.equal(failingStorage.status().failure.includes("private"), false, "Native errors must not disclose selected local paths");

const stickyHarness = createNativeHarness({ failWriteCounts: { tags: 1 } });
const stickyStorage = createTauriUserStorageAdapter({ bridge: stickyHarness.bridge, profileId: "stable" });
await stickyStorage.initialize(definitions);
stickyStorage.save("tags", { version: 1, records: { first_attempt: true } });
stickyStorage.save("workspace", { version: 1, last_reader_route: "#/read/bsb/psalms/23" });
await assert.rejects(stickyStorage.flush(), /tags: \[local path\]/);
assert.equal(stickyHarness.stores.has("stable:tags"), false, "A failed store must remain visibly unsaved");
assert.equal(stickyHarness.stores.get("stable:workspace").last_reader_route, "#/read/bsb/psalms/23");
assert.deepEqual(stickyStorage.status().unresolvedWriteStores, ["tags"]);
stickyStorage.save("tags", { version: 1, records: { retry_succeeded: true } });
assert.equal((await stickyStorage.flush()).status, "flushed");
assert.equal(stickyHarness.stores.get("stable:tags").records.retry_succeeded, true);
assert.deepEqual(stickyStorage.status().unresolvedWriteStores, []);
assert.equal(stickyStorage.status().failure, null);

const corruptHarness = createNativeHarness({ corruptStore: "tags" });
const corruptStorage = createTauriUserStorageAdapter({ bridge: corruptHarness.bridge, profileId: "stable" });
const corruptInit = await corruptStorage.initialize(definitions);
assert.deepEqual(corruptInit.blockedStores, ["tags"]);
corruptStorage.save("tags", { version: 1, records: { ordinary: true } });
await assert.rejects(corruptStorage.flush(), /preserved corrupt native data/);
corruptStorage.beginRecovery(["tags"]);
corruptStorage.save("tags", { version: 1, records: { recovered: true } });
await corruptStorage.flush();
assert.equal(corruptHarness.stores.get("stable:tags").records.recovered, true);

const recoveryHarness = createNativeHarness({ corruptStore: "tags", failWriteCounts: { tags: 1 } });
const recoveryStorage = createTauriUserStorageAdapter({ bridge: recoveryHarness.bridge, profileId: "stable" });
await recoveryStorage.initialize(definitions);
recoveryStorage.beginRecovery(["tags"]);
recoveryStorage.save("tags", { version: 1, records: { failed_recovery: true } });
await assert.rejects(recoveryStorage.flush(), /tags: \[local path\]/);
assert.deepEqual(recoveryStorage.status().recoveryStores, [], "A failed recovery write must consume its authorization");
recoveryStorage.save("tags", { version: 1, records: { unauthorized_retry: true } });
await assert.rejects(recoveryStorage.flush(), /preserved corrupt native data/);
assert.equal(recoveryHarness.stores.has("stable:tags"), false);
recoveryStorage.beginRecovery(["tags"]);
recoveryStorage.save("tags", { version: 1, records: { authorized_retry: true } });
assert.equal((await recoveryStorage.flush()).status, "flushed");
assert.equal(recoveryHarness.stores.get("stable:tags").records.authorized_retry, true);
assert.deepEqual(recoveryStorage.status().unresolvedWriteStores, []);

const fileHarness = createNativeHarness();
const fileService = createTauriFileService({ bridge: fileHarness.bridge, windowObject: { navigator: {} } });
assert.deepEqual(await fileService.saveTextFile({ text: "{}", suggestedName: "../owner:backup" }), { status: "cancelled" });
assert.equal(fileHarness.calls.at(-1).args.suggestedName, "..-owner-backup.json");
assert.deepEqual(await fileService.openTextFile(), { status: "cancelled" });
assert.equal((await fileService.readTextFile()).code, "path_read_prohibited");
const validBackupText = '{"kind":"bibleapp:user-data","version":3,"stores":{}}';
const validFileService = createTauriFileService({
  bridge: createNativeHarness({ openResult: { status: "opened", name: "portable.json", text: validBackupText } }).bridge,
  windowObject: { navigator: {} },
});
assert.deepEqual(await validFileService.openTextFile(), { status: "opened", name: "portable.json", text: validBackupText });
const beforeInvalidOpen = structuredClone(Object.fromEntries(shared));
const invalidFileService = createTauriFileService({
  bridge: createNativeHarness({ openError: Object.assign(new Error("Invalid backup."), { code: "backup_contract_invalid" }) }).bridge,
  windowObject: { navigator: {} },
});
assert.equal((await invalidFileService.openTextFile()).code, "backup_contract_invalid");
assert.deepEqual(Object.fromEntries(shared), beforeInvalidOpen, "A rejected native backup Open must not mutate user stores");

const dataHarness = createNativeHarness();
const data = createTauriDataAdapter({
  baseUrl: "http://tauri.localhost/",
  bridge: dataHarness.bridge,
});
assert.deepEqual(await data.fetchJson("data/manifest.json"), { ok: true });
assert.deepEqual(dataHarness.calls.at(-1), { command: "read_packaged_data", args: { relativePath: "data/manifest.json" } });
for (const rejected of ["https://example.com/data.json", "../data.json", "/data/manifest.json", "data/../manifest.json", "file:///owner/private.json"]) {
  await assert.rejects(data.fetchJson(rejected), /packaged data/i);
}

for (const profileId of ["stable", "lab"]) {
  const physical = createTauriPhysicalPackServices({ profileId, cryptoObject: webcrypto, baseUrl: "http://tauri.localhost/" });
  assert.equal(physical.management.mode, "bundled_static_data");
  assert.equal(physical.management.supported, false);
  assert.equal(physical.byteStoreIdentityPrefix, `bibleapp-pack:native-${profileId}:`);
  assert.deepEqual(await physical.bytes.listStoreIdentities(), []);
  await assert.rejects(physical.source.fetch("https://example.com"), (error) => error.code === "native_physical_packs_not_supported");
}

let closeListener = null;
let destroyed = 0;
let contextPrevented = false;
const runtimeStorage = { save() {}, async flush() { return { status: "flushed" }; } };
const runtime = createTauriRuntimeService({
  bridge: {
    invoke: async () => null,
    onCloseRequested: async (listener) => { closeListener = listener; return () => {}; },
    destroyCurrentWindow: async () => { destroyed += 1; },
  },
  userStorage: runtimeStorage,
  windowObject: {
    location: { href: "http://tauri.localhost/", hash: "" },
    history: { state: null, replaceState(_state, _unused, hash) { this.restored = hash; } },
    confirm: () => false,
  },
});
const listeners = new Map();
const fakeDocument = {
  documentElement: { dataset: {} },
  addEventListener(type, listener) { listeners.set(type, listener); },
};
await runtime.start({ documentObject: fakeDocument });
listeners.get("contextmenu")({ preventDefault() { contextPrevented = true; } });
assert.equal(contextPrevented, true);
await closeListener({ preventDefault() {} });
assert.equal(destroyed, 1, "A successful bounded flush must precede native window destruction");

const platformHarness = createNativeHarness();
const platformWindow = {
  location: { href: "http://tauri.localhost/index.html?profile=lab", hash: "" },
  document: { baseURI: "http://tauri.localhost/" },
  fetch: async () => new Response("{}", { status: 200 }),
  crypto: webcrypto,
  navigator: {},
  Blob,
  URL,
};
const platform = await createTauriPlatform({ windowObject: platformWindow, bridge: platformHarness.bridge });
assert.equal(platform.kind, "tauri-windows");
assert.equal(platform.profile.id, "lab");
assert.equal(platform.environment.profileId, "lab");
assert.equal(platform.environment.persistentDataPath, "native-data/lab");
assert.equal(platform.files.nativeDialogs, true);
assert.equal((await platform.userStorage.initialize(definitions)).backend, "native-json");
const currentWindow = { onCloseRequested: async () => () => {}, destroy: async () => {} };
const resolvedPlatform = await resolveApplicationPlatform({
  windowObject: {
    ...platformWindow,
    __TAURI__: {
      core: { invoke: platformHarness.bridge.invoke },
      window: { getCurrentWindow: () => currentWindow },
    },
  },
});
assert.equal(resolvedPlatform.kind, "tauri-windows", "A complete bridge must select the Tauri platform");

console.log(JSON.stringify({
  desktop_platform_contracts: "PASS",
  browser_detection_without_tauri: "PASS",
  stable_lab_native_isolation: "PASS",
  native_write_failures_stay_sticky_until_same_store_retry: "PASS",
  recovery_authorization_is_one_shot: "PASS",
  corruption_recovery_gate: "PASS",
  native_dialog_cancellation: "PASS",
  native_backup_open_and_atomic_rejection: "PASS",
  packaged_data_boundary: "PASS",
  bundled_physical_mode: "PASS",
  bounded_close_flush: "PASS",
}, null, 2));
