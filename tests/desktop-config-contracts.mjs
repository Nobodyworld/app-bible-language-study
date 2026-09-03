#!/usr/bin/env node

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (relativePath) => JSON.parse(await fs.readFile(path.join(repoRoot, relativePath), "utf8"));

const stableConfig = await readJson("src-tauri/tauri.conf.json");
const labConfig = await readJson("src-tauri/tauri.lab.conf.json");
const capability = await readJson("src-tauri/capabilities/main.json");
const packageJson = await readJson("package.json");
const cargoToml = await fs.readFile(path.join(repoRoot, "src-tauri/Cargo.toml"), "utf8");
const desktopE2e = await fs.readFile(path.join(repoRoot, "app/tools/run-desktop-e2e.mjs"), "utf8");

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
}, null, 2));
