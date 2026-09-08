#!/usr/bin/env node

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (relativePath) => JSON.parse(await fs.readFile(path.join(repoRoot, relativePath), "utf8"));
const readText = async (relativePath) => fs.readFile(path.join(repoRoot, relativePath), "utf8");

const stableConfig = await readJson("src-tauri/tauri.conf.json");
const labConfig = await readJson("src-tauri/tauri.lab.conf.json");
const capability = await readJson("src-tauri/capabilities/main.json");
const packageJson = await readJson("package.json");
const cargoToml = await readText("src-tauri/Cargo.toml");
const desktopE2e = await readText("app/tools/run-desktop-e2e.mjs");
const verifyWorkflow = await readText(".github/workflows/verify.yml");
const requiredGatesWorkflow = await readText(".github/workflows/required-gates.yml");
const desktopVerifyWorkflow = await readText(".github/workflows/desktop-verify.yml");

function onlyWindow(config, label) {
  assert.equal(config?.app?.windows?.length, 1, `${label} must configure exactly one shared application window`);
  return config.app.windows[0];
}

const stableWindow = onlyWindow(stableConfig, "Stable");
const labWindow = onlyWindow(labConfig, "Lab");
const sharedWindowContract = Object.freeze({
  label: "main",
  width: 1280,
  height: 820,
  minWidth: 390,
  minHeight: 640,
  resizable: true,
  fullscreen: false,
  maximized: false,
  decorations: true,
  zoomHotkeysEnabled: true,
  devtools: false,
  visible: true,
});

for (const [label, windowConfig] of [["Stable", stableWindow], ["Lab", labWindow]]) {
  for (const [field, expected] of Object.entries(sharedWindowContract)) {
    assert.equal(windowConfig[field], expected, `${label} window must preserve ${field}`);
  }
}

assert.equal(stableWindow.title, "Bible App Reader");
assert.equal(Object.hasOwn(stableWindow, "url"), false, "Stable must retain Tauri's internal index.html default");
assert.equal(labWindow.title, "Bible App Reader Lab");
assert.equal(labWindow.url, "index.html", "Lab must load the shared index asset without treating a query as a path");
assert.deepEqual(capability.windows, ["main"], "The least-privilege capability must remain scoped to the shared main label");
assert.deepEqual(stableConfig.app.security.capabilities, ["main"]);
assert.equal(Object.hasOwn(labConfig, "build"), false, "Lab must reuse the shared frontend build");
assert.equal(Object.hasOwn(labConfig, "bundle"), false, "Lab must not define a second installer");

assert.equal(stableConfig.build.beforeDevCommand, null, "Staging must not race Cargo through Tauri's concurrent dev hook");
assert.equal(stableConfig.build.beforeBuildCommand, "npm run desktop:prepare");
assert.equal(packageJson.scripts["desktop:dev"], "npm run desktop:prepare && tauri dev --no-dev-server");
assert.equal(
  packageJson.scripts["desktop:dev:lab"],
  "npm run desktop:prepare && tauri dev --no-dev-server --features lab-profile --config ./src-tauri/tauri.lab.conf.json",
);

const featureBlock = cargoToml.match(/\[features\]\r?\n([\s\S]*?)(?=\r?\n\[|$)/)?.[1] || "";
assert.match(featureBlock, /^default\s*=\s*\[\]\s*$/m);
assert.match(featureBlock, /^lab-profile\s*=\s*\[\]\s*$/m, "Lab startup must be selected by an explicit native build feature");
assert.doesNotMatch(
  desktopE2e,
  /invoke\(['"](?:read_user_store|write_user_store|native_flush_status)['"],\s*\{[^}]*profileId/s,
  "Desktop E2E storage calls must not send a frontend-selected profile ID",
);
assert.match(desktopE2e, /PROFILE_ID === ["']lab["'][\s\S]*?--features["'], ["']lab-profile/, "Lab E2E builds must compile the native Lab feature");

assert.match(verifyWorkflow, /name: deterministic \(\$\{\{ matrix\.node-version \}\}\)/);
assert.match(verifyWorkflow, /node-version:\s*\n\s*- "20"\s*\n\s*- "24"/);
assert.match(verifyWorkflow, /run: npm run test:static/);
assert.match(verifyWorkflow, /run: npm run audit/);
assert.match(verifyWorkflow, /name: browser \(20\)/);
assert.match(verifyWorkflow, /run: npm run test:browser\s*$/m);
assert.match(verifyWorkflow, /run: npm run test:browser:mobile/);
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

assert.match(requiredGatesWorkflow, /name: Required Gates/);
assert.match(requiredGatesWorkflow, /permissions:\s*\n\s+contents: read\s*\n\s+checks: read/);
assert.match(requiredGatesWorkflow, /name: security\/relevance/);
assert.match(requiredGatesWorkflow, /name: desktop\/security gate/);
assert.match(requiredGatesWorkflow, /if: always\(\)/);
assert.match(requiredGatesWorkflow, /gitleaks-8\.30\.1-windows-x64\.zip/);
assert.match(requiredGatesWorkflow, /D29144DEFF3A68AA93CED33DDDF84B7FDC26070ADD4AA0F4513094C8332AFC4E/);
assert.match(requiredGatesWorkflow, /gitleaks git --no-banner --redact=100 --log-opts=\$range \./);
assert.match(requiredGatesWorkflow, /\^app\//);
assert.match(requiredGatesWorkflow, /\^src-tauri\//);
assert.match(requiredGatesWorkflow, /\^tests\/desktop-\.\*\\\.mjs\$/);
assert.match(requiredGatesWorkflow, /\^package\(-lock\)\?\\\.json\$/);
assert.match(requiredGatesWorkflow, /checkName = 'desktop \(windows-2022\)'/);
assert.match(requiredGatesWorkflow, /commits\/\$env:CANDIDATE_SHA\/check-runs/);
assert.match(requiredGatesWorkflow, /head_sha -eq \$env:CANDIDATE_SHA/);
assert.match(requiredGatesWorkflow, /if \(\$check\.conclusion -eq 'success'\) \{ exit 0 \}/);
assert.equal(
  (requiredGatesWorkflow.match(/persist-credentials: false/g) || []).length,
  1,
  "The always-run security checkout must keep persisted credentials disabled",
);

assert.match(desktopVerifyWorkflow, /name: desktop \(windows-2022\)/);
assert.match(
  desktopVerifyWorkflow,
  /pull_request:\s*\n\s+paths:/,
  "The expensive desktop lifecycle should remain path-scoped; Required Gates owns always-present merge enforcement",
);
assert.match(desktopVerifyWorkflow, /persist-credentials: false/);
assert.match(desktopVerifyWorkflow, /gitleaks-8\.30\.1-windows-x64\.zip/);

console.log(JSON.stringify({
  desktop_config_contracts: "PASS",
  shared_internal_index: "PASS",
  native_lab_selection: "PASS",
  native_profile_not_frontend_argument: "PASS",
  stable_lab_zoom_hotkeys: "PASS",
  stable_window_property_parity: "PASS",
  least_privilege_main_capability: "PASS",
  sequential_dev_staging: "PASS",
  no_localhost_dev_server: "PASS",
  ci_required_context_candidates: [
    "deterministic (20)",
    "deterministic (24)",
    "browser (20)",
    "desktop/security gate",
  ],
  browser_matrix_duplication: "ABSENT",
  always_present_desktop_security_gate: "PASS",
}, null, 2));
