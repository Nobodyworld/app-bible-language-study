import { storageIdentitiesForProfile, USER_STORE_NAMES } from "./storage-identities.js";

const ALLOWED_STORES = new Set(Object.values(USER_STORE_NAMES));

function clone(value) {
  if (value == null) return value;
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function mergeFallback(fallback, value) {
  if (value == null) return clone(fallback);
  if (fallback && typeof fallback === "object" && !Array.isArray(fallback) && value && typeof value === "object" && !Array.isArray(value)) {
    return { ...clone(fallback), ...clone(value) };
  }
  return clone(value);
}

function safeMessage(error, fallback) {
  const message = String(error?.message || fallback || "Native user storage failed.");
  return message.replace(/[A-Za-z]:[\\/][^\s;]+/g, "[local path]").slice(0, 400);
}

export class TauriUserStorageAdapter {
  constructor(options = {}) {
    if (!options.bridge?.invoke) throw new TypeError("A validated Tauri command bridge is required.");
    this.bridge = options.bridge;
    this.profileId = options.profileId === "lab" ? "lab" : "stable";
    const browserIdentities = storageIdentitiesForProfile(this.profileId);
    this.identities = Object.freeze({
      ...browserIdentities,
      userDatabase: `native-json:${this.profileId}`,
      userObjectStore: "versioned-json-files",
      notificationChannel: `bibleapp:native:${this.profileId}:user-data`,
      physicalRegistryDatabase: `bundled-only:${this.profileId}`,
      physicalBytePrefix: `bibleapp-pack:native-${this.profileId}:`,
    });
    this.current = new Map();
    this.listeners = new Set();
    this.blockedStores = new Set();
    this.recoveryStores = new Set();
    this.unresolvedWriteFailures = new Map();
    this.pending = new Set();
    this.queue = Promise.resolve();
    this.failure = null;
    this.temporaryFiles = 0;
  }

  assertStore(storeName) {
    if (!ALLOWED_STORES.has(storeName)) throw new TypeError(`Unknown native logical store: ${storeName}`);
  }

  unresolvedFailureMessage() {
    if (!this.unresolvedWriteFailures.size) return null;
    return [...this.unresolvedWriteFailures.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([storeName, message]) => `${storeName}: ${message}`)
      .join("; ");
  }

  async initialize(definitions) {
    const values = {};
    const diagnostics = [];
    for (const definition of definitions) {
      this.assertStore(definition.name);
      const response = await this.bridge.invoke("read_user_store", {
        storeId: definition.name,
      });
      this.temporaryFiles += Number(response?.temporaryFiles || 0);
      if (response?.status === "ok") {
        values[definition.name] = mergeFallback(definition.fallback, response.value);
      } else if (response?.status === "missing") {
        values[definition.name] = clone(definition.fallback);
      } else if (response?.status === "corrupt") {
        values[definition.name] = clone(definition.fallback);
        this.blockedStores.add(definition.name);
        diagnostics.push(`${definition.name}: existing native data is malformed and was preserved`);
      } else {
        throw new Error(`Native storage returned an invalid read status for ${definition.name}.`);
      }
      this.current.set(definition.name, clone(values[definition.name]));
    }
    if (this.temporaryFiles) diagnostics.push(`${this.temporaryFiles} interrupted temporary file(s) were preserved for diagnostics`);
    this.failure = diagnostics.length ? diagnostics.join("; ") : null;
    return { values, ...this.status() };
  }

  readCurrent(storeName, fallback) {
    this.assertStore(storeName);
    return this.current.has(storeName) ? clone(this.current.get(storeName)) : clone(fallback);
  }

  enqueue(storeName, value) {
    const recoverCorrupt = this.recoveryStores.delete(storeName);
    const operation = this.queue.then(async () => {
      if (this.blockedStores.has(storeName) && !recoverCorrupt) {
        throw new Error(`${storeName} has preserved corrupt native data; use an explicit backup import to recover it.`);
      }
      const response = await this.bridge.invoke("write_user_store", {
        storeId: storeName,
        value,
        recoverCorrupt,
      });
      if (response?.status !== "saved") throw new Error(`Native storage did not confirm ${storeName}.`);
      this.blockedStores.delete(storeName);
      this.unresolvedWriteFailures.delete(storeName);
      this.failure = null;
    }).catch((error) => {
      const message = safeMessage(error, `Could not persist ${storeName}.`);
      this.unresolvedWriteFailures.set(storeName, message);
      this.failure = message;
      throw error;
    });
    this.pending.add(operation);
    operation.finally(() => this.pending.delete(operation)).catch(() => {});
    this.queue = operation.catch(() => {});
  }

  save(storeName, value) {
    this.assertStore(storeName);
    const snapshot = clone(value);
    this.current.set(storeName, snapshot);
    this.enqueue(storeName, snapshot);
  }

  beginRecovery(storeNames = [...this.blockedStores]) {
    for (const storeName of storeNames) {
      this.assertStore(storeName);
      if (this.blockedStores.has(storeName)) this.recoveryStores.add(storeName);
    }
    return [...this.recoveryStores];
  }

  cancelRecovery() {
    this.recoveryStores.clear();
  }

  async flush() {
    await this.queue;
    const failure = this.unresolvedFailureMessage() || this.failure;
    if (failure) throw new Error(failure);
    return this.bridge.invoke("native_flush_status", {
      pendingWrites: this.pending.size,
    });
  }

  publish(storeName) {
    const change = Object.freeze({
      type: "user-data-changed",
      profile: this.profileId,
      store: storeName,
      changed_at: new Date().toISOString(),
    });
    for (const listener of this.listeners) listener(change);
  }

  listen(listener) {
    if (typeof listener !== "function") return null;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  status() {
    const unresolvedFailure = this.unresolvedFailureMessage();
    return {
      backend: "native-json",
      authority: "native-json",
      migration: "native-no-browser-migration",
      failure: unresolvedFailure || this.failure,
      profileId: this.profileId,
      identities: this.identities,
      blockedStores: [...this.blockedStores].sort(),
      recoveryStores: [...this.recoveryStores].sort(),
      unresolvedWriteStores: [...this.unresolvedWriteFailures.keys()].sort(),
      temporaryFiles: this.temporaryFiles,
      pendingWrites: this.pending.size,
    };
  }
}

export function createTauriUserStorageAdapter(options = {}) {
  return new TauriUserStorageAdapter(options);
}
