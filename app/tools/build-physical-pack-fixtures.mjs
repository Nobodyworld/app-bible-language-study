#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PHYSICAL_PACK_KINDS,
  canonicalAggregateFrame,
  validatePhysicalPackCatalog,
  validatePhysicalPackManifest,
} from "../src/physical-pack-contract.js";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = join(appRoot, "data", "physical-pack-fixtures");
const check = process.argv.includes("--check");
const candidateSha = "afdd22a57d8c8cca874947b97ac021e588867e68";
const packageIdentity = {
  schema_version: 1,
  package_id: "reader-texts",
  content_sha256: "sha256:910de6211e387d2f2179e917031b4fe578ac078be7a870d471b9b3d422d11451",
};
const compatibility = {
  minimum_app_version: "1.0.0",
  maximum_app_version_exclusive: "2.0.0",
};

const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function fixtureFiles(version) {
  if (version === "search-v1") {
    return {
      "data/search/manifest.json": stableJson({ fixture: "search", version: 1, shards: ["search/verses/bsb/genesis.json"] }),
      "data/search/verses/bsb/genesis.json": stableJson({ translation_id: "bsb", book_id: "genesis", fixture_version: 1, entries: [{ chapter: 1, verse: 1, text: "In the beginning" }] }),
    };
  }
  if (version === "search-v2") {
    return {
      "data/search/manifest.json": stableJson({ fixture: "search", version: 2, shards: ["search/verses/bsb/genesis.json"] }),
      "data/search/verses/bsb/genesis.json": stableJson({ translation_id: "bsb", book_id: "genesis", fixture_version: 2, entries: [{ chapter: 1, verse: 1, text: "In the beginning" }, { chapter: 1, verse: 3, text: "Let there be light" }] }),
    };
  }
  return {
    "data/commentaries/verses/genesis.json": stableJson({ fixture: "commentary", version: 1, verses: { "1:1": [{ source_id: "fixture", commentary_html: "<p>A deterministic beginning.</p>" }] } }),
  };
}

function createManifest({ packId, version, label, description, dependencies, capabilities, files }) {
  const entries = Object.entries(files).map(([path, body]) => ({
    path,
    bytes: Buffer.byteLength(body),
    media_type: "application/json",
    sha256: digest(body),
  })).sort((a, b) => a.path.localeCompare(b.path));
  const aggregate = digest(canonicalAggregateFrame(entries));
  const manifest = {
    kind: PHYSICAL_PACK_KINDS.manifest,
    schema_version: 1,
    pack_id: packId,
    pack_version: version,
    label,
    description,
    package_identity: packageIdentity,
    compatibility,
    dependencies,
    provided_capabilities: capabilities,
    inventory_sha256: digest(stableJson(entries)),
    aggregate_sha256: aggregate,
    files: entries,
    totals: {
      files: entries.length,
      bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
      transfer_bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    },
    provenance: {
      license_note: "Deterministic lifecycle fixture only; production source rights remain governed by NOTICE.md.",
      notice_path: "NOTICE.md",
      source_manifest_path: "data/source-manifest.json",
      source_refs: ["source_package"],
    },
    generator: {
      name: "build-physical-pack-fixtures.mjs",
      version: "1",
      candidate_sha: candidateSha,
    },
  };
  validatePhysicalPackManifest(manifest);
  return { manifest, text: stableJson(manifest), files };
}

const searchV1 = createManifest({
  packId: "search-verses",
  version: "fixture-v1",
  label: "Search fixture",
  description: "Small deterministic Search lifecycle fixture.",
  dependencies: [],
  capabilities: ["search"],
  files: fixtureFiles("search-v1"),
});
const searchV2 = createManifest({
  packId: "search-verses",
  version: "fixture-v2",
  label: "Search fixture update",
  description: "Small deterministic Search update fixture.",
  dependencies: [],
  capabilities: ["search"],
  files: fixtureFiles("search-v2"),
});
const commentaryV1 = createManifest({
  packId: "commentary-verse-index",
  version: "fixture-v1",
  label: "Commentary fixture",
  description: "Small deterministic Commentary lifecycle fixture.",
  dependencies: ["search-verses"],
  capabilities: ["commentary"],
  files: fixtureFiles("commentary-v1"),
});

function catalogPack(pack) {
  const { manifest, text } = pack;
  return {
    pack_id: manifest.pack_id,
    pack_version: manifest.pack_version,
    manifest_path: `packs/${manifest.pack_id}/${manifest.pack_version}/manifest.json`,
    manifest_sha256: digest(text),
    dependencies: manifest.dependencies,
    provided_capabilities: manifest.provided_capabilities,
    files: manifest.totals.files,
    bytes: manifest.totals.bytes,
    transfer_bytes: manifest.totals.transfer_bytes,
    license_note: manifest.provenance.license_note,
    notice_path: manifest.provenance.notice_path,
    source_manifest_path: manifest.provenance.source_manifest_path,
    source_refs: manifest.provenance.source_refs,
  };
}

function createCatalog(version, packs) {
  const catalog = {
    kind: PHYSICAL_PACK_KINDS.catalog,
    schema_version: 1,
    catalog_version: version,
    generated_at: "2026-08-21T00:00:00.000Z",
    package_identity: packageIdentity,
    compatibility,
    packs: packs.map(catalogPack),
    full_offline_bundle: {
      pack_ids: ["search-verses", "commentary-verse-index"],
      complete_offline: true,
    },
  };
  validatePhysicalPackCatalog(catalog);
  return stableJson(catalog);
}

const outputs = new Map();
function addPack(pack) {
  const root = `packs/${pack.manifest.pack_id}/${pack.manifest.pack_version}`;
  outputs.set(`${root}/manifest.json`, pack.text);
  Object.entries(pack.files).forEach(([path, body]) => outputs.set(`${root}/files/${path}`, body));
}
addPack(searchV1);
addPack(searchV2);
addPack(commentaryV1);
outputs.set("catalog-v1.json", createCatalog("fixture-v1", [searchV1, commentaryV1]));
outputs.set("catalog-v2.json", createCatalog("fixture-v2", [searchV2, commentaryV1]));

for (const [relativePath, body] of outputs) {
  const path = join(fixtureRoot, relativePath);
  if (check) {
    const actual = await readFile(path, "utf8").catch(() => null);
    if (actual !== body) throw new Error(`Physical-pack fixture is stale: ${relativePath}`);
  } else {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
}

console.log(JSON.stringify({ status: "ok", check, files: outputs.size }, null, 2));
