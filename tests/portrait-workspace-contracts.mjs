#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [index, css, runtime, contextTabs] = await Promise.all([
  readFile(new URL("../app/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/styles-portrait.css", import.meta.url), "utf8"),
  readFile(new URL("../app/src/portrait-workspace.js", import.meta.url), "utf8"),
  readFile(new URL("../app/src/views/verse-context-tabs.js", import.meta.url), "utf8"),
]);

assert(
  /<h1>Bible Reader<\/h1>/.test(index),
  "The portrait header must use the shortened Bible Reader title.",
);
assert(
  /grid-template-areas:\s*[\s\S]*?"brand status \. theme"[\s\S]*?"controls controls controls controls"/.test(css),
  "Portrait desktop must place status beside the brand and reader controls on the final header row.",
);
assert(
  /@media\s*\(min-width:\s*769px\)\s*and\s*\(max-width:\s*1100px\)[\s\S]*?\.reader-controls\s*{[\s\S]*?grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/.test(css),
  "Portrait desktop reader controls must remain one compact three-column row.",
);

const widthButtons = index.match(/<button[\s\S]*?data-study-workspace-width-mode="(?:compact|standard|expanded)"[\s\S]*?<\/button>/g) || [];
assert.equal(widthButtons.length, 3, "The workspace must retain exactly three width controls.");
for (const [mode, button] of ["compact", "standard", "expanded"].map((mode, buttonIndex) => [mode, widthButtons[buttonIndex]])) {
  assert(new RegExp(`aria-label="Use ${mode} study workspace"`).test(button), `${mode} width control needs an accessible name.`);
  assert(new RegExp(`title="${mode[0].toUpperCase()}${mode.slice(1)} study workspace"`).test(button), `${mode} width control needs a tooltip.`);
  assert(/class="study-workspace-width-icon"/.test(button), `${mode} width control must render its compact icon.`);
}
assert(
  /\.study-workspace-width-controls button\s*{[\s\S]*?width:\s*24px;[\s\S]*?height:\s*24px;[\s\S]*?font-size:\s*0;/.test(css),
  "Width controls must remain compact icon buttons.",
);
assert(
  /@media\s*\(min-width:\s*769px\)[\s\S]*?\.detail-header\s*{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) auto auto;[\s\S]*?\.detail-header-main\s*{\s*display:\s*contents;/.test(css),
  "Desktop detail title, width controls, and utility actions must share one compact header row.",
);
assert(
  /\.detail-header-icon-button\s*{[\s\S]*?width:\s*24px;[\s\S]*?height:\s*24px;/.test(css),
  "Clear and Hide must remain compact icon controls.",
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
    /restoreReaderAnchor\(readerAnchor/.test(runtime) &&
    /detailScrollTop/.test(runtime) &&
    /dataset\.studyWorkspaceHidden/.test(runtime),
  "Hide and restore must preserve the semantic reader anchor and detail scroll position.",
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
  /centerActiveOption/.test(runtime) &&
    /active\.offsetTop/.test(runtime) &&
    !/scrollIntoView/.test(runtime),
  "Portrait picker correction must center within the intended scroller without broad scrollIntoView behavior.",
);
assert(
  /@media\s*\(max-width:\s*768px\)[\s\S]*?\.study-workspace-width-controls,[\s\S]*?display:\s*none !important;/.test(css),
  "Desktop width controls must remain hidden in the established mobile drawer.",
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
  "Verse Study Marks must sit directly after the Verse scope control before related tools.",
);
assert(
  /\.panel-context-navigation \.word-meaning-trigger\[aria-expanded="false"\]\s*{[\s\S]*?border:\s*0 !important;[\s\S]*?background:\s*transparent !important;[\s\S]*?color:\s*var\(--muted\) !important;/.test(css) &&
    /\.panel-context-navigation \.word-meaning-trigger\[aria-expanded="true"\][\s\S]*?background:\s*rgba\(37, 99, 95, 0\.12\) !important;/.test(css),
  "Meaning must remain visually neutral while closed and highlight only during interaction or expansion.",
);

console.log(JSON.stringify({ status: "ok", assertions: 20 }, null, 2));
