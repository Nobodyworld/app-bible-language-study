export const PHYSICAL_PACK_DB_NAME = "bibleapp-physical-packs";
export const PHYSICAL_PACK_DB_VERSION = 1;

const RECORD_STORE = "pack_records";
const META_STORE = "metadata";
const HISTORY_STORE = "operation_history";
const OPEN_TIMEOUT_MS = 2500;

function clone(value) {
  if (value == null) return value;
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Physical-pack registry request failed."));
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Physical-pack registry transaction failed."));
    transaction.onabort = () => reject(transaction.error || new Error("Physical-pack registry transaction was aborted."));
  });
}

function withTimeout(promise, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), OPEN_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export class BrowserPhysicalPackRegistry {
  constructor(indexedDb = globalThis.indexedDB, options = {}) {
    this.indexedDb = indexedDb;
    this.dbName = options.dbName || PHYSICAL_PACK_DB_NAME;
    this.database = null;
  }

  async open() {
    if (this.database) return this;
    if (!this.indexedDb) throw new Error("IndexedDB is unavailable for the physical-pack registry.");
    const request = this.indexedDb.open(this.dbName, PHYSICAL_PACK_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(RECORD_STORE)) {
        database.createObjectStore(RECORD_STORE, { keyPath: "pack_id" });
      }
      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE, { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains(HISTORY_STORE)) {
        const history = database.createObjectStore(HISTORY_STORE, { keyPath: "id" });
        history.createIndex("created_at", "created_at");
      }
    };
    this.database = await withTimeout(
      requestResult(request),
      "Physical-pack IndexedDB open timed out; bundled data remains available.",
    );
    this.database.onversionchange = () => {
      this.database?.close();
      this.database = null;
    };
    return this;
  }

  transaction(storeNames, mode = "readonly") {
    if (!this.database) throw new Error("Physical-pack registry has not been opened.");
    return this.database.transaction(storeNames, mode);
  }

  async listRecords() {
    const transaction = this.transaction(RECORD_STORE);
    return clone(await requestResult(transaction.objectStore(RECORD_STORE).getAll()));
  }

  async getRecord(packId) {
    const transaction = this.transaction(RECORD_STORE);
    return clone(await requestResult(transaction.objectStore(RECORD_STORE).get(packId))) || null;
  }

  async putRecord(record) {
    const transaction = this.transaction(RECORD_STORE, "readwrite");
    transaction.objectStore(RECORD_STORE).put(clone(record));
    await transactionComplete(transaction);
    return clone(record);
  }

  async deleteRecord(packId) {
    const transaction = this.transaction(RECORD_STORE, "readwrite");
    transaction.objectStore(RECORD_STORE).delete(packId);
    await transactionComplete(transaction);
  }

  async getMeta(key, fallback = null) {
    const transaction = this.transaction(META_STORE);
    const value = await requestResult(transaction.objectStore(META_STORE).get(key));
    return value ? clone(value.value) : clone(fallback);
  }

  async setMeta(key, value) {
    const transaction = this.transaction(META_STORE, "readwrite");
    transaction.objectStore(META_STORE).put({ key, value: clone(value) });
    await transactionComplete(transaction);
    return clone(value);
  }

  async appendHistory(entry) {
    const transaction = this.transaction(HISTORY_STORE, "readwrite");
    transaction.objectStore(HISTORY_STORE).put(clone(entry));
    await transactionComplete(transaction);
    return clone(entry);
  }

  async listHistory(limit = 50) {
    const transaction = this.transaction(HISTORY_STORE);
    const entries = await requestResult(transaction.objectStore(HISTORY_STORE).getAll());
    return clone(entries)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, Math.max(0, limit));
  }
}

export class MemoryPhysicalPackRegistry {
  constructor(seed = {}) {
    this.records = new Map((seed.records || []).map((record) => [record.pack_id, clone(record)]));
    this.metadata = new Map(Object.entries(seed.metadata || {}).map(([key, value]) => [key, clone(value)]));
    this.history = new Map((seed.history || []).map((entry) => [entry.id, clone(entry)]));
  }

  async open() {
    return this;
  }

  async listRecords() {
    return [...this.records.values()].map(clone);
  }

  async getRecord(packId) {
    return clone(this.records.get(packId)) || null;
  }

  async putRecord(record) {
    this.records.set(record.pack_id, clone(record));
    return clone(record);
  }

  async deleteRecord(packId) {
    this.records.delete(packId);
  }

  async getMeta(key, fallback = null) {
    return this.metadata.has(key) ? clone(this.metadata.get(key)) : clone(fallback);
  }

  async setMeta(key, value) {
    this.metadata.set(key, clone(value));
    return clone(value);
  }

  async appendHistory(entry) {
    this.history.set(entry.id, clone(entry));
    return clone(entry);
  }

  async listHistory(limit = 50) {
    return [...this.history.values()]
      .map(clone)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, Math.max(0, limit));
  }
}

export function createPhysicalPackRegistry(options = {}) {
  if (options.memory) return new MemoryPhysicalPackRegistry(options.seed);
  return new BrowserPhysicalPackRegistry(options.indexedDb, { dbName: options.dbName });
}
