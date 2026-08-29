import { FEATURE_REGISTRY, assertValidFeatureRegistry } from "./feature-registry.js";

export const FEATURE_PROFILE_IDS = Object.freeze({
  stable: "stable",
  lab: "lab",
});

const allFeatureIds = FEATURE_REGISTRY.map((feature) => feature.id);
const ordinaryFeatureIds = FEATURE_REGISTRY
  .filter((feature) => ["core", "stable"].includes(feature.lifecycle))
  .map((feature) => feature.id);
const experimentalFeatureIds = FEATURE_REGISTRY
  .filter((feature) => ["lab", "frozen"].includes(feature.lifecycle))
  .map((feature) => feature.id);
const compatibilityFeatureIds = FEATURE_REGISTRY
  .filter((feature) => feature.lifecycle === "compatibility_only")
  .map((feature) => feature.id);

export const FEATURE_PROFILES = Object.freeze([
  Object.freeze({
    id: FEATURE_PROFILE_IDS.stable,
    label: "Stable",
    description: "The default local-first reader and study experience.",
    featureIds: Object.freeze([...allFeatureIds]),
    ordinaryFeatureIds: Object.freeze([...ordinaryFeatureIds]),
    recoveryFeatureIds: Object.freeze([...experimentalFeatureIds]),
    compatibilityFeatureIds: Object.freeze([...compatibilityFeatureIds]),
  }),
  Object.freeze({
    id: FEATURE_PROFILE_IDS.lab,
    label: "Lab",
    description: "Explicit opt-in evaluation of experimental local features with isolated data.",
    featureIds: Object.freeze([...allFeatureIds]),
    ordinaryFeatureIds: Object.freeze([...ordinaryFeatureIds, ...experimentalFeatureIds]),
    recoveryFeatureIds: Object.freeze([]),
    compatibilityFeatureIds: Object.freeze([...compatibilityFeatureIds]),
  }),
]);

assertValidFeatureRegistry(FEATURE_REGISTRY, FEATURE_PROFILES);

function profileDefinition(profileId) {
  return FEATURE_PROFILES.find((profile) => profile.id === profileId) || null;
}

function dependentClosure(disabledIds, registry) {
  const disabled = new Set(disabledIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const feature of registry) {
      if (disabled.has(feature.id)) continue;
      if ((feature.dependencies || []).some((dependencyId) => disabled.has(dependencyId))) {
        disabled.add(feature.id);
        changed = true;
      }
    }
  }
  return disabled;
}

function resolvedProfile(definition, requestedId, diagnostics, disabledFeatureIds = [], registry = FEATURE_REGISTRY) {
  const disabled = dependentClosure(disabledFeatureIds, registry);
  const enabledFeatureIds = definition.featureIds.filter((id) => !disabled.has(id));
  const enabled = new Set(enabledFeatureIds);
  const accessByFeature = Object.fromEntries(registry.map((feature) => {
    let access = "disabled";
    if (enabled.has(feature.id)) {
      if (definition.compatibilityFeatureIds.includes(feature.id)) access = "compatibility";
      else if (definition.recoveryFeatureIds.includes(feature.id)) access = "recovery";
      else access = "ordinary";
    }
    return [feature.id, access];
  }));
  return Object.freeze({
    id: definition.id,
    requestedId,
    label: definition.label,
    description: definition.description,
    isLab: definition.id === FEATURE_PROFILE_IDS.lab,
    enabledFeatureIds: Object.freeze(enabledFeatureIds),
    ordinaryFeatureIds: Object.freeze(definition.ordinaryFeatureIds.filter((id) => enabled.has(id))),
    recoveryFeatureIds: Object.freeze(definition.recoveryFeatureIds.filter((id) => enabled.has(id))),
    compatibilityFeatureIds: Object.freeze(definition.compatibilityFeatureIds.filter((id) => enabled.has(id))),
    disabledFeatureIds: Object.freeze([...disabled].sort()),
    accessByFeature: Object.freeze(accessByFeature),
    diagnostics: Object.freeze(diagnostics),
  });
}

export function resolveFeatureProfile(requestedId, options = {}) {
  const normalized = String(requestedId || "").trim().toLowerCase();
  const requested = normalized || FEATURE_PROFILE_IDS.stable;
  const definition = profileDefinition(requested);
  if (!definition) {
    return resolvedProfile(
      profileDefinition(FEATURE_PROFILE_IDS.stable),
      requested,
      [{
        code: "unknown_profile",
        requested_profile: requested,
        resolved_profile: FEATURE_PROFILE_IDS.stable,
        message: `Unknown feature profile '${requested}' was ignored; Stable is active.`,
      }],
      options.disabledFeatureIds || [],
      options.registry || FEATURE_REGISTRY,
    );
  }
  return resolvedProfile(
    definition,
    requested,
    [],
    options.disabledFeatureIds || [],
    options.registry || FEATURE_REGISTRY,
  );
}

export function resolveBrowserFeatureProfile(url = "http://localhost/") {
  const parsed = new URL(url, "http://localhost/");
  return resolveFeatureProfile(parsed.searchParams.get("profile"));
}

export function resolveTestFeatureProfile(profileId, disabledFeatureIds = []) {
  return resolveFeatureProfile(profileId, { disabledFeatureIds });
}

export function featureEnabled(profile, featureId) {
  return Boolean(profile?.enabledFeatureIds?.includes(featureId));
}

export function featureAccess(profile, featureId) {
  return profile?.accessByFeature?.[featureId] || "disabled";
}
