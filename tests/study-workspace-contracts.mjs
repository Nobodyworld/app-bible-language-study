#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sources = Object.fromEntries(await Promise.all(
  [
    ["index", "../app/index.html"],
    ["css", "../app/styles.css"],
    ["contextCss", "../app/styles-context.css"],
    ["app", "../app/app.js"],
    ["activeWord", "../app/src/active-word-context.js"],
    ["chapter", "../app/src/chapter-renderer.js"],
    ["dom", "../app/src/dom.js"],
    ["portrait", "../app/src/portrait-workspace.js"],
    ["readerPicker", "../app/src/reader-picker-flow.js"],
    ["ui", "../app/src/ui-contracts.js"],
    ["boot", "../app/src/study-workspace-width-boot.js"],
    ["width", "../app/src/study-workspace-width.js"],
    ["surface", "../app/src/detail-tool-surface.js"],
    ["tags", "../app/src/views/tags-view.js"],
    ["meaning", "../app/src/word-meaning.js"],
    ["contextView", "../app/src/views/verse-context-tabs.js"],
    ["strongView", "../app/src/views/strongs-view.js"],
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
assert(
  /DETAIL_VIEW_IDS/.test(sources.ui) &&
    /normalizeDetailViewId/.test(sources.ui) &&
    /viewId:\s*currentDetailViewId/.test(sources.dom) &&
    /setDisplayedDetailView\(snapshot\.viewId\)/.test(sources.dom) &&
    /dataset\.displayedView/.test(sources.dom),
  "Displayed Detail view identity must be bounded, exposed, snapshotted, and restored.",
);
assert(
  /DETAIL_SCROLL_POLICIES/.test(sources.ui) &&
    /function applyDetailScrollPolicy/.test(sources.dom) &&
    /isDetailIntentCurrent\(detailIntent\)/.test(sources.dom) &&
    /DETAIL_SCROLL_POLICIES\.preserve/.test(sources.dom) &&
    /DETAIL_SCROLL_POLICIES\.reset/.test(sources.dom),
  "Detail replacement must use explicit reset/preserve policies with stale-intent protection.",
);
assert(
  /function setPaneInert\(inert\)/.test(sources.portrait) &&
    /detailPane\.setAttribute\("aria-hidden", "true"\)/.test(sources.portrait) &&
    /detailPane\.setAttribute\("aria-hidden", "false"\)/.test(sources.portrait) &&
    /export function openStudyWorkspace/.test(sources.portrait) &&
    /export function closeStudyWorkspace/.test(sources.portrait) &&
    /event\.key !== "Tab"/.test(sources.portrait),
  "One responsive lifecycle must own mobile open/close, inertness, exposure, and Tab containment.",
);
assert(
  !/src="\.\/src\/portrait-workspace\.js/.test(sources.index) &&
    /from "\.\/src\/portrait-workspace\.js"/.test(sources.app),
  "The responsive Study lifecycle must be instantiated only through the application module graph.",
);
assert(
  /invoker:\s*element/.test(sources.chapter) &&
    /invoker:\s*options\.invoker \|\| null/.test(sources.strongView) &&
    /const \{ invoker: _invoker, \.\.\.storedOptions \}/.test(sources.activeWord),
  "Reader activation must restore focus through the live invoker without storing a DOM node in canonical word context.",
);
assert(
  /options\.history === "replace" && !options\.invoker/.test(sources.dom),
  "An invoker-owned Reader replacement must open the mobile drawer while background same-view replacements remain non-revealing.",
);
assert(
  /return document\.activeElement === element;/.test(sources.portrait) &&
    /!restoredBeforeClose \|\| !isExternalInvoker\(document\.activeElement\)[\s\S]*?focusElement\(openButton, \{ suppressReaderSnapshot: true \}\)/.test(sources.portrait) &&
    /data-study-drawer-focus-restore/.test(sources.portrait) &&
    /event\.target\?\.hasAttribute\?\.\("data-study-drawer-focus-restore"\)/.test(sources.app),
  "Drawer focus restoration must verify the active element, fall back to the external Study launcher, and avoid rewriting Reader history.",
);
assert(
  /const generation = \+\+drawerTransitionGeneration;[\s\S]*?requestAnimationFrame[\s\S]*?generation !== drawerTransitionGeneration/.test(sources.portrait),
  "Drawer close must use one bounded, generation-guarded frame to reassert external focus after key settlement.",
);
assert(
  /function isExternalInvoker\(element\)[\s\S]*?element\.matches\?\.\(FOCUSABLE_SELECTOR\)[\s\S]*?element\.tabIndex >= 0/.test(sources.portrait),
  "Drawer restoration must reject body and other non-focusable external nodes as invokers.",
);
assert(
  /event\.key === "Escape" && document\.querySelector\("\.detail-pane\.visible"\)/.test(sources.readerPicker),
  "A mobile drawer-owned Escape must not clear the frozen Reader highlight before focus restoration.",
);
assert(
  !/resetDetailContent[\s\S]*?classList\.remove\("visible"\)/.test(sources.dom) &&
    /focusStudyWorkspaceAfterClear/.test(sources.app) &&
    /Close study panel/.test(sources.portrait),
  "Clear must retain the mobile drawer while the adaptive Hide control owns Close.",
);
assert(
  /id="detailModeStatus"[\s\S]*?>Following<\/span>/.test(sources.index) &&
    /Study workspace mode: \$\{visibleMode\}/.test(sources.dom),
  "The header must expose a compact, truthful Locked/Following status.",
);
const detailHeader = sources.index.match(/<div class="detail-header">[\s\S]*?<\/div>\s*<div id="detailWorkspace"/)?.[0] || "";
assert(
  detailHeader.indexOf('id="detailTitle"') < detailHeader.indexOf('id="studyWorkspaceWidthControls"') &&
    detailHeader.indexOf('id="studyWorkspaceWidthControls"') < detailHeader.indexOf('id="clearDetail"') &&
    detailHeader.indexOf('id="clearDetail"') < detailHeader.indexOf('id="hideStudyWorkspace"'),
  "Detail header source order must match title, width, Clear, then Hide/Close.",
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

console.log(JSON.stringify({ status: "ok", assertions: 38 }, null, 2));
