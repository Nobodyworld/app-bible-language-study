#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assertStrict from "node:assert/strict";
import {
  applyFeaturePackRemoval,
  applyPackageInstall,
  createDefaultPackageStore,
  createPackageStoreFromPackage,
  getPackageStoreSummary,
  setCapabilityDisabled,
} from "../src/package-state.js";
import { CAPABILITY_STATES, resolveCapability } from "../src/capabilities.js";
import { configureUserStorageAdapter, createUserDataExport, ensureStores, importUserData, setPackageStore } from "../src/stores.js";
import { createMemoryUserStorageAdapter } from "../src/platform/browser-user-storage.js";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = join(appRoot, "data");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(join(dataRoot, relativePath), "utf8"));
}

async function main() {
  configureUserStorageAdapter(createMemoryUserStorageAdapter());
  const manifest = await readJson("package-manifest.json");

  let packageStore = createDefaultPackageStore();
  const baselineInstall = applyPackageInstall(manifest, packageStore, {
    type: "feature_packs",
    feature_pack_ids: ["translation-bsb"],
  });
  packageStore = baselineInstall.store;
  assert(packageStore.installed_feature_pack_ids.includes("translation-bsb"), "baseline install missing translation-bsb");
  assert(baselineInstall.operation.physical_data_mutation === false, "package state must not mutate physical data");

  const strongsInstall = applyPackageInstall(manifest, packageStore, {
    type: "feature_packs",
    feature_pack_ids: ["bsb-strongs-overlay"],
  });
  packageStore = strongsInstall.store;
  assert(strongsInstall.plan.added_feature_pack_ids.length === 1, "Strong's install should add one pack");
  assert(packageStore.installed_feature_pack_ids.includes("bsb-strongs-overlay"), "Strong's install missing overlay");

  const blockedRemoval = applyFeaturePackRemoval(manifest, packageStore, ["translation-bsb"]);
  packageStore = blockedRemoval.store;
  assert(blockedRemoval.operation.state === "blocked", "dependent removal should be blocked");
  assert(blockedRemoval.store.installed_feature_pack_ids.includes("translation-bsb"), "blocked removal must preserve BSB");

  const cascadeRemoval = applyFeaturePackRemoval(manifest, packageStore, ["translation-bsb"], { cascade: true });
  packageStore = cascadeRemoval.store;
  assert(cascadeRemoval.operation.state === "applied", "cascade removal should apply");
  assert(cascadeRemoval.store.installed_feature_pack_ids.length === 0, "cascade removal should remove baseline packs");

  const fullStudyStore = createPackageStoreFromPackage(manifest, "reader-texts");
  const summary = getPackageStoreSummary(manifest, fullStudyStore);
  assert(summary.installed_feature_packs === manifest.feature_packs.length, "reader-texts should install all feature packs");
  assert(Number.isFinite(summary.installed_summary.bytes), "reader-texts summary size must be numeric");
  assert(
    resolveCapability(manifest, fullStudyStore, "commentary").state === CAPABILITY_STATES.available,
    "full-study should make commentary capability available",
  );
  const disabledCommentary = setCapabilityDisabled(manifest, fullStudyStore, "commentary", true);
  assert(
    resolveCapability(manifest, disabledCommentary.store, "commentary").state === CAPABILITY_STATES.disabled,
    "disabled capability should resolve as disabled without removing data",
  );
  const restoredCommentary = setCapabilityDisabled(manifest, disabledCommentary.store, "commentary", false);
  assert(
    resolveCapability(manifest, restoredCommentary.store, "commentary").state === CAPABILITY_STATES.available,
    "restored capability should become available without app restart",
  );
  assert(
    resolveCapability(
      manifest,
      { ...createDefaultPackageStore(), physical_data_mode: "managed_feature_packs" },
      "search",
      { assumeBundledFullAccess: false },
    ).state ===
      CAPABILITY_STATES.notInstalled,
    "explicit empty package store should report missing optional capabilities",
  );
  assert(
    resolveCapability(manifest, { ...fullStudyStore, disabled_feature_pack_ids: ["translation-bsb"] }, "strongs-overlay").state ===
      CAPABILITY_STATES.dependencyMissing,
    "disabled required dependency should report dependency_missing",
  );

  const state = {};
  ensureStores(state);
  setPackageStore(state, packageStore);
  const exported = createUserDataExport(state);
  assert(exported.stores.packages.operations.length === 4, "package operations missing from export");

  const importedState = {};
  ensureStores(importedState);
  const importedSummary = importUserData(importedState, exported, "replace");
  assert(importedSummary.package_operations === 4, "package operations missing after import");
  assert(importedSummary.installed_feature_packs === 0, "replace import should preserve cascade-removed package state");

  const historicalState = {};
  ensureStores(historicalState);
  const historicalPackages = {
    ...disabledCommentary.store,
    disabled_capability_ids: ["commentary", "historical-unknown-capability"],
    extension: { source: "historical-backup" },
  };
  setPackageStore(historicalState, historicalPackages);
  const historicalExport = createUserDataExport(historicalState);
  assert(historicalExport.version === 3, "Capability state must remain in version-3 backups");
  assertStrict.deepEqual(historicalExport.stores.packages, historicalPackages, "Export must preserve historical disabled IDs, package state and extensions");

  configureUserStorageAdapter(createMemoryUserStorageAdapter());
  const replacedHistorical = {};
  const historicalSummary = importUserData(replacedHistorical, historicalExport, "replace");
  assert(historicalSummary.last_import_backup?.reason === "before-replace-import", "Historical package replacement must retain recovery backup behavior");
  assertStrict.deepEqual(createUserDataExport(replacedHistorical).stores.packages, historicalPackages);
  const reloadedHistorical = {};
  ensureStores(reloadedHistorical);
  assertStrict.deepEqual(reloadedHistorical.packageStore, historicalPackages, "Historical disabled IDs and package state must survive storage reload");
  assert(resolveCapability(manifest, reloadedHistorical.packageStore, "commentary").state === CAPABILITY_STATES.disabled, "Preserved IDs must still affect capability resolution");

  const mergePayload = structuredClone(historicalExport);
  mergePayload.stores.packages.disabled_capability_ids = ["search"];
  importUserData(reloadedHistorical, mergePayload, "merge");
  assertStrict.deepEqual(reloadedHistorical.packageStore.disabled_capability_ids, historicalPackages.disabled_capability_ids, "Merge must retain existing local capability preferences rather than adopt incoming preferences");
  assertStrict.deepEqual(createUserDataExport({}).stores.packages, historicalPackages, "Merge/export/reload must preserve package state and historical disabled IDs");

  const beforeRestore = createUserDataExport(reloadedHistorical);
  const restoredHistorical = setCapabilityDisabled(manifest, reloadedHistorical.packageStore, "commentary", false);
  assertStrict.deepEqual(restoredHistorical.store.disabled_capability_ids, ["historical-unknown-capability"], "Restoring one known capability must not discard unknown historical IDs");
  assertStrict.deepEqual(restoredHistorical.store.installed_feature_pack_ids, historicalPackages.installed_feature_pack_ids);
  setPackageStore(reloadedHistorical, restoredHistorical.store);
  const afterRestore = createUserDataExport(reloadedHistorical);
  for (const name of ["tags", "workspace", "assertions", "polls"]) assertStrict.deepEqual(afterRestore.stores[name], beforeRestore.stores[name], `Capability restoration must preserve ${name}`);

  console.log(
    JSON.stringify(
      {
        baselineInstalled: baselineInstall.store.installed_feature_pack_ids,
        strongsAdded: strongsInstall.plan.added_feature_pack_ids,
        blockedRemoval: blockedRemoval.operation.state,
        cascadeRemoved: cascadeRemoval.plan.removed_feature_pack_ids,
        fullStudyInstalledPacks: summary.installed_feature_packs,
        exportedPackageOperations: exported.stores.packages.operations.length,
        historicalCapabilityPreferences: "replace/merge/export/reload and selective restoration preserved",
        importedSummary,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
