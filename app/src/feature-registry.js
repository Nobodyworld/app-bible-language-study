export const FEATURE_LIFECYCLES = Object.freeze([
  "core",
  "stable",
  "lab",
  "frozen",
  "compatibility_only",
]);

export const FEATURE_UI_SURFACES = Object.freeze([
  "reader",
  "reader-header",
  "home",
  "detail-word",
  "detail-verse",
  "my-data",
  "advanced-diagnostics",
  "none",
]);

export const FEATURE_UNAVAILABLE_BEHAVIORS = Object.freeze([
  "required",
  "hide",
  "structured_unavailable",
  "recovery_only",
  "compatibility_only",
]);

const descriptor = (value) => Object.freeze({
  dependencies: [],
  capabilityIds: [],
  packIds: [],
  providers: [],
  uiSurfaces: [],
  ownedControlIds: [],
  storageNamespaces: [],
  portableUserData: false,
  defaultProfiles: ["stable", "lab"],
  cleanupAuthority: "none",
  migrationAuthority: "none",
  testOwners: [],
  ...value,
});

export const FEATURE_REGISTRY = Object.freeze([
  descriptor({
    id: "translations",
    label: "Translations",
    description: "Bundled Bible translations and translation selection.",
    lifecycle: "core",
    providers: ["data:verses"],
    uiSurfaces: ["reader-header", "reader"],
    ownedControlIds: ["translationSelect"],
    unavailableBehavior: "required",
    testOwners: ["tests/integrity.mjs", "app/scripts/interaction-test.mjs"],
  }),
  descriptor({
    id: "reader",
    label: "Reader",
    description: "Hash-routed local-first scripture reader and navigation shell.",
    lifecycle: "core",
    dependencies: ["translations"],
    providers: ["ui:reader", "routing:hash"],
    uiSurfaces: ["reader", "reader-header", "home"],
    ownedControlIds: ["homeButton", "bookPickerButton", "chapterPickerButton", "prevChapter", "nextChapter"],
    unavailableBehavior: "required",
    testOwners: ["app/scripts/interaction-test.mjs", "tests/reader-ui-regressions.mjs"],
  }),
  descriptor({
    id: "strongs",
    label: "Strong's",
    description: "Strong's-linked word context and lexicon detail.",
    lifecycle: "core",
    dependencies: ["reader", "translations"],
    capabilityIds: ["strongs-overlay", "lexicon-language-metadata"],
    providers: ["view:strongs"],
    uiSurfaces: ["detail-word"],
    unavailableBehavior: "structured_unavailable",
    testOwners: ["tests/strong-section-lifecycle.mjs", "app/scripts/strong-preview-hydration-test.mjs"],
  }),
  descriptor({
    id: "language-study",
    label: "Language Study",
    description: "Chapter and verse Hebrew and Greek study surfaces.",
    lifecycle: "core",
    dependencies: ["reader", "strongs"],
    capabilityIds: ["interlinear", "strongs-overlay", "lexicon-language-metadata"],
    providers: ["view:language-study"],
    uiSurfaces: ["reader-header", "detail-verse"],
    ownedControlIds: ["showInterlinear"],
    unavailableBehavior: "structured_unavailable",
    testOwners: ["tests/original-language-study.mjs", "app/scripts/original-language-study-interaction-test.mjs"],
  }),
  descriptor({
    id: "study-marks",
    label: "Study Marks",
    description: "Target-aware Favorites, tags, assertions, and local indexes.",
    lifecycle: "core",
    dependencies: ["reader"],
    providers: ["view:study-marks"],
    uiSurfaces: ["reader", "reader-header", "detail-word", "detail-verse", "home", "my-data"],
    ownedControlIds: ["showTags", "bookTagControl", "chapterTagControl"],
    storageNamespaces: ["tags", "assertions"],
    portableUserData: true,
    unavailableBehavior: "required",
    cleanupAuthority: "derived-index-only",
    migrationAuthority: "user-storage-adapter",
    testOwners: ["tests/tags.mjs", "app/scripts/user-data-semantic-test.mjs"],
  }),
  descriptor({
    id: "meaning",
    label: "Meaning",
    description: "Personal meanings for exact canonical source-token identity.",
    lifecycle: "core",
    dependencies: ["language-study"],
    providers: ["view:meaning"],
    uiSurfaces: ["detail-word"],
    storageNamespaces: ["workspace"],
    portableUserData: true,
    unavailableBehavior: "required",
    migrationAuthority: "user-storage-adapter",
    testOwners: ["tests/word-meaning.mjs", "app/scripts/word-meaning-focus-test.mjs"],
  }),
  descriptor({
    id: "my-data",
    label: "My Data",
    description: "Portable backup, restore, settings, maintenance, and recovery access.",
    lifecycle: "core",
    dependencies: ["study-marks", "meaning"],
    providers: ["view:my-data", "contract:user-data-v3"],
    uiSurfaces: ["reader-header", "home", "my-data"],
    ownedControlIds: ["showMyData"],
    storageNamespaces: ["tags", "workspace", "assertions", "polls", "packages", "importBackups"],
    portableUserData: true,
    unavailableBehavior: "required",
    cleanupAuthority: "recovery-backups-only",
    migrationAuthority: "user-storage-adapter",
    testOwners: ["app/scripts/user-data-semantic-test.mjs", "app/scripts/recovery-scenarios-test.mjs"],
  }),
  descriptor({
    id: "search",
    label: "Search",
    description: "Bundled deterministic scripture and study search.",
    lifecycle: "stable",
    dependencies: ["reader", "translations"],
    capabilityIds: ["search"],
    packIds: ["search-verses"],
    providers: ["view:search"],
    uiSurfaces: ["reader-header", "home"],
    ownedControlIds: ["showSearch"],
    unavailableBehavior: "structured_unavailable",
    testOwners: ["app/scripts/search-highlight-interaction-test.mjs", "app/scripts/reader-data-loading-interaction-test.mjs"],
  }),
  descriptor({
    id: "commentary",
    label: "Commentary",
    description: "Verse commentary from deterministic bundled aggregates and sources.",
    lifecycle: "stable",
    dependencies: ["reader"],
    capabilityIds: ["commentary"],
    packIds: ["commentary-verse-index"],
    providers: ["view:commentary"],
    uiSurfaces: ["detail-verse"],
    unavailableBehavior: "structured_unavailable",
    testOwners: ["app/scripts/panel-context-interaction-test.mjs"],
  }),
  descriptor({
    id: "cross-references",
    label: "Cross References",
    description: "Verse-scoped cross-reference and Treasury links.",
    lifecycle: "stable",
    dependencies: ["reader"],
    capabilityIds: ["crossrefs"],
    providers: ["view:cross-references"],
    uiSurfaces: ["detail-verse"],
    unavailableBehavior: "structured_unavailable",
    testOwners: ["app/scripts/panel-context-interaction-test.mjs", "tests/reference-context.mjs"],
  }),
  descriptor({
    id: "parallel-translations",
    label: "Parallel Translations",
    description: "Verse comparison across bundled translations.",
    lifecycle: "stable",
    dependencies: ["reader", "translations"],
    providers: ["view:parallel-translations"],
    uiSurfaces: ["detail-verse"],
    unavailableBehavior: "structured_unavailable",
    testOwners: ["app/scripts/panel-context-interaction-test.mjs"],
  }),
  descriptor({
    id: "outlines",
    label: "Outlines",
    description: "Book outline navigation and detail.",
    lifecycle: "stable",
    dependencies: ["reader"],
    capabilityIds: ["outlines"],
    providers: ["view:outline"],
    uiSurfaces: ["reader-header"],
    ownedControlIds: ["showOutline"],
    unavailableBehavior: "structured_unavailable",
    testOwners: ["app/scripts/reader-data-loading-interaction-test.mjs"],
  }),
  descriptor({
    id: "physical-pack-management",
    label: "Physical Pack Management",
    description: "Recovery and experimental management for verified physical data packs.",
    lifecycle: "frozen",
    dependencies: ["my-data"],
    providers: ["diagnostic:physical-packs"],
    uiSurfaces: ["advanced-diagnostics"],
    storageNamespaces: ["physical-pack-registry", "physical-pack-bytes"],
    portableUserData: false,
    unavailableBehavior: "recovery_only",
    cleanupAuthority: "orphan-physical-pack-bytes",
    migrationAuthority: "physical-pack-registry",
    testOwners: ["app/scripts/physical-pack-lifecycle-test.mjs", "app/scripts/physical-pack-interaction-test.mjs"],
  }),
  descriptor({
    id: "local-jobs",
    label: "Local Jobs",
    description: "Technical local job history and diagnostic controls.",
    lifecycle: "frozen",
    dependencies: ["my-data"],
    providers: ["diagnostic:local-jobs"],
    uiSurfaces: ["advanced-diagnostics"],
    storageNamespaces: ["tags", "workspace"],
    portableUserData: true,
    unavailableBehavior: "recovery_only",
    testOwners: ["app/scripts/job-processor-test.mjs"],
  }),
  descriptor({
    id: "capability-controls",
    label: "Capability Controls",
    description: "Technical package capability toggles for diagnostics.",
    lifecycle: "frozen",
    dependencies: ["my-data"],
    providers: ["diagnostic:capabilities"],
    uiSurfaces: ["advanced-diagnostics"],
    storageNamespaces: ["packages"],
    portableUserData: true,
    unavailableBehavior: "recovery_only",
    testOwners: ["tests/capabilities.mjs", "app/scripts/package-state-test.mjs"],
  }),
  descriptor({
    id: "advanced-diagnostics",
    label: "Advanced Diagnostics",
    description: "Collapsed Stable recovery surface and expanded Lab diagnostics.",
    lifecycle: "lab",
    dependencies: ["physical-pack-management", "local-jobs", "capability-controls"],
    providers: ["diagnostic:advanced"],
    uiSurfaces: ["advanced-diagnostics"],
    unavailableBehavior: "recovery_only",
    testOwners: ["app/scripts/physical-pack-interaction-test.mjs", "app/scripts/feature-profile-interaction-test.mjs"],
  }),
  descriptor({
    id: "interpretation-polls",
    label: "Interpretation Polls",
    description: "Compatibility-only persisted poll responses pending issue #82 retirement.",
    lifecycle: "compatibility_only",
    dependencies: ["my-data"],
    providers: ["compatibility:poll-storage"],
    uiSurfaces: ["none"],
    storageNamespaces: ["polls"],
    portableUserData: true,
    unavailableBehavior: "compatibility_only",
    migrationAuthority: "user-storage-adapter",
    testOwners: ["app/scripts/poll-response-test.mjs"],
  }),
]);

export class FeatureRegistryValidationError extends Error {
  constructor(diagnostics) {
    super(`Feature registry validation failed:\n${diagnostics.map((item) => `- [${item.code}] ${item.message}`).join("\n")}`);
    this.name = "FeatureRegistryValidationError";
    this.diagnostics = diagnostics;
  }
}

export function validateFeatureRegistry(registry = FEATURE_REGISTRY, profiles = []) {
  const diagnostics = [];
  const lifecycleValues = new Set(FEATURE_LIFECYCLES);
  const surfaceValues = new Set(FEATURE_UI_SURFACES);
  const behaviorValues = new Set(FEATURE_UNAVAILABLE_BEHAVIORS);
  const ordinarySurfaces = new Set(["reader", "reader-header", "home", "detail-word", "detail-verse", "my-data"]);
  const byId = new Map();
  const controlOwners = new Map();
  const profileIds = new Set(profiles.map((profile) => profile.id));

  for (const feature of registry) {
    if (!feature?.id) {
      diagnostics.push({ code: "missing_feature_id", message: "Every feature requires a non-empty id." });
      continue;
    }
    if (byId.has(feature.id)) {
      diagnostics.push({ code: "duplicate_feature_id", featureId: feature.id, message: `Feature id '${feature.id}' is registered more than once.` });
    } else {
      byId.set(feature.id, feature);
    }
    if (!lifecycleValues.has(feature.lifecycle)) {
      diagnostics.push({ code: "invalid_lifecycle", featureId: feature.id, message: `Feature '${feature.id}' uses unsupported lifecycle '${feature.lifecycle}'.` });
    }
    for (const surface of feature.uiSurfaces || []) {
      if (!surfaceValues.has(surface)) diagnostics.push({ code: "invalid_ui_surface", featureId: feature.id, message: `Feature '${feature.id}' uses unsupported UI surface '${surface}'.` });
    }
    if (!behaviorValues.has(feature.unavailableBehavior)) {
      diagnostics.push({ code: "invalid_unavailable_behavior", featureId: feature.id, message: `Feature '${feature.id}' uses unsupported unavailable behavior '${feature.unavailableBehavior}'.` });
    }
    for (const profileId of feature.defaultProfiles || []) {
      if (profileIds.size && !profileIds.has(profileId)) diagnostics.push({ code: "invalid_profile_reference", featureId: feature.id, message: `Feature '${feature.id}' references unknown profile '${profileId}'.` });
    }
    for (const controlId of feature.ownedControlIds || []) {
      if (controlOwners.has(controlId)) diagnostics.push({ code: "duplicate_control_owner", featureId: feature.id, message: `Control '${controlId}' is owned by both '${controlOwners.get(controlId)}' and '${feature.id}'.` });
      else controlOwners.set(controlId, feature.id);
    }
    if (feature.lifecycle === "compatibility_only") {
      const ordinary = (feature.uiSurfaces || []).filter((surface) => ordinarySurfaces.has(surface));
      if ((feature.ownedControlIds || []).length || ordinary.length) diagnostics.push({ code: "compatibility_ui_forbidden", featureId: feature.id, message: `Compatibility-only feature '${feature.id}' cannot own ordinary UI.` });
    }
    if (!(feature.testOwners || []).length) diagnostics.push({ code: "missing_test_owner", featureId: feature.id, message: `Feature '${feature.id}' must name at least one focused test owner.` });
  }

  for (const feature of registry) {
    for (const dependencyId of feature.dependencies || []) {
      if (dependencyId === feature.id) diagnostics.push({ code: "self_dependency", featureId: feature.id, message: `Feature '${feature.id}' cannot depend on itself.` });
      else if (!byId.has(dependencyId)) diagnostics.push({ code: "missing_dependency", featureId: feature.id, message: `Feature '${feature.id}' depends on unknown feature '${dependencyId}'.` });
      else if (feature.lifecycle === "core" && ["lab", "frozen"].includes(byId.get(dependencyId).lifecycle)) diagnostics.push({ code: "core_depends_on_experimental", featureId: feature.id, message: `Core feature '${feature.id}' cannot depend on ${byId.get(dependencyId).lifecycle} feature '${dependencyId}'.` });
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const visit = (id, trail = []) => {
    if (visiting.has(id)) {
      diagnostics.push({ code: "dependency_cycle", featureId: id, message: `Feature dependency cycle detected: ${[...trail, id].join(" -> ")}.` });
      return;
    }
    if (visited.has(id) || !byId.has(id)) return;
    visiting.add(id);
    for (const dependencyId of byId.get(id).dependencies || []) visit(dependencyId, [...trail, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of byId.keys()) visit(id);

  for (const profile of profiles) {
    const selected = new Set(profile.featureIds || []);
    for (const id of selected) {
      if (!byId.has(id)) diagnostics.push({ code: "profile_unknown_feature", profileId: profile.id, message: `Profile '${profile.id}' references unknown feature '${id}'.` });
      for (const dependencyId of byId.get(id)?.dependencies || []) {
        if (!selected.has(dependencyId)) diagnostics.push({ code: "profile_dependency_not_closed", profileId: profile.id, featureId: id, message: `Profile '${profile.id}' includes '${id}' without dependency '${dependencyId}'.` });
      }
    }
  }
  return diagnostics;
}

export function assertValidFeatureRegistry(registry = FEATURE_REGISTRY, profiles = []) {
  const diagnostics = validateFeatureRegistry(registry, profiles);
  if (diagnostics.length) throw new FeatureRegistryValidationError(diagnostics);
  return registry;
}

export function featureById(featureId, registry = FEATURE_REGISTRY) {
  return registry.find((feature) => feature.id === featureId) || null;
}
