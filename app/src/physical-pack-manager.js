import {
  PHYSICAL_DATA_MODES,
  appVersionIsCompatible,
  canonicalAggregateFrame,
  canonicalPackPath,
  createPhysicalRegistryRecord,
  isOwnedPhysicalPackCacheName,
  normalizeSha256,
  physicalPackCacheName,
  validateDistributionManifest,
  validatePhysicalPackCatalog,
  validatePhysicalPackManifest,
} from "./physical-pack-contract.js";
import { createPhysicalPackRegistry } from "./physical-pack-registry.js";
import {
  createCacheStoragePhysicalByteStore,
  createCancellationService,
  createFetchSourceService,
  createStorageEstimateService,
  createWebDigestService,
} from "./platform/physical-services.js";

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

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
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

function pathPackId(path) {
  return OPTIONAL_PATH_PACKS.find(([prefix]) => path.startsWith(prefix))?.[1] || null;
}

function recordIsVerifiedActive(record) {
  return Boolean(
    record &&
    ["active", "update_available", "rollback_available"].includes(record.state) &&
    record.active_cache &&
    record.active_manifest &&
    record.verified_files === record.expected_files &&
    record.verified_bytes === record.expected_bytes
  );
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
    this.byteStore = options.byteStore || createCacheStoragePhysicalByteStore(options.cacheStorage, {
      ResponseImpl: options.ResponseImpl,
    });
    this.sourceLoader = options.sourceLoader || createFetchSourceService(options.fetchImpl);
    this.digestService = options.digestService || (options.cryptoImpl ? createWebDigestService(options.cryptoImpl) : null);
    this.storageEstimateService = options.storageEstimateService || createStorageEstimateService(options.storage);
    this.cancellation = options.cancellation || createCancellationService();
    this.cachePrefix = options.cacheNamePrefix || CACHE_PREFIX;
    this.beforeStoredPackVerification = options.beforeStoredPackVerification || null;
    this.clock = options.clock || Date.now;
    this.baseUrl = new URL(options.baseUrl || "http://localhost/");
    this.packageManifest = options.packageManifest || null;
    this.distributionManifest = options.distributionManifest
      ? validateDistributionManifest(options.distributionManifest)
      : null;
    this.managedOptionalPackIds = new Set(
      this.distributionManifest?.managed_optional_pack_ids || OPTIONAL_PATH_PACKS.map(([, packId]) => packId),
    );
    this.bundledFallback = this.distributionManifest?.bundled_fallback === true;
    this.appVersion = options.appVersion || "1.0.0";
    this.mode = PHYSICAL_DATA_MODES.bundled;
    this.catalog = null;
    this.catalogUrl = null;
    this.records = [];
    this.history = [];
    this.orphanCaches = [];
    this.listeners = new Set();
    this.startupReconciliation = Promise.resolve();
  }

  async initialize() {
    if (!this.byteStore || !this.sourceLoader || !this.digestService) {
      throw new Error("Physical byte storage, source loading, and SHA-256 services are required for physical-pack management.");
    }
    await this.registry.open();
    this.mode = await this.registry.getMeta("physical_data_mode", PHYSICAL_DATA_MODES.bundled);
    if (!Object.values(PHYSICAL_DATA_MODES).includes(this.mode)) this.mode = PHYSICAL_DATA_MODES.bundled;
    await this.restorePersistedCatalog();
    await this.reconcileStartup();
    await this.refreshSnapshot();
    this.startupReconciliation = this.completeStartupReconciliation();
    return this;
  }

  async restorePersistedCatalog() {
    const persistedCatalog = await this.registry.getMeta("catalog", null);
    const persistedCatalogUrl = await this.registry.getMeta("catalog_url", null);
    if (persistedCatalog == null && persistedCatalogUrl == null) return;
    try {
      if (persistedCatalog == null || persistedCatalogUrl == null) {
        throw new PhysicalPackError("corrupt", "Persisted physical-pack catalog metadata is incomplete.");
      }
      const catalog = validatePhysicalPackCatalog(persistedCatalog);
      this.assertCompatibility(catalog, "Persisted physical-pack catalog");
      const catalogUrl = this.sameOriginUrl(persistedCatalogUrl, this.baseUrl, "Persisted physical-pack catalog URL");
      this.catalog = clone(catalog);
      this.catalogUrl = catalogUrl.href;
    } catch (error) {
      this.catalog = null;
      this.catalogUrl = null;
      this.mode = PHYSICAL_DATA_MODES.bundled;
      await this.registry.setMeta("catalog", null);
      await this.registry.setMeta("catalog_url", null);
      await this.registry.setMeta("physical_data_mode", this.mode);
      await this.appendHistory("startup-reconcile", "failed", {
        catalog_rejected: true,
        code: error?.code || "corrupt",
        message: sanitizeMessage(error),
      });
    }
  }

  async whenStartupReconciled() {
    await this.startupReconciliation;
    return this.snapshot();
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
      storage_supported: Boolean(this.byteStore && this.registry),
      distribution: clone(this.distributionManifest),
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
    if (!appVersionIsCompatible(value.compatibility, this.appVersion)) {
      throw new PhysicalPackError("incompatible_version", `${label} is incompatible with app version ${this.appVersion}.`);
    }
  }

  sameOriginUrl(value, base, label, { allowFragment = false } = {}) {
    let resolved;
    try {
      resolved = new URL(String(value || ""), base);
    } catch {
      throw new PhysicalPackError("source_policy", `${label} is not a valid URL.`);
    }
    if (!/^https?:$/.test(resolved.protocol)) {
      throw new PhysicalPackError("source_policy", `${label} must use HTTP or HTTPS.`);
    }
    if (resolved.username || resolved.password) {
      throw new PhysicalPackError("source_policy", `${label} must not contain credentials.`);
    }
    if (resolved.origin !== this.baseUrl.origin) {
      throw new PhysicalPackError("source_policy", `${label} must use the application origin.`);
    }
    if (resolved.hash && !allowFragment) {
      throw new PhysicalPackError("source_policy", `${label} must not contain a fragment.`);
    }
    return resolved;
  }

  async refreshCatalog(url = this.catalogUrl, options = {}) {
    if (!url) throw new PhysicalPackError("load_failed", "Enter a physical-pack catalog URL before refreshing.");
    const catalogUrl = this.sameOriginUrl(url, this.baseUrl, "Physical-pack catalog URL");
    const response = await this.sourceLoader.fetch(catalogUrl, { cache: "no-store", signal: options.signal });
    assertResponse(response, "Physical-pack catalog");
    const bytes = await response.arrayBuffer();
    if (options.expectedSha256) {
      const actual = await this.digestService.sha256(bytes);
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
      const estimate = await this.storageEstimateService.estimate();
      const usage = Number(estimate?.usage);
      const quota = Number(estimate?.quota);
      const known = Number.isFinite(usage) && usage >= 0 && Number.isFinite(quota) && quota > 0;
      return {
        known,
        usage: known ? usage : null,
        quota: known ? quota : null,
        available: known ? Math.max(0, quota - usage) : null,
      };
    } catch {
      return { known: false, usage: null, quota: null, available: null };
    }
  }

  async plan(packId, action = "install") {
    const records = await this.registry.listRecords();
    const current = records.find((record) => record.pack_id === packId) || null;
    if (action === "remove" || action === "verify" || action === "rollback") {
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
    const active = new Set(records.filter(recordIsVerifiedActive).map((record) => record.pack_id));
    const required = order.filter((entry) => !active.has(entry.pack_id) || entry.pack_id === packId);
    const storage = await this.storageEstimate();
    return Object.freeze({
      action,
      pack_id: packId,
      mutates: false,
      dependency_order: order.map((entry) => entry.pack_id),
      required_pack_ids: required.map((entry) => entry.pack_id),
      files: required.reduce((sum, entry) => sum + entry.files, 0),
      bytes: required.reduce((sum, entry) => sum + entry.bytes, 0),
      transfer_bytes: required.reduce((sum, entry) => sum + entry.transfer_bytes, 0),
      current_version: current?.pack_version || null,
      target_version: this.catalogEntry(packId).pack_version,
      storage,
    });
  }

  assertStorageCapacity(plan) {
    if (plan?.storage?.known && plan.storage.available < plan.bytes) {
      throw new PhysicalPackError(
        "insufficient_storage",
        `Physical-pack ${plan.action} requires ${plan.bytes} bytes but only approximately ${plan.storage.available} bytes are available.`,
        {
          usage: plan.storage.usage,
          quota: plan.storage.quota,
          available: plan.storage.available,
          required_bytes: plan.bytes,
        },
      );
    }
  }

  async loadManifest(entry, signal) {
    const manifestUrl = this.sameOriginUrl(entry.manifest_path, this.catalogUrl, `Manifest URL for ${entry.pack_id}`);
    const response = await this.sourceLoader.fetch(manifestUrl, { cache: "no-store", signal });
    assertResponse(response, `Manifest for ${entry.pack_id}`);
    const bytes = await response.arrayBuffer();
    const digest = await this.digestService.sha256(bytes);
    if (digest !== entry.manifest_sha256) {
      throw new PhysicalPackError("corrupt", `Manifest digest for ${entry.pack_id} does not match the catalog.`);
    }
    const manifest = validatePhysicalPackManifest(JSON.parse(new TextDecoder().decode(bytes)));
    if (manifest.pack_id !== entry.pack_id || manifest.pack_version !== entry.pack_version) {
      throw new PhysicalPackError("corrupt", `Manifest identity for ${entry.pack_id} does not match the catalog.`);
    }
    this.assertCompatibility(manifest, `Manifest for ${entry.pack_id}`);
    const aggregate = await this.digestService.sha256(new TextEncoder().encode(canonicalAggregateFrame(manifest.files)));
    if (aggregate !== manifest.aggregate_sha256) {
      throw new PhysicalPackError("corrupt", `Manifest aggregate digest for ${entry.pack_id} is invalid.`);
    }
    return { manifest: clone(manifest), manifestUrl: manifestUrl.href };
  }

  async validateStoredManifestClaim(manifestValue, claim = {}) {
    const label = claim.label || "Stored physical pack";
    if (!manifestValue) {
      throw new PhysicalPackError("repair_required", `${label} has no persisted manifest claim.`);
    }
    let manifest;
    try {
      manifest = validatePhysicalPackManifest(manifestValue);
    } catch (error) {
      throw new PhysicalPackError("corrupt", `${label} manifest is invalid: ${sanitizeMessage(error)}`);
    }
    if ((claim.packId && manifest.pack_id !== claim.packId) ||
        (claim.packVersion && manifest.pack_version !== claim.packVersion)) {
      throw new PhysicalPackError("corrupt", `${label} manifest identity does not match its persisted registry claim.`);
    }
    this.assertCompatibility(manifest, `${label} manifest`);
    if (claim.aggregateSha256 && manifest.aggregate_sha256 !== claim.aggregateSha256) {
      throw new PhysicalPackError("corrupt", `${label} aggregate identity does not match its persisted registry claim.`);
    }
    if (claim.manifestSha256 && await this.digestService.sha256(new TextEncoder().encode(stableJson(manifest))) !== claim.manifestSha256) {
      throw new PhysicalPackError("corrupt", `${label} persisted manifest digest is invalid.`);
    }
    if (await this.digestService.sha256(new TextEncoder().encode(stableJson(manifest.files))) !== manifest.inventory_sha256) {
      throw new PhysicalPackError("corrupt", `${label} manifest inventory digest is invalid.`);
    }
    if (await this.digestService.sha256(new TextEncoder().encode(canonicalAggregateFrame(manifest.files))) !== manifest.aggregate_sha256) {
      throw new PhysicalPackError("corrupt", `${label} manifest aggregate digest is invalid.`);
    }
    return manifest;
  }

  async install(packId, options = {}) {
    const plan = await this.plan(packId, options.action || "install");
    this.cancellation.throwIfAborted(options.signal);
    this.assertStorageCapacity(plan);
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
      this.cancellation.throwIfAborted(signal);
      const { manifest, manifestUrl } = await this.loadManifest(entry, signal);
      for (const dependency of manifest.dependencies) {
        const record = await this.registry.getRecord(dependency);
        if (!record || !["active", "update_available", "rollback_available"].includes(record.state)) {
          throw new PhysicalPackError("dependency_missing", `${entry.pack_id} requires active pack ${dependency}.`);
        }
      }
      stagingCacheName = physicalPackCacheName(entry.pack_id, entry.pack_version, entry.manifest_sha256, `staging-${operation}`, this.cachePrefix);
      activeCacheName = physicalPackCacheName(entry.pack_id, entry.pack_version, entry.manifest_sha256, `active-${operation}`, this.cachePrefix);
      await this.byteStore.createStore(stagingCacheName);
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
        this.cancellation.throwIfAborted(signal);
        const artifactUrl = this.sameOriginUrl(`files/${file.path}`, manifestUrl, `Artifact URL for ${file.path}`);
        const response = await this.sourceLoader.fetch(artifactUrl, { cache: "no-store", signal });
        assertResponse(response, file.path);
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength !== file.bytes) {
          throw new PhysicalPackError("corrupt", `${file.path} has an unexpected byte length.`);
        }
        const digest = await this.digestService.sha256(bytes);
        if (digest !== file.sha256) throw new PhysicalPackError("corrupt", `${file.path} failed SHA-256 verification.`);
        const mediaType = responseMediaType(response);
        if (mediaType !== file.media_type) throw new PhysicalPackError("corrupt", `${file.path} has unexpected media type ${mediaType}.`);
        const runtimeUrl = new URL(file.path, this.baseUrl).href;
        await this.byteStore.writeVerifiedBytes(stagingCacheName, runtimeUrl, bytes, {
          mediaType: file.media_type,
          packIdentity: `${entry.pack_id}@${entry.pack_version}`,
        });
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
      await this.byteStore.createStore(activeCacheName);
      for (const path of await this.byteStore.enumerateStoredPaths(stagingCacheName)) {
        const response = await this.byteStore.readResponse(stagingCacheName, path);
        if (!response) throw new PhysicalPackError("corrupt", "A staged response disappeared before activation.");
        await this.byteStore.writeResponse(activeCacheName, path, response);
      }
      const activatedAt = isoNow(this.clock);
      let previousActiveIsValid = false;
      if (previous?.active_cache && previous?.active_manifest && !["corrupt", "repair_required", "failed", "startup_verifying"].includes(previous.state)) {
        try {
          await this.verifyStoredPack({
            cacheName: previous.active_cache,
            manifest: previous.active_manifest,
            label: `Previous active ${entry.pack_id} pack`,
            packId: previous.pack_id,
            packVersion: previous.pack_version,
            manifestSha256: previous.manifest_sha256,
            aggregateSha256: previous.aggregate_sha256,
          });
          previousActiveIsValid = true;
        } catch {
          previousActiveIsValid = false;
        }
      }
      let rollback = previousActiveIsValid
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
        : null;
      if (!rollback && previous?.rollback?.cache && previous?.rollback?.manifest) {
        try {
          await this.verifyStoredPack({
            cacheName: previous.rollback.cache,
            manifest: previous.rollback.manifest,
            label: `Retained rollback ${entry.pack_id} pack`,
            packId: previous.pack_id,
            packVersion: previous.rollback.pack_version,
            manifestSha256: previous.rollback.manifest_sha256,
            aggregateSha256: previous.rollback.aggregate_sha256,
          });
          rollback = clone(previous.rollback);
        } catch {
          rollback = null;
        }
      }
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
        await this.byteStore.deleteStore(stagingCacheName);
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
      if (stagingCacheName) await this.byteStore.deleteStore(stagingCacheName).catch(() => false);
      if (activeCacheName) await this.byteStore.deleteStore(activeCacheName).catch(() => false);
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

  async verifyStoredPack({
    cacheName,
    manifest: manifestValue,
    label = "Stored physical pack",
    packId = null,
    packVersion = null,
    manifestSha256 = null,
    aggregateSha256 = null,
  }) {
    const manifest = await this.validateStoredManifestClaim(manifestValue, {
      label,
      packId,
      packVersion,
      manifestSha256,
      aggregateSha256,
    });
    await this.beforeStoredPackVerification?.({ cacheName, manifest, label });
    if (!cacheName) throw new PhysicalPackError("repair_required", `${label} has no complete cache claim.`);
    const cacheNames = await this.byteStore.listStoreIdentities();
    if (!cacheNames.includes(cacheName)) {
      throw new PhysicalPackError("repair_required", `${label} cache is missing.`);
    }
    const expectedUrls = new Map(
      manifest.files.map((file) => [new URL(file.path, this.baseUrl).href, file]),
    );
    const actualUrls = new Set(await this.byteStore.enumerateStoredPaths(cacheName));
    const missing = [...expectedUrls.keys()].filter((url) => !actualUrls.has(url));
    if (missing.length) {
      const file = expectedUrls.get(missing[0]);
      throw new PhysicalPackError("repair_required", `${file.path} is missing from ${label.toLowerCase()}.`);
    }
    const extra = [...actualUrls].filter((url) => !expectedUrls.has(url));
    if (extra.length || actualUrls.size !== manifest.totals.files) {
      throw new PhysicalPackError("corrupt", `${label} file inventory does not match its manifest.`);
    }
    let bytes = 0;
    for (const [url, file] of expectedUrls) {
      const response = await this.byteStore.readResponse(cacheName, url);
      if (!response) throw new PhysicalPackError("repair_required", `${file.path} is missing from ${label.toLowerCase()}.`);
      const mediaType = responseMediaType(response);
      if (mediaType !== file.media_type) {
        throw new PhysicalPackError("corrupt", `${file.path} has unexpected stored media type ${mediaType}.`);
      }
      const body = await response.arrayBuffer();
      if (body.byteLength !== file.bytes) {
        throw new PhysicalPackError("corrupt", `${file.path} has an invalid stored byte length.`);
      }
      if (await this.digestService.sha256(body) !== file.sha256) {
        throw new PhysicalPackError("corrupt", `${file.path} failed stored SHA-256 verification.`);
      }
      bytes += body.byteLength;
    }
    if (bytes !== manifest.totals.bytes) {
      throw new PhysicalPackError("corrupt", `${label} verified byte total does not match its manifest.`);
    }
    return Object.freeze({ files: expectedUrls.size, bytes, manifest: clone(manifest) });
  }

  catalogUpdateAvailable(packId, packVersion) {
    return Boolean(this.catalog?.packs?.some((entry) => entry.pack_id === packId && entry.pack_version !== packVersion));
  }

  stateWithoutRollback(record) {
    return record.state === "update_available" || record.startup_previous_state === "update_available" || this.catalogUpdateAvailable(record.pack_id, record.pack_version)
      ? "update_available"
      : "active";
  }

  stateWithRollback(record) {
    return this.stateWithoutRollback(record) === "update_available" ? "update_available" : "rollback_available";
  }

  async clearInvalidRollback(record, error, action) {
    const rollbackCache = record.rollback?.cache || record.rollback_cache || null;
    const message = error?.code === "incompatible_version"
      ? `Retained rollback authority was cleared because it is incompatible; cached bytes were preserved as orphaned local data: ${sanitizeMessage(error)}`
      : `Retained rollback copy was removed after verification failed: ${sanitizeMessage(error)}`;
    const now = isoNow(this.clock);
    const next = {
      ...record,
      state: this.stateWithoutRollback(record),
      rollback_cache: null,
      rollback: null,
      startup_previous_state: null,
      last_failure: { code: "rollback_lost", message, at: now },
      updated_at: now,
    };
    await this.registry.putRecord(next);
    await this.appendHistory(action, "failed", {
      pack_id: record.pack_id,
      rollback_lost: true,
      rollback_failure: error?.code || "corrupt",
      message,
    });
    if (error?.code !== "incompatible_version" && rollbackCache && rollbackCache !== record.active_cache) {
      await this.byteStore.deleteStore(rollbackCache).catch(() => false);
    }
    return next;
  }

  async verify(packId) {
    const record = await this.registry.getRecord(packId);
    if (!record?.active_cache || !record.active_manifest) {
      throw new PhysicalPackError("not_installed", `${packId} has no active physical copy to verify.`);
    }
    try {
      const verified = await this.verifyStoredPack({
        cacheName: record.active_cache,
        manifest: record.active_manifest,
        label: `Active ${packId} pack`,
        packId: record.pack_id,
        packVersion: record.pack_version,
        manifestSha256: record.manifest_sha256,
        aggregateSha256: record.aggregate_sha256,
      });
      const now = isoNow(this.clock);
      const next = {
        ...record,
        state: record.rollback_cache ? this.stateWithRollback(record) : this.stateWithoutRollback(record),
        active_manifest: verified.manifest,
        verified_files: verified.files,
        verified_bytes: verified.bytes,
        last_verified_at: now,
        updated_at: now,
        last_failure: null,
      };
      await this.registry.putRecord(next);
      await this.appendHistory("verify", "completed", { pack_id: packId, files: next.verified_files, bytes: verified.bytes });
      await this.refreshSnapshot();
      return next;
    } catch (error) {
      await this.markInvalid(packId, error);
      throw error;
    }
  }

  async markInvalid(packId, error = "Physical pack is corrupt.") {
    const record = await this.registry.getRecord(packId);
    if (!record) return null;
    const code = error?.code === "incompatible_version"
      ? "incompatible"
      : error?.code === "repair_required" ? "repair_required" : "corrupt";
    const failureCode = code === "incompatible" ? "incompatible_version" : code;
    const next = {
      ...record,
      state: code,
      last_failure: { code: failureCode, message: sanitizeMessage(error), at: isoNow(this.clock) },
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
    let verifiedRollback;
    try {
      verifiedRollback = await this.verifyStoredPack({
        cacheName: rollback.cache,
        manifest: rollback.manifest,
        label: `Rollback ${packId} pack`,
        packId: record.pack_id,
        packVersion: rollback.pack_version,
        manifestSha256: rollback.manifest_sha256,
        aggregateSha256: rollback.aggregate_sha256,
      });
    } catch (error) {
      await this.clearInvalidRollback(record, error, "rollback");
      await this.refreshSnapshot();
      throw error;
    }
    const now = isoNow(this.clock);
    let nextRollback = null;
    try {
      const verifiedActive = await this.verifyStoredPack({
        cacheName: record.active_cache,
        manifest: record.active_manifest,
        label: `Active ${packId} pack`,
        packId: record.pack_id,
        packVersion: record.pack_version,
        manifestSha256: record.manifest_sha256,
        aggregateSha256: record.aggregate_sha256,
      });
      nextRollback = {
        pack_version: record.pack_version,
        manifest_sha256: record.manifest_sha256,
        aggregate_sha256: record.aggregate_sha256,
        cache: record.active_cache,
        manifest: clone(record.active_manifest),
        verified_files: verifiedActive.files,
        verified_bytes: verifiedActive.bytes,
        activated_at: record.activated_at,
      };
    } catch {
      nextRollback = null;
    }
    const next = {
      ...record,
      pack_version: rollback.pack_version,
      manifest_sha256: rollback.manifest_sha256,
      aggregate_sha256: rollback.aggregate_sha256,
      active_cache: rollback.cache,
      rollback_cache: nextRollback?.cache || null,
      active_manifest: clone(verifiedRollback.manifest),
      rollback: nextRollback,
      expected_files: verifiedRollback.manifest.totals.files,
      expected_bytes: verifiedRollback.manifest.totals.bytes,
      verified_files: verifiedRollback.files,
      verified_bytes: verifiedRollback.bytes,
      state: nextRollback ? this.stateWithRollback({ ...record, pack_version: rollback.pack_version }) : this.stateWithoutRollback({ ...record, pack_version: rollback.pack_version }),
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
      for (const cacheName of pending) await this.byteStore.deleteStore(cacheName);
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
    const cacheNames = new Set(await this.byteStore.listStoreIdentities());
    for (const record of await this.registry.listRecords()) {
      if (["staging", "verifying"].includes(record.state) && record.staging_cache) {
        if (record.staging_cache) await this.byteStore.deleteStore(record.staging_cache).catch(() => false);
        if (record.previous_active?.active_cache && cacheNames.has(record.previous_active.active_cache)) {
          await this.registry.putRecord({
            ...record.previous_active,
            state: "startup_verifying",
            startup_previous_state: record.previous_active.state,
            last_failure: {
              code: "interrupted",
              message: "An interrupted operation was recovered; the previous active copy is being reverified.",
              at: isoNow(this.clock),
            },
          });
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
        for (const cacheName of record.pending_deletions || []) await this.byteStore.deleteStore(cacheName).catch(() => false);
        await this.registry.deleteRecord(record.pack_id);
        await this.appendHistory("startup-reconcile", "completed", { pack_id: record.pack_id, removal_completed: true });
        continue;
      }
      if (record.active_cache || record.active_manifest) {
        await this.registry.putRecord({
          ...record,
          state: "startup_verifying",
          startup_previous_state: record.state === "startup_verifying"
            ? record.startup_previous_state || "active"
            : record.state,
          updated_at: isoNow(this.clock),
        });
      }
    }
    const referenced = await this.registry.listRecords();
    const referencedNames = new Set(referenced.flatMap((record) => [record.active_cache, record.rollback_cache, record.staging_cache]).filter(Boolean));
    for (const name of await this.byteStore.listStoreIdentities()) {
      if (
        isOwnedPhysicalPackCacheName(name, this.cachePrefix, "staging") &&
        !referencedNames.has(name)
      ) {
        await this.byteStore.deleteStore(name).catch(() => false);
      }
    }
  }

  async completeStartupReconciliation() {
    try {
      const records = await this.registry.listRecords();
      for (const record of records.filter((item) => item.state === "startup_verifying")) {
        try {
          const verified = await this.verifyStoredPack({
            cacheName: record.active_cache,
            manifest: record.active_manifest,
            label: `Active ${record.pack_id} pack`,
            packId: record.pack_id,
            packVersion: record.pack_version,
            manifestSha256: record.manifest_sha256,
            aggregateSha256: record.aggregate_sha256,
          });
          const now = isoNow(this.clock);
          const activeRecord = {
            ...record,
            state: this.stateWithoutRollback(record),
            startup_previous_state: null,
            verified_files: verified.files,
            verified_bytes: verified.bytes,
            active_manifest: verified.manifest,
            last_verified_at: now,
            updated_at: now,
            last_failure: record.last_failure?.code === "interrupted" ? record.last_failure : null,
          };
          const hasRollbackClaim = Boolean(record.rollback_cache || record.rollback);
          if (hasRollbackClaim) {
            try {
              if (!record.rollback?.cache || !record.rollback?.manifest || record.rollback_cache !== record.rollback.cache) {
                throw new PhysicalPackError("corrupt", `Rollback ${record.pack_id} pack metadata is incomplete or inconsistent.`);
              }
              const rollbackVerified = await this.verifyStoredPack({
                cacheName: record.rollback.cache,
                manifest: record.rollback.manifest,
                label: `Rollback ${record.pack_id} pack`,
                packId: record.pack_id,
                packVersion: record.rollback.pack_version,
                manifestSha256: record.rollback.manifest_sha256,
                aggregateSha256: record.rollback.aggregate_sha256,
              });
              await this.registry.putRecord({
                ...activeRecord,
                state: this.stateWithRollback(activeRecord),
                rollback_cache: record.rollback.cache,
                rollback: {
                  ...clone(record.rollback),
                  manifest: rollbackVerified.manifest,
                  verified_files: rollbackVerified.files,
                  verified_bytes: rollbackVerified.bytes,
                },
              });
            } catch (rollbackError) {
              await this.clearInvalidRollback(activeRecord, rollbackError, "startup-reconcile");
            }
          } else {
            await this.registry.putRecord(activeRecord);
          }
          await this.appendHistory("startup-reconcile", "completed", {
            pack_id: record.pack_id,
            verified_files: verified.files,
            verified_bytes: verified.bytes,
            rollback_verified: hasRollbackClaim && Boolean((await this.registry.getRecord(record.pack_id))?.rollback_cache),
          });
        } catch (activeError) {
          let recovered = false;
          if (record.rollback?.cache && record.rollback?.manifest) {
            try {
              const rollbackVerified = await this.verifyStoredPack({
                cacheName: record.rollback.cache,
                manifest: record.rollback.manifest,
                label: `Rollback ${record.pack_id} pack`,
                packId: record.pack_id,
                packVersion: record.rollback.pack_version,
                manifestSha256: record.rollback.manifest_sha256,
                aggregateSha256: record.rollback.aggregate_sha256,
              });
              const rollback = record.rollback;
              const catalogUpdateAvailable = this.catalogUpdateAvailable(record.pack_id, rollback.pack_version);
              await this.registry.putRecord({
                ...record,
                pack_version: rollback.pack_version,
                manifest_sha256: rollback.manifest_sha256,
                aggregate_sha256: rollback.aggregate_sha256,
                active_cache: rollback.cache,
                active_manifest: clone(rollbackVerified.manifest),
                rollback_cache: null,
                rollback: null,
                expected_files: rollbackVerified.manifest.totals.files,
                expected_bytes: rollbackVerified.manifest.totals.bytes,
                verified_files: rollbackVerified.files,
                verified_bytes: rollbackVerified.bytes,
                state: catalogUpdateAvailable ? "update_available" : "active",
                startup_previous_state: null,
                last_verified_at: isoNow(this.clock),
                updated_at: isoNow(this.clock),
                last_failure: {
                  code: activeError.code || "corrupt",
                  message: `The active copy failed verification; a verified rollback copy was activated. ${sanitizeMessage(activeError)}`,
                  at: isoNow(this.clock),
                },
              });
              await this.appendHistory("startup-reconcile", "completed", {
                pack_id: record.pack_id,
                rollback_recovered: true,
                active_failure: activeError.code || "corrupt",
              });
              recovered = true;
            } catch (rollbackError) {
              const code = activeError.code === "incompatible_version"
                ? "incompatible"
                : activeError.code === "repair_required" ? "repair_required" : "corrupt";
              const failureCode = code === "incompatible" ? "incompatible_version" : code;
              await this.registry.putRecord({
                ...record,
                state: code,
                startup_previous_state: null,
                rollback_cache: null,
                rollback: null,
                last_failure: {
                  code: failureCode,
                  message: `${sanitizeMessage(activeError)} Retained rollback was not activated: ${sanitizeMessage(rollbackError)}`,
                  at: isoNow(this.clock),
                },
                updated_at: isoNow(this.clock),
              });
              await this.appendHistory("startup-reconcile", "failed", {
                pack_id: record.pack_id,
                active_failure: activeError.code || "corrupt",
                rollback_failure: rollbackError.code || "corrupt",
              });
              recovered = true;
            }
          }
          if (!recovered) {
            const code = activeError.code === "incompatible_version"
              ? "incompatible"
              : activeError.code === "repair_required" ? "repair_required" : "corrupt";
            const failureCode = code === "incompatible" ? "incompatible_version" : code;
            await this.registry.putRecord({
              ...record,
              state: code,
              startup_previous_state: null,
              last_failure: { code: failureCode, message: sanitizeMessage(activeError), at: isoNow(this.clock) },
              updated_at: isoNow(this.clock),
            });
            await this.appendHistory("startup-reconcile", "failed", {
              pack_id: record.pack_id,
              active_failure: code,
            });
          }
        }
      }
    } finally {
      await this.refreshSnapshot();
    }
  }

  async findOrphanCaches(records = []) {
    const referenced = new Set(records.flatMap((record) => [record.active_cache, record.rollback_cache, record.staging_cache, ...(record.pending_deletions || [])]).filter(Boolean));
    return (await this.byteStore.listStoreIdentities()).filter((name) => isOwnedPhysicalPackCacheName(name, this.cachePrefix) && !referenced.has(name)).sort();
  }

  async cleanup() {
    const orphans = await this.findOrphanCaches(await this.registry.listRecords());
    let removed = 0;
    for (const name of orphans) {
      if (await this.byteStore.deleteStore(name)) removed += 1;
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
    if (!packId || !this.managedOptionalPackIds.has(packId)) return null;
    const record = await this.registry.getRecord(packId);
    const fallback = () => ({
      response: null,
      source_key: `bundled_fallback:${packId}`,
      runtime_source: "bundled_fallback",
      pack_id: packId,
    });
    const unavailable = (code, message) => {
      if (this.bundledFallback) return fallback();
      throw new PhysicalPackError(code, message, {
        pack_id: packId,
        managed_fallback_forbidden: true,
        runtime_source: "managed_unavailable",
      });
    };
    if (!record) return unavailable("not_installed", `${packId} is not installed.`);
    if (record.state === "incompatible") return unavailable("incompatible_version", `${packId} is incompatible.`);
    if (record.state === "repair_required") return unavailable("corrupt", `${packId} must be repaired.`);
    if (record.state === "corrupt") return unavailable("corrupt", `${packId} is corrupt.`);
    if (["failed", "startup_verifying"].includes(record.state)) {
      return unavailable("load_failed", `${packId} does not have a verified active copy.`);
    }
    if (!recordIsVerifiedActive(record)) return unavailable("not_installed", `${packId} has no verified active copy.`);
    for (const dependency of record.active_manifest.dependencies || []) {
      const dependencyRecord = await this.registry.getRecord(dependency);
      if (!recordIsVerifiedActive(dependencyRecord)) {
        return unavailable("dependency_missing", `${packId} requires verified pack ${dependency}.`);
      }
    }
    const declared = record.active_manifest.files.some((file) => file.path === canonical);
    if (!declared) return unavailable("load_failed", `${canonical} is not declared by ${packId}.`);
    const response = await this.byteStore.readResponse(record.active_cache, new URL(canonical, this.baseUrl).href);
    if (!response) {
      const error = new PhysicalPackError("repair_required", `${canonical} is missing from the active cache.`);
      await this.markInvalid(packId, error);
      return unavailable("corrupt", `${packId} is missing a required file.`);
    }
    return {
      response: response.clone(),
      source_key: `${packId}@${record.pack_version}:${record.manifest_sha256}`,
      runtime_source: "managed_pack",
      pack_id: packId,
      version: record.pack_version,
      content_identity: record.manifest_sha256,
    };
  }
}

export function createPhysicalPackManager(options = {}) {
  return new PhysicalPackManager(options);
}
