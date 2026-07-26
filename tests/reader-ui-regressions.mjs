#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveReferencePreviewPlacement } from "../app/src/reference-preview-placement.js";

const [index, css, contextCss, stylesPolish, app, pickerFlow, renderer, tagsView, strongsView, interlinearView, userDataView, detailViews, jobsView] = await Promise.all([
  readFile(new URL("../app/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../app/styles-context.css", import.meta.url), "utf8"),
  readFile(new URL("../app/styles-polish.css", import.meta.url), "utf8"),
  readFile(new URL("../app/app.js", import.meta.url), "utf8"),
  readFile(new URL("../app/src/reader-picker-flow.js", import.meta.url), "utf8"),
  readFile(new URL("../app/src/chapter-renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../app/src/views/tags-view.js", import.meta.url), "utf8"),
  readFile(new URL("../app/src/views/strongs-view.js", import.meta.url), "utf8"),
  readFile(new URL("../app/src/views/interlinear-translation-view.js", import.meta.url), "utf8"),
  readFile(new URL("../app/src/views/user-data-view.js", import.meta.url), "utf8"),
  readFile(new URL("../app/src/detail-views.js", import.meta.url), "utf8"),
  readFile(new URL("../app/src/views/jobs-view.js", import.meta.url), "utf8"),
]);

assert.equal((index.match(/id="study-marks-icon"/g) || []).length, 1, "Study Marks must have one official icon definition.");
assert.equal((tagsView.match(/#study-marks-icon/g) || []).length, 1, "Study Marks triggers must reference the shared icon.");
assert(!`${css}\n${contextCss}\n${stylesPolish}`.includes("color-mix("), "App stylesheets must not use color-mix().");

const chapterTools = index.match(/<div class="chapter-actions"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/)?.[0] || "";
const sideTools = index.match(/<nav class="detail-tool-nav"[\s\S]*?<\/nav>/)?.[0] || "";
const homeButtonMarkup = index.match(/<button id="homeButton"[\s\S]*?<\/button>/)?.[0] || "";

assert(chapterTools.includes('id="showOutline"'), "Outline must remain available in reader header tools.");
assert(chapterTools.includes('id="showInterlinear"'), "Language Study must remain available in reader header tools.");
assert.equal(sideTools, "", "Chapter and Book tool groups must not reserve side-panel height.");
assert.equal((chapterTools.match(/id="showMyData"/g) || []).length, 1, "Workspace tools must expose exactly one My Data control.");
assert(!/id="showJobs"|>Processing<|id="showUserData"|>Study Data</.test(chapterTools), "Processing and Study Data must not remain header controls.");
assert(
  /\["My Data", runWithReaderData\(detailViews\.showMyData\)\]/.test(app) &&
    !/\["Jobs"|\["Data"/.test(app),
  "Home must expose one My Data action without Jobs or Data duplicates.",
);
assert(
  /showMyData: createUserDataView\(ctx, \{ showStudyMarks: tagsView\.showTagIndex \}\)/.test(detailViews) &&
    /setDetail\("My Data", wrap\)/.test(userDataView),
  "My Data must use one stable global detail view.",
);
assert(
  /diagnostics\.className = "advanced-diagnostics"/.test(userDataView) &&
    !/diagnostics\.open\s*=\s*true/.test(userDataView) &&
    /renderJobsDiagnostics/.test(userDataView) &&
    /payload\.textContent = JSON\.stringify/.test(jobsView),
  "Technical job controls must be text-only and nested in collapsed-by-default diagnostics.",
);
assert(
  /Refresh Study Marks index/.test(userDataView) &&
    !/\bSync\b/.test(userDataView) &&
    /does not change personal study data/.test(userDataView),
  "Local maintenance must use plain-language Refresh wording and explain data impact.",
);

assert(/html\s*{\s*overflow-x:\s*clip;/.test(css), "The document must not create a sticky-breaking horizontal overflow container.");
assert(/body\s*{[\s\S]*?overflow-x:\s*clip;/.test(css), "The body must not create a sticky-breaking horizontal overflow container.");
assert(/\.detail-pane\s*{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*76px;[\s\S]*?height:\s*calc\(100dvh - 88px\);/.test(css), "Desktop detail panel must remain viewport-sticky and tall.");
assert(/\.strong-sticky-summary\s*{[\s\S]*?position:\s*static;/.test(css), "Strong summary must not create a second sticky scrolling region.");
assert(/renderInlineTagPicker/.test(renderer), "Reader verse numbers must retain the canonical inline Study Marks picker.");
assert(!/verse-study-marks-button/.test(renderer), "Reader rows must not render a duplicate Study Marks trigger beside the verse number.");
assert(
  /renderStudyMarksTrigger\(sourceTarget,\s*\{[\s\S]*?boundary:\s*"detail-pane"/.test(interlinearView),
  "Interlinear exact-token Study Marks must stay contained within the detail pane.",
);
assert(/verseActions\.append\(studyButton\)/.test(renderer), "Reader row actions must retain only the ellipsis study-tools launcher.");
assert(/@media\s*\(min-width:\s*641px\)\s*and\s*\(max-width:\s*1380px\)[\s\S]*?\.chapter-actions \.toolbar-button\s*{[\s\S]*?width:\s*34px;/.test(css), "Workspace controls must compact at intermediate widths.");
assert(/:root\[data-theme="dark"\] \.parallel-verse\.active\s*{[\s\S]*?background:\s*rgba\(148,\s*163,\s*184,\s*0\.12\)/.test(css), "Dark parallel selection must not use a white background.");
assert(/:root\[data-theme="dark"\] \.reader-context-verse\s*{[\s\S]*?background:\s*rgba\(148,\s*163,\s*184,\s*0\.08\)/.test(css), "Dark reader selection must use the calm slate highlight.");
assert(/\.reader-nav-arrow\s*{[\s\S]*?width:\s*20px;[\s\S]*?min-height:\s*56px;/.test(css), "Chapter navigation must remain edge-sliver sized.");
assert(/\.reader-floating-nav\s*{[\s\S]*?top:\s*176px;/.test(css), "Floating chapter navigation must sit below the reader header.");
assert(/\.detail-floating-nav\s*{[\s\S]*?top:\s*18px;[\s\S]*?margin:\s*0 24px 0 0;/.test(css), "Detail history controls must sit slightly lower and left of the panel edge.");
assert(
  (index.match(/class="scope-mark-control"/g) || []).length === 2 &&
    !/Book tags|Chapter tags/.test(index) &&
    /renderStudyMarksTrigger/.test(app),
  "Exactly one consolidated Book control and one consolidated Chapter control must be mounted.",
);
assert(
  /const renderLines = lines\.every\(\(line\) => \(line\.class \|\| "reg"\) === "reg" && !line\.style\)[\s\S]*?char_length: verseText\.length/.test(renderer),
  "Ordinary prose line records must collapse archive wrapping into one consistently spaced verse line while styled presentation lines remain distinct.",
);
assert(
  /target\.closest\?\.\("\.detail-pane"\)/.test(await readFile(new URL("../app/src/language-tooltips.js", import.meta.url), "utf8")) &&
    /\.definition-tooltip\[data-tooltip\]::after\s*{[\s\S]*?display:\s*none !important;/.test(css),
  "Side-panel definition and language tooltips must use the panel-aware fixed tooltip layer instead of overflowing pseudo-elements.",
);
assert(
  /id="bookTagControl" class="scope-mark-control"/.test(index) &&
    /id="chapterTagControl" class="scope-mark-control"/.test(index) &&
    /function syncScopeControls\(\)/.test(app) &&
    /renderStudyMarksTrigger\(target/.test(app) &&
    /Favorite/.test(tagsView),
  "Favorite and non-favorite tags must share each consolidated scope picker.",
);
assert(
  /id="bookPickerButton"/.test(index) &&
    /id="chapterPickerButton"/.test(index) &&
    /\.book-picker-panel\s*{[\s\S]*?grid-template-columns:\s*repeat\(2/.test(css) &&
    /\.chapter-picker-grid\s*{[\s\S]*?grid-template-columns:\s*repeat\(6/.test(css),
  "Book and chapter controls must use app-owned picker popovers: testament columns and chapter grid.",
);
assert(/\.fn-marker\s*{[\s\S]*?color:\s*#2347fb;/.test(css), "Footnote markers must use the requested blue.");
assert(
  /:root\[data-theme="dark"\] \.fn-marker\s*{[\s\S]*?color:\s*#9eafff\s*!important;/.test(css) &&
    /:root\[data-theme="dark"\] \.fn-marker:hover\s*{[\s\S]*?color:\s*#c5ceff\s*!important;/.test(css) &&
    /:root\[data-theme="dark"\] \.fn-marker:focus-visible\s*{[\s\S]*?outline:\s*2px solid #9eafff[\s\S]*?color:\s*#f0f2ff\s*!important;/.test(css),
  "Dark footnotes must use lighter default, hover, and keyboard-focus colors with a visible focus outline.",
);
assert(
  /html\[data-theme="light"\] \.fn-marker\s*{[\s\S]*?color:\s*#2347fb\s*!important;/.test(css) &&
    /html\[data-theme="light"\] \.fn-marker:hover\s*{[\s\S]*?color:\s*#1232c8\s*!important;/.test(css) &&
    /html\[data-theme="light"\] \.fn-marker:focus-visible\s*{[\s\S]*?outline:\s*2px solid #2347fb[\s\S]*?color:\s*#0b238f\s*!important;/.test(css),
  "Light-theme footnote contrast and keyboard focus treatment must remain explicit.",
);
assert(
  /reader-picker-flow\.js\?v=pr13-live-qa-20260711e/.test(index),
  "The reader picker flow helper must load after the main app module.",
);
assert(
  /ACTIVE_OPTION_SELECTOR = "\.reader-picker-option\.active"/.test(pickerFlow) &&
    /scrollIntoView\(\{[\s\S]*?block:\s*"center",[\s\S]*?inline:\s*"nearest",/.test(pickerFlow),
  "Opening reader pickers must scroll the active option into view.",
);
assert(
  /openChapterPickerAfterBookSelection/.test(pickerFlow) &&
    /#bookPickerPanel \.reader-picker-option/.test(pickerFlow) &&
    /setPickerExpanded\(chapterButton, chapterPanel, true\)/.test(pickerFlow),
  "Selecting a book in the app-owned picker must open chapter selection after navigation.",
);
assert(
  /frozenReaderContext/.test(pickerFlow) &&
    /captureFrozenReaderContext/.test(pickerFlow) &&
    /findFrozenReaderToken/.test(pickerFlow) &&
    /FROZEN_HIGHLIGHT_REFRESH_DELAYS_MS/.test(pickerFlow) &&
    /READER_BACKGROUND_RESET_SELECTOR/.test(pickerFlow) &&
    /MutationObserver\(\(\) => \{[\s\S]*?requestAnimationFrame\(applyFrozenReaderHighlight\)/.test(pickerFlow),
  "Clicked reader Strong's words must stay frozen while browsing side-panel details until an explicit unfreeze action.",
);
assert(
  /@media\s*\(min-width:\s*1024px\)[\s\S]*?\.reader-pane \.verse-row\s*{[\s\S]*?grid-template-columns:\s*58px minmax\(0, 1fr\) 32px;[\s\S]*?gap:\s*12px;/.test(stylesPolish) &&
    /@media\s*\(min-width:\s*1380px\)[\s\S]*?\.reader-pane \.chapter-content\s*{[\s\S]*?padding-inline:\s*28px 24px;/.test(stylesPolish),
  "Wide reader layout must add desktop-only breathing room without changing the mobile base layout.",
);

assert(/function disengageDetailFollow\(\)/.test(app), "Background reset must share the detail-follow disengage path.");
assert(
  /els\.content\?\.addEventListener\("pointerdown"/.test(app) &&
    /event\.pointerType !== "touch"/.test(app) &&
    /chapterSwipeDirection/.test(app),
  "Reader must retain touch chapter swiping.",
);
assert(
  /resetDetailForNavigation\(\)/.test(app),
  "Book, chapter, and translation navigation must clear stale detail-panel content.",
);
assert(/Content-Security-Policy/.test(index), "App shell must declare a Content Security Policy.");
assert(/object-src 'none'/.test(index), "Content Security Policy must block embedded objects.");
assert(/line\.append\(number,\s*document\.createTextNode/.test(renderer), "Reference preview verse numbers must render as superscripts.");
assert(/button\.textContent =/.test(renderer), "Cross-reference button labels must remain plain text.");
assert(/reference-hover-tooltip-title/.test(renderer), "Reference previews must include a passage title bar.");
assert(
  /\.reference-hover-tooltip-layer\s*{[\s\S]*?max-height:\s*calc\(100dvh - 20px\);[\s\S]*?overflow-y:\s*auto;[\s\S]*?pointer-events:\s*auto;/.test(css),
  "Reference hover previews must stay inside the viewport and support scrolling.",
);
assert.deepEqual(
  resolveReferencePreviewPlacement({
    targetTop: 500,
    targetBottom: 528,
    desiredHeight: 300,
    viewportHeight: 720,
  }),
  {
    availableAbove: 482,
    availableBelow: 174,
    maxHeight: 482,
    side: "above",
  },
  "Reference previews must choose above when the full content fits there.",
);
assert.deepEqual(
  resolveReferencePreviewPlacement({
    targetTop: 120,
    targetBottom: 148,
    desiredHeight: 300,
    viewportHeight: 720,
  }),
  {
    availableAbove: 102,
    availableBelow: 554,
    maxHeight: 554,
    side: "below",
  },
  "Reference previews must choose below when the content does not fit above but fits below.",
);
assert.deepEqual(
  resolveReferencePreviewPlacement({
    targetTop: 330,
    targetBottom: 358,
    desiredHeight: 700,
    viewportHeight: 720,
  }),
  {
    availableAbove: 312,
    availableBelow: 344,
    maxHeight: 344,
    side: "below",
  },
  "Long reference previews must use the larger collision-free region and cap their height to it.",
);
assert(
  /layer\.style\.removeProperty\("max-height"\)[\s\S]*?Math\.max\(layer\.scrollHeight,\s*naturalLayerRect\.height\)[\s\S]*?resolveReferencePreviewPlacement[\s\S]*?layer\.style\.maxHeight\s*=\s*`\$\{placement\.maxHeight\}px`[\s\S]*?const layerRect = layer\.getBoundingClientRect\(\)/.test(renderer),
  "Reference preview placement must clear stale sizing, measure natural content, apply a regional maximum height, and remeasure.",
);
assert(
  /placement\.side === "above"[\s\S]*?targetRect\.top - layerRect\.height - offset[\s\S]*?targetRect\.bottom \+ offset/.test(renderer) &&
    !/viewportHeight - layerRect\.height - margin/.test(renderer),
  "Reference previews must remain wholly above or below their trigger instead of clamping full-height content across it.",
);
assert(
  /referenceHoverTooltipLayer\.addEventListener\("mouseenter",\s*cancelReferenceHoverTooltipHide\)/.test(renderer) &&
    /button\.addEventListener\("mouseleave",\s*scheduleReferenceHoverTooltipHide\)/.test(renderer),
  "Reference hover previews must remain open while the user scrolls them.",
);

assert(
  /rtlNote\.setAttribute\("aria-expanded",\s*"false"\)/.test(strongsView) &&
    /rtlNote\.addEventListener\("click"/.test(strongsView) &&
    /rtlExplanation\.hidden = expanded/.test(strongsView),
  "Hebrew reading-direction affordance must behave as an expandable control.",
);
assert(
  /const markRecords = analysis\.units\.flatMap\(\(unit\) => unit\.marks \|\| \[\]\);/.test(strongsView) &&
    !/base_char/.test(strongsView) &&
    /section\.append\(marksTitle,\s*markStudy,\s*letters\)/.test(strongsView) &&
    /\.mark-study \.mark-study-word\s*{[\s\S]*?text-align:\s*center;/.test(css),
  "Hebrew marks must appear before letters/gematria and keep the studied word centered.",
);
assert(
  /\.language-breakdown\.hebrew \.mark-list\s*{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*repeat\(auto-fit, minmax\(96px, 1fr\)\);[\s\S]*?direction:\s*rtl;[\s\S]*?justify-content:\s*center;[\s\S]*?overflow-x:\s*visible;/.test(stylesPolish) &&
    /\.language-breakdown\.hebrew \.mark-glyph\s*{[\s\S]*?height:\s*auto;[\s\S]*?min-height:\s*42px;[\s\S]*?overflow:\s*visible;/.test(stylesPolish),
  "Hebrew mark pills must stay reachable in narrow panels and must not clip low vowel symbols.",
);
assert(
  /:root\[data-theme="dark"\] \.translation-renderings\s*{[\s\S]*?background:\s*var\(--bg-elevated\)\s*!important;/.test(css) &&
    /:root\[data-theme="dark"\] \.translation-rendering-row\s*{[\s\S]*?background:\s*var\(--panel\)\s*!important;/.test(css),
  "Translation rendering surfaces must respect dark theme colors.",
);
assert(
  /\.strong-sticky-summary > h3\s*{[\s\S]*?border-bottom:\s*1px solid var\(--line\);/.test(css),
  "Strong's summary heading must retain its separator.",
);
assert(
  /class="theme-switch-track"/.test(index) &&
    /class="theme-option theme-sun"/.test(index) &&
    /class="theme-option theme-moon"/.test(index) &&
    /aria-pressed="false"/.test(index),
  "Theme control must expose both theme icons and switch state.",
);
assert(
  /id="statusText" class="header-status"/.test(index) &&
    !homeButtonMarkup.includes('id="statusText"'),
  "Dynamic load status must remain available outside the brand control.",
);
assert(/setMorphologyHelp\(pos,\s*morphology,\s*language\)/.test(strongsView), "Strong's morphology must expose definition help.");
assert(
  /glyph\.textContent = languageUnitDisplayGlyph\(unit\)/.test(strongsView) &&
    /marksTitle\.textContent = `\$\{languageTitle\(analysis\.language\)\} marks \/ symbols`/.test(strongsView),
  "Strong's letter tiles must reconstruct marked graphemes while retaining the separate marks and symbols section.",
);
assert(
  /resolveStrongSeeSegments\(paragraph, refs\)/.test(strongsView) &&
    /createStrongReferenceControl\(segment\.ref/.test(strongsView),
  "Structured concordance see-references must render through the shared Strong's control behavior.",
);
assert(
  /appendLexicalRow\(rows, "Transliteration", createTransliterationValue\(entry\.transliteration\)\)/.test(strongsView) &&
    /appendLexicalRow\(rows, "Phonetic spelling", entry\.phonetic_spelling\)/.test(strongsView) &&
    /function appendLexicalRow[\s\S]*?if \(!value\) return;/.test(strongsView),
  "Strong's transliteration and phonetic spelling must remain separate, and missing fields must be omitted.",
);
assert(
  /Study Marks by Scripture/.test(tagsView) &&
    /Book\/chapter tags/.test(tagsView) &&
    /English word\/phrase tags/.test(tagsView) &&
    /Source-word tags/.test(tagsView) &&
    /appendStudyMarksByScripture\(ctx,\s*wrap,\s*assertions/.test(tagsView),
  "Study Marks must expose a scripture-centered book/chapter/verse hierarchy.",
);
assert(
  /styles\.css\?v=pr13-live-qa-20260711e/.test(index) &&
    /app\.js\?v=pr13-live-qa-20260711e/.test(index) &&
    !/full-audit-20260701|browser-comments-20260702/.test(index),
  "Browser-visible app and stylesheet entry points must use the current cache-buster key.",
);

console.log(JSON.stringify({ status: "ok", assertions: 56 }, null, 2));
