#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CAPABILITY_REGISTRY, CAPABILITY_STATES, capabilityMessage } from "../app/src/capabilities.js";
import { FEATURE_REGISTRY, featureById } from "../app/src/feature-registry.js";
import { panelToolsForScope } from "../app/src/panel-context-model.js";
import {
  chapterSwipeDirection,
  CONTROL_STATES,
  PANEL_EVENTS,
  PANEL_MODES,
  STUDY_CONTROL_SCHEMA,
  UI_ACTION_CONTRACTS,
  interlinearTokenIdentity,
  resolveControlState,
  transitionPanelMode,
  uiActionContract,
  uiActionLabel,
} from "../app/src/ui-contracts.js";

assert.deepEqual(resolveControlState(), {
  state: CONTROL_STATES.enabled,
  disabled: false,
  available: true,
});
assert.equal(
  resolveControlState({ capabilityAvailable: false, dataAvailable: true }).state,
  CONTROL_STATES.capabilityUnavailable,
);
assert.equal(
  resolveControlState({ capabilityAvailable: true, dataAvailable: false }).state,
  CONTROL_STATES.dataUnavailable,
);
const disabledMessage = capabilityMessage({ label: "Commentary", state: CAPABILITY_STATES.disabled });
assert.match(disabledMessage, /Commentary is disabled/, "Saved disabled state must remain understandable");
assert.match(disabledMessage, /Ordinary scripture reading remains available/);
assert.doesNotMatch(disabledMessage, /Enable it under|My Data.*Advanced diagnostics|[Rr]estore.*[Cc]ontrol/, "Shared unavailable copy must not direct Stable to removed capability controls");

assert.equal(transitionPanelMode(PANEL_MODES.follow, PANEL_EVENTS.hover), PANEL_MODES.follow);
assert.equal(transitionPanelMode(PANEL_MODES.follow, PANEL_EVENTS.activate), PANEL_MODES.locked);
assert.equal(transitionPanelMode(PANEL_MODES.locked, PANEL_EVENTS.hover), PANEL_MODES.locked);
assert.equal(transitionPanelMode(PANEL_MODES.locked, PANEL_EVENTS.disengage), PANEL_MODES.follow);
assert.equal(transitionPanelMode(PANEL_MODES.locked, PANEL_EVENTS.reset), PANEL_MODES.follow);
assert.equal(chapterSwipeDirection({ deltaX: -90, deltaY: 10 }), 1);
assert.equal(chapterSwipeDirection({ deltaX: 90, deltaY: 10 }), -1);
assert.equal(chapterSwipeDirection({ deltaX: 60, deltaY: 5 }), 0);
assert.equal(chapterSwipeDirection({ deltaX: 90, deltaY: 80 }), 0);

assert.equal(
  interlinearTokenIdentity({ verse: "1", tokenIndex: 10, strongCode: "G3754" }),
  "verse:1:token:10",
);
assert.equal(interlinearTokenIdentity({ strongCode: "G3754" }), "strong:G3754");

const detailViewsSource = readFileSync(new URL("../app/src/detail-views.js", import.meta.url), "utf8");
assert.match(
  detailViewsSource,
  /function studyMarkBadgeOptions[\s\S]*includeFavorite:\s*true/,
  "Favorite must remain visible wherever Study Mark badges render",
);
assert.match(
  detailViewsSource,
  /renderTargetTagBadges\(target, studyMarkBadgeOptions\(options\)\)/,
  "all target badge surfaces must use the Favorite visibility policy",
);

const contextStyles = readFileSync(new URL("../app/styles-context.css", import.meta.url), "utf8");
const summaryRule = contextStyles.match(/\.panel-context-summary\s*\{([^}]*)\}/s)?.[1] || "";
assert.match(summaryRule, /color:\s*var\(--text\)/, "selected context title must use primary text contrast");
assert.doesNotMatch(contextStyles, /#favoriteBook::before|#favoriteChapter::before/, "Book and Chapter labels must be real trigger markup, not CSS pseudo-elements");
assert.match(contextStyles, /\.study-marks-trigger-label\s*\{/, "visible Book and Chapter labels need a shared trigger label style");
assert.match(
  readFileSync(new URL("../app/styles-study.css", import.meta.url), "utf8"),
  /\.original-language-transliteration,[\s\S]*color:\s*var\(--text\)/,
  "Language Study transliteration must use primary text contrast",
);

const capabilityIds = new Set(CAPABILITY_REGISTRY.map((item) => item.capability_id));
const actions = new Set();
for (const [controlId, control] of Object.entries(STUDY_CONTROL_SCHEMA)) {
  assert.ok(control.action, `${controlId} must declare an action`);
  assert.equal(actions.has(control.action), false, `${control.action} must map to one control`);
  actions.add(control.action);
  assert.ok(["package", "book", "chapter", "verse"].includes(control.dataScope));
  assert.equal(control.lockOnActivate, true);
  assert.ok(uiActionContract(control.uiActionId), `${controlId} must reference a canonical UI action`);
  if (control.capabilityId) {
    assert.ok(capabilityIds.has(control.capabilityId), `${controlId} has an unknown capability`);
  }
}

assert.equal(STUDY_CONTROL_SCHEMA.toolbarSearch.dataScope, "book");
assert.equal(STUDY_CONTROL_SCHEMA.sidePanelOutline.dataScope, "book");
assert.equal(STUDY_CONTROL_SCHEMA.sidePanelInterlinear.dataScope, "chapter");
assert.equal(STUDY_CONTROL_SCHEMA.verseCommentary.dataScope, "verse");
assert.equal(STUDY_CONTROL_SCHEMA.verseInterlinear.dataScope, "verse");
assert.equal(
  STUDY_CONTROL_SCHEMA.sidePanelInterlinear.uiActionId,
  STUDY_CONTROL_SCHEMA.verseInterlinear.uiActionId,
  "Chapter and verse Language Study entry points must share one semantic UI action",
);

for (const [actionId, contract] of Object.entries(UI_ACTION_CONTRACTS)) {
  assert.equal(contract.id, actionId, `${actionId} contract key/id drifted`);
  assert.ok(contract.label?.trim(), `${actionId} requires a primary label`);
  assert.ok(contract.compactLabel?.trim(), `${actionId} requires an explicit compact label`);
  assert.ok(contract.tip?.trim(), `${actionId} requires a concise quick tip`);
  assert.ok(contract.viewId?.trim() || ["dialog", "reader"].includes(contract.destination), `${actionId} requires a declared destination`);
  assert.ok(featureById(contract.featureId, FEATURE_REGISTRY), `${actionId} references unknown feature ${contract.featureId}`);
  assert.equal(uiActionLabel(actionId), contract.label);
  assert.equal(uiActionLabel(actionId, { compact: true }), contract.compactLabel);
}
assert.equal(uiActionContract(" LANGUAGE-STUDY "), UI_ACTION_CONTRACTS["language-study"]);
assert.equal(uiActionContract("unknown-action"), null);

const verseTools = Object.fromEntries(panelToolsForScope("verse").map((tool) => [tool.id, tool]));
for (const [toolId, actionId] of Object.entries({
  par: "translations",
  refs: "references",
  commentary: "commentary",
  interlinear: "language-study",
})) {
  const tool = verseTools[toolId];
  const contract = uiActionContract(actionId);
  assert.equal(tool.actionId, actionId, `${toolId} must be wired to ${actionId}`);
  assert.equal(tool.label, contract.label, `${toolId} full label drifted from ${actionId}`);
  assert.equal(tool.shortLabel, contract.compactLabel, `${toolId} compact label drifted from ${actionId}`);
  assert.equal(tool.tip, contract.tip, `${toolId} quick tip drifted from ${actionId}`);
}
const definition = panelToolsForScope("word", { language: null })[0];
assert.equal(definition.actionId, "definition");
assert.equal(definition.label, uiActionLabel("definition"));

const index = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
for (const [controlId, actionId] of Object.entries({
  showSearch: "search",
  showInterlinear: "language-study",
  showOutline: "outline",
  showTags: "study-marks",
  showMyData: "my-data",
})) {
  const markup = index.match(new RegExp(`<button id="${controlId}"[\\s\\S]*?<\\/button>`))?.[0] || "";
  assert.ok(markup, `${controlId} must remain in the Reader toolbar`);
  assert.ok(markup.includes(`data-ui-action="${actionId}"`), `${controlId} must expose its canonical action identity`);
  assert.ok(markup.includes("ui-action-control"), `${controlId} must use the shared repeated-action hook`);
  const label = uiActionLabel(actionId);
  assert.ok(markup.includes(`>${label}<`), `${controlId} visible label must match ${actionId}`);
}

const contextSource = readFileSync(new URL("../app/src/views/verse-context-tabs.js", import.meta.url), "utf8");
assert.match(contextSource, /button\.dataset\.uiAction\s*=\s*action\.actionId/, "dynamic contextual actions must expose canonical action identity");
assert.match(contextSource, /button\.className\s*=\s*\["verse-context-tab",\s*"ui-action-control"/, "dynamic contextual actions must use the shared repeated-action hook");
assert.match(contextSource, /action\.tip\s*\|\|/, "dynamic contextual actions must reuse canonical quick tips");
assert.match(contextSource, /marks\.dataset\.uiAction\s*=\s*"study-marks"/, "dynamic Study Marks controls must share the Study Marks action identity");
assert.match(contextSource, /trigger\.dataset\.uiAction\s*=\s*"interpretation"/, "dynamic Interpretation controls must share the Interpretation action identity");

const runtimeSources = Object.fromEntries([
  "app.js", "src/chapter-renderer.js", "src/views/tags-view.js", "src/views/user-data-view.js",
  "src/views/interlinear-translation-view.js", "src/word-meaning.js",
].map(path => [path, readFileSync(new URL(`../app/${path}`, import.meta.url), "utf8")]));
assert.match(runtimeSources["app.js"], /button\.dataset\.uiAction = id/);
assert.match(runtimeSources["app.js"], /button\.setAttribute\("aria-label", action\.label\)/, "loading/disabled descriptions must not rename the primary action");
assert.match(runtimeSources["src/views/tags-view.js"], /trigger\.dataset\.uiAction = "study-marks"/);
assert.match(runtimeSources["src/views/tags-view.js"], /manage\.textContent = uiActionContract\("tags"\)\.label/);
assert.equal(uiActionContract("tags").tip, "Edit tags for this target.", "Book/Chapter/source-token editors must not describe their target as a verse");
assert.match(runtimeSources["src/views/user-data-view.js"], /item\.dataset\.uiAction = "study-marks"/);
assert.match(runtimeSources["src/views/interlinear-translation-view.js"], /inspect\.dataset\.uiAction = "language-study"/);
assert.match(runtimeSources["src/word-meaning.js"], /trigger\.dataset\.uiAction = "interpretation"/);
assert.match(runtimeSources["src/chapter-renderer.js"], /study\.textContent = studyAction\.compactLabel/);

console.log(
  JSON.stringify(
    {
      status: "ok",
      controls_checked: Object.keys(STUDY_CONTROL_SCHEMA).length,
      ui_actions_checked: Object.keys(UI_ACTION_CONTRACTS).length,
      repeated_panel_actions_checked: 5,
      static_action_controls_checked: 5,
      dynamic_action_contracts_checked: 5,
    },
    null,
    2,
  ),
);
