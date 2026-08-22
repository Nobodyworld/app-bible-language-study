#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  PHYSICAL_PACK_KINDS,
  canonicalAggregateFrame,
  validatePhysicalPackCatalog,
  validatePhysicalPackManifest,
} from "../src/physical-pack-contract.js";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(appRoot, "..");
const dataRoot = join(appRoot, "data");
const defaultOutput = join(repoRoot, "dist", "physical-packs");
const cli = process.argv.slice(2);
const check = cli.includes("--check");
const checkScenariosOnly = cli.includes("--check-scenarios");
const assembleOffline = cli.includes("--assemble-offline");
const outputIndex = cli.indexOf("--output");
const outputRoot = resolve(outputIndex >= 0 ? cli[outputIndex + 1] : defaultOutput);

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runtimePath(path) {
  return relative(appRoot, path).split(sep).join("/");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function walkFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function mapLimited(values, limit, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index], index);
    }
  }));
  return results;
}

function packCapabilities(packId) {
  if (packId === "search-verses") return ["search"];
  if (packId === "commentary-verse-index") return ["commentary"];
  return [];
}

function packageIdentity(packageManifest) {
  const pkg = packageManifest.packages[0];
  return {
    schema_version: packageManifest.schema_version,
    package_id: pkg.id,
    content_sha256: pkg.sha256,
  };
}

function compatibility() {
  return {
    minimum_app_version: "1.0.0",
    maximum_app_version_exclusive: "2.0.0",
  };
}

async function inventoryPack(definition, packageManifest, candidateSha) {
  const roots = definition.paths.map((path) => join(appRoot, path));
  const paths = (await Promise.all(roots.map(walkFiles))).flat().sort((a, b) => runtimePath(a).localeCompare(runtimePath(b)));
  const files = await mapLimited(paths, 8, async (path) => {
    const body = await readFile(path);
    return {
      path: runtimePath(path),
      bytes: body.byteLength,
      media_type: "application/json",
      sha256: sha256(body),
    };
  });
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  assert(files.length === definition.files, `${definition.id} file count changed: expected ${definition.files}, found ${files.length}. Run inventory:refresh deliberately first.`);
  assert(totalBytes === definition.bytes, `${definition.id} byte count changed: expected ${definition.bytes}, found ${totalBytes}. Run inventory:refresh deliberately first.`);
  const aggregate = sha256(canonicalAggregateFrame(files));
  const version = `v1-${aggregate.slice("sha256:".length, "sha256:".length + 16)}`;
  const manifest = {
    kind: PHYSICAL_PACK_KINDS.manifest,
    schema_version: 1,
    pack_id: definition.id,
    pack_version: version,
    label: definition.label,
    description: definition.description,
    package_identity: packageIdentity(packageManifest),
    compatibility: compatibility(),
    dependencies: [...(definition.dependencies || [])].sort(),
    provided_capabilities: packCapabilities(definition.id),
    inventory_sha256: sha256(stableJson(files)),
    aggregate_sha256: aggregate,
    files,
    totals: {
      files: files.length,
      bytes: totalBytes,
      transfer_bytes: definition.gzip_bytes,
    },
    provenance: {
      license_note: definition.license_note,
      notice_path: "provenance/NOTICE.md",
      source_manifest_path: "provenance/source-manifest.json",
      source_refs: ["source_package", "transformations"],
    },
    generator: {
      name: "build-physical-packs.mjs",
      version: "1",
      candidate_sha: candidateSha,
    },
  };
  validatePhysicalPackManifest(manifest);
  const manifestText = stableJson(manifest);
  return {
    definition,
    manifest,
    manifestText,
    manifestSha256: sha256(manifestText),
    sourcePaths: paths,
  };
}

async function buildModel() {
  const [packageManifest, sourceManifest, notice] = await Promise.all([
    readJson(join(dataRoot, "package-manifest.json")),
    readJson(join(dataRoot, "source-manifest.json")),
    readFile(join(repoRoot, "NOTICE.md"), "utf8"),
  ]);
  assert(sourceManifest.source_package && Array.isArray(sourceManifest.transformations), "Source manifest lacks required physical-pack provenance references.");
  assert(notice.includes("Bundled Data Notice"), "NOTICE.md lacks the bundled-data notice required by physical packs.");
  const candidateSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  assert(/^[0-9a-f]{40}$/.test(candidateSha), "Could not resolve an exact candidate commit SHA.");
  const ids = ["search-verses", "commentary-verse-index"];
  const definitions = ids.map((id) => packageManifest.feature_packs.find((pack) => pack.id === id));
  assert(definitions.every(Boolean), "Search and Commentary feature-pack definitions are required.");
  const packs = [];
  for (const definition of definitions) packs.push(await inventoryPack(definition, packageManifest, candidateSha));
  const catalogPacks = packs.map(({ definition, manifest, manifestSha256 }) => ({
    pack_id: manifest.pack_id,
    pack_version: manifest.pack_version,
    manifest_path: `packs/${manifest.pack_id}/${manifest.pack_version}/manifest.json`,
    manifest_sha256: manifestSha256,
    dependencies: manifest.dependencies,
    provided_capabilities: manifest.provided_capabilities,
    files: manifest.totals.files,
    bytes: manifest.totals.bytes,
    transfer_bytes: manifest.totals.transfer_bytes,
    license_note: definition.license_note,
    notice_path: manifest.provenance.notice_path,
    source_manifest_path: manifest.provenance.source_manifest_path,
    source_refs: manifest.provenance.source_refs,
  }));
  const catalogSeed = stableJson(catalogPacks.map(({ pack_id, pack_version, manifest_sha256 }) => ({ pack_id, pack_version, manifest_sha256 })));
  const catalog = {
    kind: PHYSICAL_PACK_KINDS.catalog,
    schema_version: 1,
    catalog_version: `v1-${sha256(catalogSeed).slice("sha256:".length, "sha256:".length + 16)}`,
    generated_at: packageManifest.generated_at,
    package_identity: packageIdentity(packageManifest),
    compatibility: compatibility(),
    packs: catalogPacks,
    full_offline_bundle: {
      pack_ids: ids,
      complete_offline: true,
    },
  };
  validatePhysicalPackCatalog(catalog);
  return { packageManifest, sourceManifest, notice, candidateSha, packs, catalog, catalogText: stableJson(catalog) };
}

function expectedScenarios(packageManifest) {
  const full = packageManifest.packages[0];
  const search = packageManifest.feature_packs.find((pack) => pack.id === "search-verses");
  const commentary = packageManifest.feature_packs.find((pack) => pack.id === "commentary-verse-index");
  const metrics = (files, bytes, transferBytes) => ({ files, bytes, transfer_bytes: transferBytes });
  const common = {
    integrity: "Per-file SHA-256 plus canonical aggregate SHA-256 and immutable manifest digest.",
    notice_and_provenance: "NOTICE.md and data/source-manifest.json are retained by explicit artifact references.",
  };
  return {
    kind: "bibleapp:physical-pack-scenario-report",
    schema_version: 1,
    measured_from_package_sha256: full.sha256,
    generated_at: packageManifest.generated_at,
    scenarios: [
      {
        id: "complete-bundled-app",
        ...metrics(full.files, full.bytes, full.gzip_bytes),
        build_install_update: "Ship and open the existing complete static app; no managed-pack mutation is required.",
        first_use: "Bundled network/file read; hardware timing is recorded by the maintained Edge suite, not frozen into source.",
        warm_use: "Parsed-data cache and browser HTTP cache; hardware timing is recorded by the maintained Edge suite.",
        offline_behavior: "Complete reader, Search, and Commentary remain bundled offline.",
        unavailable_behavior: "Only deliberate logical disablement makes a capability unavailable.",
        ...common,
      },
      {
        id: "base-without-search-commentary",
        ...metrics(full.files - search.files - commentary.files, full.bytes - search.bytes - commentary.bytes, full.gzip_bytes - search.gzip_bytes - commentary.gzip_bytes),
        build_install_update: "Reference measurement only; no smaller public application is produced by this branch.",
        first_use: "Reader base remains immediately available; optional tools expose structured not-installed states in managed mode.",
        warm_use: "Reader caches remain independent of optional-pack installation.",
        offline_behavior: "Scripture reading remains offline; managed Search and Commentary require verified local packs.",
        unavailable_behavior: "Search and Commentary identify the required pack and offer install or bundled-mode recovery.",
        ...common,
      },
      {
        id: "base-plus-search",
        ...metrics(full.files - commentary.files, full.bytes - commentary.bytes, full.gzip_bytes - commentary.gzip_bytes),
        build_install_update: "Install the immutable Search manifest and loose files into staging, verify, then activate atomically.",
        first_use: "First managed Search read resolves from the verified active Cache Storage version.",
        warm_use: "Parsed JSON is keyed by physical pack version and reused until activation invalidates it.",
        offline_behavior: "Search reads remain available from Cache Storage without an application request.",
        unavailable_behavior: "Commentary remains explicitly not installed while ordinary reading and Search continue.",
        ...common,
      },
      {
        id: "base-plus-commentary",
        ...metrics(full.files - search.files, full.bytes - search.bytes, full.gzip_bytes - search.gzip_bytes),
        build_install_update: "Install the immutable Commentary manifest and loose files into staging, verify, then activate atomically.",
        first_use: "First managed Commentary read resolves from the verified active Cache Storage version.",
        warm_use: "Parsed JSON is keyed by physical pack version and reused until activation invalidates it.",
        offline_behavior: "Commentary reads remain available from Cache Storage without an application request.",
        unavailable_behavior: "Search remains explicitly not installed while ordinary reading and Commentary continue.",
        ...common,
      },
      {
        id: "reconstructed-complete-offline-bundle",
        ...metrics(full.files, full.bytes, full.gzip_bytes),
        build_install_update: "Run physical-packs:build -- --assemble-offline to overlay verified Search and Commentary artifacts onto the unchanged base tree.",
        first_use: "Equivalent data boundary to the complete bundled app; Edge fixture timing validates resolver activation separately.",
        warm_use: "Equivalent data boundary to the complete bundled app with version-keyed parsed caches.",
        offline_behavior: "The reconstructed directory contains the complete offline data inventory.",
        unavailable_behavior: "No optional capability is missing after complete reconstruction.",
        ...common,
      },
    ],
  };
}

async function checkScenarioReport(packageManifest) {
  const path = join(dataRoot, "physical-pack-scenarios.json");
  const actual = await readJson(path);
  const expected = expectedScenarios(packageManifest);
  assert(stableJson(actual) === stableJson(expected), "Physical-pack scenario report is stale. Regenerate it with --write-scenarios.");
  return expected;
}

async function copyImmutable(source, destination) {
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

async function safeResetOutput(path) {
  const resolvedPath = resolve(path);
  const allowedRepoRoot = `${resolve(repoRoot, "dist")}${sep}`;
  const allowedTempRoot = `${resolve(tmpdir())}${sep}`;
  assert(resolvedPath.startsWith(allowedRepoRoot) || resolvedPath.startsWith(allowedTempRoot), "Physical-pack output must stay inside repo dist or the operating-system temporary directory.");
  await rm(resolvedPath, { recursive: true, force: true });
  await mkdir(resolvedPath, { recursive: true });
}

async function writeArtifacts(model) {
  await safeResetOutput(outputRoot);
  await writeFile(join(outputRoot, "catalog.json"), model.catalogText);
  await mkdir(join(outputRoot, "provenance"), { recursive: true });
  await writeFile(join(outputRoot, "provenance", "NOTICE.md"), model.notice);
  await writeFile(join(outputRoot, "provenance", "source-manifest.json"), stableJson(model.sourceManifest));
  for (const pack of model.packs) {
    const packRoot = join(outputRoot, "packs", pack.manifest.pack_id, pack.manifest.pack_version);
    await mkdir(packRoot, { recursive: true });
    await writeFile(join(packRoot, "manifest.json"), pack.manifestText);
    await mapLimited(pack.sourcePaths, 8, (source) => copyImmutable(source, join(packRoot, "files", runtimePath(source))));
  }
}

async function assembleCompleteOffline(model) {
  const destination = join(outputRoot, "complete-offline", "app");
  const allFiles = await walkFiles(appRoot);
  await mapLimited(allFiles, 8, (source) => copyImmutable(source, join(destination, runtimePath(source))));
  const inventory = model.packageManifest.packages[0];
  const optionalFiles = model.packs.reduce((sum, pack) => sum + pack.manifest.totals.files, 0);
  assert(optionalFiles > 0 && inventory.files >= optionalFiles, "Complete offline assembly inventory is invalid.");
  await writeFile(join(outputRoot, "complete-offline", "ASSEMBLY.json"), stableJson({
    kind: "bibleapp:complete-offline-assembly",
    schema_version: 1,
    package_sha256: inventory.sha256,
    optional_pack_versions: Object.fromEntries(model.packs.map((pack) => [pack.manifest.pack_id, pack.manifest.pack_version])),
    complete_offline: true,
  }));
}

const initialPackageManifest = await readJson(join(dataRoot, "package-manifest.json"));
if (cli.includes("--write-scenarios")) {
  await writeFile(join(dataRoot, "physical-pack-scenarios.json"), stableJson(expectedScenarios(initialPackageManifest)));
  console.log("Updated app/data/physical-pack-scenarios.json");
  process.exit(0);
}

if (checkScenariosOnly) {
  const report = await checkScenarioReport(initialPackageManifest);
  console.log(JSON.stringify({ status: "ok", scenarios: report.scenarios.map(({ id, files, bytes, transfer_bytes }) => ({ id, files, bytes, transfer_bytes })) }, null, 2));
  process.exit(0);
}

if (check) {
  const first = await buildModel();
  const second = await buildModel();
  assert(first.catalogText === second.catalogText, "Physical-pack catalog generation is not reproducible.");
  assert(first.packs.every((pack, index) => pack.manifestText === second.packs[index].manifestText), "Physical-pack manifest generation is not reproducible.");
  await checkScenarioReport(first.packageManifest);
  console.log(JSON.stringify({
    status: "ok",
    reproducible: true,
    candidate_sha: first.candidateSha,
    catalog_version: first.catalog.catalog_version,
    packs: first.packs.map(({ manifest, manifestSha256 }) => ({
      pack_id: manifest.pack_id,
      pack_version: manifest.pack_version,
      files: manifest.totals.files,
      bytes: manifest.totals.bytes,
      transfer_bytes: manifest.totals.transfer_bytes,
      aggregate_sha256: manifest.aggregate_sha256,
      manifest_sha256: manifestSha256,
    })),
  }, null, 2));
  process.exit(0);
}

const model = await buildModel();
await writeArtifacts(model);
if (assembleOffline) await assembleCompleteOffline(model);
console.log(JSON.stringify({ output: outputRoot, catalog_version: model.catalog.catalog_version, complete_offline_assembled: assembleOffline }, null, 2));
