#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertValidJsonSchema } from "./schema-validation.mjs";
import {
  PHYSICAL_DATA_MODES,
  PHYSICAL_PACK_KINDS,
  canonicalAggregateFrame,
  canonicalPackPath,
  createPhysicalRegistryRecord,
  physicalPackCacheName,
  resolvePhysicalFeaturePackIds,
  validateDistributionManifest,
  validatePhysicalPackCatalog,
  validatePhysicalPackManifest,
  verifiedActivePhysicalPackIds,
} from "../src/physical-pack-contract.js";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = join(appRoot, "data");
const schemaRoot = join(appRoot, "schemas");
const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function expectThrow(fn, pattern) {
  assert.throws(fn, pattern);
}

const [distribution, packageManifest, distributionSchema, manifestSchema, catalogSchema] = await Promise.all([
  readJson(join(dataRoot, "distribution-manifest.json")),
  readJson(join(dataRoot, "package-manifest.json")),
  readJson(join(schemaRoot, "distribution-manifest.schema.json")),
  readJson(join(schemaRoot, "physical-pack-manifest.schema.json")),
  readJson(join(schemaRoot, "physical-pack-catalog.schema.json")),
]);

assertValidJsonSchema(distribution, distributionSchema, {}, "distribution manifest");
const normalizedDistribution = validateDistributionManifest(distribution);
assert.equal(normalizedDistribution.physical_data_mode, PHYSICAL_DATA_MODES.bundled);
assert.equal(normalizedDistribution.complete_offline, true);
assert.equal(normalizedDistribution.bundled_fallback, true);
assert.deepEqual(normalizedDistribution.managed_optional_pack_ids, [
  "search-verses",
  "commentary-verse-index",
]);

const bundledPackIds = resolvePhysicalFeaturePackIds({ distribution, packageManifest });
assert.equal(bundledPackIds.length, packageManifest.feature_packs.length);
assert.ok(bundledPackIds.includes("search-verses"));
assert.ok(bundledPackIds.includes("commentary-verse-index"));

assert.equal(canonicalPackPath("data/search/manifest.json"), "data/search/manifest.json");
for (const unsafe of [
  "../data/search.json",
  "data/../search.json",
  "/data/search.json",
  "C:/data/search.json",
  "data\\search.json",
  "data//search.json",
  "data/%2e%2e/search.json",
  "data/search.json?version=1",
  "data/search.json#fragment",
]) {
  expectThrow(() => canonicalPackPath(unsafe), /path|relative|segment|percent|query|slash/i);
}

const fixtureFiles = [
  {
    path: "data/search/verses/bsb/genesis.json",
    bytes: 12,
    media_type: "application/json",
    sha256: digest("genesis"),
  },
  {
    path: "data/search/manifest.json",
    bytes: 8,
    media_type: "application/json",
    sha256: digest("manifest"),
  },
];
const frame = canonicalAggregateFrame(fixtureFiles);
assert.equal(frame, canonicalAggregateFrame([...fixtureFiles].reverse()));
assert.match(frame, /^bibleapp-physical-pack-aggregate-v1\n/);
expectThrow(
  () => canonicalAggregateFrame([...fixtureFiles, { ...fixtureFiles[0] }]),
  /duplicate canonical paths/i,
);

const physicalManifest = {
  kind: PHYSICAL_PACK_KINDS.manifest,
  schema_version: 1,
  pack_id: "search-verses",
  pack_version: "v1-deadbeef",
  label: "Verse search",
  description: "Deterministic fixture pack.",
  package_identity: {
    schema_version: 1,
    package_id: "reader-texts",
    content_sha256: packageManifest.packages[0].sha256,
  },
  compatibility: {
    minimum_app_version: "1.0.0",
    maximum_app_version_exclusive: "2.0.0",
  },
  dependencies: [],
  provided_capabilities: ["search"],
  inventory_sha256: digest("inventory"),
  aggregate_sha256: digest(frame),
  files: fixtureFiles,
  totals: {
    files: fixtureFiles.length,
    bytes: fixtureFiles.reduce((total, file) => total + file.bytes, 0),
    transfer_bytes: 9,
  },
  provenance: {
    license_note: "Fixture only; source rights remain separate.",
    notice_path: "provenance/NOTICE.md",
    source_manifest_path: "provenance/source-manifest.json",
    source_refs: ["source_package"],
  },
  generator: {
    name: "physical-pack-contract-test",
    version: "1",
    candidate_sha: "a".repeat(40),
  },
};
assertValidJsonSchema(physicalManifest, manifestSchema, {}, "physical pack manifest");
const normalizedManifest = validatePhysicalPackManifest(physicalManifest);
assert.deepEqual(normalizedManifest.files.map(({ path }) => path), [
  "data/search/manifest.json",
  "data/search/verses/bsb/genesis.json",
]);
expectThrow(
  () => validatePhysicalPackManifest({
    ...physicalManifest,
    totals: { ...physicalManifest.totals, bytes: physicalManifest.totals.bytes + 1 },
  }),
  /totals.bytes/i,
);
expectThrow(
  () => validatePhysicalPackManifest({
    ...physicalManifest,
    provenance: { ...physicalManifest.provenance, source_refs: [] },
  }),
  /source_refs/i,
);

const catalog = {
  kind: PHYSICAL_PACK_KINDS.catalog,
  schema_version: 1,
  catalog_version: "v1",
  generated_at: "2026-08-15T00:00:00.000Z",
  package_identity: physicalManifest.package_identity,
  compatibility: physicalManifest.compatibility,
  packs: [
    {
      pack_id: physicalManifest.pack_id,
      pack_version: physicalManifest.pack_version,
      manifest_path: "packs/search-verses/v1-deadbeef/manifest.json",
      manifest_sha256: digest(JSON.stringify(physicalManifest)),
      dependencies: [],
      provided_capabilities: ["search"],
      files: physicalManifest.totals.files,
      bytes: physicalManifest.totals.bytes,
      transfer_bytes: physicalManifest.totals.transfer_bytes,
      license_note: physicalManifest.provenance.license_note,
      notice_path: physicalManifest.provenance.notice_path,
      source_manifest_path: physicalManifest.provenance.source_manifest_path,
      source_refs: physicalManifest.provenance.source_refs,
    },
  ],
  full_offline_bundle: {
    pack_ids: [physicalManifest.pack_id],
    complete_offline: true,
  },
};
assertValidJsonSchema(catalog, catalogSchema, {}, "physical pack catalog");
assert.equal(validatePhysicalPackCatalog(catalog).packs[0].pack_id, "search-verses");
expectThrow(
  () => validatePhysicalPackCatalog({
    ...catalog,
    full_offline_bundle: { pack_ids: ["missing-pack"], complete_offline: true },
  }),
  /unknown pack/i,
);

const activeRecord = createPhysicalRegistryRecord({
  pack_id: "search-verses",
  pack_version: "v1-deadbeef",
  manifest_sha256: catalog.packs[0].manifest_sha256,
  aggregate_sha256: physicalManifest.aggregate_sha256,
  state: "active",
  active_cache: physicalPackCacheName(
    "search-verses",
    "v1-deadbeef",
    catalog.packs[0].manifest_sha256,
  ),
  expected_files: 2,
  expected_bytes: physicalManifest.totals.bytes,
  verified_files: 2,
  verified_bytes: physicalManifest.totals.bytes,
});
assert.deepEqual(verifiedActivePhysicalPackIds([activeRecord]), ["search-verses"]);
assert.deepEqual(
  resolvePhysicalFeaturePackIds({
    distribution: {
      ...distribution,
      distribution_id: "managed-reference-v1",
      physical_data_mode: "managed_cache_packs",
      complete_offline: false,
      bundled_fallback: false,
      bundled_package_ids: [],
      immutable_base_feature_pack_ids: ["translation-bsb"],
      catalog: {
        path: "packs/catalog.json",
        sha256: digest("catalog"),
      },
    },
    packageManifest,
    registryRecords: [activeRecord],
  }),
  ["search-verses", "translation-bsb"],
);
const incompleteRecord = { ...activeRecord, verified_files: 1 };
assert.deepEqual(verifiedActivePhysicalPackIds([incompleteRecord]), []);

console.log(JSON.stringify({
  distribution: normalizedDistribution.distribution_id,
  bundled_feature_packs: bundledPackIds.length,
  canonical_fixture_paths: normalizedManifest.files.map(({ path }) => path),
  cache_name: activeRecord.active_cache,
  managed_active_feature_packs: verifiedActivePhysicalPackIds([activeRecord]),
}, null, 2));
