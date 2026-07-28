const PARTS_OF_SPEECH = {
  V: "verb",
  N: "noun",
  Adj: "adjective",
  Adv: "adverb",
  Pro: "pronoun",
  Prep: "preposition",
  Conj: "conjunction",
  Art: "article",
  Interjection: "interjection",
  Interrog: "interrogative",
  DirObjM: "direct-object marker",
  P: "pronoun",
  A: "adjective",
  D: "adverb",
  C: "conjunction",
  T: "article",
  I: "interjection",
};

const PART_OF_SPEECH_DEFINITIONS = {
  verb: "Action, occurrence, or state of being.",
  noun: "Person, place, thing, or concept.",
  adjective: "Describes or modifies a noun.",
  pronoun: "Stands in for a noun or noun phrase.",
  preposition: "Shows relationship, direction, location, or agency.",
  conjunction: "Connects words, phrases, clauses, or ideas.",
  article: "Marks or specifies a noun.",
  particle: "Short function word whose meaning depends on context.",
  adverb: "Modifies a verb, adjective, or another adverb.",
  interjection: "Brief expression or exclamation.",
  interrogative: "Introduces or marks a question.",
  "direct-object marker": "Marks the direct object in context.",
};

const HEBREW_TERMS = {
  Qal: "Qal stem — simple active",
  Nifal: "Nifal stem — usually simple passive or reflexive",
  Piel: "Piel stem — usually intensive active",
  Pual: "Pual stem — usually intensive passive",
  Hifil: "Hifil stem — usually causative active",
  Hofal: "Hofal stem — usually causative passive",
  Hitpael: "Hitpael stem — usually reflexive",
  Hithpael: "Hithpael stem — usually reflexive",
  Perf: "perfect — completed action",
  Imperf: "imperfect — incomplete or ongoing action",
  ConjPerf: "consecutive perfect",
  ConjImperf: "consecutive imperfect",
  Imp: "imperative — command",
  Inf: "infinitive",
  InfAbs: "absolute infinitive",
  InfConstruct: "construct infinitive",
  Prtcpl: "participle",
  QalPassPrtcpl: "Qal passive participle",
  Cohort: "cohortative — speaker's resolve or request",
  NegPrt: "negative particle",
  proper: "proper name",
  r: "relative",
  b: "בְּ prefix — in, at, or by",
  l: "לְ prefix — to or for",
  k: "כְּ prefix — like or as",
  m: "מִן prefix — from",
  w: "וְ prefix — and",
};

const CASES = { N: "nominative", G: "genitive", D: "dative", A: "accusative", V: "vocative" };
const GENDERS = { M: "masculine", F: "feminine", N: "neuter", C: "common" };
const NUMBERS = { S: "singular", P: "plural", D: "dual" };
const TENSES = {
  P: "present",
  I: "imperfect",
  F: "future",
  A: "aorist",
  R: "perfect",
  L: "pluperfect",
  X: "no tense stated",
};
const VOICES = {
  A: "active",
  M: "middle",
  P: "passive",
  E: "middle or passive",
  D: "middle deponent",
  O: "passive deponent",
  N: "middle or passive deponent",
};
const MOODS = {
  I: "indicative",
  S: "subjunctive",
  O: "optative",
  M: "imperative",
  N: "infinitive",
  P: "participle",
};

let tooltipLayer = null;
let activeTarget = null;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function resolveMorphologyTooltipBounds({
  panelRect = null,
  viewportWidth,
  viewportHeight,
  margin = 10,
} = {}) {
  const viewportBounds = {
    left: margin,
    right: Math.max(margin, Number(viewportWidth) - margin),
    top: margin,
    bottom: Math.max(margin, Number(viewportHeight) - margin),
  };
  if (!panelRect) return viewportBounds;

  const left = Math.max(viewportBounds.left, Number(panelRect.left) + margin);
  const right = Math.min(viewportBounds.right, Number(panelRect.right) - margin);
  const top = Math.max(viewportBounds.top, Number(panelRect.top) + margin);
  const bottom = Math.min(viewportBounds.bottom, Number(panelRect.bottom) - margin);
  return {
    left,
    right: Math.max(left, right),
    top,
    bottom: Math.max(top, bottom),
  };
}

export function resolveMorphologyTooltipPlacement({ targetRect, tooltipRect, bounds, margin = 10 } = {}) {
  const maximumLeft = Math.max(bounds.left, bounds.right - tooltipRect.width);
  const maximumTop = Math.max(bounds.top, bounds.bottom - tooltipRect.height);
  const centerX = targetRect.left + targetRect.width / 2;
  const above = targetRect.top - tooltipRect.height - margin;
  const below = targetRect.bottom + margin;
  const preferredTop = above >= bounds.top ? above : below;
  return {
    left: clamp(centerX - tooltipRect.width / 2, bounds.left, maximumLeft),
    top: clamp(preferredTop, bounds.top, maximumTop),
  };
}

function humanList(values) {
  const items = values.filter(Boolean);
  if (items.length <= 1) return items[0] || "Morphology";
  return `${items.slice(0, -1).join(", ")} — ${items.at(-1)}`;
}

function personDescription(value) {
  const match = String(value).match(/^([123])([mfc])([spd])(e?)$/i);
  if (!match) return "";
  const person = { 1: "first person", 2: "second person", 3: "third person" }[match[1]];
  const gender = { m: "masculine", f: "feminine", c: "common" }[match[2].toLowerCase()];
  const number = { s: "singular", p: "plural", d: "dual" }[match[3].toLowerCase()];
  return `${person} ${gender} ${number}${match[4] ? " emphatic" : ""}`;
}

function nominalDescription(value) {
  const match = String(value).match(/^([mfc])([spd])([ca])?$/i);
  if (!match) return "";
  const gender = { m: "masculine", f: "feminine", c: "common" }[match[1].toLowerCase()];
  const number = { s: "singular", p: "plural", d: "dual" }[match[2].toLowerCase()];
  const state = { c: " construct", a: " absolute" }[match[3]?.toLowerCase()] || "";
  return `${gender} ${number}${state}`;
}

function explainHebrew(code) {
  const tokens = String(code)
    .replaceAll(".", "-")
    .split(/\s*::\s*|,\s*|\s+|-/)
    .filter(Boolean);
  const rows = tokens.map((token) => ({
    code: token,
    meaning:
      PARTS_OF_SPEECH[token] ||
      HEBREW_TERMS[token] ||
      personDescription(token) ||
      nominalDescription(token) ||
      token,
  }));
  return { title: humanList(rows.map((row) => row.meaning)), rows };
}

function explainGreek(code) {
  const [part = "", form = "", ending = ""] = String(code).split("-");
  const rows = [{ code: part, meaning: PARTS_OF_SPEECH[part] || part }];
  if (part === "V" && form) {
    const [tense, mood, voice] = form;
    rows.push(
      { code: tense, meaning: TENSES[tense] || tense },
      { code: mood, meaning: MOODS[mood] || mood },
      { code: voice, meaning: VOICES[voice] || voice },
    );
  } else if (form) {
    const [caseCode, genderCode, numberCode] = form;
    rows.push(
      { code: caseCode, meaning: CASES[caseCode] || caseCode },
      { code: genderCode, meaning: GENDERS[genderCode] || genderCode },
      { code: numberCode, meaning: NUMBERS[numberCode] || numberCode },
    );
  }
  if (ending) {
    const personMatch = ending.match(/^([123])([SP])$/);
    if (personMatch) {
      rows.push({
        code: ending,
        meaning: `${{ 1: "first", 2: "second", 3: "third" }[personMatch[1]]} person ${NUMBERS[personMatch[2]]}`,
      });
    } else {
      const [caseCode, genderCode, numberCode] = ending;
      if (caseCode) rows.push({ code: caseCode, meaning: CASES[caseCode] || caseCode });
      if (genderCode) rows.push({ code: genderCode, meaning: GENDERS[genderCode] || genderCode });
      if (numberCode) rows.push({ code: numberCode, meaning: NUMBERS[numberCode] || numberCode });
    }
  }
  return { title: humanList(rows.map((row) => row.meaning)), rows: rows.filter((row) => row.code) };
}

function withPartOfSpeechDefinition(help) {
  const partOfSpeechRow = help.rows.find((row) => PART_OF_SPEECH_DEFINITIONS[row.meaning]);
  return {
    ...help,
    partOfSpeech: partOfSpeechRow?.meaning || "",
    partOfSpeechDefinition: partOfSpeechRow ? PART_OF_SPEECH_DEFINITIONS[partOfSpeechRow.meaning] : "",
  };
}

export function explainMorphology(code, language = "") {
  const value = String(code || "").trim();
  if (!value) return { title: "Morphology", rows: [] };
  return withPartOfSpeechDefinition(
    language === "greek" || /^[A-Z]-[A-Z]{2,3}(?:-|$)/.test(value)
      ? explainGreek(value)
      : explainHebrew(value),
  );
}

function targetFromNode(node) {
  return node?.closest?.(".morphology-help[data-morphology]") || null;
}

function positionTooltip(target) {
  if (!target || !tooltipLayer || tooltipLayer.hidden) return;
  const rect = target.getBoundingClientRect();
  const margin = 10;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const panelRect = target.closest?.(".detail-pane")?.getBoundingClientRect() || null;
  const bounds = resolveMorphologyTooltipBounds({ panelRect, viewportWidth, viewportHeight, margin });

  tooltipLayer.style.removeProperty("left");
  tooltipLayer.style.removeProperty("top");
  tooltipLayer.style.removeProperty("max-width");
  tooltipLayer.style.maxWidth = `${Math.max(1, bounds.right - bounds.left)}px`;

  const tooltipRect = tooltipLayer.getBoundingClientRect();
  const placement = resolveMorphologyTooltipPlacement({ targetRect: rect, tooltipRect, bounds, margin });
  tooltipLayer.style.left = `${placement.left}px`;
  tooltipLayer.style.top = `${placement.top}px`;
}

function renderTooltip(target) {
  const help = explainMorphology(target.dataset.morphology, target.dataset.language);
  const title = document.createElement("div");
  title.className = "morphology-tooltip-title";
  title.textContent = help.title;
  const definition = document.createElement("p");
  definition.className = "morphology-tooltip-definition";
  definition.textContent = help.partOfSpeechDefinition || "Morphology details depend on the source language and context.";
  const table = document.createElement("table");
  table.className = "morphology-tooltip-table";
  const body = document.createElement("tbody");
  const rows = help.partOfSpeech ? help.rows.filter((row) => row.meaning !== help.partOfSpeech) : help.rows;
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    const code = document.createElement("th");
    const meaning = document.createElement("td");
    code.scope = "row";
    code.textContent = row.code;
    meaning.textContent = row.meaning;
    tr.append(code, meaning);
    body.append(tr);
  });
  table.append(body);
  tooltipLayer.replaceChildren(title, definition, table);
}

function ensureTooltipLayer() {
  if (typeof document === "undefined") return null;
  if (tooltipLayer) return tooltipLayer;
  tooltipLayer = document.createElement("div");
  tooltipLayer.className = "morphology-tooltip-layer";
  tooltipLayer.setAttribute("role", "tooltip");
  tooltipLayer.hidden = true;
  document.body.append(tooltipLayer);

  const show = (target) => {
    activeTarget = target;
    renderTooltip(target);
    tooltipLayer.hidden = false;
    positionTooltip(target);
  };
  const hide = () => {
    activeTarget = null;
    tooltipLayer.hidden = true;
    tooltipLayer.textContent = "";
    tooltipLayer.style.removeProperty("left");
    tooltipLayer.style.removeProperty("top");
    tooltipLayer.style.removeProperty("max-width");
  };

  document.addEventListener("pointerover", (event) => {
    const target = targetFromNode(event.target);
    if (target) show(target);
  });
  document.addEventListener("pointerout", (event) => {
    if (activeTarget && !activeTarget.contains(event.relatedTarget)) hide();
  });
  document.addEventListener("focusin", (event) => {
    const target = targetFromNode(event.target);
    if (target) show(target);
  });
  document.addEventListener("focusout", (event) => {
    if (event.target === activeTarget) hide();
  });
  window.addEventListener("scroll", () => positionTooltip(activeTarget), true);
  window.addEventListener("resize", () => positionTooltip(activeTarget));
  return tooltipLayer;
}

export function setMorphologyHelp(node, code, language = "") {
  const value = String(code || "").trim();
  node.textContent = value;
  if (!value) return;
  const help = explainMorphology(value, language);
  node.classList.add("morphology-help");
  node.dataset.morphology = value;
  node.dataset.language = language;
  node.tabIndex = 0;
  node.setAttribute("aria-label", `${value}: ${help.title}`);
  ensureTooltipLayer();
}
