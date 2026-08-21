import {
  PHYSICAL_DATA_MODES,
  canonicalAggregateFrame,
  canonicalPackPath,
  createPhysicalRegistryRecord,
  normalizeSha256,
  physicalPackCacheName,
  validatePhysicalPackCatalog,
  validatePhysicalPackManifest,
} from "./physical-pack-contract.js";
import { createPhysicalPackRegistry } from "./physical-pack-registry.js";

const CACHE_PREFIX = "bibleapp-pack:";
const OPTIONAL_PATH_PACKS = Object.freeze([
  ["data/search/", "search-verses"],
  ["data/commentaries/", "commentary-verse-index"],
]);

let operationSequence = 0;

function isoNow(clock) {
  return new Date(clock()).toISOString();
}

function operationToken(clock) {
  operationSequence += 1;
  return `op-${clock().toString(36)}-${operationSequence.toString(36)}`;
}

function clone(value) {
  if (value == null) return value;
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function sanitizeMessage(error) {
  const message = error instanceof Error ? error.message : String(error || "Operation failed.");
  return message.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 240);
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256Bytes(bytes, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle) throw new Error("SHA-256 verification is unavailable in this browser.");
  return `sha256:${bytesToHex(await cryptoImpl.subtle.digest("SHA-256", bytes))}`;
}

async function sha256Text(value, cryptoImpl = globalThis.crypto) {
  return sha256Bytes(new TextEncoder().encode(value), cryptoImpl);
}

function responseMediaType(response) {
  return String(response.headers.get("content-type") || "application/json").split(";", 1)[0].toLowerCase();
}

function assertResponse(response, label) {
  if (!response?.ok) throw new PhysicalPackError("load_failed", `${label} returned HTTP ${response?.status || 0}.`);
}

function samePackageIdentity(left, right) {
  return Boolean(
    left && right &&
    left.schema_version === right.schema_version &&
    left.package_id === right.package_id &&
    left.content_sha256 === right.content_sha256
  );
}

function appMajor(version) {
  const match = String(version || "").match(/^(\d+)\./);
  return match ? Number(match[1]) : null;
}

function compatibleWithApp(compatibility, appVersion) {
  if (!compatibility) return true;
  const current = appMajor(appVersion);
  const minimum = appMajor(compatibility.minimum_app_version);
  const maximum = appMajor(compatibility.maximum_app_version_exclusive);
  return current != null && minimum != null && maximum != null && current >= minimum && current < maximum;
}

function ensureNotAborted(signal) {
  if (signal?.aborted) throw new DOMException("Physical-pack operation was cancelled.", "AbortError");
}

function pathPackId(path) {
  return OPTIONAL_PATH_PACKS.find(([prefix]) => path.startsWith(prefix))?.[1] || null;
}

export class PhysicalPackError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = "PhysicalPackError";
    this.code = code;
    this.detail = detail;
  }
}

export class PhysicalPackManager {
  constructor(options = {}) {
    this.registry = options.registry || createPhysicalPackRegistry({ indexedDb: options.indexedDb });
    this.cacheStorage = options.cacheStorage || globalThis.caches;
    this.fetchImpl = options.fetchImpl || globalThis.fetch?.bind(globalThis);
    this.cryptoImpl = options.cryptoImpl || globalThis.crypto;
    this.storage = options.storage || globalThis.navigator?.storage || null;
    this.clock = options.clock || Date.now;
    this.baseUrl = new URL(options.baseUrl || globalThis.document?.baseURI || globalThis.location?.href || "http://localhost/");
    this.packageManifest = options.packageManifest || null;
    this.appVersion = options.appVersion || "1.0.0";
    this.mode = PHYSICAL_DATA_MODES.bundled;
    this.catalog = null;
    this.catalogUrl = null;
    this.records = [];
    this.history = [];
    this.orphanCaches = [];
    this.listeners = new Set();
  }

  async initialize() {
    if (!this.cacheStorage || !this.fetchImpl) {
      throw new Error("Cache Storage and fetch are required for physical-pack management.");
    }
    await this.registry.open();
    this.mode = await this.registry.getMeta("physical_data_mode", PHYSICAL_DATA_MODES.bundled);
    if (!Object.values(PHYSICAL_DATA_MODES).includes(this.mode)) this.mode = PHYSICAL_DATA_MODES.bundled;
    this.catalog = await this.registry.getMeta("catalog", null);
    this.catalogUrl = await this.registry.getMeta("catalog_url", null);
    await this.reconcileStartup();
    await this.refreshSnapshot();
    return this;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() {
    const snapshot = this.snapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }

  snapshot() {
    return Object.freeze({
      mode: this.mode,
      catalog: clone(this.catalog),
      catalog_url: this.catalogUrl,
      records: clone(this.records),
      history: clone(this.history),
      orphan_caches: [...this.orphanCaches],
      storage_supported: Boolean(this.cacheStorage && this.registry),
    });
  }

  async refreshSnapshot() {
    this.records = (await this.registry.listRecords()).sort((a, b) => a.pack_id.localeCompare(b.pack_id));
    this.history = await this.registry.listHistory(50);
    this.orphanCaches = await this.findOrphanCaches(this.records);
    this.emit();
    return this.snapshot();
  }

  async setMode(mode) {
    if (!Object.values(PHYSICAL_DATA_MODES).includes(mode)) throw new Error("Unsupported physical data mode.");
    this.mode = mode;
    await this.registry.setMeta("physical_data_mode", mode);
    await this.appendHistory("mode", "completed", { mode });
    await this.refreshSnapshot();
    return mode;
  }

  packageIdentity() {
    const pkg = this.packageManifest?.packages?.[0];
    if (!pkg) throw new PhysicalPackError("incompatible_version", "Package identity metadata is unavailable.");
    return {
      schema_version: this.packageManifest.schema_version || 1,
      package_id: pkg.id,
      content_sha256: pkg.sha256,
    };
  }

  assertCompatibility(value, label) {
    if (!samePackageIdentity(value.package_identity, this.packageIdentity())) {
      throw new PhysicalPackError("incompatible_version", `${label} targets a different package inventory.`);
    }
    if (!compatibleWithApp(value.compatibility, this.appVersion)) {
      throw new PhysicalPackError("incompatible_version", `${label} is incompatible with app version ${this.appVersion}.`);
    }
  }

  async refreshCatalog(url = this.catalogUrl, options = {}) {
    if (!url) throw new PhysicalPackError("load_failed", "Enter a physical-pack catalog URL before refreshing.");
    const catalogUrl = new URL(url, this.baseUrl);
    const response = await this.fetchImpl(catalogUrl, { cache: "no-store", signal: options.signal });
    assertResponse(response, "Physical-pack catalog");
    const bytes = await response.arrayBuffer();
    if (options.expectedSha256) {
      const actual = await sha256Bytes(bytes, this.cryptoImpl);
      if (actual !== normalizeSha256(options.expectedSha256)) {
        throw new PhysicalPackError("corrupt", "Physical-pack catalog digest does not match the expected SHA-256.");
      }
    }
    const catalog = validatePhysicalPackCatalog(JSON.parse(new TextDecoder().decode(bytes)));
    this.assertCompatibility(catalog, "Physical-pack catalog");
    this.catalog = clone(catalog);
    this.catalogUrl = catalogUrl.href;
    await this.registry.setMeta("catalog", this.catalog);
    await this.registry.setMeta("catalog_url", this.catalogUrl);

    const index = new Map(catalog.packs.map((pack) => [pack.pack_id, pack]));
    for (const record of await this.registry.listRecords()) {
      const available = index.get(record.pack_id);
      if (["active", "rollback_available", "update_available"].includes(record.state) && available && available.pack_version !== record.pack_version) {
        await this.registry.putRecord({ ...record, state: "update_available", updated_at: isoNow(this.clock) });
      }
    }
    await this.appendHistory("catalog-refresh", "completed", {
      catalog_version: catalog.catalog_version,
      packs: catalog.packs.length,
    });
    await this.refreshSnapshot();
    return clone(catalog);
  }

  catalogEntry(packId) {
    const entry = this.catalog?.packs?.find((pack) => pack.pack_id === packId);
    if (!entry) throw new PhysicalPackError("not_installed", `Pack ${packId} is not present in the current catalog.`);
    return entry;
  }

  installationOrder(packId) {
    const ordered = [];
    const visited = new Set();
    const visiting = new Set();
    const visit = (id) => {
      if (visited.has(id)) return;
      if (visiting.has(id)) throw new PhysicalPackError("dependency_missing", `Catalog dependency cycle includes ${id}.`);
      visiting.add(id);
      const entry = this.catalogEntry(id);
      (entry.dependencies || []).forEach(visit);
      visiting.delete(id);
      visited.add(id);
      ordered.push(entry);
    };
    visit(packId);
    return ordered;
  }

  async storageEstimate() {
    try {
      const estimate = await this.storage?.estimate?.();
      return estimate ? { usage: Number(estimate.usage || 0), quota: Number(estimate.quota || 0) } : null;
    } catch {
      return null;
    }
  }

  async plan(packId, action = "install") {
    const records = await this.registry.listRecords();
    const current = records.find((record) => record.pack_id === packId) || null;
    if (action === "remove" || action === "verify" || action === "repair" || action === "rollback") {
      const blockedBy = action === "remove"
        ? records.filter((record) => record.pack_id !== packId && record.active_cache && record.active_manifest?.dependencies?.includes(packId)).map((record) => record.pack_id)
        : [];
      return Object.freeze({
        action,
        pack_id: packId,
        mutates: false,
        current: clone(current),
        available: Boolean(current),
        blocked_by: blockedBy,
        storage: await this.storageEstimate(),
      });
    }
    const order = this.installationOrder(packId);
    const active = new Set(records.filter((record) => ["active", "update_available", "rollback_available"].includes(record.state)).map((record) => record.pack_id));
    const required = order.filter((entry) => !active.has(entry.pack_id) || entry.pack_id === packId);
    return Object.freeze({
      action,
      pack_id: packId,
      mutates: false,
      dependency_order: order.map((entry) => entry.pack_id),
      required_pack_ids: required.map((entry) => entry.pack_id),
      files: required.reduce((sum, entry) => sum + entry.files, 0),
      bytes: required.reduce((sum, entry) => sum + entry.bytes, 0),
      transfer_bytes: required.reduce((sum, entry) => sum + entry.transfer_bytes, 0),
      storage: await this.storageEstimate(),
    });
  }

  async loadManifest(entry, signal) {
    const manifestUrl = new URL(entry.manifest_path, this.catalogUrl);
    const response = await this.fetchImpl(manifestUrl, { cache: "no-store", signal });
    assertResponse(response, `Manifest for ${entry.pack_id}`);
    const bytes = await response.arrayBuffer();
    const digest = await sha256Bytes(bytes, this.cryptoImpl);
    if (digest !== entry.manifest_sha256) {
      throw new PhysicalPackError("corrupt", `Manifest digest for ${entry.pack_id} does not match the catalog.`);
    }
    const manifest = validatePhysicalPackManifest(JSON.parse(new TextDecoder().decode(bytes)));
    if (manifest.pack_id !== entry.pack_id || manifest.pack_version !== entry.pack_version) {
      throw new PhysicalPackError("corrupt", `Manifest identity for ${entry.pack_id} does not match the catalog.`);
    }
    this.assertCompatibility(manifest, `Manifest for ${entry.pack_id}`);
    const aggregate = await sha256Text(canonicalAggregateFrame(manifest.files), this.cryptoImpl);
    if (aggregate !== manifest.aggregate_sha256) {
      throw new PhysicalPackError("corrupt", `Manifest aggregate digest for ${entry.pack_id} is invalid.`);
    }
    return { manifest: clone(manifest), manifestUrl: manifestUrl.href };
  }

  async install(packId, options = {}) {
    const plan = await this.plan(packId, options.action || "install");
    ensureNotAborted(options.signal);
    for (const entry of this.installationOrder(packId)) {
      const current = await this.registry.getRecord(entry.pack_id);
      const isTarget = entry.pack_id === packId;
      const needsInstall = !current || !["active", "update_available", "rollback_available"].includes(current.state);
      const needsVersion = current?.pack_version !== entry.pack_version;
      if (needsInstall || needsVersion || isTarget && options.force) {
        await this.installOne(entry, { ...options, plan });
      }
    }
    await this.refreshSnapshot();
    return this.registry.getRecord(packId);
  }

  async installOne(entry, options = {}) {
    const signal = options.signal;
    const operation = operationToken(this.clock);
    const previous = await this.registry.getRecord(entry.pack_id);
    let stagingCacheName = null;
    let activeCacheName = null;
    try {
      ensureNotAborted(signal);
      const { manifest, manifestUrl } = await this.loadManifest(entry, signal);
      for (const dependency of manifest.dependencies) {
        const record = await this.registry.getRecord(dependency);
        if (!record || !["active", "update_available", "rollback_available"].includes(record.state)) {
          throw new PhysicalPackError("dependency_missing", `${entry.pack_id} requires active pack ${dependency}.`);
        }
      }
      stagingCacheName = physicalPackCacheName(entry.pack_id, entry.pack_version, entry.manifest_sha256, `staging-${operation}`);
      activeCacheName = physicalPackCacheName(entry.pack_id, entry.pack_version, entry.manifest_sha256, `active-${operation}`);
      const stagingCache = await this.cacheStorage.open(stagingCacheName);
      const stagingRecord = {
        ...createPhysicalRegistryRecord({
          pack_id: entry.pack_id,
          pack_version: entry.pack_version,
          manifest_sha256: entry.manifest_sha256,
          aggregate_sha256: manifest.aggregate_sha256,
          state: "staging",
          staging_cache: stagingCacheName,
          active_cache: previous?.active_cache || null,
          rollback_cache: previous?.rollback_cache || null,
          expected_files: manifest.totals.files,
          expected_bytes: manifest.totals.bytes,
          verified_files: 0,
          verified_bytes: 0,
          source_catalog_id: this.catalog.catalog_version,
          installed_at: previous?.installed_at || null,
          updated_at: isoNow(this.clock),
        }),
        manifest_url: manifestUrl,
        active_manifest: previous?.active_manifest || null,
        rollback: previous?.rollback || null,
        previous_active: previous ? clone(previous) : null,
        provenance: clone(manifest.provenance),
        compatibility: clone(manifest.compatibility),
      };
      await this.registry.putRecord(stagingRecord);
      this.emitProgress(options, { phase: "staging", pack_id: entry.pack_id, completed: 0, total: manifest.files.length });

      let verifiedBytes = 0;
      let verifiedFiles = 0;
      for (const file of manifest.files) {
        ensureNotAborted(signal);
        const artifactUrl = new URL(`files/${file.path}`, manifestUrl);
        const response = await this.fetchImpl(artifactUrl, { cache: "no-store", signal });
        assertResponse(response, file.path);
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength !== file.bytes) {
          throw new PhysicalPackError("corrupt", `${file.path} has an unexpected byte length.`);
        }
        const digest = await sha256Bytes(bytes, this.cryptoImpl);
        if (digest !== file.sha256) throw new PhysicalPackError("corrupt", `${file.path} failed SHA-256 verification.`);
        const mediaType = responseMediaType(response);
        if (mediaType !== file.media_type) throw new PhysicalPackError("corrupt", `${file.path} has unexpected media type ${mediaType}.`);
        const runtimeUrl = new URL(file.path, this.baseUrl).href;
        await stagingCache.put(runtimeUrl, new Response(bytes, {
          status: 200,
          headers: { "content-type": file.media_type, "x-bibleapp-pack": `${entry.pack_id}@${entry.pack_version}` },
        }));
        verifiedFiles += 1;
        verifiedBytes += bytes.byteLength;
        this.emitProgress(options, { phase: "staging", pack_id: entry.pack_id, completed: verifiedFiles, total: manifest.files.length });
      }

      await this.registry.putRecord({
        ...stagingRecord,
        state: "verifying",
        verified_files: verifiedFiles,
        verified_bytes: verifiedBytes,
        updated_at: isoNow(this.clock),
      });
      const activeCache = await this.cacheStorage.open(activeCacheName);
      for (const request of await stagingCache.keys()) {
        const response = await stagingCache.match(request);
        if (!response) throw new PhysicalPackError("corrupt", "A staged response disappeared before activation.");
        await activeCache.put(request, response.clone());
      }
      const activatedAt = isoNow(this.clock);
      const previousActiveIsValid = previous?.active_cache && !["corrupt", "repair_required", "failed"].includes(previous.state);
      const rollback = previousActiveIsValid
        ? {
          pack_version: previous.pack_version,
          manifest_sha256: previous.manifest_sha256,
          aggregate_sha256: previous.aggregate_sha256,
          cache: previous.active_cache,
          manifest: clone(previous.active_manifest),
          verified_files: previous.verified_files,
          verified_bytes: previous.verified_bytes,
          activated_at: previous.activated_at,
        }
        : previous?.rollback?.cache
          ? clone(previous.rollback)
          : null;
      const activeRecord = {
        ...createPhysicalRegistryRecord({
          pack_id: entry.pack_id,
          pack_version: entry.pack_version,
          manifest_sha256: entry.manifest_sha256,
          aggregate_sha256: manifest.aggregate_sha256,
          state: rollback ? "rollback_available" : "active",
          active_cache: activeCacheName,
          rollback_cache: rollback?.cache || null,
          expected_files: manifest.totals.files,
          expected_bytes: manifest.totals.bytes,
          verified_files: verifiedFiles,
          verified_bytes: verifiedBytes,
          source_catalog_id: this.catalog.catalog_version,
          installed_at: previous?.installed_at || activatedAt,
          activated_at: activatedAt,
          last_verified_at: activatedAt,
          updated_at: activatedAt,
        }),
        manifest_url: manifestUrl,
        active_manifest: manifest,
        rollback,
        previous_active: null,
        provenance: clone(manifest.provenance),
        compatibility: clone(manifest.compatibility),
        last_failure: null,
      };
      await this.registry.putRecord(activeRecord);
      try {
        await this.cacheStorage.delete(stagingCacheName);
      } catch (cleanupError) {
        await this.appendHistory("cleanup", "failed", { pack_id: entry.pack_id, message: sanitizeMessage(cleanupError) });
      }
      await this.appendHistory(options.action || (previous ? "update" : "install"), "completed", {
        pack_id: entry.pack_id,
        pack_version: entry.pack_version,
        files: verifiedFiles,
        bytes: verifiedBytes,
        rollback_retained: Boolean(rollback),
      });
      this.emitProgress(options, { phase: "active", pack_id: entry.pack_id, completed: verifiedFiles, total: manifest.files.length });
      return activeRecord;
    } catch (error) {
      if (stagingCacheName) await this.cacheStorage.delete(stagingCacheName).catch(() => false);
      if (activeCacheName) await this.cacheStorage.delete(activeCacheName).catch(() => false);
      const cancelled = error?.name === "AbortError";
      if (previous?.active_cache) {
        await this.registry.putRecord({ ...previous, last_failure: {
          code: cancelled ? "cancelled" : error.code || "load_failed",
          message: sanitizeMessage(error),
          at: isoNow(this.clock),
        } });
      } else {
        const digest = entry.manifest_sha256;
        await this.registry.putRecord({
          ...createPhysicalRegistryRecord({
            pack_id: entry.pack_id,
            pack_version: entry.pack_version,
            manifest_sha256: digest,
            aggregate_sha256: `sha256:${"0".repeat(64)}`,
            state: "failed",
            failure: { code: cancelled ? "cancelled" : error.code || "load_failed", message: sanitizeMessage(error) },
            updated_at: isoNow(this.clock),
          }),
          last_failure: { code: cancelled ? "cancelled" : error.code || "load_failed", message: sanitizeMessage(error), at: isoNow(this.clock) },
        });
      }
      await this.appendHistory(options.action || "install", cancelled ? "cancelled" : "failed", {
        pack_id: entry.pack_id,
        message: sanitizeMessage(error),
      });
      await this.refreshSnapshot();
      throw error;
    }
  }

  emitProgress(options, progress) {
    options.onProgress?.(Object.freeze({ ...progress }));
  }

  async verify(packId) {
    const record = await this.registry.getRecord(packId);
    if (!record?.active_cache || !record.active_manifest) {
      throw new PhysicalPackError("not_installed", `${packId} has no active physical copy to verify.`);
    }
    try {
      const cache = await this.cacheStorage.open(record.active_cache);
      let bytes = 0;
      for (const file of record.active_manifest.files) {
        const response = await cache.match(new URL(file.path, this.baseUrl).href);
        if (!response) throw new PhysicalPackError("corrupt", `${file.path} is missing from the active cache.`);
        const body = await response.arrayBuffer();
        if (body.byteLength !== file.bytes || await sha256Bytes(body, this.cryptoImpl) !== file.sha256) {
          throw new PhysicalPackError("corrupt", `${file.path} failed active-cache verification.`);
        }
        bytes += body.byteLength;
      }
      const now = isoNow(this.clock);
      const next = {
        ...record,
        state: record.rollback_cache ? "rollback_available" : "active",
        verified_files: record.active_manifest.files.length,
        verified_bytes: bytes,
        last_verified_at: now,
        updated_at: now,
        last_failure: null,
      };
      await this.registry.putRecord(next);
      await this.appendHistory("verify", "completed", { pack_id: packId, files: next.verified_files, bytes });
      await this.refreshSnapshot();
      return next;
    } catch (error) {
      await this.markCorrupt(packId, error);
      throw error;
    }
  }

  async markCorrupt(packId, error = "Physical pack is corrupt.") {
    const record = await this.registry.getRecord(packId);
    if (!record) return null;
    const next = {
      ...record,
      state: "corrupt",
      last_failure: { code: "corrupt", message: sanitizeMessage(error), at: isoNow(this.clock) },
      updated_at: isoNow(this.clock),
    };
    await this.registry.putRecord(next);
    await this.appendHistory("verify", "failed", { pack_id: packId, message: sanitizeMessage(error) });
    await this.refreshSnapshot();
    return next;
  }

  async repair(packId, options = {}) {
    return this.install(packId, { ...options, action: "repair", force: true });
  }

  async update(packId, options = {}) {
    const current = await this.registry.getRecord(packId);
    const available = this.catalogEntry(packId);
    if (current?.pack_version === available.pack_version) return this.verify(packId);
    return this.install(packId, { ...options, action: "update", force: true });
  }

  async rollback(packId) {
    const record = await this.registry.getRecord(packId);
    const rollback = record?.rollback;
    if (!record?.active_cache || !rollback?.cache || !rollback.manifest) {
      throw new PhysicalPackError("not_installed", `${packId} has no retained rollback copy.`);
    }
    if (!(await this.cacheStorage.has?.(rollback.cache)) && !(await this.cacheStorage.keys()).includes(rollback.cache)) {
      throw new PhysicalPackError("corrupt", `The retained rollback cache for ${packId} is missing.`);
    }
    const now = isoNow(this.clock);
    const nextRollback = {
      pack_version: record.pack_version,
      manifest_sha256: record.manifest_sha256,
      aggregate_sha256: record.aggregate_sha256,
      cache: record.active_cache,
      manifest: clone(record.active_manifest),
      verified_files: record.verified_files,
      verified_bytes: record.verified_bytes,
      activated_at: record.activated_at,
    };
    const next = {
      ...record,
      pack_version: rollback.pack_version,
      manifest_sha256: rollback.manifest_sha256,
      aggregate_sha256: rollback.aggregate_sha256,
      active_cache: rollback.cache,
      rollback_cache: nextRollback.cache,
      active_manifest: clone(rollback.manifest),
      rollback: nextRollback,
      expected_files: rollback.manifest.totals.files,
      expected_bytes: rollback.manifest.totals.bytes,
      verified_files: rollback.verified_files,
      verified_bytes: rollback.verified_bytes,
      state: "rollback_available",
      activated_at: now,
      updated_at: now,
      last_failure: null,
    };
    await this.registry.putRecord(next);
    await this.appendHistory("rollback", "completed", { pack_id: packId, pack_version: next.pack_version });
    await this.refreshSnapshot();
    return next;
  }

  async remove(packId, options = {}) {
    const record = await this.registry.getRecord(packId);
    if (!record) return false;
    const plan = await this.plan(packId, "remove");
    if (plan.blocked_by.length && !options.cascade) {
      throw new PhysicalPackError("dependency_missing", `${packId} is required by active pack(s): ${plan.blocked_by.join(", ")}. Remove dependents first.`);
    }
    if (options.cascade) {
      for (const dependent of plan.blocked_by) await this.remove(dependent, { cascade: true });
    }
    const pending = [record.active_cache, record.rollback_cache, record.staging_cache].filter(Boolean);
    await this.registry.putRecord({
      ...record,
      state: "removing",
      pending_deletions: pending,
      active_cache: null,
      rollback_cache: null,
      staging_cache: null,
      updated_at: isoNow(this.clock),
    });
    try {
      for (const cacheName of pending) await this.cacheStorage.delete(cacheName);
      await this.registry.deleteRecord(packId);
      await this.appendHistory("remove", "completed", { pack_id: packId, caches: pending.length });
      await this.refreshSnapshot();
      return true;
    } catch (error) {
      const interrupted = await this.registry.getRecord(packId);
      await this.registry.putRecord({
        ...interrupted,
        state: "failed",
        pending_deletions: pending,
        last_failure: { code: "cleanup_failed", message: sanitizeMessage(error), at: isoNow(this.clock) },
      });
      await this.appendHistory("remove", "failed", { pack_id: packId, message: sanitizeMessage(error) });
      await this.refreshSnapshot();
      throw error;
    }
  }

  async reconcileStartup() {
    const cacheNames = new Set(await this.cacheStorage.keys());
    for (const record of await this.registry.listRecords()) {
      if (["staging", "verifying"].includes(record.state)) {
        if (record.staging_cache) await this.cacheStorage.delete(record.staging_cache).catch(() => false);
        if (record.previous_active?.active_cache && cacheNames.has(record.previous_active.active_cache)) {
          await this.registry.putRecord({ ...record.previous_active, last_failure: {
            code: "interrupted",
            message: "An interrupted operation was recovered; the previous active copy was preserved.",
            at: isoNow(this.clock),
          } });
        } else {
          await this.registry.putRecord({ ...record, state: "failed", staging_cache: null, previous_active: null, last_failure: {
            code: "interrupted",
            message: "An interrupted operation was cleared before activation.",
            at: isoNow(this.clock),
          } });
        }
        await this.appendHistory("startup-reconcile", "completed", { pack_id: record.pack_id, recovered: true });
        continue;
      }
      if (record.state === "removing" || record.pending_deletions?.length && !record.active_cache) {
        for (const cacheName of record.pending_deletions || []) await this.cacheStorage.delete(cacheName).catch(() => false);
        await this.registry.deleteRecord(record.pack_id);
        await this.appendHistory("startup-reconcile", "completed", { pack_id: record.pack_id, removal_completed: true });
        continue;
      }
      if (record.active_cache && !cacheNames.has(record.active_cache)) {
        if (record.rollback?.cache && cacheNames.has(record.rollback.cache)) {
          const rollback = record.rollback;
          await this.registry.putRecord({
            ...record,
            pack_version: rollback.pack_version,
            manifest_sha256: rollback.manifest_sha256,
            aggregate_sha256: rollback.aggregate_sha256,
            active_cache: rollback.cache,
            active_manifest: rollback.manifest,
            rollback_cache: null,
            rollback: null,
            expected_files: rollback.manifest.totals.files,
            expected_bytes: rollback.manifest.totals.bytes,
            verified_files: rollback.verified_files,
            verified_bytes: rollback.verified_bytes,
            state: "active",
            last_failure: { code: "active_cache_missing", message: "The retained rollback copy was activated during startup recovery.", at: isoNow(this.clock) },
          });
        } else {
          await this.registry.putRecord({ ...record, state: "repair_required", last_failure: {
            code: "active_cache_missing",
            message: "The active cache is missing and must be reinstalled or repaired.",
            at: isoNow(this.clock),
          } });
        }
      }
    }
    const referenced = await this.registry.listRecords();
    const referencedNames = new Set(referenced.flatMap((record) => [record.active_cache, record.rollback_cache, record.staging_cache]).filter(Boolean));
    for (const name of await this.cacheStorage.keys()) {
      if (
        (name.startsWith(`${CACHE_PREFIX}staging-`) || name.startsWith(`${CACHE_PREFIX}staging:`)) &&
        !referencedNames.has(name)
      ) {
        await this.cacheStorage.delete(name).catch(() => false);
      }
    }
  }

  async findOrphanCaches(records = []) {
    const referenced = new Set(records.flatMap((record) => [record.active_cache, record.rollback_cache, record.staging_cache, ...(record.pending_deletions || [])]).filter(Boolean));
    return (await this.cacheStorage.keys()).filter((name) => name.startsWith(CACHE_PREFIX) && !referenced.has(name)).sort();
  }

  async cleanup() {
    const orphans = await this.findOrphanCaches(await this.registry.listRecords());
    let removed = 0;
    for (const name of orphans) {
      if (await this.cacheStorage.delete(name)) removed += 1;
    }
    await this.appendHistory("cleanup", "completed", { orphan_caches_removed: removed });
    await this.refreshSnapshot();
    return { orphan_caches_removed: removed };
  }

  async appendHistory(action, state, detail = {}) {
    const createdAt = isoNow(this.clock);
    const entry = {
      id: `${createdAt}-${operationToken(this.clock)}`,
      action,
      state,
      created_at: createdAt,
      detail: clone(detail),
    };
    await this.registry.appendHistory(entry);
    return entry;
  }

  async resolve(path) {
    const resolvedUrl = new URL(String(path || ""), this.baseUrl);
    const basePath = this.baseUrl.pathname.endsWith("/") ? this.baseUrl.pathname : `${this.baseUrl.pathname}/`;
    if (resolvedUrl.origin !== this.baseUrl.origin || !resolvedUrl.pathname.startsWith(basePath)) {
      throw new PhysicalPackError("load_failed", "Managed runtime paths must remain inside the application origin and base path.");
    }
    const relativePath = decodeURIComponent(resolvedUrl.pathname.slice(basePath.length));
    const canonical = canonicalPackPath(relativePath, "runtime path");
    if (this.mode !== PHYSICAL_DATA_MODES.managed) return null;
    const packId = pathPackId(canonical);
    if (!packId) return null;
    const record = await this.registry.getRecord(packId);
    if (!record) throw new PhysicalPackError("not_installed", `${packId} is not installed.`, { pack_id: packId });
    if (record.state === "incompatible") throw new PhysicalPackError("incompatible_version", `${packId} is incompatible.`, { pack_id: packId });
    if (["corrupt", "repair_required"].includes(record.state)) throw new PhysicalPackError("corrupt", `${packId} must be repaired.`, { pack_id: packId });
    if (record.state === "failed") throw new PhysicalPackError("load_failed", `${packId} failed to load.`, { pack_id: packId });
    if (!record.active_cache || !record.active_manifest) throw new PhysicalPackError("not_installed", `${packId} has no active copy.`, { pack_id: packId });
    const declared = record.active_manifest.files.some((file) => file.path === canonical);
    if (!declared) throw new PhysicalPackError("load_failed", `${canonical} is not declared by ${packId}.`, { pack_id: packId });
    const cache = await this.cacheStorage.open(record.active_cache);
    const response = await cache.match(new URL(canonical, this.baseUrl).href);
    if (!response) {
      await this.markCorrupt(packId, `${canonical} is missing from the active cache.`);
      throw new PhysicalPackError("corrupt", `${packId} is missing a required file.`, { pack_id: packId });
    }
    return {
      response: response.clone(),
      source_key: `${packId}@${record.pack_version}:${record.manifest_sha256}`,
      pack_id: packId,
    };
  }
}

export function createPhysicalPackManager(options = {}) {
  return new PhysicalPackManager(options);
}
