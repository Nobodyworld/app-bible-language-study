#!/usr/bin/env node

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readText = (relativePath) => fs.readFile(path.join(repoRoot, relativePath), "utf8");

const [verifyWorkflow, desktopWorkflow, packageText] = await Promise.all([
  readText(".github/workflows/verify.yml"),
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

assert.doesNotMatch(
  desktopWorkflow,
  /pull_request:\s*\n\s+paths:/,
  "Desktop Verify must emit an always-present PR gate instead of using workflow-level path filters",
);
assert.doesNotMatch(
  desktopWorkflow,
  /push:\s*\n\s+branches:\s*\n\s+- main\s*\n\s+paths:/,
  "Desktop Verify must emit an always-present main-push gate instead of using workflow-level path filters",
);
assert.match(desktopWorkflow, /name: security and relevance/);
assert.match(desktopWorkflow, /name: desktop lifecycle \(windows-2022\)/);
assert.match(desktopWorkflow, /if: needs\.preflight\.outputs\.desktop_relevant == 'true'/);
assert.match(desktopWorkflow, /name: desktop\/security gate/);
assert.match(desktopWorkflow, /if: always\(\)/);
assert.match(desktopWorkflow, /needs: \[preflight, desktop\]/);
assert.match(desktopWorkflow, /gitleaks-8\.30\.1-windows-x64\.zip/);
assert.match(desktopWorkflow, /D29144DEFF3A68AA93CED33DDDF84B7FDC26070ADD4AA0F4513094C8332AFC4E/);
assert.match(desktopWorkflow, /gitleaks git --no-banner --redact=100 --log-opts=\$range \./);
assert.match(desktopWorkflow, /desktop_relevant=true/);
assert.match(desktopWorkflow, /desktop_relevant=false/);
assert.match(desktopWorkflow, /\^app\//);
assert.match(desktopWorkflow, /\^src-tauri\//);
assert.match(desktopWorkflow, /\^tests\/desktop-\.\*\\\.mjs\$/);
assert.match(desktopWorkflow, /\^package\(-lock\)\?\\\.json\$/);
assert.ok(
  (desktopWorkflow.match(/persist-credentials: false/g) || []).length >= 2,
  "Security/relevance and desktop lifecycle checkouts must keep persisted credentials disabled",
);

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
  gitleaks_every_pr: "PASS",
}, null, 2));
