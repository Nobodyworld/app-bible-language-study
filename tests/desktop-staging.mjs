#!/usr/bin/env node

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stagedRoot = path.join(repoRoot, ".desktop-dist");
const resourceRoot = path.join(repoRoot, ".desktop-resources");
const inventory = JSON.parse(await fs.readFile(path.join(stagedRoot, "desktop-inventory.json"), "utf8"));
const paths = inventory.files.map((entry) => entry.path);

assert.equal(inventory.kind, "bibleapp:desktop-runtime-inventory");
assert.equal(inventory.schemaVersion, 1);
assert.equal(inventory.fileCount, paths.length);
assert.equal(new Set(paths).size, paths.length);
assert.ok(inventory.logicalBytes > 900_000_000, "The full authorized core corpus must be staged");
assert.ok(inventory.frontendBytes < 50_000_000, "Large corpus files must not be compiled into Rust frontend objects");
assert.ok(inventory.resourceBytes > 900_000_000, "The full data corpus must remain installer-owned resources");
assert.ok(paths.includes("data/package-manifest.json"));
assert.ok(paths.includes("src/platform/tauri-platform.js"));
assert.equal(paths.some((entry) => entry.includes("physical-pack-fixtures")), false);
assert.equal(paths.includes("data/physical-pack-scenarios.json"), false);
assert.equal(paths.some((entry) => entry.startsWith("tests/") || entry.startsWith("tools/")), false);
assert.equal(paths.some((entry) => /(?:^|\/)node_modules(?:\/|$)/.test(entry)), false);
assert.equal(paths.some((entry) => entry.endsWith(".log")), false);
assert.equal(paths.some((entry) => /(?:^|\/)(?:\.env|backup)(?:\.|\/|$)/i.test(entry)), false);
for (const entry of inventory.files) {
  const root = entry.placement === "resource" ? resourceRoot : stagedRoot;
  const stat = await fs.lstat(path.join(root, entry.path));
  assert.equal(stat.isFile(), true, `Staged inventory file is absent: ${entry.path}`);
  assert.equal(stat.isSymbolicLink(), false, `Staged inventory file is a link: ${entry.path}`);
}

const sourceHtml = await fs.readFile(path.join(repoRoot, "app", "index.html"), "utf8");
const desktopHtml = await fs.readFile(path.join(stagedRoot, "index.html"), "utf8");
assert.equal(sourceHtml.includes("ipc: http://ipc.localhost"), false, "Browser CSP must remain browser-only");
assert.equal(desktopHtml.includes("connect-src 'self' ipc: http://ipc.localhost"), true);
assert.equal(desktopHtml.includes("unsafe-eval"), false);

console.log(JSON.stringify({
  desktop_staging: "PASS",
  files: inventory.fileCount,
  logical_bytes: inventory.logicalBytes,
  frontend_bytes: inventory.frontendBytes,
  resource_bytes: inventory.resourceBytes,
  full_core_corpus: true,
  physical_fixture_corpus: false,
  csp_transform_only_in_staging: true,
}, null, 2));
