export const CAPABILITY_STATES = {
  available: "available",
  notInstalled: "not_installed",
  disabled: "disabled",
  dependencyMissing: "dependency_missing",
  incompatibleVersion: "incompatible_version",
  corrupt: "corrupt",
  loadFailed: "load_failed",
};

export const CAPABILITY_REGISTRY = [
  {
    capability_id: "crossrefs",
    label: "Cross references",
    required_packs: ["crossrefs-basic"],
    optional_dependencies: [],
    routes: ["reader", "verse-context"],
  },
  {
    capability_id: "strongs-overlay",
    label: "Strong's overlay",
    required_packs: ["bsb-strongs-overlay"],
    optional_dependencies: ["hebrew-lexicon", "greek-lexicon"],
    routes: ["reader", "strongs"],
  },
  {
    capability_id: "lexicon-language-metadata",
    label: "Lexicon and language metadata",
    required_packs: ["hebrew-lexicon", "greek-lexicon"],
    optional_dependencies: ["search-lexicon"],
    routes: ["strongs", "language"],
  },
  {
    capability_id: "interlinear",
    label: "Interlinear",
    required_packs: ["hebrew-interlinear", "greek-interlinear"],
    optional_dependencies: ["hebrew-text", "greek-text-nestle", "greek-text-tr94"],
    routes: ["interlinear"],
  },
  {
    capability_id: "commentary",
    label: "Commentary",
    required_packs: ["commentary-verse-index"],
    optional_dependencies: ["commentary-ellicott", "commentary-gill", "commentary-mhc", "commentary-pulpit", "search-commentaries"],
    routes: ["commentary"],
  },
  {
    capability_id: "outlines",
    label: "Outlines",
    required_packs: ["outlines"],
    optional_dependencies: ["search-outlines"],
    routes: ["outline"],
  },
  {
    capability_id: "search",
    label: "Search",
    required_packs: ["search-verses"],
    optional_dependencies: ["search-lexicon", "search-outlines", "search-commentaries"],
    routes: ["search"],
  },
  {
    capability_id: "graph-word-map-analysis",
    label: "Graph and word-map analysis",
    required_packs: ["analysis-word-map", "analysis-graph"],
    optional_dependencies: [],
    routes: ["analysis", "word-map"],
  },
];

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function packIdsFromManifest(packageManifest) {
  return unique((packageManifest?.feature_packs || []).map((pack) => pack.id));
}

function registryById(registry = CAPABILITY_REGISTRY) {
  return new Map(registry.map((capability) => [capability.capability_id, capability]));
}

export function getCapabilityDefinition(capabilityId, registry = CAPABILITY_REGISTRY) {
  return registryById(registry).get(capabilityId) || null;
}

export function getLogicalInstalledFeaturePackIds(packageManifest, packageStore = {}, options = {}) {
  const installed = unique(packageStore.installed_feature_pack_ids || []);
  if (packageStore.physical_data_mode === "bundled_static_data" || options.assumeBundledFullAccess) {
    return unique([...installed, ...packIdsFromManifest(packageManifest)]);
  }
  if (installed.length || options.assumeBundledFullAccess === false) return installed;
  return installed;
}

function physicalRecordMap(options = {}) {
  return new Map((options.physicalRecords || []).map((record) => [record.pack_id, record]));
}

function recordIsVerifiedActive(record) {
  return Boolean(
    record &&
    ["active", "update_available", "rollback_available"].includes(record.state) &&
    record.active_cache &&
    record.verified_files === record.expected_files &&
    record.verified_bytes === record.expected_bytes
  );
}

function physicalFailure(requiredPacks, options = {}) {
  if (options.physicalDataMode !== "managed_cache_packs") return null;
  const records = physicalRecordMap(options);
  const requiredRecords = requiredPacks.map((id) => [id, records.get(id)]);
  const incompatible = requiredRecords.filter(([, record]) => record?.state === "incompatible").map(([id]) => id);
  if (incompatible.length) return { state: CAPABILITY_STATES.incompatibleVersion, packs: incompatible, next_action: "return_to_bundled_or_update" };
  const corrupt = requiredRecords.filter(([, record]) => ["corrupt", "repair_required"].includes(record?.state)).map(([id]) => id);
  if (corrupt.length) return { state: CAPABILITY_STATES.corrupt, packs: corrupt, next_action: "repair" };
  const failed = requiredRecords.filter(([, record]) => record?.state === "failed").map(([id]) => id);
  if (failed.length) return { state: CAPABILITY_STATES.loadFailed, packs: failed, next_action: "retry" };
  const missing = requiredRecords.filter(([, record]) => !recordIsVerifiedActive(record)).map(([id]) => id);
  if (missing.length) return { state: CAPABILITY_STATES.notInstalled, packs: missing, next_action: "install" };
  return null;
}

export function resolveCapability(packageManifest, packageStore, capabilityId, options = {}) {
  const capability = getCapabilityDefinition(capabilityId, options.registry);
  if (!capability) {
    return {
      capability_id: capabilityId,
      state: CAPABILITY_STATES.notInstalled,
      reason: "unknown_capability",
      missing_packs: [],
      disabled_packs: [],
      optional_missing_packs: [],
    };
  }

  const featurePacks = new Map((packageManifest?.feature_packs || []).map((pack) => [pack.id, pack]));
  const physicalRecords = physicalRecordMap(options);
  const installed = options.physicalDataMode === "managed_cache_packs"
    ? new Set([...physicalRecords].filter(([, record]) => recordIsVerifiedActive(record)).map(([id]) => id))
    : new Set(getLogicalInstalledFeaturePackIds(packageManifest, packageStore, options));
  const disabledCapabilities = new Set(packageStore?.disabled_capability_ids || []);
  const disabledPacks = new Set(packageStore?.disabled_feature_pack_ids || []);
  const requiredPacks = capability.required_packs || [];
  const missingPacks = requiredPacks.filter((id) => !installed.has(id));
  const unknownPacks = requiredPacks.filter((id) => !featurePacks.has(id));
  const disabledRequiredPacks = requiredPacks.filter((id) => disabledPacks.has(id));
  const dependencyMissing = [];

  for (const id of requiredPacks) {
    const pack = featurePacks.get(id);
    const physicalDependencies = physicalRecords.get(id)?.active_manifest?.dependencies || [];
    for (const dependency of unique([...(pack?.dependencies || []), ...physicalDependencies])) {
      if (!installed.has(dependency) || disabledPacks.has(dependency)) dependencyMissing.push(dependency);
    }
  }

  if (disabledCapabilities.has(capability.capability_id) || disabledRequiredPacks.length) {
    return {
      ...capability,
      state: CAPABILITY_STATES.disabled,
      missing_packs: missingPacks,
      disabled_packs: disabledRequiredPacks,
      optional_missing_packs: (capability.optional_dependencies || []).filter((id) => !installed.has(id)),
      bundled_included: requiredPacks.every((id) => featurePacks.has(id)),
      next_action: "enable",
    };
  }
  if (unknownPacks.length) {
    return {
      ...capability,
      state: CAPABILITY_STATES.notInstalled,
      missing_packs: unknownPacks,
      disabled_packs: [],
      optional_missing_packs: (capability.optional_dependencies || []).filter((id) => !installed.has(id)),
      bundled_included: false,
      next_action: "update_app",
    };
  }
  const physical = physicalFailure(requiredPacks, options);
  if (physical) {
    return {
      ...capability,
      state: physical.state,
      missing_packs: physical.packs,
      disabled_packs: [],
      optional_missing_packs: (capability.optional_dependencies || []).filter((id) => !installed.has(id)),
      bundled_included: true,
      next_action: physical.next_action,
    };
  }
  if (missingPacks.length) {
    return {
      ...capability,
      state: CAPABILITY_STATES.notInstalled,
      missing_packs: missingPacks,
      disabled_packs: [],
      optional_missing_packs: (capability.optional_dependencies || []).filter((id) => !installed.has(id)),
      bundled_included: requiredPacks.every((id) => featurePacks.has(id)),
      next_action: "install",
    };
  }
  if (dependencyMissing.length) {
    return {
      ...capability,
      state: CAPABILITY_STATES.dependencyMissing,
      missing_packs: unique(dependencyMissing),
      disabled_packs: [],
      optional_missing_packs: (capability.optional_dependencies || []).filter((id) => !installed.has(id)),
      bundled_included: requiredPacks.every((id) => featurePacks.has(id)),
      next_action: "install_dependency",
    };
  }
  return {
    ...capability,
    state: CAPABILITY_STATES.available,
    missing_packs: [],
    disabled_packs: [],
    optional_missing_packs: (capability.optional_dependencies || []).filter((id) => !installed.has(id)),
    bundled_included: requiredPacks.every((id) => featurePacks.has(id)),
    next_action: null,
  };
}

export function capabilityAvailable(packageManifest, packageStore, capabilityId, options = {}) {
  return resolveCapability(packageManifest, packageStore, capabilityId, options).state === CAPABILITY_STATES.available;
}

export function capabilityMessage(capability) {
  const label = capability?.label || capability?.capability_id || "This feature";
  const pack = capability?.missing_packs?.[0];
  const readerSafe = " Ordinary scripture reading remains available.";
  if (capability?.state === CAPABILITY_STATES.disabled) return `${label} is disabled. Enable it under My Data → Advanced diagnostics.${readerSafe}`;
  if (capability?.state === CAPABILITY_STATES.notInstalled) return `${label} requires the ${pack || "managed"} pack. Install it or return to bundled data.${readerSafe}`;
  if (capability?.state === CAPABILITY_STATES.dependencyMissing) {
    return `${label} is unavailable because required dependency packs are missing or disabled. Install or enable the dependency.${readerSafe}`;
  }
  if (capability?.state === CAPABILITY_STATES.incompatibleVersion) return `${label} is incompatible with this app version. Update the pack or return to bundled data.${readerSafe}`;
  if (capability?.state === CAPABILITY_STATES.corrupt) return `${label} has a corrupt managed pack. Repair it or return to bundled data.${readerSafe}`;
  if (capability?.state === CAPABILITY_STATES.loadFailed) return `${label} could not be loaded. Retry the operation or return to bundled data.${readerSafe}`;
  return `${label} is unavailable.`;
}

export function resolveCapabilities(packageManifest, packageStore, options = {}) {
  return Object.fromEntries(
    (options.registry || CAPABILITY_REGISTRY).map((capability) => [
      capability.capability_id,
      resolveCapability(packageManifest, packageStore, capability.capability_id, options),
    ]),
  );
}
