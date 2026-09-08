#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = join(appRoot, "data");
const manifestPath = join(dataRoot, "package-manifest.json");
const checkOnly = process.argv.includes("--check");

function roundMb(bytes) {
  return Math.round((bytes / 1024 / 1024) * 100) / 100;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function listFiles(path) {
  const info = await stat(path);
  if (info.isFile()) return [path];
  const files = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(child)));
    if (entry.isFile()) files.push(child);
  }
  return files;
}

function normalizePath(path) {
  return path.replaceAll("\\", "/");
}

function runtimePackDefinitions(appManifest) {
  const oldTestamentBooks = appManifest.books.slice(0, 39).map((book) => book.id);
  const newTestamentBooks = appManifest.books.slice(39).map((book) => book.id);
  return {
    "bsb-strongs-overlay": {
      label: "Reader Strong's overlays",
      description: "Token-level Strong's mappings loaded by the BSB, KJV, and YLT reader routes.",
      paths: ["data/strongs"],
    },
    "hebrew-interlinear": {
      include_book_ids: oldTestamentBooks,
    },
    "greek-interlinear": {
      include_book_ids: newTestamentBooks,
    },
    "footnotes-bsb": {
      id: "footnotes-bsb",
      label: "BSB footnotes",
      description: "Inline BSB footnote records loaded by reader routes.",
      dependencies: ["translation-bsb"],
      paths: ["data/footnotes/bsb"],
      license_note: "Packaged runtime data; distribution rights require explicit review.",
    },
    "presentation-bsb": {
      id: "presentation-bsb",
      label: "BSB presentation metadata",
      description: "Headings, paragraph structure, poetry layout, and presentation metadata loaded by the reader.",
      dependencies: ["translation-bsb"],
      paths: ["data/presentation/bsb"],
      license_note: "Packaged runtime data; distribution rights require explicit review.",
    },
    "language-metadata": {
      id: "language-metadata",
      label: "Hebrew and Greek language metadata",
      description: "Alphabet and mark metadata used by original-language tooltips.",
      dependencies: [],
      paths: ["data/language"],
      license_note: "Application metadata packaged for original-language UI.",
    },
    "semantic-seeds": {
      id: "semantic-seeds",
      label: "Semantic tag definitions and relations",
      description: "Packaged tag definitions and relations.",
      dependencies: [],
      paths: ["data/semantic"],
      license_note: "Application semantic metadata.",
    },
    "source-wlc": {
      id: "source-wlc",
      label: "Westminster Leningrad Codex (WLC)",
      description: "Pointed Hebrew source-script verse corpus used by Original Language Study.",
      dependencies: [],
      paths: ["data/verses/wlc"],
      license_note: "Extracted from the reviewed OpenBible archive; provenance and archive terms are recorded in data/source-manifest.json and NOTICE.md.",
    },
    "source-wlco": {
      id: "source-wlco",
      label: "WLC — Consonants Only (WLCO)",
      description: "Consonants-only Hebrew source-script verse corpus used by Original Language Study.",
      dependencies: [],
      paths: ["data/verses/wlco"],
      license_note: "Extracted from the reviewed OpenBible archive; provenance and archive terms are recorded in data/source-manifest.json and NOTICE.md.",
    },
    "source-nestle-1904": {
      id: "source-nestle-1904",
      label: "Nestle Greek New Testament 1904",
      description: "Nestle 1904 Greek source-script verse corpus used by Original Language Study.",
      dependencies: [],
      paths: ["data/verses/nestle"],
      license_note: "Extracted from the reviewed OpenBible archive; provenance and archive terms are recorded in data/source-manifest.json and NOTICE.md.",
    },
    "source-tr94": {
      id: "source-tr94",
      label: "Scrivener Textus Receptus 1894 (TR94)",
      description: "Scrivener 1894 Greek source-script verse corpus used by Original Language Study.",
      dependencies: [],
      paths: ["data/verses/tr94"],
      license_note: "Extracted from the reviewed OpenBible archive; provenance and archive terms are recorded in data/source-manifest.json and NOTICE.md.",
    },
  };
}

async function filesForPack(pack) {
  const files = new Set();
  for (const declaredPath of pack.paths || []) {
    const absolutePath = resolve(appRoot, declaredPath);
    if (absolutePath !== appRoot && !absolutePath.startsWith(`${appRoot}\\`) && !absolutePath.startsWith(`${appRoot}/`)) {
      throw new Error(`Unsafe package path: ${declaredPath}`);
    }
    for (const file of await listFiles(absolutePath)) {
      if (pack.include_book_ids?.length && normalizePath(file).includes("/interlinear/books/")) {
        if (!pack.include_book_ids.includes(basename(file, ".json"))) continue;
      }
      files.add(file);
    }
  }
  return [...files].sort();
}

async function inventoryForFiles(files) {
  let bytes = 0;
  let gzipBytes = 0;
  let largestShard = null;
  const hash = createHash("sha256");
  for (const file of files) {
    const content = await readFile(file);
    const relativePath = normalizePath(relative(appRoot, file));
    bytes += content.length;
    gzipBytes += gzipSync(content).length;
    hash.update(relativePath);
    hash.update("\0");
    hash.update(content);
    if (!largestShard || content.length > largestShard.bytes) {
      largestShard = {
        path: relativePath,
        bytes: content.length,
      };
    }
  }
  return {
    files: files.length,
    bytes,
    mb: roundMb(bytes),
    gzip_bytes: gzipBytes,
    gzip_mb: roundMb(gzipBytes),
    sha256: `sha256:${hash.digest("hex")}`,
    largest_shard: largestShard,
  };
}

async function buildInventory(current) {
  const appManifest = await readJson(join(dataRoot, "manifest.json"));
  const runtimeDefinitions = runtimePackDefinitions(appManifest);
  const existingById = new Map((current.feature_packs || []).map((pack) => [pack.id, pack]));
  for (const [id, definition] of Object.entries(runtimeDefinitions)) {
    existingById.set(id, { ...(existingById.get(id) || {}), ...definition });
  }

  const featurePacks = [];
  const filesByPack = new Map();
  for (const pack of existingById.values()) {
    const files = await filesForPack(pack);
    filesByPack.set(pack.id, files);
    featurePacks.push({
      ...pack,
      ...(await inventoryForFiles(files)),
    });
  }

  const packages = [];
  for (const definition of current.packages || []) {
    const featurePackIds = [...new Set([...(definition.feature_pack_ids || []), ...Object.keys(runtimeDefinitions)])];
    const files = new Set();
    featurePackIds.forEach((id) => (filesByPack.get(id) || []).forEach((file) => files.add(file)));
    packages.push({
      ...definition,
      feature_pack_ids: featurePackIds,
      ...(await inventoryForFiles([...files].sort())),
    });
  }

  return {
    ...current,
    generated_at: current.generated_at,
    packages,
    feature_packs: featurePacks,
  };
}

const current = await readJson(manifestPath);
const expected = await buildInventory(current);
const inventoryChanged = JSON.stringify(expected) !== JSON.stringify(current);
const distributionPath = join(dataRoot, "distribution-manifest.json");
const distribution = await readJson(distributionPath);
const reference = distribution.package_manifest;
if (reference?.path !== "data/package-manifest.json" || reference.schema_version !== expected.schema_version) {
  throw new Error("Distribution must reference the maintained package manifest path and schema.");
}
const referencedPackages = expected.packages.filter((pack) => pack.id === reference.package_id);
if (referencedPackages.length !== 1) {
  throw new Error(`Distribution package ${reference.package_id} must resolve to exactly one package inventory.`);
}
const expectedDistribution = {
  ...distribution,
  package_manifest: { ...reference, content_sha256: referencedPackages[0].sha256 },
};
const distributionChanged = JSON.stringify(expectedDistribution) !== JSON.stringify(distribution);
if (checkOnly) {
  if (inventoryChanged) {
    throw new Error("Package inventory is stale. Run `npm run inventory:refresh`.");
  }
  if (distributionChanged) {
    throw new Error("Distribution package identity is stale. Run `npm run inventory:refresh`.");
  }
  console.log(
    JSON.stringify(
      {
        status: "ok",
        feature_packs: expected.feature_packs.length,
        files: expected.packages[0]?.files || 0,
        bytes: expected.packages[0]?.bytes || 0,
        gzip_bytes: expected.packages[0]?.gzip_bytes || 0,
      },
      null,
      2,
    ),
  );
} else {
  if (inventoryChanged) {
    expected.generated_at = new Date().toISOString();
    await writeFile(manifestPath, `${JSON.stringify(expected, null, 2)}\n`, "utf8");
  }
  if (distributionChanged) {
    await writeFile(distributionPath, `${JSON.stringify(expectedDistribution, null, 2)}\n`, "utf8");
  }
  console.log(
    JSON.stringify(
      {
        status: inventoryChanged || distributionChanged ? "updated" : "unchanged",
        feature_packs: expected.feature_packs.length,
        files: expected.packages[0]?.files || 0,
        bytes: expected.packages[0]?.bytes || 0,
        gzip_bytes: expected.packages[0]?.gzip_bytes || 0,
      },
      null,
      2,
    ),
  );
}
