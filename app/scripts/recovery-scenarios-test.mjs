#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createVerseTarget } from "../src/semantic-targets.js";

const reportPath = join(tmpdir(), "bibleapp-user-data-recovery-report.json");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createLocalStorage(options = {}) {
  const store = new Map(Object.entries(options.initial || {}).map(([key, value]) => [key, String(value)]));
  return {
    removed: [],
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      if (options.throwOnSet) throw new Error(options.throwMessage || "QuotaExceededError");
      store.set(key, String(value));
    },
    removeItem(key) {
      this.removed.push(key);
      store.delete(key);
    },
    clear() {
      store.clear();
    },
    snapshot() {
      return Object.fromEntries(store.entries());
    },
  };
}

function createFailingIndexedDb(mode) {
  return {
    open() {
      const request = {};
      queueMicrotask(() => {
        if (mode === "blocked") {
          request.onblocked?.();
          return;
        }
        request.error = new Error(mode === "open-error" ? "Synthetic IndexedDB open failure." : "Synthetic IndexedDB failure.");
        request.onerror?.();
      });
      return request;
    },
  };
}

function createWorkingIndexedDb(options = {}) {
  const records = new Map(Object.entries(options.initial || {}).map(([name, value]) => [name, { name, value }]));
  let created = false;
  return {
    records,
    open() {
      const request = {};
      const db = {
        objectStoreNames: {
          contains() {
            return created;
          },
        },
        createObjectStore() {
          created = true;
        },
        transaction() {
          const transaction = {};
          transaction.objectStore = () => ({
            get(name) {
              const getRequest = {};
              queueMicrotask(() => {
                getRequest.result = records.get(name) || null;
                getRequest.onsuccess?.();
              });
              return getRequest;
            },
            put(record) {
              const putRequest = {};
              queueMicrotask(() => {
                if (options.throwOnPut) {
                  const error = new Error(options.throwMessage || "Synthetic IndexedDB quota failure.");
                  putRequest.error = error;
                  transaction.error = error;
                  putRequest.onerror?.();
                  transaction.onerror?.();
                  return;
                }
                records.set(record.name, record);
                putRequest.onsuccess?.();
              });
              return putRequest;
            },
          });
          return transaction;
        },
      };
      queueMicrotask(() => {
        request.result = db;
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
}

async function loadStores(label) {
  return import(`../src/stores.js?recovery=${label}-${Date.now()}-${Math.random()}`);
}

function setWindow({ localStorage, indexedDB = null }) {
  globalThis.window = {
    localStorage,
    ...(indexedDB ? { indexedDB } : {}),
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  };
}

async function scenario(name, fn) {
  try {
    const result = await fn();
    return { name, status: "passed", ...result };
  } catch (error) {
    return { name, status: "failed", error: error.message };
  } finally {
    delete globalThis.window;
  }
}

async function main() {
  const results = [];

  results.push(await scenario("indexeddb_unavailable_falls_back_to_localstorage", async () => {
    const localStorage = createLocalStorage();
    setWindow({ localStorage });
    const stores = await loadStores("no-indexeddb");
    const state = {};
    await stores.initStores(state);
    stores.createCustomTag(state, { label: "Recovery Tag", icon: "R", color: "#335577" });
    const summary = stores.getUserDataSummary(state);
    assert(summary.user_store_backend === "localStorage", "expected localStorage backend");
    assert(summary.user_store_migration === "indexeddb-unavailable", "expected indexeddb-unavailable migration");
    assert(summary.user_store_failure === "IndexedDB is not available.", "expected visible IndexedDB warning");
    return { backend: summary.user_store_backend, migration: summary.user_store_migration };
  }));

  results.push(await scenario("indexeddb_blocked_falls_back_safely", async () => {
    const localStorage = createLocalStorage();
    setWindow({ localStorage, indexedDB: createFailingIndexedDb("blocked") });
    const stores = await loadStores("blocked-indexeddb");
    const state = {};
    await stores.initStores(state);
    const summary = stores.getUserDataSummary(state);
    assert(summary.user_store_backend === "localStorage", "blocked IndexedDB should fall back");
    assert(summary.user_store_failure === "User data store upgrade was blocked.", "blocked reason should be visible");
    return { backend: summary.user_store_backend, failure: summary.user_store_failure };
  }));

  results.push(await scenario("indexeddb_open_failure_falls_back_safely", async () => {
    const localStorage = createLocalStorage();
    setWindow({ localStorage, indexedDB: createFailingIndexedDb("open-error") });
    const stores = await loadStores("open-failure");
    const state = {};
    await stores.initStores(state);
    const summary = stores.getUserDataSummary(state);
    assert(summary.user_store_backend === "localStorage", "open failure should fall back");
    assert(summary.user_store_failure === "Synthetic IndexedDB open failure.", "open failure reason should be visible");
    return { backend: summary.user_store_backend, failure: summary.user_store_failure };
  }));

  results.push(await scenario("indexeddb_authority_migrates_and_clears_legacy_mirror", async () => {
    const legacyTagStore = JSON.stringify({
      version: 3,
      tags: {},
      verse_tags: {},
      tag_assertions: {},
      job_events: [],
    });
    const localStorage = createLocalStorage({
      initial: {
        "openbible-clean-app:verse-tags:v1": legacyTagStore,
      },
    });
    const indexedDB = createWorkingIndexedDb();
    setWindow({ localStorage, indexedDB });
    const stores = await loadStores("indexeddb-authority");
    const state = {};
    await stores.initStores(state);
    const summary = stores.getUserDataSummary(state);
    assert(summary.user_store_backend === "indexedDB", "expected IndexedDB backend after successful open");
    assert(summary.user_store_authority === "indexedDB", "expected IndexedDB authority");
    assert(!localStorage.getItem("openbible-clean-app:verse-tags:v1"), "legacy mirror should be removed after migration");
    return { backend: summary.user_store_backend, removed_legacy_keys: localStorage.removed.length };
  }));

  results.push(await scenario("localstorage_quota_failure_is_visible", async () => {
    const localStorage = createLocalStorage({ throwOnSet: true, throwMessage: "QuotaExceededError" });
    setWindow({ localStorage });
    const stores = await loadStores("quota");
    const state = {};
    await stores.initStores(state);
    stores.setVerseDraft(state, "john:1:1", "Recovery draft");
    const summary = stores.getUserDataSummary(state);
    assert(summary.user_store_failure === "QuotaExceededError", "quota failure should be exposed in summary");
    return { failure: summary.user_store_failure, export_still_available: Boolean(stores.createUserDataExport(state).stores.workspace) };
  }));

  results.push(await scenario("malformed_import_fails_without_mutating_current_state", async () => {
    const localStorage = createLocalStorage();
    setWindow({ localStorage });
    const stores = await loadStores("malformed-import");
    const state = {};
    stores.ensureStores(state);
    stores.createCustomTag(state, { label: "Keep Me", icon: "K", color: "#335577" });
    const before = stores.getUserDataSummary(state).custom_tags;
    let rejected = false;
    try {
      stores.importUserData(state, { kind: "not-openbible" }, "replace");
    } catch {
      rejected = true;
    }
    assert(rejected, "malformed import should be rejected");
    assert(stores.getUserDataSummary(state).custom_tags === before, "malformed import must not mutate current state");
    return { rejected, custom_tags_preserved: before };
  }));

  results.push(await scenario("replace_import_creates_recovery_backup", async () => {
    const localStorage = createLocalStorage();
    setWindow({ localStorage });
    const stores = await loadStores("replace-backup");
    const state = {};
    stores.ensureStores(state);
    stores.createCustomTag(state, { label: "Before Replace", icon: "B", color: "#335577" });
    const incoming = stores.createUserDataExport({});
    const summary = stores.importUserData(state, incoming, "replace");
    assert(summary.last_import_backup?.reason === "before-replace-import", "replace import must create backup");
    return { backup_reason: summary.last_import_backup.reason };
  }));

  results.push(await scenario("corrupt_records_are_quarantined", async () => {
    const localStorage = createLocalStorage();
    setWindow({ localStorage });
    const stores = await loadStores("quarantine");
    const state = {};
    stores.ensureStores(state);
    const exported = stores.createUserDataExport(state);
    exported.stores.assertions.assertions = {
      "bad:assertion": { id: "bad:assertion" },
    };
    stores.importUserData(state, exported, "replace");
    const summary = stores.getUserDataSummary(state);
    assert(summary.quarantined_assertion_records === 1, "corrupt assertion should be quarantined");
    return { quarantined_assertion_records: summary.quarantined_assertion_records };
  }));

  results.push(await scenario("partial_export_recovers_with_default_empty_stores", async () => {
    const localStorage = createLocalStorage();
    setWindow({ localStorage });
    const stores = await loadStores("partial-export");
    const state = {};
    stores.importUserData(
      state,
      {
        kind: "openbible-clean-app:user-data",
        version: 2,
        stores: {
          tags: {
            version: 3,
            tags: {},
            verse_tags: {
              "john:1:1": ["positive_sentiment"],
            },
          },
        },
      },
      "replace",
    );
    const summary = stores.getUserDataSummary(state);
    assert(summary.tagged_verses === 1, "partial export should recover tag store");
    assert(summary.poll_responses === 0 && state.workspaceStore.job_events.length === 0, "missing stores should normalize to empty defaults");
    return { tagged_verses: summary.tagged_verses, poll_responses: summary.poll_responses };
  }));

  results.push(await scenario("browser_storage_cleared_recovers_from_json_export", async () => {
    const localStorage = createLocalStorage();
    setWindow({ localStorage });
    const stores = await loadStores("storage-cleared");
    const state = {};
    stores.ensureStores(state);
    stores.createCustomTag(state, { label: "Exported Recovery Tag", icon: "E", color: "#335577" });
    const exported = stores.createUserDataExport(state);
    localStorage.clear();
    const recovered = {};
    stores.importUserData(recovered, exported, "replace");
    const summary = stores.getUserDataSummary(recovered);
    assert(summary.custom_tags === 1, "JSON export should recover after browser storage is cleared");
    return { recovered_custom_tags: summary.custom_tags };
  }));

  const failed = results.filter((item) => item.status !== "passed");
  const report = {
    schema_version: 1,
    report_id: "user-data-recovery-scenarios",
    generated_at: new Date().toISOString(),
    scenario_count: results.length,
    failures: failed,
    scenarios: results,
    recovery_policy: {
      local_authority: "IndexedDB when available",
      fallback: "localStorage only when IndexedDB is unavailable or write fails",
      portable_backup: "versioned JSON export/import",
      destructive_import: "backup before replace import",
    },
  };

  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
