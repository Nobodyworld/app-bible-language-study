#!/usr/bin/env node

import assert from "node:assert/strict";
import { cssRules } from "../app/tools/stylesheet-ownership.mjs";
import { readAppStyles } from "./helpers/app-styles.mjs";
import { readFile } from "node:fs/promises";

const [index, css, readerCss, runtime, pickerFlow, contextTabs] = await Promise.all([
  readFile(new URL("../app/index.html", import.meta.url), "utf8"),
  readAppStyles(),
  readAppStyles(),
  readFile(new URL("../app/src/portrait-workspace.js", import.meta.url), "utf8"),
  readFile(new URL("../app/src/reader-picker-flow.js", import.meta.url), "utf8"),
  readFile(new URL("../app/src/views/verse-context-tabs.js", import.meta.url), "utf8"),
]);

assert(
  /<h1>Bible Reader<\/h1>/.test(index),
  "The portrait header must use the shortened Bible Reader title.",
);
assert(
  /@media\s*\(min-width:\s*769px\)\s*and\s*\(max-width:\s*1100px\)[\s\S]*?\.brand\s*{[\s\S]*?width:\s*max-content;[\s\S]*?min-width:\s*max-content;[\s\S]*?padding-inline-end:\s*14px;/.test(css),
  "The portrait brand backdrop must size to its title and retain trailing breathing room.",
);
assert(
  /grid-template-areas:\s*[\s\S]*?"brand status \. theme"[\s\S]*?"controls controls controls controls"/.test(css),
  "Portrait desktop must place status beside the brand and reader controls on the final header row.",
);
assert(
  /@media\s*\(min-width:\s*769px\)\s*and\s*\(max-width:\s*1100px\)[\s\S]*?\.reader-controls\s*{[\s\S]*?grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/.test(css),
  "Portrait desktop reader controls must remain one compact three-column row.",
);
assert(
  /@media\s*\(min-width:\s*641px\)\s*and\s*\(max-width:\s*960px\)[\s\S]*?@container\s+reader-pane\s*\(min-width:\s*550px\)/.test(readerCss),
  "Portrait chapter-action labels must appear only when the measured reader pane can keep one action row.",
);

const widthCycle = index.match(/<button\b(?=[^>]*\bid="studyWorkspaceWidthCycle")[^>]*>[\s\S]*?<\/button>/)?.[0] || "";
assert(widthCycle, "The workspace must expose one Study width cycle control.");
assert.equal((index.match(/data-study-workspace-width-cycle/g) || []).length, 1, "The workspace must retain exactly one width cycle control.");
assert(
  /data-study-workspace-width-mode="standard"/.test(widthCycle) &&
    /data-study-workspace-width-current="standard"/.test(widthCycle) &&
    /data-study-workspace-width-next="expanded"/.test(widthCycle) &&
    /aria-label="Study workspace width: Standard\. Change to Expanded\."/.test(widthCycle) &&
    /title="Study workspace width: Standard \(click for Expanded\)"/.test(widthCycle) &&
    !/aria-pressed=/.test(widthCycle),
  "The single width cycle must declare truthful Standard-to-Expanded startup state without radio-button semantics.",
);
for (const mode of ["compact", "standard", "expanded"]) {
  assert(
    new RegExp(`study-workspace-width-divider-${mode}`).test(widthCycle),
    `${mode} must have deterministic right-pane divider artwork inside the one width control.`,
  );
}
assert(
  /class="study-workspace-width-frame"/.test(widthCycle) &&
    /\.study-workspace-width-controls button\s*{[\s\S]*?width:\s*32px;[\s\S]*?height:\s*32px;[\s\S]*?font-size:\s*0;/.test(css) &&
    /\.study-workspace-width-symbol\s*{[\s\S]*?display:\s*block;[\s\S]*?width:\s*18px;[\s\S]*?height:\s*16px;[\s\S]*?fill:\s*none;[\s\S]*?stroke:\s*currentColor;[\s\S]*?stroke-width:\s*1\.7;/.test(css) &&
    /\.study-workspace-width-cycle\[data-study-workspace-width-current="compact"\][\s\S]*?study-workspace-width-divider-compact[\s\S]*?\.study-workspace-width-cycle\[data-study-workspace-width-current="standard"\][\s\S]*?study-workspace-width-divider-standard[\s\S]*?\.study-workspace-width-cycle\[data-study-workspace-width-current="expanded"\][\s\S]*?study-workspace-width-divider-expanded/.test(css),
  "The single width control must use a centered stateful right-pane icon inside one 32px target.",
);
assert(
  !index.includes("study-workspace-width-reset-symbol") && !index.includes(">↺</") && !index.includes(">−</") && !index.includes(">+</"),
  "Study width must not fall back to reset/minus/plus font glyphs.",
);
assert(
  /id="clearDetail"[\s\S]*?<span class="detail-header-icon-label">Clear<\/span>[\s\S]*?<svg/.test(index) &&
    /id="hideStudyWorkspace"[\s\S]*?<span id="hideStudyWorkspaceLabel" class="detail-header-icon-label">Hide<\/span>[\s\S]*?<svg/.test(index) &&
    /\.detail-header-icon-label\s*{[\s\S]*?display:\s*inline-flex;[\s\S]*?align-items:\s*center;[\s\S]*?min-height:\s*14px;[\s\S]*?line-height:\s*1;/.test(css),
  "Clear and Hide must expose explicit label boxes aligned with their SVG artwork.",
);
assert(
  /id="hideStudyWorkspace"[\s\S]*?data-workspace-direction="collapse-right"[\s\S]*?class="study-workspace-panel-arrow-shaft" d="M10 12H18"[\s\S]*?class="study-workspace-panel-arrow-head" d="M15 9l3 3-3 3"/.test(index) &&
    /id="showStudyWorkspace"[\s\S]*?data-workspace-direction="restore-left"[\s\S]*?class="study-workspace-panel-arrow-shaft" d="M18 12H10"[\s\S]*?class="study-workspace-panel-arrow-head" d="M13 9l-3 3 3 3"/.test(index),
  "Right-side Hide must point outward/right and Show must point inward/left.",
);
assert(
  /@media\s*\(min-width:\s*769px\)[\s\S]*?\.detail-header\s*{[\s\S]*?--study-header-layout-band:\s*narrow;[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);[\s\S]*?\.detail-header-main\s*{\s*display:\s*contents;/.test(css) &&
    /@container\s+study-workspace\s*\(min-width:\s*318px\)[\s\S]*?--study-header-layout-band:\s*wide;[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) auto auto;[\s\S]*?\.detail-title-block\s*{[\s\S]*?grid-row:\s*1;[\s\S]*?\.study-workspace-width-controls\s*{[\s\S]*?grid-row:\s*1;[\s\S]*?\.detail-header-actions\s*{[\s\S]*?grid-row:\s*1;/.test(css) &&
    !/@container\s+study-workspace\s*\(min-width:\s*420px\)/.test(css),
  "Desktop Study controls must stay on one header row from the compact 320px pane minimum upward.",
);
assert(
  /\.detail-header-icon-button\s*{[\s\S]*?min-width:\s*32px;[\s\S]*?height:\s*32px;[\s\S]*?font-size:\s*11px;/.test(css),
  "Clear and Hide must remain compact labeled 32px controls on desktop.",
);

for (const [id, label] of [
  ["clearDetail", "Clear study workspace"],
  ["hideStudyWorkspace", "Hide study workspace"],
  ["showStudyWorkspace", "Show study workspace"],
]) {
  assert(new RegExp(`id="${id}"[\\s\\S]*?aria-label="${label}"`).test(index), `${id} must be an accessible icon control.`);
}
assert(
  /id="detailPane" class="detail-pane"/.test(index) &&
    /aria-controls="detailPane"/.test(index),
  "Hide and Show controls must explicitly control the stable detail pane.",
);
assert(
  /data-study-workspace-hidden="true"[\s\S]*?\.app-shell[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/.test(css) &&
    /data-study-workspace-hidden="true"[\s\S]*?\.detail-pane[\s\S]*?display:\s*none/.test(css),
  "Hiding the workspace must expand the reader without destroying the detail DOM.",
);
assert(
  /captureReaderAnchor\(readerRoot\)/.test(runtime) &&
    /restoreReaderAnchor\(snapshot\.readerAnchor/.test(runtime) &&
    /let hiddenStateDetailScrollTop = null;/.test(runtime) &&
    /hiddenStateDetailScrollTop = liveDetailScrollTop;/.test(runtime) &&
    /hiddenStateDetailScrollTop \?\? liveDetailScrollTop/.test(runtime) &&
    /dataset\.studyWorkspaceHidden/.test(runtime),
  "Hide and restore must preserve the semantic reader anchor and exact detail scroll position across display:none.",
);
assert(
  /let workspaceTransitionGeneration = 0;/.test(runtime) &&
    /generation: \+\+workspaceTransitionGeneration/.test(runtime) &&
    /snapshot\.generation !== workspaceTransitionGeneration/.test(runtime) &&
    /function settleWorkspaceTransition\(snapshot\) \{[\s\S]*?restoreWorkspaceTransition\(snapshot\);[\s\S]*?requestAnimationFrame\(settle\)/.test(runtime),
  "Workspace transitions must correct the new grid synchronously and discard stale frame corrections.",
);
assert(
  /ResizeObserver/.test(runtime) &&
    /--app-header-block-size/.test(runtime) &&
    /top:\s*calc\(var\(--app-header-block-size\) \+ 12px\)/.test(css) &&
    /height:\s*calc\(100dvh - var\(--app-header-block-size\) - 24px\)/.test(css),
  "The sticky workspace must derive its usable height from the rendered header.",
);
assert(
  /\.book-picker-panel\s*{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/.test(css) &&
    /\.book-picker-list\s*{[\s\S]*?min-height:\s*0;[\s\S]*?overflow-y:\s*auto;[\s\S]*?overscroll-behavior-y:\s*contain/.test(css),
  "Portrait book columns must remain separately scrollable and viewport-contained.",
);
assert(
  /function revealActivePickerOption\(panel\)/.test(pickerFlow) &&
    /activeOptionScroller\(panel\)/.test(pickerFlow) &&
    /scroller\.scrollTop = Math\.max/.test(pickerFlow) &&
    !/scrollIntoView/.test(pickerFlow) &&
    !/centerActiveOption|settlePicker/.test(runtime),
  "Reader picker correction must have one owner and center only within the intended scroller.",
);
assert(
  /@media\s*\(max-width:\s*768px\)[\s\S]*?\.study-workspace-width-controls,[\s\S]*?\.study-workspace-show-button\s*{[\s\S]*?display:\s*none !important;/.test(css) &&
    /\.detail-header-icon-button\s*{[\s\S]*?min-width:\s*44px;[\s\S]*?min-height:\s*44px;/.test(css),
  "Mobile must hide desktop width/show controls while retaining 44px Clear and Close actions.",
);
assert(
  /button\.dataset\.panelAction = action\.id;/.test(contextTabs),
  "Every contextual navigation button must expose its semantic action identity.",
);

const wordBranch = contextTabs.match(
  /if \(scope === "word" && hasWord\) \{[\s\S]*?\n      \} else if \(scope === "verse"\)/,
)?.[0] || "";
assert(
  /marks\.dataset\.panelAction = "study-marks";[\s\S]*?controls\.append\(marks\);[\s\S]*?relatedTools\.forEach\(appendTool\);[\s\S]*?meaning\.dataset\.panelAction = "meaning";[\s\S]*?controls\.append\(meaning\);/.test(wordBranch),
  "Word controls must render Word, Study Marks, concordance, then Meaning in DOM and keyboard order.",
);

const verseBranch = contextTabs.match(
  /else if \(scope === "verse"\) \{[\s\S]*?\n      \} else \{/,
)?.[0] || "";
assert(
  /marks\.dataset\.panelAction = "study-marks";[\s\S]*?controls\.append\(marks\);[\s\S]*?relatedTools\.forEach\(appendTool\);/.test(verseBranch),
  "Verse Study Marks must sit after the single Parallel action and before the remaining verse tools.",
);
assert(
  /\.panel-context-navigation \.word-meaning-trigger\[aria-expanded="false"\]\s*{[\s\S]*?border:\s*0 !important;[\s\S]*?background:\s*transparent !important;[\s\S]*?color:\s*var\(--muted\) !important;/.test(css) &&
    /\.panel-context-navigation \.word-meaning-trigger\[aria-expanded="true"\][\s\S]*?background:\s*rgba\(37, 99, 95, 0\.12\) !important;/.test(css),
  "Meaning must remain visually neutral while closed and highlight only during interaction or expansion.",
);

assert(
  [[".fn-marker::before", {width: "44px", height: "44px"}],
    [".verse-number", {width: "40px", "min-height": "44px"}],
    [".presentation-block .cross-links .reference-hover::before", {height: "44px"}]].every(([selector, properties]) =>
    cssRules(readerCss).some(rule => rule.selectors.includes(selector) &&
      rule.contexts.includes("@media (hover: none), (pointer: coarse)") &&
      Object.entries(properties).every(([property, value]) => rule.declarations.some(d => d.property === property && d.value === value)))),
  "Portrait touch layouts must retain the enlarged inline reader targets without changing the reader columns.",
);

console.log(JSON.stringify({ status: "ok", assertions: 27 }, null, 2));
