const STUDY_EMPTY_STATES = {
  search: {
    title: "Search",
    heading: "Search indexes are not included in this private build.",
    body: "Install a search study data pack to enable verse and study search.",
  },
  outlines: {
    title: "Outline",
    heading: "Book outline data is not included in this private build.",
    body: "Install an outlines study pack to browse section structure.",
  },
  interlinear: {
    title: "Language Study",
    heading: "Language Study data is not included in this private build.",
    body: "Install an interlinear study pack to unlock source words, morphology, and alignment tools.",
  },
  commentary: {
    title: "Commentary",
    heading: "Commentary data is not included in this private build.",
    body: "Install a commentary study pack to use commentary beside the reader.",
  },
  crossrefs: {
    title: "References",
    heading: "Cross references are not included in this private build.",
    body: "Install a cross references study pack to use Refs beside the reader.",
  },
  strongs: {
    title: "Word Study",
    heading: "Word study data is not included in this private build.",
    body: "Install a Strong's and lexicon study pack to view definitions and source-word details.",
  },
  verseStudy: {
    title: "Study Tools",
    heading: "Study tools are not included for this verse in this private build.",
    body: "Install study data packs to open references, commentary, and interlinear tools here.",
  },
};

function appendCapabilityDetail(details, capability) {
  if (!capability) return;
  const rows = [
    ["State", capability.state],
    ["Required packs", (capability.required_packs || []).join(", ")],
    ["Missing dependencies", (capability.missing_dependencies || []).join(", ")],
    ["Disabled packs", (capability.disabled_packs || []).join(", ")],
  ].filter(([, value]) => value);
  if (!rows.length) return;

  const list = document.createElement("dl");
  list.className = "study-empty-details";
  rows.forEach(([label, value]) => {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    list.append(term, description);
  });
  details.append(list);
}

export function studyEmptyStateCopy(key) {
  return STUDY_EMPTY_STATES[key] || STUDY_EMPTY_STATES.verseStudy;
}

export function studyUnavailableLabel(key) {
  const copy = studyEmptyStateCopy(key);
  return `${copy.heading} ${copy.body}`;
}

export function createStudyEmptyState(ctx, key, options = {}) {
  const copy = studyEmptyStateCopy(key);
  const wrap = document.createElement("section");
  wrap.className = "study-empty-state";

  if (options.reference) {
    const ref = document.createElement("div");
    ref.className = "study-empty-reference";
    ref.textContent = options.reference;
    wrap.append(ref);
  }

  const heading = document.createElement("h3");
  heading.textContent = copy.heading;
  const body = document.createElement("p");
  body.textContent = copy.body;
  wrap.append(heading, body);

  const capabilityIds = options.capabilityIds || [];
  const detail = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Package details";
  detail.append(summary);
  capabilityIds.forEach((capabilityId) => appendCapabilityDetail(detail, ctx.getCapabilityState?.(capabilityId)));
  if (detail.childElementCount > 1) wrap.append(detail);

  return wrap;
}
