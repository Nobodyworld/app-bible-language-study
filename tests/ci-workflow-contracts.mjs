#!/usr/bin/env node

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readText = (relativePath) => fs.readFile(path.join(repoRoot, relativePath), "utf8");

const [verifyWorkflow, requiredWorkflow, desktopWorkflow, packageText] = await Promise.all([
  readText(".github/workflows/verify.yml"),
  readText(".github/workflows/required-gates.yml"),
  readText(".github/workflows/desktop-verify.yml"),
  readText("package.json"),
]);
const packageJson = JSON.parse(packageText);

assert.equal(
  packageJson.scripts["verify:deterministic"],
  "npm run test:static && npm run audit",
  "Deterministic verification must own static/domain/generator/integrity and publication-audit coverage",
);
assert.equal(
  packageJson.scripts["verify:browser"],
  "npm run test:browser && npm run test:browser:mobile",
  "Browser verification must own rendered desktop/mobile interaction acceptance exactly once",
);
assert.equal(
  packageJson.scripts.verify,
  "npm run verify:deterministic && npm run verify:browser",
  "Local npm run verify must retain the complete deterministic + browser acceptance contract",
);

assert.match(verifyWorkflow, /name: deterministic \(\$\{\{ matrix\.node-version \}\}\)/);
assert.match(verifyWorkflow, /node-version:\s*\n\s*- "20"\s*\n\s*- "24"/);
assert.match(verifyWorkflow, /run: npm run verify:deterministic/);
assert.match(verifyWorkflow, /name: browser \(20\)/);
assert.match(verifyWorkflow, /node-version: "20"/);
assert.match(verifyWorkflow, /run: npm run verify:browser/);
assert.doesNotMatch(
  verifyWorkflow,
  /run: npm run verify\s*$/m,
  "Hosted Node compatibility jobs must not duplicate the complete browser aggregate",
);
assert.equal(
  (verifyWorkflow.match(/persist-credentials: false/g) || []).length,
  2,
  "Both Verify checkouts must keep persisted credentials disabled",
);

assert.match(requiredWorkflow, /name: Required Gates/);
assert.match(requiredWorkflow, /permissions:\s*\n\s+contents: read\s*\n\s+checks: read/);
assert.match(requiredWorkflow, /name: security\/relevance/);
assert.match(requiredWorkflow, /name: desktop\/security gate/);
assert.match(requiredWorkflow, /if: always\(\)/);
assert.match(requiredWorkflow, /gitleaks-8\.30\.1-windows-x64\.zip/);
assert.match(requiredWorkflow, /D29144DEFF3A68AA93CED33DDDF84B7FDC26070ADD4AA0F4513094C8332AFC4E/);
assert.match(requiredWorkflow, /gitleaks git --no-banner --redact=100 --log-opts=\$range \./);
assert.match(requiredWorkflow, /desktop_relevant=/);
assert.match(requiredWorkflow, /\^app\//);
assert.match(requiredWorkflow, /\^src-tauri\//);
assert.match(requiredWorkflow, /\^tests\/desktop-\.\*\\\.mjs\$/);
assert.match(requiredWorkflow, /\^package\(-lock\)\?\\\.json\$/);
assert.match(requiredWorkflow, /checkName = 'desktop \(windows-2022\)'/);
assert.match(requiredWorkflow, /commits\/\$env:CANDIDATE_SHA\/check-runs/);
assert.match(requiredWorkflow, /head_sha -eq \$env:CANDIDATE_SHA/);
assert.match(requiredWorkflow, /if \(\$check\.conclusion -eq 'success'\) \{ exit 0 \}/);
assert.equal(
  (requiredWorkflow.match(/persist-credentials: false/g) || []).length,
  1,
  "The always-run security checkout must keep persisted credentials disabled",
);

assert.match(desktopWorkflow, /name: desktop \(windows-2022\)/);
assert.match(
  desktopWorkflow,
  /pull_request:\s*\n\s+paths:/,
  "The expensive desktop lifecycle should remain path-scoped; the always-present required gate owns merge enforcement",
);
assert.match(desktopWorkflow, /persist-credentials: false/);
assert.match(desktopWorkflow, /gitleaks-8\.30\.1-windows-x64\.zip/);

console.log(JSON.stringify({
  ci_workflow_contracts: "PASS",
  required_context_candidates: [
    "deterministic (20)",
    "deterministic (24)",
    "browser (20)",
    "desktop/security gate",
  ],
  browser_matrix_duplication: "ABSENT",
  always_present_desktop_security_gate: "PASS",
  path_scoped_desktop_lifecycle: "PRESERVED",
  gitleaks_every_pr: "PASS",
}, null, 2));
