#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  FEATURE_LIFECYCLES,
  FEATURE_REGISTRY,
  FeatureRegistryValidationError,
  assertValidFeatureRegistry,
  validateFeatureRegistry,
} from "../app/src/feature-registry.js";
import { FEATURE_PROFILES } from "../app/src/feature-profiles.js";

const requiredIds = [
  "reader", "translations", "language-study", "strongs", "study-marks", "meaning", "my-data",
  "search", "commentary", "cross-references", "parallel-translations", "outlines",
  "physical-pack-management", "local-jobs", "capability-controls", "advanced-diagnostics",
  "interpretation-polls",
];

assert.deepEqual([...new Set(FEATURE_REGISTRY.map((feature) => feature.id))].sort(), [...requiredIds].sort());
assert.deepEqual(FEATURE_LIFECYCLES, ["core", "stable", "lab", "frozen", "compatibility_only"]);
assert.deepEqual(validateFeatureRegistry(FEATURE_REGISTRY, FEATURE_PROFILES), []);
assert.equal(assertValidFeatureRegistry(FEATURE_REGISTRY, FEATURE_PROFILES), FEATURE_REGISTRY);

const fixture = (values = {}) => ({
  id: "fixture",
  label: "Fixture",
  description: "Fixture feature.",
  lifecycle: "stable",
  dependencies: [],
  capabilityIds: [],
  packIds: [],
  providers: [],
  uiSurfaces: ["none"],
  ownedControlIds: [],
  storageNamespaces: [],
  portableUserData: false,
  defaultProfiles: ["stable"],
  unavailableBehavior: "hide",
  cleanupAuthority: "none",
  migrationAuthority: "none",
  testOwners: ["tests/fixture.mjs"],
  ...values,
});

const invalid = [
  fixture({ id: "duplicate", ownedControlIds: ["shared-control"] }),
  fixture({ id: "duplicate", lifecycle: "unknown", ownedControlIds: ["shared-control"] }),
  fixture({ id: "self", dependencies: ["self"] }),
  fixture({ id: "missing", dependencies: ["not-registered"] }),
  fixture({ id: "cycle-a", dependencies: ["cycle-b"] }),
  fixture({ id: "cycle-b", dependencies: ["cycle-a"] }),
  fixture({ id: "lab-only", lifecycle: "lab" }),
  fixture({ id: "bad-core", lifecycle: "core", dependencies: ["lab-only"] }),
  fixture({ id: "compat-ui", lifecycle: "compatibility_only", uiSurfaces: ["reader-header"], ownedControlIds: ["compat"] }),
  fixture({ id: "bad-surface", uiSurfaces: ["sidebar-of-mystery"] }),
  fixture({ id: "bad-behavior", unavailableBehavior: "silently-break" }),
  fixture({ id: "untested", testOwners: [] }),
  fixture({ id: "profile-parent" }),
  fixture({ id: "profile-child", dependencies: ["profile-parent"] }),
];
const invalidProfiles = [{
  id: "stable",
  featureIds: invalid.map(({ id }) => id).filter((id) => !["missing", "profile-parent"].includes(id)),
}];
const diagnostics = validateFeatureRegistry(invalid, invalidProfiles);
for (const code of [
  "duplicate_feature_id", "invalid_lifecycle", "duplicate_control_owner", "self_dependency",
  "missing_dependency", "dependency_cycle", "core_depends_on_experimental", "compatibility_ui_forbidden",
  "invalid_ui_surface", "invalid_unavailable_behavior", "missing_test_owner", "profile_dependency_not_closed",
]) {
  assert.ok(diagnostics.some((item) => item.code === code), `missing actionable diagnostic ${code}`);
}
assert.throws(() => assertValidFeatureRegistry(invalid, invalidProfiles), (error) =>
  error instanceof FeatureRegistryValidationError && /duplicate_feature_id/.test(error.message));

console.log(JSON.stringify({
  features: FEATURE_REGISTRY.length,
  lifecycle_values: FEATURE_LIFECYCLES,
  invalid_fixture_diagnostics: [...new Set(diagnostics.map(({ code }) => code))].sort(),
}, null, 2));
