export const CONTROL_STATES = Object.freeze({
  enabled: "enabled",
  capabilityUnavailable: "capability_unavailable",
  dataUnavailable: "data_unavailable",
});

export const PANEL_MODES = Object.freeze({
  follow: "follow",
  locked: "locked",
});

export const DETAIL_VIEW_IDS = Object.freeze({
  commentary: "commentary",
  favorites: "favorites",
  footnote: "footnote",
  languageStudy: "language-study",
  localProcessing: "local-processing",
  meaning: "meaning",
  myData: "my-data",
  outline: "outline",
  parallel: "parallel",
  references: "references",
  search: "search",
  strongs: "strongs",
  studyMarks: "study-marks",
  tags: "tags",
});

const DETAIL_VIEW_ID_SET = new Set(Object.values(DETAIL_VIEW_IDS));

export function normalizeDetailViewId(viewId) {
  const normalized = String(viewId || "").trim().toLowerCase();
  return DETAIL_VIEW_ID_SET.has(normalized) ? normalized : "";
}

export const DETAIL_SCROLL_POLICIES = Object.freeze({
  preserve: "preserve",
  reset: "reset",
  restore: "restore",
  revealSection: "reveal-section",
});

const DETAIL_SCROLL_POLICY_SET = new Set(Object.values(DETAIL_SCROLL_POLICIES));

export function normalizeDetailScrollPolicy(policy, fallback = DETAIL_SCROLL_POLICIES.reset) {
  const normalized = String(policy || "").trim().toLowerCase();
  return DETAIL_SCROLL_POLICY_SET.has(normalized) ? normalized : fallback;
}

export const PANEL_EVENTS = Object.freeze({
  activate: "activate",
  disengage: "disengage",
  reset: "reset",
  hover: "hover",
});

export const STUDY_CONTROL_SCHEMA = Object.freeze({
  toolbarSearch: {
    capabilityId: "search",
    dataScope: "book",
    action: "showSearch",
    lockOnActivate: true,
  },
  sidePanelOutline: {
    capabilityId: "outlines",
    dataScope: "book",
    action: "showOutline",
    lockOnActivate: true,
  },
  sidePanelInterlinear: {
    capabilityId: "interlinear",
    dataScope: "chapter",
    action: "showInterlinearChapter",
    lockOnActivate: true,
  },
  verseParallel: {
    capabilityId: null,
    dataScope: "verse",
    action: "showParallelVerse",
    lockOnActivate: true,
  },
  verseReferences: {
    capabilityId: "crossrefs",
    dataScope: "verse",
    action: "showCrossrefs",
    lockOnActivate: true,
  },
  verseCommentary: {
    capabilityId: "commentary",
    dataScope: "verse",
    action: "showCommentary",
    lockOnActivate: true,
  },
  verseInterlinear: {
    capabilityId: "interlinear",
    dataScope: "verse",
    action: "showInterlinearVerse",
    lockOnActivate: true,
  },
  verseTags: {
    capabilityId: null,
    dataScope: "verse",
    action: "showTagEditor",
    lockOnActivate: true,
  },
});

export function resolveControlState({ capabilityAvailable = true, dataAvailable = true } = {}) {
  if (!capabilityAvailable) {
    return {
      state: CONTROL_STATES.capabilityUnavailable,
      disabled: true,
      available: false,
    };
  }
  if (!dataAvailable) {
    return {
      state: CONTROL_STATES.dataUnavailable,
      disabled: true,
      available: false,
    };
  }
  return {
    state: CONTROL_STATES.enabled,
    disabled: false,
    available: true,
  };
}

export function transitionPanelMode(mode, event) {
  if (event === PANEL_EVENTS.activate) return PANEL_MODES.locked;
  if (event === PANEL_EVENTS.disengage || event === PANEL_EVENTS.reset) return PANEL_MODES.follow;
  return mode === PANEL_MODES.locked ? PANEL_MODES.locked : PANEL_MODES.follow;
}

export function chapterSwipeDirection({ deltaX = 0, deltaY = 0, threshold = 72 } = {}) {
  if (Math.abs(deltaX) < threshold || Math.abs(deltaX) < Math.abs(deltaY) * 1.35) return 0;
  return deltaX < 0 ? 1 : -1;
}

export function interlinearTokenIdentity({ verse, segmentId, tokenIndex, strongCode } = {}) {
  const normalizedVerse = String(verse || "");
  const normalizedIndex = String(tokenIndex ?? "");
  if (segmentId && normalizedIndex) return `segment:${String(segmentId)}:token:${normalizedIndex}`;
  if (normalizedVerse && normalizedIndex) return `verse:${normalizedVerse}:token:${normalizedIndex}`;
  return strongCode ? `strong:${String(strongCode)}` : "";
}
