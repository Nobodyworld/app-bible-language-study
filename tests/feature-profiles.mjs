#!/usr/bin/env node

import assert from "node:assert/strict";
import { FEATURE_REGISTRY } from "../app/src/feature-registry.js";
import {
  featureAccess,
  featureEnabled,
  resolveFeatureProfile,
  resolveTestFeatureProfile,
} from "../app/src/feature-profiles.js";
import {
  LAB_STORAGE_IDENTITIES,
  STABLE_STORAGE_IDENTITIES,
  storageIdentitiesForProfile,
} from "../app/src/platform/storage-identities.js";

const stable = resolveFeatureProfile();
const lab = resolveFeatureProfile("lab");
assert.equal(stable.id, "stable");
assert.equal(stable.requestedId, "stable");
assert.equal(lab.id, "lab");
for (const feature of FEATURE_REGISTRY.filter(({ lifecycle }) => ["core", "stable"].includes(lifecycle))) {
  assert.ok(featureEnabled(stable, feature.id), `${feature.id} must be enabled in Stable`);
  assert.equal(featureAccess(stable, feature.id), "ordinary");
  assert.equal(featureAccess(lab, feature.id), "ordinary");
}
for (const feature of FEATURE_REGISTRY.filter(({ lifecycle }) => ["lab", "frozen"].includes(lifecycle))) {
  const stableAccess = feature.defaultProfiles.includes("stable") ? "recovery" : "disabled";
  assert.equal(featureAccess(stable, feature.id), stableAccess, `${feature.id} must respect Stable presentation access`);
  assert.equal(featureAccess(lab, feature.id), "ordinary", `${feature.id} must be complete in Lab`);
}
assert.equal(featureEnabled(stable, "capability-controls"), false, "Stable must not enable capability mutations");
assert.equal(featureEnabled(lab, "capability-controls"), true, "Lab must retain capability mutations");
assert.equal(stable.recoveryFeatureIds.includes("capability-controls"), false);
for (const id of ["my-data", "physical-pack-management", "advanced-diagnostics"]) {
  assert.equal(featureEnabled(stable, id), true, `${id} must survive removal of Stable capability controls`);
}
const labWithoutControls = resolveTestFeatureProfile("lab", ["capability-controls"]);
assert.equal(featureEnabled(labWithoutControls, "capability-controls"), false);
assert.equal(featureEnabled(labWithoutControls, "advanced-diagnostics"), true, "Recovery diagnostics must not depend on capability mutations");
assert.equal(featureEnabled(labWithoutControls, "physical-pack-management"), true);
assert.equal(featureAccess(stable, "interpretation-polls"), "compatibility");
assert.equal(featureAccess(lab, "interpretation-polls"), "compatibility");

const unknown = resolveFeatureProfile("future-experiment");
assert.equal(unknown.id, "stable");
assert.equal(unknown.diagnostics[0].code, "unknown_profile");
assert.equal(unknown.diagnostics[0].requested_profile, "future-experiment");
assert.equal(featureEnabled(unknown, "capability-controls"), false, "Unknown profiles must not expose Lab mutations");

const disabled = resolveTestFeatureProfile("stable", ["search", "commentary", "cross-references", "outlines"]);
for (const id of ["search", "commentary", "cross-references", "outlines"]) assert.equal(featureEnabled(disabled, id), false);
for (const id of ["reader", "language-study", "strongs", "study-marks", "meaning", "my-data"]) assert.equal(featureEnabled(disabled, id), true);

assert.equal(storageIdentitiesForProfile("stable"), STABLE_STORAGE_IDENTITIES);
assert.equal(storageIdentitiesForProfile("lab"), LAB_STORAGE_IDENTITIES);
assert.equal(STABLE_STORAGE_IDENTITIES.userDatabase, "bibleapp");
assert.equal(STABLE_STORAGE_IDENTITIES.localStorageKeys.tags, "bibleapp:verse-tags:v1");
assert.equal(STABLE_STORAGE_IDENTITIES.localStorageKeys.workspace, "bibleapp:translation-workspace:v1");
assert.equal(STABLE_STORAGE_IDENTITIES.notificationChannel, "bibleapp:user-data");
assert.equal(STABLE_STORAGE_IDENTITIES.physicalRegistryDatabase, "bibleapp-physical-packs");
assert.equal(STABLE_STORAGE_IDENTITIES.physicalBytePrefix, "bibleapp-pack:");
assert.equal(LAB_STORAGE_IDENTITIES.userDatabase, "bibleapp-lab");
assert.equal(LAB_STORAGE_IDENTITIES.notificationChannel, "bibleapp:lab:user-data");
assert.equal(LAB_STORAGE_IDENTITIES.physicalRegistryDatabase, "bibleapp-physical-packs-lab");
assert.equal(LAB_STORAGE_IDENTITIES.physicalBytePrefix, "bibleapp-pack:lab:");
assert.notDeepEqual(LAB_STORAGE_IDENTITIES.localStorageKeys, STABLE_STORAGE_IDENTITIES.localStorageKeys);
assert.ok(!Object.values(STABLE_STORAGE_IDENTITIES.localStorageKeys).includes("bibleAppTheme"));
assert.ok(!Object.values(STABLE_STORAGE_IDENTITIES.localStorageKeys).includes("bibleapp:study-workspace-width:v1"));

console.log(JSON.stringify({
  default_profile: stable.id,
  lab_profile: lab.id,
  stable_recovery_features: stable.recoveryFeatureIds,
  unknown_profile_diagnostic: unknown.diagnostics[0],
  isolated_databases: [STABLE_STORAGE_IDENTITIES.userDatabase, LAB_STORAGE_IDENTITIES.userDatabase],
}, null, 2));
