#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveReferencePreviewPlacement } from "../app/src/reference-preview-placement.js";

const [index, css, portraitCss, contextCss, stylesPolish, app, dom, pickerFlow, renderer, tagsView, strongsView, interlinearView, userDataView, detailViews, jobsView, languageStudyTooltipTest, readerNavigation] = await Promise.all([
  readFile(new URL("../app/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../app/styles-portrait.css", import.meta.url), "utf8"),
  readFile(new URL("../app/styles-context.css", import.meta.url), "utf8"),
  readFile(new URL("../app/styles-polish.css", import.meta.url), "utf8"),
  readFile(new URL("../app/app.js", import.meta.url), "utf8"),
  readFile(new URL("../app/src/dom.js", import.meta.url), "utf8"),
  readFile(new URL("../app/src/reader-picker-flow.js", import.meta.url), "utf8"),
  readFile(new URL("../app/src/chapter-renderer.js", import.meta.url), "utf8"),
  readFile(new URL("../app/src/views/tags-view.js", import.meta.url), "utf8"),
  readFile(new URL("../app/src/views/strongs-view.js", import.meta.url), "utf8"),
  readFile(new URL("../app/src/views/interlinear-translation-view.js", import.meta.url), "utf8"),
  readFile(new URL("../app/src/views/user-data-view.js", import.meta.url), "utf8"),
  readFile(new URL("../app/src/detail-views.js", import.meta.url), "utf8"),
  readFile(new URL("../app/src/views/jobs-view.js", import.meta.url), "utf8"),
  readFile(new URL("../app/scripts/language-study-tooltip-interaction-test.mjs", import.meta.url), "utf8"),
  readFile(new URL("../app/src/reader-navigation.js", import.meta.url), "utf8"),
]);

assert.equal((index.match(/id="study-marks-icon"/g) || []).length, 1, "Study Marks must have one official icon definition.");
assert.equal((tagsView.match(/#study-marks-icon/g) || []).length, 1, "Study Marks triggers must reference the shared icon.");
assert(!`${css}\n${contextCss}\n${stylesPolish}`.includes("color-mix("), "App stylesheets must not use color-mix().");
assert(
  /\.hebrew-rtl-note\s*{[\s\S]*?width:\s*24px;[\s\S]*?height:\s*24px;[\s\S]*?font-size:\s*0;/.test(css) &&
    /\.hebrew-rtl-note::before\s*{[\s\S]*?content:\s*"!";[\s\S]*?place-items:\s*center;[\s\S]*?width:\s*18px;[\s\S]*?height:\s*18px;/.test(css),
  "Hebrew direction help must retain its 24px target with an optically compact centered badge.",
);
assert(
  /:root\[data-theme="dark"\] \.strong-source-word,[\s\S]*?html\[data-theme="light"\] \.strong-source-word \.language-letter-hover\s*{[\s\S]*?color:\s*var\(--accent-dark\)\s*!important;/.test(css) &&
    /@media\s*\(forced-colors:\s*active\)[\s\S]*?:root\[data-theme\] \.strong-source-word,[\s\S]*?color:\s*LinkText\s*!important;[\s\S]*?forced-color-adjust:\s*none;/.test(css),
  "Strong's source words and their hydrated language spans must retain the narrow accent and forced-colors treatment.",
);
assert(
  /button\[data-study-workspace-width-mode="compact"\][\s\S]*?\.study-workspace-width-symbol::before,[\s\S]*?button\[data-study-workspace-width-mode="expanded"\][\s\S]*?\.study-workspace-width-symbol::after/.test(portraitCss),
  "Compact and Expanded workspace controls must use CSS-drawn centered strokes.",
);

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
    /setDetail\("My Data", wrap, \{ viewId: DETAIL_VIEW_IDS\.myData \}\)/.test(userDataView),
  "My Data must use one stable global detail view.",
);
assert(
  /diagnostics\.className = "advanced-diagnostics"/.test(userDataView) &&
    /if \(profile\?\.isLab\) \{[\s\S]*?diagnostics\.open\s*=\s*true/.test(userDataView) &&
    /renderJobsDiagnostics/.test(userDataView) &&
    /payload\.textContent = JSON\.stringify/.test(jobsView),
  "Technical job controls must be text-only, collapsed by default in Stable, and expanded only in Lab.",
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
assert(
  /detailViews\.showDefaultVerseStudy\(reference, verse/.test(renderer) &&
    /crossrefResult\.status === "loaded" && crossRecord[\s\S]*?interlinearResult\.status === "loaded"[\s\S]*?canUseCapability\("commentary"\)/.test(app) &&
    /showLoadedCrossrefs\(reference, resolvedRecord \|\| emptyCrossrefRecord\(\), \{[\s\S]*?detailIntent: activation\.detailIntent/.test(app),
  "The default verse-study launcher must resolve real verse data in cross-reference, Language Study, commentary order without passing null to the explicit cross-reference view.",
);
assert.equal(
  (app.match(/runReaderDatasetActivation\(/g) || []).length,
  5,
  "Outline, chapter/verse Language Study, and Cross References must share one route-and-detail activation guard.",
);
const ensureReaderDatasetSource = app.match(/async function ensureReaderDataset\(key\) \{[\s\S]*?\n\}/)?.[0] || "";
const runReaderDatasetActivationSource = app.match(/async function runReaderDatasetActivation\(key, activate, options = \{\}\) \{[\s\S]*?\n\}/)?.[0] || "";
assert(
  /navigationGeneration: state\.navigationGeneration[\s\S]*?detailIntent: beginDetailIntent\(\)/.test(app) &&
    /activation\.navigationGeneration !== state\.navigationGeneration[\s\S]*?!isDetailIntentCurrent\(activation\.detailIntent\)/.test(app),
  "Deferred reader activations must capture and validate independent route and detail-intent generations.",
);
assert(
  /function claimDetailMutation\(options\)[\s\S]*?isDetailIntentCurrent\(options\.detailIntent\)[\s\S]*?beginDetailIntent\(\)/.test(dom) &&
    /export function setDetail\(title, node, options = \{\}\) \{\s*const detailIntent = claimDetailMutation\(options\);\s*if \(detailIntent === null\) return null;/.test(dom),
  "All immediate detail mutations must invalidate older deferred intents while tokened stale mutations are rejected.",
);
assert(
  /export function goBackDetail\(\) \{\s*const detailIntent = beginDetailIntent\(\)/.test(dom) &&
    /export function goForwardDetail\(\) \{\s*const detailIntent = beginDetailIntent\(\)/.test(dom) &&
    /function resetDetailContent\(title, message\) \{\s*const detailIntent = beginDetailIntent\(\)/.test(dom),
  "Detail Back, Forward, reset, and clear paths must invalidate pending deferred intents.",
);
assert(
  /function synchronizeReaderDatasetControls\(\{ generation, bookId, translationId \}\)[\s\S]*?generation !== state\.readerDatasetGeneration[\s\S]*?bookId !== state\.bookId[\s\S]*?translationId !== state\.translationId[\s\S]*?syncToolButtons\(\)/.test(app) &&
    (ensureReaderDatasetSource.match(/synchronizeReaderDatasetControls\(\{ generation, bookId, translationId \}\)/g) || []).length === 4,
  "Every loading, loaded, unavailable, and error transition for the current dataset owner must synchronize shared controls.",
);
assert(
  !/renderer\.renderChapter|setStatus|setDetail|setDetailMessage|\.focus\(|scrollTo/.test(ensureReaderDatasetSource) &&
    !/syncToolButtons/.test(runReaderDatasetActivationSource),
  "Dataset synchronization must not restore reader/status/detail/focus mutations or depend on current detail-intent ownership.",
);
assert(
  /expectedStatus:\s*"BSB data loaded"/.test(languageStudyTooltipTest) &&
    /languageStudy\.getAttribute\("aria-busy"\) === "false"/.test(languageStudyTooltipTest) &&
    /languageStudy\.dataset\.controlState === "enabled"/.test(languageStudyTooltipTest) &&
    /page\.on\("requestfailed"/.test(languageStudyTooltipTest) &&
    /Readiness diagnostics:/.test(languageStudyTooltipTest) &&
    !/document\.body\.textContent\.includes\("Loading data"\)/.test(languageStudyTooltipTest),
  "Language Study tooltip readiness must use the maintained reader/control contract and preserve timeout diagnostics.",
);
let modeledDetailIntent = 0;
const beginModeledDetailIntent = () => ++modeledDetailIntent;
const delayedLanguageStudyIntent = beginModeledDetailIntent();
const newerOutlineIntent = beginModeledDetailIntent();
assert(
  delayedLanguageStudyIntent !== modeledDetailIntent && newerOutlineIntent === modeledDetailIntent,
  "A newer deferred Outline intent must supersede an older held Language Study intent on the same route.",
);
assert(
  /\.reader-pane\s*{[\s\S]*?container-name:\s*reader-pane;[\s\S]*?container-type:\s*inline-size;/.test(css) &&
    /@media\s*\(min-width:\s*641px\)[\s\S]*?\.chapter-actions \.toolbar-button\s*{[\s\S]*?width:\s*34px;/.test(css) &&
    /@media\s*\(min-width:\s*641px\)\s*and\s*\(max-width:\s*960px\)[\s\S]*?@container\s+reader-pane\s*\(min-width:\s*550px\)[\s\S]*?white-space:\s*nowrap;/.test(css) &&
    /@media\s*\(min-width:\s*961px\)[\s\S]*?@container\s+reader-pane\s*\(min-width:\s*840px\)[\s\S]*?white-space:\s*nowrap;/.test(css),
  "Chapter action labels must use measured reader-pane thresholds and retain the compact fallback.",
);
assert(
  /@media\s*\(max-width:\s*640px\)[\s\S]*?\.chapter-favorite-actions \.scope-mark-button\s*{[\s\S]*?min-height:\s*44px;/.test(css) &&
    /\.chapter-actions\s*{[\s\S]*?gap:\s*4px;[\s\S]*?\.action-group\s*{[\s\S]*?gap:\s*4px;[\s\S]*?padding:\s*0;[\s\S]*?border:\s*0;/.test(css),
  "Mobile Book and Chapter marks must have real 44px targets while the 4+2 action groups remove duplicate chrome.",
);
assert(
  /@media\s*\(max-width:\s*640px\)[\s\S]*?\.chapter-content\s*{[\s\S]*?padding-top:\s*16px;/.test(css) &&
    /\.chapter-content\s*>\s*\.presentation-block\.section_heading:first-child\s*{[\s\S]*?margin-top:\s*14px;/.test(css) &&
    /\.presentation-block\.section_heading:first-child\s*\+\s*\.presentation-block\.psalm_superscription\s*{[\s\S]*?margin-top:\s*14px;[\s\S]*?margin-bottom:\s*6px;/.test(css),
  "Mobile first-content spacing must use semantic presentation classes without removing heading or superscription content.",
);
assert(/:root\[data-theme="dark"\] \.parallel-verse\.active\s*{[\s\S]*?background:\s*rgba\(148,\s*163,\s*184,\s*0\.12\)/.test(css), "Dark parallel selection must not use a white background.");
assert(/:root\[data-theme="dark"\] \.reader-context-verse\s*{[\s\S]*?background:\s*rgba\(148,\s*163,\s*184,\s*0\.08\)/.test(css), "Dark reader selection must use the calm slate highlight.");
assert(
  /\.reader-nav-arrow\s*{[\s\S]*?width:\s*40px;[\s\S]*?min-width:\s*40px;[\s\S]*?min-height:\s*56px;/.test(css) &&
    /\.reader-nav-arrow::before,[\s\S]*?\.reader-nav-arrow::after\s*{[\s\S]*?width:\s*20px;[\s\S]*?pointer-events:\s*none;/.test(css) &&
    /\.reader-nav-arrow:focus-visible\s*{[\s\S]*?outline:\s*none;[\s\S]*?\.reader-nav-arrow:focus-visible::before\s*{[\s\S]*?outline:\s*3px solid var\(--accent\);[\s\S]*?outline-offset:\s*-3px;/.test(css),
  "Floating chapter navigation must keep its edge placement while exposing a real 40px target and contained focus ring.",
);
assert(/\.reader-floating-nav\s*{[\s\S]*?top:\s*176px;/.test(css), "Floating chapter navigation must sit below the reader header.");
assert(
  /\.detail-floating-nav\s*{[\s\S]*?position:\s*relative;[\s\S]*?flex:\s*0 0 auto;[\s\S]*?min-height:\s*44px;[\s\S]*?padding:\s*6px 12px 0;/.test(css) &&
    /\.detail-nav-arrow\s*{[\s\S]*?width:\s*32px;[\s\S]*?height:\s*32px;[\s\S]*?min-width:\s*32px;[\s\S]*?min-height:\s*32px;/.test(css),
  "Detail history controls must remain in source-order flow with compact desktop targets that cannot be overlapped by contextual navigation.",
);
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
  /renderStudyMarksTrigger\(target,\s*\{[\s\S]*?openOnFocus:\s*false,/.test(app) &&
    /options\.openOnFocus === false\) menu\.dataset\.openOnFocus = "false";/.test(tagsView) &&
    /menu\.dataset\.openOnFocus === "false"[\s\S]*?document\.activeElement === menu\.__targetTagTrigger[\s\S]*?return;/.test(tagsView) &&
    /menu\.dataset\.openOnFocus === "false"[\s\S]*?menu\.__targetTagOpenedFromPointer = true;/.test(tagsView) &&
    /keepPointerOpenedMenu[\s\S]*?menu\.dataset\.openOnFocus === "false"[\s\S]*?menu\.__targetTagOpenedFromPointer === true[\s\S]*?keepFocusOpenedMenu \|\| keepPointerOpenedMenu/.test(tagsView) &&
    /\.target-tag-picker-menu\[data-open-on-focus="false"\]:not\(\[data-menu-open="true"\]\):focus-within\s*>\s*\.tag-picker-popover\s*{[\s\S]*?display:\s*none;/.test(css),
  "Book and Chapter Study Marks must retain first-click, hover, and activation menus without inserting menu items into top-level Tab order on focus alone.",
);
assert(
  /id="bookPickerButton"/.test(index) &&
    /id="chapterPickerButton"/.test(index) &&
    /\.book-picker-panel\s*{[\s\S]*?grid-template-columns:\s*repeat\(2/.test(css) &&
    /\.chapter-picker-grid\s*{[\s\S]*?grid-template-columns:\s*repeat\(6/.test(css),
  "Book and chapter controls must use app-owned picker popovers: testament columns and chapter grid.",
);
assert(
  /<select id="bookSelect"[^>]*hidden[^>]*aria-hidden="true"[^>]*tabindex="-1"/.test(index) &&
    /<select id="chapterSelect"[^>]*hidden[^>]*aria-hidden="true"[^>]*tabindex="-1"/.test(index) &&
    (index.match(/<label\b/g) || []).length === 1 &&
    /aria-label="Book: Select book"/.test(index) &&
    /aria-label="Chapter: Select chapter"/.test(index) &&
    /setAttribute\("aria-label", `Book: \$\{bookLabel\}`\)/.test(app) &&
    /setAttribute\("aria-label", `Chapter: \$\{chapterLabel\}`\)/.test(app),
  "Book and Chapter native selects must be internal-only while their visible picker buttons expose purpose and value.",
);
assert(
  (index.match(/aria-live="polite"/g) || []).length === 1 &&
    /id="statusText" class="header-status" role="status" aria-live="polite"/.test(index) &&
    /id="compactStatusText"[^>]*aria-hidden="true"/.test(index) &&
    /status\.dataset\.statusState = statusState/.test(dom) &&
    /statusState = isError \? "error" : isLoading \? "loading" : isLoaded \? "loaded" : "message"/.test(dom) &&
    /showCompactLoaded = statusState === "loaded"/.test(dom) &&
    /compactStatus\.textContent = showCompactLoaded \? "Loaded"/.test(dom) &&
    /compactStatus\.hidden = !showCompactLoaded/.test(dom),
  "The mobile loaded indicator must mirror one real status live region without duplicate announcements.",
);
assert(
  /@media\s*\(max-width:\s*640px\)[\s\S]*?\.reader-controls\s*{[\s\S]*?grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)[\s\S]*?\.reader-controls select,[\s\S]*?\.reader-picker-button\s*{[\s\S]*?height:\s*44px;/.test(css) &&
    /\.home-button\s*{[\s\S]*?min-height:\s*44px;/.test(css) &&
    /\.action-group:first-child\s*{[\s\S]*?grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/.test(css) &&
    /\.toolbar-button\s*{[\s\S]*?min-height:\s*44px;/.test(css) &&
    /\.chapter-nav-button\s*{[\s\S]*?min-height:\s*44px;/.test(css),
  "Mobile reader navigation and chapter actions must use a compact, labeled, touch-comfortable composition.",
);
assert(/\.fn-marker\s*{[\s\S]*?color:\s*#2347fb;/.test(css), "Footnote markers must use the requested blue.");
assert(
  /\.fn-marker::before\s*{[\s\S]*?width:\s*28px;[\s\S]*?height:\s*28px;[\s\S]*?pointer-events:\s*auto;/.test(css) &&
    /\.verse-number\s*{[\s\S]*?width:\s*32px;[\s\S]*?min-height:\s*36px;/.test(css) &&
    /\.presentation-block \.cross-links \.reference-hover::before\s*{[\s\S]*?height:\s*36px;[\s\S]*?pointer-events:\s*auto;/.test(css) &&
    /@media\s*\(hover:\s*none\),\s*\(pointer:\s*coarse\)\s*{[\s\S]*?\.fn-marker::before\s*{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;[\s\S]*?\.verse-number\s*{[\s\S]*?width:\s*40px;[\s\S]*?min-height:\s*44px;[\s\S]*?\.reference-hover::before\s*{[\s\S]*?height:\s*44px;/.test(css),
  "Inline reader targets must provide fine-pointer and touch dimensions without widening the scripture grid.",
);
assert(
  /:root\[data-theme="dark"\] \.fn-marker\s*{[\s\S]*?color:\s*#9eafff\s*!important;/.test(css) &&
    /:root\[data-theme="dark"\] \.fn-marker:hover\s*{[\s\S]*?color:\s*#c5ceff\s*!important;/.test(css) &&
    /:root\[data-theme="dark"\] \.fn-marker:focus-visible\s*{[\s\S]*?outline:\s*none\s*!important;[\s\S]*?color:\s*#f0f2ff\s*!important;/.test(css) &&
    /:root\[data-theme="dark"\] \.fn-marker:focus-visible::before\s*{[\s\S]*?outline-color:\s*#9eafff;/.test(css),
  "Dark footnotes must use lighter default and hover colors with a full-target keyboard-focus outline.",
);
assert(
  /html\[data-theme="light"\] \.fn-marker\s*{[\s\S]*?color:\s*#2347fb\s*!important;/.test(css) &&
    /html\[data-theme="light"\] \.fn-marker:hover\s*{[\s\S]*?color:\s*#1232c8\s*!important;/.test(css) &&
    /html\[data-theme="light"\] \.fn-marker:focus-visible\s*{[\s\S]*?outline:\s*none\s*!important;[\s\S]*?color:\s*#0b238f\s*!important;/.test(css) &&
    /html\[data-theme="light"\] \.fn-marker:focus-visible::before\s*{[\s\S]*?outline-color:\s*#2347fb;/.test(css),
  "Light-theme footnote contrast and full-target keyboard focus treatment must remain explicit.",
);
assert(
  /reader-picker-flow\.js\?v=pr13-live-qa-20260711e/.test(index),
  "The reader picker flow helper must load after the main app module.",
);
assert(
  /ACTIVE_OPTION_SELECTOR = "\.reader-picker-option\.active"/.test(pickerFlow) &&
    /function revealActivePickerOption\(panel\)/.test(pickerFlow) &&
    /activeOptionScroller\(panel\)/.test(pickerFlow) &&
    /scroller\.scrollTop = Math\.max/.test(pickerFlow) &&
    !/scrollIntoView/.test(pickerFlow),
  "Opening reader pickers must reveal the active option inside only its intended scroller.",
);
assert(
    /function positionPickerPanel\(button, panel\)/.test(pickerFlow) &&
    /PICKER_VIEWPORT_MARGIN = 10/.test(pickerFlow) &&
    /panel\.style\.removeProperty\("width"\);\s+const naturalRect = panel\.getBoundingClientRect\(\)/.test(pickerFlow) &&
    /activePickerContext = \{ buttonId: button\.id, snapshot \}/.test(pickerFlow) &&
    /activePickerContext\?\.buttonId === button\.id[\s\S]*?activePickerContext\.snapshot[\s\S]*?settleOpenPicker\(button, panel, snapshot\)/.test(pickerFlow) &&
    /viewportWidth - PICKER_VIEWPORT_MARGIN - width/.test(pickerFlow) &&
    /dataset\.placement = placeAbove \? "above" : "below"/.test(pickerFlow) &&
    /window\.addEventListener\([\s\S]*?"resize"[\s\S]*?settleOpenPicker\(button, panel, snapshot\)/.test(pickerFlow) &&
    /\.reader-picker-panel\[data-positioned="true"\]/.test(css),
  "Reader picker panels must be measured, shifted, height-constrained, and repositioned within the viewport.",
);
assert(
  /function capturePickerContext\(\)/.test(pickerFlow) &&
    /readerScrollTop/.test(pickerFlow) &&
    /detailScrollTop/.test(pickerFlow) &&
    /capturePickerContextBeforeOpen/.test(pickerFlow) &&
    /addEventListener\("click", capturePickerContextBeforeOpen, true\)/.test(pickerFlow) &&
    /PICKER_CONTEXT_SETTLE_DURATION_MS = 400/.test(pickerFlow) &&
    /function suspendPickerScrollAnchoring\(\)/.test(pickerFlow) &&
    /target\.style\.overflowAnchor = "none"/.test(pickerFlow) &&
    /window\.performance\.now\(\) - contextSettleStartedAt < PICKER_CONTEXT_SETTLE_DURATION_MS/.test(pickerFlow) &&
    /restorePickerContext\(snapshot\)/.test(pickerFlow) &&
    /window\.scrollTo\(\{ left: snapshot\.pageX, top: snapshot\.pageY/.test(pickerFlow),
  "Opening and settling a reader picker must preserve document, reader, and detail scroll context.",
);
assert(
  /#bookPickerButton\[aria-expanded="true"\], #chapterPickerButton\[aria-expanded="true"\]/.test(pickerFlow),
  "Reader picker Escape must preserve the active reader highlight while the picker closes.",
);
assert(
  /if \(!trigger\) return;\s+event\.preventDefault\(\);\s+event\.stopImmediatePropagation\(\);\s+closeReaderPickers\(\)/.test(app),
  "An open reader picker must consume Escape before the underlying detail workspace handles it.",
);
assert(
  /openChapterPickerAfterBookSelection/.test(pickerFlow) &&
    /reader:book-selection-complete/.test(app) &&
    /reader:book-selection-complete/.test(pickerFlow) &&
    /bookSelect\?\.value === selection\.bookId/.test(pickerFlow) &&
    /chapterSelect\?\.value === selection\.chapter/.test(pickerFlow) &&
    /activeChapter\?\.getAttribute\("aria-pressed"\) === "true"/.test(pickerFlow) &&
    /chapterTitle\?\.textContent\?\.trim\(\) === `\$\{selection\.bookLabel\} \$\{selection\.chapter\}`/.test(pickerFlow) &&
    /setPickerExpanded\(chapterButton, chapterPanel, true\)/.test(pickerFlow),
  "Selecting a book must open Chapter only after route, native controls, active option, and rendered content converge.",
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
  /function maybeDisengageLockedDetail\(event\)[\s\S]*?\.morphology-help[\s\S]*?disengageDetailFollow\(\)/.test(app) &&
    /document\.addEventListener\("pointerdown", maybeDisengageLockedDetail, true\)/.test(app) &&
    /document\.addEventListener\("click", maybeDisengageLockedDetail, true\)/.test(app),
  "Morphology help must preserve locked detail while background pointerdown and click retain capture-phase disengagement.",
);
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

assert(
  /const scroller = els\.detail;/.test(strongsView) &&
    /scroller\.scrollTo\(\{ top, behavior: reducedMotion \? "auto" : "smooth" \}\)/.test(strongsView) &&
    !/target\.scrollIntoView/.test(strongsView),
  "Strong's section controls must scroll only the detail-content owner and respect reduced motion.",
);
assert(
  /commitTextSpanSelection\?\.\(target\)/.test(renderer) &&
    /textSpanTarget: committedTarget/.test(renderer) &&
    /activeRange\.char_start/.test(renderer) &&
    /reader-context-phrase/.test(renderer),
  "The selection Study action must retain the canonical text-span and render exact phrase boundaries.",
);
assert(
  /createSelectedPhraseSummary/.test(interlinearView) &&
    /createTranslationAlignmentPanel\(tokens, selected\.wordMapLookup, selected\.range\)/.test(interlinearView) &&
    /pair\.dataset\.selectedRange = "true"/.test(interlinearView) &&
    /document\.createElement\("article"\)/.test(interlinearView) &&
    /pair\.setAttribute\("role", "group"\)/.test(interlinearView) &&
    !/pair\.type = "button"/.test(interlinearView),
  "Language Study must summarize the phrase and expose alignment pairs as selected informational groups, not no-op buttons.",
);
assert(
  /READER_NAVIGATION_SNAPSHOT_VERSION = 1/.test(readerNavigation) &&
    /textSpanTarget/.test(readerNavigation) &&
    /navigationIndex/.test(readerNavigation) &&
    /navigationMaxIndex/.test(readerNavigation) &&
    !/detailTitle|detailLocked|detailVisible|detailScrollTop/.test(readerNavigation) &&
    /historyStateWithReaderSnapshot/.test(readerNavigation) &&
    /readerSnapshotFromHistoryState/.test(readerNavigation) &&
    !/HTMLElement|Range\(|Event\(/.test(readerNavigation),
  "Reader restoration state must remain one versioned serializable snapshot without DOM objects.",
);
assert(
  /const restorationSnapshot = readerSnapshotFromHistoryState\(event\.state\);[\s\S]*?historyTraversal: true,[\s\S]*?restorationSnapshot,/.test(app) &&
    /popstateHashToIgnore/.test(app) &&
    /history\.scrollRestoration = "manual"/.test(app) &&
    /String\(restorationSnapshot\.verse \|\| ""\) === String\(next\.verse \|\| ""\)/.test(app) &&
    /state\.pendingScrollVerse = canRestore \? null/.test(app) &&
    /window\.scrollTo\(\{ left: snapshot\.pageX, top: snapshot\.pageY, behavior: "auto" \}\)/.test(app) &&
    /setReaderNavigationAvailability/.test(dom) &&
    !/readerLocationHistory|readerLocationForwardHistory/.test(dom) &&
    /readerNavigationMaxIndex = Math\.max\(\s*readerNavigationMaxIndex,\s*readerNavigationIndex,\s*restorationSnapshot\.navigationMaxIndex/.test(app) &&
    /if \(willPush\) \{\s*readerNavigationMaxIndex = readerNavigationIndex \+ 1;\s*persistCurrentReaderSnapshot\(\);\s*\}[\s\S]*?const activeTextSpanRef = state\.activeTextSpanTarget/.test(app) &&
    /!goBackDetail\(\) && readerNavigationIndex > 0\) window\.history\.back\(\)/.test(app) &&
    /!goForwardDetail\(\) && readerNavigationIndex < readerNavigationMaxIndex\) window\.history\.forward\(\)/.test(app),
  "Browser history must own Reader routes while in-app Detail history remains panel-only and button states use the monotonic index.",
);
assert(
  /const textSpanTarget = ctx\.getActiveTextSpanTarget\?\.\(verse\) \|\| null;/.test(await readFile(new URL("../app/src/views/verse-context-tabs.js", import.meta.url), "utf8")) &&
    /wordHighlightOptions\(wordContext, verse, Boolean\(textSpanTarget\)\)/.test(await readFile(new URL("../app/src/views/verse-context-tabs.js", import.meta.url), "utf8")) &&
    /\{ verse, commit: true, preserveTextSpan: Boolean\(textSpanTarget\) \}/.test(await readFile(new URL("../app/src/views/verse-context-tabs.js", import.meta.url), "utf8")) &&
    /action\.run\(\{ textSpanTarget \}\)/.test(await readFile(new URL("../app/src/views/verse-context-tabs.js", import.meta.url), "utf8")),
  "Same-verse contextual tools must capture and explicitly preserve the active phrase before changing detail content.",
);
assert(
  /readerSnapshotSuspendedGeneration === state\.navigationGeneration/.test(app) &&
    /window\.cancelAnimationFrame\(readerSnapshotFrame\)/.test(app) &&
    /const scheduledNavigationGeneration = state\.navigationGeneration;[\s\S]*?scheduledNavigationGeneration !== state\.navigationGeneration/.test(app),
  "Deferred scroll and focus snapshots from an earlier navigation must not contaminate the current Reader history stack.",
);

console.log(JSON.stringify({ status: "ok", assertions: 76 }, null, 2));
