#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sources = Object.fromEntries(await Promise.all(
  [
    ["index", "../app/index.html"],
    ["css", "../app/styles.css"],
    ["contextCss", "../app/styles-context.css"],
    ["app", "../app/app.js"],
    ["dom", "../app/src/dom.js"],
    ["boot", "../app/src/study-workspace-width-boot.js"],
    ["width", "../app/src/study-workspace-width.js"],
    ["surface", "../app/src/detail-tool-surface.js"],
    ["tags", "../app/src/views/tags-view.js"],
    ["meaning", "../app/src/word-meaning.js"],
    ["contextView", "../app/src/views/verse-context-tabs.js"],
    ["interlinearView", "../app/src/views/interlinear-translation-view.js"],
    ["stores", "../app/src/stores.js"],
  ].map(async ([name, path]) => [name, await readFile(new URL(path, import.meta.url), "utf8")]),
));

assert(
  /<html[^>]*data-study-workspace-width="standard"/.test(sources.index),
  "Standard must be the declarative pre-JavaScript desktop width.",
);
assert(
  sources.index.indexOf("study-workspace-width-boot.js") < sources.index.indexOf("styles.css"),
  "The fault-tolerant stored width must be applied before stylesheet evaluation.",
);
assert(
  /id="studyWorkspaceWidthControls"[^>]*role="group"[^>]*aria-label="Study workspace width"/.test(sources.index) &&
    (sources.index.match(/data-study-workspace-width-mode="(?:compact|standard|expanded)"/g) || []).length === 3 &&
    (sources.index.match(/aria-pressed="true">Standard</g) || []).length === 1,
  "The header must expose one labeled three-button pressed-state width group.",
);
assert(
  /id="detailWorkArea" class="detail-work-area"/.test(sources.index) &&
    /id="detailToolSurface"[^>]*role="dialog"[^>]*aria-labelledby="detailToolTitle"[^>]*aria-hidden="true"[^>]*hidden/.test(sources.index) &&
    /id="detailToolClose"[^>]*aria-label="Close study tool"[^>]*>Close</.test(sources.index),
  "The reusable contained tool surface must start hidden with a title and explicit Close action.",
);

for (const [mode, value] of [
  ["compact", "clamp(320px, 25vw, 420px)"],
  ["standard", "clamp(400px, 33vw, 620px)"],
  ["expanded", "clamp(500px, 40vw, 760px)"],
]) {
  assert(
    new RegExp(`data-study-workspace-width="${mode}"[\\s\\S]*?--study-workspace-inline-size:\\s*${value.replace(/[()]/g, "\\$&")}`).test(sources.css),
    `${mode} must retain its bounded desktop width contract.`,
  );
}
assert(
  /grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, var\(--study-workspace-inline-size\)\)/.test(sources.css),
  "The desktop shell must consume the declarative study-workspace width.",
);
assert(
  /@media\s*\(min-width:\s*769px\)\s*and\s*\(max-width:\s*1100px\)[\s\S]*?compact[\s\S]*?clamp\(300px, 32vw, 340px\)[\s\S]*?standard[\s\S]*?clamp\(340px, 38vw, 400px\)[\s\S]*?expanded[\s\S]*?clamp\(380px, 44vw, 440px\)/.test(sources.css),
  "Intermediate desktop widths must constrain all three stored modes without collapsing their identity.",
);
assert(
  /@media\s*\(max-width:\s*768px\)[\s\S]*?\.app-shell\s*{[\s\S]*?grid-template-columns:\s*1fr/.test(sources.css) &&
    /@media\s*\(max-width:\s*768px\)[\s\S]*?\.study-workspace-width-controls\s*{\s*display:\s*none;/.test(sources.css) &&
    (sources.css.match(/\.app-shell\s*{[^}]*grid-template-columns:\s*1fr/g) || []).length === 1,
  "Only the established mobile breakpoint may collapse the shell or hide width controls.",
);
assert(
  /\.reader-pane,[\s\S]*?\.detail-pane\s*{[\s\S]*?min-width:\s*0/.test(sources.css) &&
    /\.detail-pane\s*{[\s\S]*?position:\s*sticky;[\s\S]*?height:\s*calc\(100dvh - 88px\);[\s\S]*?overflow-y:\s*hidden/.test(sources.css) &&
    /\.detail-content\s*{[\s\S]*?min-height:\s*0;[\s\S]*?overflow-x:\s*hidden;[\s\S]*?overflow-y:\s*auto;[\s\S]*?overscroll-behavior-y:\s*contain/.test(sources.css),
  "The bounded pane and #detailContent must own an independent, horizontal-safe scroll region.",
);
assert(
  /\.detail-tool-surface\s*{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0;[\s\S]*?overflow:\s*hidden/.test(sources.css) &&
    /\.detail-tool-surface\[hidden\]\s*{\s*display:\s*none;/.test(sources.css),
  "Contained tools must layer inside the panel body without adding layout height.",
);

assert(
  /bibleapp:study-workspace-width:v1/.test(sources.boot) &&
    /let mode\s*=\s*"standard"/.test(sources.boot) &&
    /try\s*{[\s\S]*?localStorage\.getItem/.test(sources.boot) &&
    /catch\s*{[\s\S]*?default remains usable/.test(sources.boot),
  "The early boot preference read must be isolated and fall back to Standard.",
);
assert(
  /captureReaderAnchor\(readerRoot\)/.test(sources.width) &&
    /applyStudyWorkspaceWidth\(root, requestedMode/.test(sources.width) &&
    /restoreReaderAnchor\(readerAnchor/.test(sources.width) &&
    /scrollBy\(0, delta\)/.test(sources.width) &&
    !/scrollIntoView|setDetail|history\.(?:pushState|replaceState)/.test(sources.width),
  "Width changes must correct a semantic anchor without rerendering, recentering, or changing history.",
);
assert(
  !sources.stores.includes("bibleapp:study-workspace-width:v1"),
  "The UI-only width key must remain absent from portable user-data storage and exports.",
);

assert(
  /activateOverlay/.test(sources.surface) &&
    /workArea\.setAttribute\("aria-hidden", "true"\)/.test(sources.surface) &&
    /workArea\.inert\s*=\s*true/.test(sources.surface) &&
    /surface\.hidden\s*=\s*false/.test(sources.surface) &&
    /surface\.hidden\s*=\s*true/.test(sources.surface),
  "The shared surface must be the overlay owner and safely hide/inert the preserved work area.",
);
assert(
  /event\.key !== "Escape"/.test(await readFile(new URL("../app/src/overlay-coordinator.js", import.meta.url), "utf8")) &&
    /closeContainedDetailTool\(\{[\s\S]*?restoreFocus/.test(sources.surface) &&
    /resolveRestoreFocus/.test(sources.surface),
  "Escape and Close must use coordinated, replacement-safe focus restoration.",
);
assert(
  /dismissContainedDetailTool\("detail-change"\)/.test(sources.dom) &&
    /dismissContainedDetailTool\("history-back"\)/.test(sources.dom) &&
    /dismissContainedDetailTool\("history-forward"\)/.test(sources.dom) &&
    /dismissContainedDetailTool\("detail-reset"\)/.test(sources.dom) &&
    /dismissContainedDetailTool\("route-change"\)/.test(sources.app),
  "Detail replacement, history, reset, Clear, and route navigation must dismiss the shared surface.",
);
assert(
  /const handlePopState = \(event\) => \{[\s\S]*?const restorationSnapshot = readerSnapshotFromHistoryState\(event\.state\);[\s\S]*?void navigateToRoute\(route, \{[\s\S]*?writeUrl: false,[\s\S]*?historyTraversal: true,[\s\S]*?historyEntryCreated: !restorationSnapshot,[\s\S]*?restorationSnapshot,/.test(sources.app) &&
    /const handleHashChange = \(\) => \{[\s\S]*?void navigateToRoute\(route, \{ writeUrl: false, historyTraversal: true, historyEntryCreated: true \}\)/.test(sources.app) &&
    !/const handle(?:PopState|HashChange)[\s\S]*?route\.home[\s\S]*?showHomePage/.test(sources.app),
  "Hash/popstate Home navigation must pass through the same contained-tool cleanup as reader routes.",
);
assert(
  /closeContainedDetailTool\(\{ restoreFocus: true, reason: "trigger-disconnected" \}\)/.test(sources.surface),
  "A contained tool whose trigger disappears must restore focus to its stable panel fallback.",
);
assert(
  /matchMedia\("\(max-width: 768px\)"\)/.test(sources.dom),
  "Mobile reveal behavior must use the same 768px breakpoint as the full-screen drawer.",
);

const containedMarksBranch = sources.tags.match(/if \(options\.boundary === "detail-pane"\) \{[\s\S]*?return trigger;\s*\}/)?.[0] || "";
assert(
  /aria-haspopup", "dialog"/.test(containedMarksBranch) &&
    /aria-expanded", "false"/.test(containedMarksBranch) &&
    /trigger\.addEventListener\("click"/.test(containedMarksBranch) &&
    /openContainedDetailTool/.test(containedMarksBranch) &&
    !/pointerenter|focusin/.test(containedMarksBranch),
  "Only explicit activation may open side-panel Study Marks in the contained dialog.",
);
assert.equal(
  (sources.contextView.match(/boundary:\s*"detail-pane"/g) || []).length +
    (sources.interlinearView.match(/boundary:\s*"detail-pane"/g) || []).length,
  3,
  "Exactly the two compact-context targets and Language Study token target opt into contained Study Marks.",
);
assert(
  /availableTagsForTarget\(target\)/.test(sources.tags) &&
    /setTagAssertion\(ctx\.state, target, tag\.id/.test(sources.tags) &&
    /showTargetTagEditor\(target/.test(sources.tags),
  "Contained Study Marks must retain valid-tag filtering, exact target mutations, and Manage tags.",
);

assert(
    /presentation = "popover"/.test(sources.meaning) &&
    /presentation === "detail-pane"/.test(sources.meaning) &&
    /openContainedDetailTool\(\{[\s\S]*?kind:\s*"meaning"/.test(sources.meaning) &&
    /menu\.className = contained \? "word-meaning-contained" : "word-meaning-menu"/.test(sources.meaning),
  "Meaning must keep its default popover while exposing an explicit contained-panel presentation.",
);
assert.equal(
  (sources.contextView.match(/presentation:\s*"detail-pane"/g) || []).length +
    (sources.interlinearView.match(/presentation:\s*"detail-pane"/g) || []).length,
  2,
  "Both current detail-panel Meaning call sites must explicitly opt into containment.",
);
assert(
  /\.word-meaning-menu\s*{[\s\S]*?position:\s*fixed/.test(sources.css) &&
    /\.word-meaning-contained\s*{[\s\S]*?display:\s*grid/.test(sources.css) &&
    !/\.word-meaning-contained\s*{[\s\S]*?position:\s*fixed/.test(sources.css),
  "The legacy default Meaning dialog may remain fixed, but contained Meaning must not be viewport-positioned.",
);
assert(
  /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?transition-duration:\s*0\.01ms\s*!important/.test(sources.css),
  "The completed workspace must retain reduced-motion suppression.",
);

console.log(JSON.stringify({ status: "ok", assertions: 25 }, null, 2));
