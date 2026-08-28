export const PHYSICAL_DATA_MODES = Object.freeze({
  bundled: "bundled_static_data",
  managed: "managed_cache_packs",
});

export const PHYSICAL_PACK_SNAPSHOT_EVENT = "bibleapp:physical-pack-snapshot";

export const PHYSICAL_PACK_STATES = Object.freeze([
  "discovered",
  "staging",
  "verifying",
  "startup_verifying",
  "active",
  "update_available",
  "incompatible",
  "corrupt",
  "repair_required",
  "removing",
  "rollback_available",
  "failed",
]);

export const PHYSICAL_PACK_KINDS = Object.freeze({
  catalog: "bibleapp:physical-pack-catalog",
  distribution: "bibleapp:distribution-manifest",
  manifest: "bibleapp:physical-pack-manifest",
});

const IDENTIFIER_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SEMANTIC_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const textEncoder = new TextEncoder();

function fail(message) {
  throw new TypeError(message);
}

function requiredString(value, label) {
  const normalized = String(value ?? "");
  if (!normalized || normalized !== normalized.trim()) fail(`${label} must be a non-empty trimmed string.`);
  return normalized;
}

function requiredInteger(value, label, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum) fail(`${label} must be an integer >= ${minimum}.`);
  return value;
}

function uniqueStrings(values, label) {
  if (!Array.isArray(values)) fail(`${label} must be an array.`);
  const normalized = values.map((value, index) => requiredString(value, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) fail(`${label} must not contain duplicates.`);
  return normalized;
}

export function isSha256(value) {
  return SHA256_PATTERN.test(String(value || ""));
}

export function normalizeSha256(value, label = "sha256") {
  const normalized = String(value || "").toLowerCase();
  if (!isSha256(normalized)) fail(`${label} must use sha256:<64 lowercase hex characters>.`);
  return normalized;
}

export function normalizePackIdentifier(value, label = "identifier") {
  const normalized = requiredString(value, label).toLowerCase();
  if (!IDENTIFIER_PATTERN.test(normalized)) fail(`${label} contains unsupported characters.`);
  return normalized;
}

export function canonicalPackPath(value, label = "path") {
  const path = requiredString(value, label);
  if (path.includes("%")) fail(`${label} must not contain percent-encoded path identity.`);
  if (path.includes("\\")) fail(`${label} must use forward slashes.`);
  if (path.includes("?") || path.includes("#")) fail(`${label} must not contain a query or fragment.`);
  if (path.startsWith("/") || path.startsWith("//") || /^[A-Za-z]:/.test(path)) {
    fail(`${label} must be repository-relative.`);
  }
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    fail(`${label} contains an empty, current-directory, or traversal segment.`);
  }
  if (parts.some((part) => /[\u0000-\u001f\u007f]/.test(part))) fail(`${label} contains control characters.`);
  return parts.join("/");
}

export function normalizePhysicalPackFile(entry, label = "file") {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail(`${label} must be an object.`);
  return Object.freeze({
    path: canonicalPackPath(entry.path, `${label}.path`),
    bytes: requiredInteger(entry.bytes, `${label}.bytes`),
    media_type: requiredString(entry.media_type, `${label}.media_type`).toLowerCase(),
    sha256: normalizeSha256(entry.sha256, `${label}.sha256`),
  });
}

export function normalizePhysicalPackFiles(entries) {
  if (!Array.isArray(entries) || !entries.length) fail("files must be a non-empty array.");
  const files = entries.map((entry, index) => normalizePhysicalPackFile(entry, `files[${index}]`));
  const paths = files.map(({ path }) => path);
  if (new Set(paths).size !== paths.length) fail("files must not contain duplicate canonical paths.");
  return Object.freeze([...files].sort((a, b) => a.path.localeCompare(b.path)));
}

export function canonicalAggregateFrame(entries) {
  const files = normalizePhysicalPackFiles(entries);
  const chunks = ["bibleapp-physical-pack-aggregate-v1\n"];
  for (const file of files) {
    const pathBytes = textEncoder.encode(file.path).byteLength;
    const mediaTypeBytes = textEncoder.encode(file.media_type).byteLength;
    chunks.push(
      `${pathBytes}:${file.path}\n`,
      `${file.bytes}\n`,
      `${file.sha256}\n`,
      `${mediaTypeBytes}:${file.media_type}\n`,
    );
  }
  return chunks.join("");
}

export function physicalPackCacheName(packId, packVersion, manifestSha256, phase = "active", prefix = "bibleapp-pack:") {
  const normalizedPackId = normalizePackIdentifier(packId, "packId");
  const normalizedVersion = normalizePackIdentifier(packVersion, "packVersion");
  const normalizedPhase = normalizePackIdentifier(phase, "phase");
  const digest = normalizeSha256(manifestSha256, "manifestSha256").slice("sha256:".length, 23);
  const normalizedPrefix = String(prefix || "");
  if (!/^bibleapp-pack:(?:[a-z0-9._-]+:)?$/.test(normalizedPrefix)) fail("physical pack cache prefix is invalid.");
  return `${normalizedPrefix}${normalizedPhase}:${normalizedPackId}:${normalizedVersion}:${digest}`;
}

function packageIdentity(value, label = "package_identity") {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
  return Object.freeze({
    schema_version: requiredInteger(value.schema_version, `${label}.schema_version`, 1),
    package_id: normalizePackIdentifier(value.package_id, `${label}.package_id`),
    content_sha256: normalizeSha256(value.content_sha256, `${label}.content_sha256`),
  });
}

function compatibility(value, label = "compatibility") {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
  const minimum = requiredString(value.minimum_app_version, `${label}.minimum_app_version`);
  const maximum = requiredString(value.maximum_app_version_exclusive, `${label}.maximum_app_version_exclusive`);
  if (!SEMANTIC_VERSION_PATTERN.test(minimum) || !SEMANTIC_VERSION_PATTERN.test(maximum)) {
    fail(`${label} versions must be semantic versions.`);
  }
  return Object.freeze({
    minimum_app_version: minimum,
    maximum_app_version_exclusive: maximum,
  });
}

function parseSemanticVersion(value, label = "version") {
  const normalized = requiredString(value, label);
  const match = normalized.match(SEMANTIC_VERSION_PATTERN);
  if (!match) fail(`${label} must be a semantic version.`);
  return {
    core: match.slice(1, 4).map(Number),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

export function compareSemanticVersions(left, right) {
  const a = parseSemanticVersion(left, "left version");
  const b = parseSemanticVersion(right, "right version");
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1;
  }
  if (!a.prerelease.length && !b.prerelease.length) return 0;
  if (!a.prerelease.length) return 1;
  if (!b.prerelease.length) return -1;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const aValue = a.prerelease[index];
    const bValue = b.prerelease[index];
    if (aValue == null) return -1;
    if (bValue == null) return 1;
    if (aValue === bValue) continue;
    const aNumeric = /^\d+$/.test(aValue);
    const bNumeric = /^\d+$/.test(bValue);
    if (aNumeric && bNumeric) return Number(aValue) < Number(bValue) ? -1 : 1;
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return aValue < bValue ? -1 : 1;
  }
  return 0;
}

export function appVersionIsCompatible(compatibilityValue, appVersion) {
  if (!compatibilityValue) return true;
  return compareSemanticVersions(appVersion, compatibilityValue.minimum_app_version) >= 0 &&
    compareSemanticVersions(appVersion, compatibilityValue.maximum_app_version_exclusive) < 0;
}

export function validateDistributionManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("distribution manifest must be an object.");
  if (value.kind !== PHYSICAL_PACK_KINDS.distribution) fail("distribution manifest kind is invalid.");
  if (value.schema_version !== 1) fail("distribution manifest schema_version must be 1.");
  const mode = String(value.physical_data_mode || "");
  if (!Object.values(PHYSICAL_DATA_MODES).includes(mode)) fail("distribution physical_data_mode is invalid.");
  const bundledPackageIds = uniqueStrings(value.bundled_package_ids, "bundled_package_ids");
  const basePackIds = uniqueStrings(value.immutable_base_feature_pack_ids, "immutable_base_feature_pack_ids");
  const optionalPackIds = uniqueStrings(value.managed_optional_pack_ids, "managed_optional_pack_ids");
  if (basePackIds.some((id) => optionalPackIds.includes(id))) {
    fail("immutable base packs and managed optional packs must not overlap.");
  }
  if (typeof value.complete_offline !== "boolean" || typeof value.bundled_fallback !== "boolean") {
    fail("distribution offline and bundled-fallback flags must be boolean.");
  }
  if (mode === PHYSICAL_DATA_MODES.bundled && !bundledPackageIds.length) {
    fail("bundled_static_data requires at least one bundled package.");
  }
  if (mode === PHYSICAL_DATA_MODES.bundled && value.complete_offline !== true) {
    fail("the tracked bundled distribution must remain complete offline.");
  }
  let catalog = null;
  if (value.catalog != null) {
    catalog = Object.freeze({
      path: canonicalPackPath(value.catalog.path, "catalog.path"),
      sha256: normalizeSha256(value.catalog.sha256, "catalog.sha256"),
    });
  }
  return Object.freeze({
    ...value,
    distribution_id: normalizePackIdentifier(value.distribution_id, "distribution_id"),
    physical_data_mode: mode,
    package_manifest: Object.freeze({
      path: canonicalPackPath(value.package_manifest?.path, "package_manifest.path"),
      ...packageIdentity(value.package_manifest, "package_manifest"),
    }),
    bundled_package_ids: Object.freeze(bundledPackageIds.map((id) => normalizePackIdentifier(id))),
    immutable_base_feature_pack_ids: Object.freeze(basePackIds.map((id) => normalizePackIdentifier(id))),
    managed_optional_pack_ids: Object.freeze(optionalPackIds.map((id) => normalizePackIdentifier(id))),
    catalog,
  });
}

export function validatePhysicalPackManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("physical pack manifest must be an object.");
  if (value.kind !== PHYSICAL_PACK_KINDS.manifest) fail("physical pack manifest kind is invalid.");
  if (value.schema_version !== 1) fail("physical pack manifest schema_version must be 1.");
  const files = normalizePhysicalPackFiles(value.files);
  const fileBytes = files.reduce((total, file) => total + file.bytes, 0);
  const totals = value.totals || {};
  if (requiredInteger(totals.files, "totals.files", 1) !== files.length) fail("totals.files does not match files.");
  if (requiredInteger(totals.bytes, "totals.bytes") !== fileBytes) fail("totals.bytes does not match files.");
  requiredInteger(totals.transfer_bytes, "totals.transfer_bytes");
  const provenance = value.provenance || {};
  const normalizedProvenance = Object.freeze({
    license_note: requiredString(provenance.license_note, "provenance.license_note"),
    notice_path: canonicalPackPath(provenance.notice_path, "provenance.notice_path"),
    source_manifest_path: canonicalPackPath(provenance.source_manifest_path, "provenance.source_manifest_path"),
    source_refs: Object.freeze(uniqueStrings(provenance.source_refs, "provenance.source_refs")),
  });
  if (!normalizedProvenance.source_refs.length) fail("provenance.source_refs must not be empty.");
  const generator = value.generator || {};
  if (!/^[0-9a-f]{40}$/.test(String(generator.candidate_sha || ""))) {
    fail("generator.candidate_sha must be an exact 40-character commit SHA.");
  }
  return Object.freeze({
    ...value,
    pack_id: normalizePackIdentifier(value.pack_id, "pack_id"),
    pack_version: normalizePackIdentifier(value.pack_version, "pack_version"),
    label: requiredString(value.label, "label"),
    description: requiredString(value.description, "description"),
    package_identity: packageIdentity(value.package_identity),
    compatibility: compatibility(value.compatibility),
    dependencies: Object.freeze(uniqueStrings(value.dependencies, "dependencies").map((id) => normalizePackIdentifier(id))),
    provided_capabilities: Object.freeze(uniqueStrings(value.provided_capabilities, "provided_capabilities").map((id) => normalizePackIdentifier(id))),
    inventory_sha256: normalizeSha256(value.inventory_sha256, "inventory_sha256"),
    aggregate_sha256: normalizeSha256(value.aggregate_sha256, "aggregate_sha256"),
    files,
    totals: Object.freeze({
      files: totals.files,
      bytes: totals.bytes,
      transfer_bytes: totals.transfer_bytes,
    }),
    provenance: normalizedProvenance,
    generator: Object.freeze({
      name: requiredString(generator.name, "generator.name"),
      version: requiredString(generator.version, "generator.version"),
      candidate_sha: generator.candidate_sha,
    }),
  });
}

export function validatePhysicalPackCatalog(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("physical pack catalog must be an object.");
  if (value.kind !== PHYSICAL_PACK_KINDS.catalog) fail("physical pack catalog kind is invalid.");
  if (value.schema_version !== 1) fail("physical pack catalog schema_version must be 1.");
  if (!Array.isArray(value.packs)) fail("catalog packs must be an array.");
  const packs = value.packs.map((pack, index) => {
    if (!pack || typeof pack !== "object" || Array.isArray(pack)) fail(`packs[${index}] must be an object.`);
    return Object.freeze({
      ...pack,
      pack_id: normalizePackIdentifier(pack.pack_id, `packs[${index}].pack_id`),
      pack_version: normalizePackIdentifier(pack.pack_version, `packs[${index}].pack_version`),
      manifest_path: canonicalPackPath(pack.manifest_path, `packs[${index}].manifest_path`),
      manifest_sha256: normalizeSha256(pack.manifest_sha256, `packs[${index}].manifest_sha256`),
      dependencies: Object.freeze(uniqueStrings(pack.dependencies, `packs[${index}].dependencies`).map((id) => normalizePackIdentifier(id))),
      provided_capabilities: Object.freeze(uniqueStrings(pack.provided_capabilities, `packs[${index}].provided_capabilities`).map((id) => normalizePackIdentifier(id))),
      files: requiredInteger(pack.files, `packs[${index}].files`, 1),
      bytes: requiredInteger(pack.bytes, `packs[${index}].bytes`),
      transfer_bytes: requiredInteger(pack.transfer_bytes, `packs[${index}].transfer_bytes`),
      license_note: requiredString(pack.license_note, `packs[${index}].license_note`),
      notice_path: canonicalPackPath(pack.notice_path, `packs[${index}].notice_path`),
      source_manifest_path: canonicalPackPath(pack.source_manifest_path, `packs[${index}].source_manifest_path`),
      source_refs: Object.freeze(uniqueStrings(pack.source_refs, `packs[${index}].source_refs`)),
    });
  });
  const ids = packs.map(({ pack_id }) => pack_id);
  if (new Set(ids).size !== ids.length) fail("catalog packs must not contain duplicate pack IDs.");
  const bundle = value.full_offline_bundle || {};
  if (bundle.complete_offline !== true) fail("full_offline_bundle.complete_offline must be true.");
  const bundlePackIds = uniqueStrings(bundle.pack_ids, "full_offline_bundle.pack_ids").map((id) => normalizePackIdentifier(id));
  if (bundlePackIds.some((id) => !ids.includes(id))) fail("full offline bundle references an unknown pack.");
  return Object.freeze({
    ...value,
    catalog_version: normalizePackIdentifier(value.catalog_version, "catalog_version"),
    generated_at: requiredString(value.generated_at, "generated_at"),
    package_identity: packageIdentity(value.package_identity),
    compatibility: compatibility(value.compatibility),
    packs: Object.freeze(packs),
    full_offline_bundle: Object.freeze({
      pack_ids: Object.freeze(bundlePackIds),
      complete_offline: true,
    }),
  });
}

export function createPhysicalRegistryRecord(input = {}) {
  const state = input.state || "discovered";
  if (!PHYSICAL_PACK_STATES.includes(state)) fail("physical pack registry state is invalid.");
  return Object.freeze({
    schema_version: 1,
    pack_id: normalizePackIdentifier(input.pack_id, "pack_id"),
    pack_version: normalizePackIdentifier(input.pack_version, "pack_version"),
    manifest_sha256: normalizeSha256(input.manifest_sha256, "manifest_sha256"),
    aggregate_sha256: normalizeSha256(input.aggregate_sha256, "aggregate_sha256"),
    state,
    staging_cache: input.staging_cache || null,
    active_cache: input.active_cache || null,
    rollback_cache: input.rollback_cache || null,
    expected_files: requiredInteger(input.expected_files ?? 0, "expected_files"),
    expected_bytes: requiredInteger(input.expected_bytes ?? 0, "expected_bytes"),
    verified_files: requiredInteger(input.verified_files ?? 0, "verified_files"),
    verified_bytes: requiredInteger(input.verified_bytes ?? 0, "verified_bytes"),
    source_catalog_id: input.source_catalog_id || null,
    installed_at: input.installed_at || null,
    activated_at: input.activated_at || null,
    last_verified_at: input.last_verified_at || null,
    updated_at: input.updated_at || null,
    failure: input.failure || null,
  });
}

export function verifiedActivePhysicalPackIds(records = []) {
  if (!Array.isArray(records)) fail("records must be an array.");
  return Object.freeze(
    [...new Set(records
      .filter((record) => ["active", "update_available", "rollback_available"].includes(record?.state))
      .filter((record) => record.active_cache)
      .filter((record) => record.verified_files === record.expected_files)
      .filter((record) => record.verified_bytes === record.expected_bytes)
      .map((record) => normalizePackIdentifier(record.pack_id, "record.pack_id")))].sort(),
  );
}

export function resolvePhysicalFeaturePackIds({ distribution, packageManifest, registryRecords = [] }) {
  const normalizedDistribution = validateDistributionManifest(distribution);
  const featurePackIds = new Set((packageManifest?.feature_packs || []).map((pack) => pack.id));
  if (normalizedDistribution.physical_data_mode === PHYSICAL_DATA_MODES.bundled) {
    const packageIndex = new Map((packageManifest?.packages || []).map((pkg) => [pkg.id, pkg]));
    const resolved = new Set();
    normalizedDistribution.bundled_package_ids.forEach((packageId) => {
      const definition = packageIndex.get(packageId);
      if (!definition) fail(`distribution references unknown package ${packageId}.`);
      (definition.feature_pack_ids || []).forEach((id) => resolved.add(id));
    });
    return Object.freeze([...resolved].sort());
  }
  const managedOptional = new Set(normalizedDistribution.managed_optional_pack_ids);
  const resolved = new Set([
    ...normalizedDistribution.immutable_base_feature_pack_ids,
    ...[...featurePackIds].filter((id) => !managedOptional.has(id)),
  ]);
  verifiedActivePhysicalPackIds(registryRecords).forEach((id) => resolved.add(id));
  if (normalizedDistribution.bundled_fallback) {
    normalizedDistribution.managed_optional_pack_ids.forEach((id) => resolved.add(id));
  }
  const unknown = [...resolved].filter((id) => !featurePackIds.has(id));
  if (unknown.length) fail(`physical state references unknown feature packs: ${unknown.join(", ")}.`);
  return Object.freeze([...resolved].sort());
}
