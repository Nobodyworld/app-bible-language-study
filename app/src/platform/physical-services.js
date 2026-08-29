export class CacheStoragePhysicalByteStore {
  constructor(cacheStorage, options = {}) {
    this.cacheStorage = cacheStorage;
    this.ResponseImpl = options.ResponseImpl || globalThis.Response || null;
  }
  async createStore(name) {
    await this.cacheStorage.open(name);
    return name;
  }
  async listStoreIdentities() {
    return this.cacheStorage.keys();
  }
  async readResponse(name, path) {
    const store = await this.cacheStorage.open(name);
    return (await store.match(path)) || null;
  }
  async writeResponse(name, path, response) {
    const store = await this.cacheStorage.open(name);
    await store.put(path, response.clone());
  }
  async writeVerifiedBytes(name, path, bytes, options = {}) {
    if (!this.ResponseImpl) throw new Error("Response construction is unavailable for physical bytes.");
    const response = new this.ResponseImpl(bytes, {
      status: 200,
      headers: {
        "content-type": options.mediaType || "application/octet-stream",
        ...(options.packIdentity ? { "x-bibleapp-pack": options.packIdentity } : {}),
      },
    });
    await this.writeResponse(name, path, response);
  }
  async deleteStore(name) {
    return this.cacheStorage.delete(name);
  }
  async storeExists(name) {
    if (typeof this.cacheStorage.has === "function") return this.cacheStorage.has(name);
    return (await this.listStoreIdentities()).includes(name);
  }
  async enumerateStoredPaths(name) {
    const store = await this.cacheStorage.open(name);
    return (await store.keys()).map((request) => request.url);
  }
}

export function createCacheStoragePhysicalByteStore(cacheStorage, options = {}) {
  return cacheStorage ? new CacheStoragePhysicalByteStore(cacheStorage, options) : null;
}

export function createFetchSourceService(fetchImpl) {
  return Object.freeze({
    async fetch(input, options = {}) {
      if (!fetchImpl) throw new Error("Physical-pack source loading is unavailable.");
      return fetchImpl(input, options);
    },
  });
}
export function createWebDigestService(cryptoImpl) {
  return Object.freeze({
    async sha256(bytes) {
      if (!cryptoImpl?.subtle) throw new Error("SHA-256 is unavailable in this environment.");
      const digest = await cryptoImpl.subtle.digest("SHA-256", bytes);
      return `sha256:${[...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
    },
  });
}

export function createStorageEstimateService(storage) {
  return Object.freeze({
    async estimate() {
      if (!storage?.estimate) return { usage: null, quota: null, supported: false };
      const estimate = await storage.estimate();
      return { usage: estimate?.usage ?? null, quota: estimate?.quota ?? null, supported: true };
    },
  });
}

export function createCancellationService() {
  return Object.freeze({
    throwIfAborted(signal) {
      if (signal?.aborted) throw new DOMException("Physical-pack operation was cancelled.", "AbortError");
    },
  });
}
