import { FEATURE_REGISTRY } from "./feature-registry.js";
import { featureAccess, featureEnabled } from "./feature-profiles.js";

export const PANEL_ACTION_FEATURES = Object.freeze({
  strongs: "strongs",
  hebrew: "language-study",
  greek: "language-study",
  par: "parallel-translations",
  refs: "cross-references",
  commentary: "commentary",
  interlinear: "language-study",
  "study-marks": "study-marks",
  meaning: "meaning",
});

export function controlOwnership(registry = FEATURE_REGISTRY) {
  return Object.freeze(Object.fromEntries(registry.flatMap((feature) =>
    (feature.ownedControlIds || []).map((controlId) => [controlId, feature.id]),
  )));
}

export function panelActionFeature(actionId) {
  return PANEL_ACTION_FEATURES[actionId] || null;
}

export function applyFeatureProfileToDocument(root, profile, registry = FEATURE_REGISTRY) {
  const documentRoot = root?.documentElement ? root : root?.ownerDocument || null;
  const elementRoot = documentRoot?.documentElement || root;
  if (elementRoot?.dataset) {
    elementRoot.dataset.featureProfile = profile.id;
    elementRoot.dataset.profileDiagnostic = profile.diagnostics?.[0]?.code || "none";
  }
  const ownership = controlOwnership(registry);
  for (const [controlId, featureId] of Object.entries(ownership)) {
    const control = documentRoot?.getElementById?.(controlId) || root?.querySelector?.(`#${controlId}`);
    if (!control) continue;
    control.dataset.featureId = featureId;
    control.hidden = !featureEnabled(profile, featureId);
    control.dataset.featureAccess = featureAccess(profile, featureId);
  }
  const indicator = documentRoot?.getElementById?.("profileIdentity") || root?.querySelector?.("#profileIdentity");
  if (indicator) {
    const unknown = profile.diagnostics?.some((item) => item.code === "unknown_profile");
    indicator.hidden = !profile.isLab && !unknown;
    indicator.textContent = profile.isLab ? "Lab · isolated local data" : "Stable · unknown profile ignored";
    indicator.dataset.featureProfile = profile.id;
  }
  return ownership;
}

export function profileIdentityMessage(profile) {
  if (profile?.isLab) return "Lab is active. Personal study data and physical packs are isolated from Stable.";
  if (profile?.diagnostics?.length) return profile.diagnostics[0].message;
  return "Stable is active.";
}
