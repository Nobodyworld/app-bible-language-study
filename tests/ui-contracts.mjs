#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CAPABILITY_REGISTRY, CAPABILITY_STATES, capabilityMessage } from "../app/src/capabilities.js";
import {
  chapterSwipeDirection,
  CONTROL_STATES,
  PANEL_EVENTS,
  PANEL_MODES,
  STUDY_CONTROL_SCHEMA,
  interlinearTokenIdentity,
  resolveControlState,
  transitionPanelMode,
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
  if (control.capabilityId) {
    assert.ok(capabilityIds.has(control.capabilityId), `${controlId} has an unknown capability`);
  }
}

assert.equal(STUDY_CONTROL_SCHEMA.toolbarSearch.dataScope, "book");
assert.equal(STUDY_CONTROL_SCHEMA.sidePanelOutline.dataScope, "book");
assert.equal(STUDY_CONTROL_SCHEMA.sidePanelInterlinear.dataScope, "chapter");
assert.equal(STUDY_CONTROL_SCHEMA.verseCommentary.dataScope, "verse");
assert.equal(STUDY_CONTROL_SCHEMA.verseInterlinear.dataScope, "verse");

console.log(
  JSON.stringify(
    {
      status: "ok",
      controls_checked: Object.keys(STUDY_CONTROL_SCHEMA).length,
      assertions: 30,
    },
    null,
    2,
  ),
);
