import { storageIdentitiesForProfile, USER_STORE_NAMES } from "./storage-identities.js";

const DEFAULT_TIMEOUT_MS = 3000;

function clone(value) {
  if (value == null) return value;
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function mergeFallback(fallback, value) {
  if (value == null) return clone(fallback);
  if (fallback && typeof fallback === "object" && !Array.isArray(fallback) && typeof value === "object" && !Array.isArray(value)) {
    return { ...clone(fallback), ...clone(value) };
  }
  return clone(value);
}

export class BrowserUserStorageAdapter {
  constructor(options = {}) {
    this.profileId = options.profileId === "lab" ? "lab" : "stable";
    this.identities = options.identities || storageIdentitiesForProfile(this.profileId);
    this.indexedDb = options.indexedDb || null;
    this.localStorage = options.localStorage || null;
    this.BroadcastChannelImpl = options.BroadcastChannelImpl || null;
    this.setTimer = options.setTimeoutImpl || setTimeout;
    this.clearTimer = options.clearTimeoutImpl || clearTimeout;
    this.now = options.now || (() => new Date().toISOString());
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.databasePromise = null;
    this.database = null;
    this.channel = null;
    this.current = new Map();
    this.backend = "localStorage";
    this.migration = "not-initialized";
    this.failure = null;
  }

  storageKey(storeName) {
    return this.identities.localStorageKeys[storeName] || null;
  }

  legacyStorageKey(storeName) {
    return this.identities.legacyLocalStorageKeys[storeName] || null;
  }

  readLocalKey(key, fallback) {
    if (!key || !this.localStorage) return clone(fallback);
    try {
      const raw = this.localStorage.getItem(key);
      return raw ? mergeFallback(fallback, JSON.parse(raw)) : clone(fallback);
    } catch {
      return clone(fallback);
    }
  }

  readLocal(storeName, fallback) {
    const current = this.readLocalKey(this.storageKey(storeName), null);
    if (current != null) return mergeFallback(fallback, current);
    const legacyKey = this.legacyStorageKey(storeName);
    const legacy = this.readLocalKey(legacyKey, null);
    if (legacy == null) return clone(fallback);
    const normalized = mergeFallback(fallback, legacy);
    if (this.writeLocal(storeName, normalized)) this.removeLocalKey(legacyKey);
    return normalized;
  }

  writeLocal(storeName, value) {
    const key = this.storageKey(storeName);
    if (!key || !this.localStorage) {
      this.failure = "localStorage is not available.";
      return false;
    }
    try {
      this.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      this.failure = error?.message || `Could not write ${key} to localStorage fallback.`;
      return false;
    }
  }

  removeLocalKey(key) {
    if (!key || !this.localStorage) return;
    try {
      this.localStorage.removeItem(key);
    } catch {
      // Migration cleanup is best-effort; persisted authority is unchanged.
    }
  }

  withTimeout(promise, message) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = this.setTimer(() => reject(new Error(message)), this.timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => this.clearTimer(timer));
  }

  openDatabase() {
    if (!this.indexedDb) return Promise.reject(new Error("IndexedDB is not available."));
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise((resolve, reject) => {
      const request = this.indexedDb.open(this.identities.userDatabase, this.identities.userDatabaseVersion);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(this.identities.userObjectStore)) {
          database.createObjectStore(this.identities.userObjectStore, { keyPath: "name" });
        }
      };
      request.onsuccess = () => {
        this.database = request.result;
        this.database.onversionchange = () => {
          this.database?.close?.();
          this.database = null;
          this.databasePromise = null;
        };
        resolve(this.database);
      };
      request.onerror = () => reject(request.error || new Error("Could not open user data store."));
      request.onblocked = () => reject(new Error("User data store upgrade was blocked."));
    });
    return this.databasePromise;
  }

  async readIndexed(storeName) {
    const database = await this.openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(this.identities.userObjectStore, "readonly");
      const request = transaction.objectStore(this.identities.userObjectStore).get(storeName);
      request.onsuccess = () => resolve(request.result?.value || null);
      request.onerror = () => reject(request.error || new Error(`Could not read ${storeName}.`));
    });
  }

  async writeIndexed(storeName, value) {
    const database = await this.openDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(this.identities.userObjectStore, "readwrite");
      const request = transaction.objectStore(this.identities.userObjectStore).put({
        name: storeName,
        value: clone(value),
        updated_at: this.now(),
      });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error(`Could not write ${storeName}.`));
      transaction.onerror = () => reject(transaction.error || new Error(`Could not commit ${storeName}.`));
    });
  }

  async initialize(definitions) {
    const localValues = Object.fromEntries(definitions.map((definition) => [
      definition.name,
      this.readLocal(definition.name, definition.fallback),
    ]));
    if (!this.indexedDb) {
      for (const [name, value] of Object.entries(localValues)) this.current.set(name, clone(value));
      this.backend = "localStorage";
      this.migration = "indexeddb-unavailable";
      this.failure = "IndexedDB is not available.";
      return { values: localValues, ...this.status() };
    }
    try {
      const indexedValues = await this.withTimeout(
        Promise.all(definitions.map((definition) => this.readIndexed(definition.name))),
        "IndexedDB initialization timed out.",
      );
      const values = {};
      const migrations = [];
      let authorityComplete = true;
      definitions.forEach((definition, index) => {
        const indexed = indexedValues[index];
        values[definition.name] = indexed == null ? localValues[definition.name] : indexed;
        this.current.set(definition.name, clone(values[definition.name]));
        if (indexed == null) {
          migrations.push(this.writeIndexed(definition.name, values[definition.name]));
          if (definition.requiredForAuthority !== false) authorityComplete = false;
        }
      });
      if (migrations.length) await this.withTimeout(Promise.all(migrations), "IndexedDB migration timed out.");
      this.backend = "indexedDB";
      this.migration = authorityComplete ? "already-indexed" : "migrated-from-localStorage";
      this.failure = null;
      for (const definition of definitions) this.removeLocalKey(this.storageKey(definition.name));
      for (const key of Object.values(this.identities.legacyLocalStorageKeys)) this.removeLocalKey(key);
      return { values, ...this.status() };
    } catch (error) {
      for (const [name, value] of Object.entries(localValues)) this.current.set(name, clone(value));
      this.backend = "localStorage";
      this.migration = "indexeddb-open-failed";
      this.failure = error?.message || "Could not open IndexedDB.";
      return { values: localValues, ...this.status() };
    }
  }

  readCurrent(storeName, fallback) {
    if (this.current.has(storeName)) return clone(this.current.get(storeName));
    const value = this.readLocal(storeName, fallback);
    this.current.set(storeName, clone(value));
    return value;
  }

  save(storeName, value) {
    this.current.set(storeName, clone(value));
    if (this.backend === "indexedDB" && this.indexedDb) {
      void this.writeIndexed(storeName, value)
        .then(() => this.publish(storeName))
        .catch((error) => {
          this.backend = "localStorage";
          this.failure = error?.message || `Could not write ${storeName} to IndexedDB.`;
          this.writeLocal(storeName, value);
          this.publish(storeName);
        });
      return;
    }
    this.writeLocal(storeName, value);
    this.publish(storeName);
  }

  getChannel() {
    if (!this.BroadcastChannelImpl) return null;
    if (!this.channel) {
      this.channel = new this.BroadcastChannelImpl(this.identities.notificationChannel);
      this.channel.unref?.();
    }
    return this.channel;
  }

  publish(storeName) {
    try {
      this.getChannel()?.postMessage({
        type: "user-data-changed",
        profile: this.profileId,
        store: storeName,
        changed_at: this.now(),
      });
    } catch {
      // Notifications are advisory; persisted storage remains authoritative.
    }
  }

  listen(onChange) {
    const channel = this.getChannel();
    if (!channel) return null;
    const handler = (event) => {
      if (event?.data?.type !== "user-data-changed" || event.data.profile !== this.profileId) return;
      onChange?.(event.data);
    };
    channel.addEventListener("message", handler);
    return () => channel.removeEventListener("message", handler);
  }

  status() {
    return {
      backend: this.backend,
      authority: this.backend,
      migration: this.migration,
      failure: this.failure,
      profileId: this.profileId,
      identities: this.identities,
    };
  }
}

export class MemoryUserStorageAdapter {
  constructor(seed = {}) {
    this.current = new Map(Object.entries(seed).map(([name, value]) => [name, clone(value)]));
  }
  async initialize(definitions) {
    const values = Object.fromEntries(definitions.map(({ name, fallback }) => [name, this.readCurrent(name, fallback)]));
    return { values, ...this.status() };
  }
  readCurrent(storeName, fallback) {
    return this.current.has(storeName) ? clone(this.current.get(storeName)) : clone(fallback);
  }
  save(storeName, value) {
    this.current.set(storeName, clone(value));
  }
  publish() {}
  listen() { return null; }
  status() {
    return { backend: "memory", authority: "memory", migration: "memory", failure: null, profileId: "test" };
  }
}

export function createBrowserUserStorageAdapter(options = {}) {
  const browserWindow = options.windowObject || globalThis.window || null;
  return new BrowserUserStorageAdapter({
    ...options,
    indexedDb: options.indexedDb ?? browserWindow?.indexedDB ?? null,
    localStorage: options.localStorage ?? browserWindow?.localStorage ?? null,
    BroadcastChannelImpl: options.BroadcastChannelImpl ?? globalThis.BroadcastChannel ?? null,
    setTimeoutImpl: options.setTimeoutImpl ?? browserWindow?.setTimeout?.bind(browserWindow) ?? setTimeout,
    clearTimeoutImpl: options.clearTimeoutImpl ?? browserWindow?.clearTimeout?.bind(browserWindow) ?? clearTimeout,
  });
}

export function createMemoryUserStorageAdapter(seed = {}) {
  return new MemoryUserStorageAdapter(seed);
}

export { USER_STORE_NAMES };
