#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [index, styles, flow, strongReferenceControl, app, interlinearView, emptyState, dom] = await Promise.all([
  readFile(new URL("../app/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/styles-polish.css", import.meta.url), "utf8"),
  readFile(new URL("../app/src/original-language-study-flow.js", import.meta.url), "utf8"),
  readFile(new URL("../app/src/strong-reference-control.js", import.meta.url), "utf8"),
  readFile(new URL("../app/app.js", import.meta.url), "utf8"),
  readFile(new URL("../app/src/views/interlinear-translation-view.js", import.meta.url), "utf8"),
  readFile(new URL("../app/src/study-empty-state.js", import.meta.url), "utf8"),
  readFile(new URL("../app/src/dom.js", import.meta.url), "utf8"),
]);

assert(
  /id="showInterlinear"[\s\S]*?title="Original language study"[\s\S]*?>Language Study</.test(index),
  "The side-panel tool must present the feature as Language Study.",
);
assert(
  /original-language-study-flow\.js\?v=pr13-live-qa-20260711e/.test(index),
  "The original-language study enhancement module must load after the app modules.",
);
assert(
  /INTERLINEAR_DETAIL_TITLE = "Language Study"/.test(flow) &&
    !/setDetail(?:Message)?\(\s*"Interlinear"/.test(interlinearView) &&
    /setDetail(?:Message)?\(\s*"Language Study"/.test(interlinearView) &&
    !/No interlinear data found/.test(interlinearView) &&
    /No Language Study data found/.test(interlinearView) &&
    !/Interlinear (?:words|data is not available)/.test(app) &&
    /"Language Study"/.test(app) &&
    /"Language Study data is not available for this chapter\."/u.test(app) &&
    /interlinear:\s*{[\s\S]*?title:\s*"Language Study"[\s\S]*?heading:\s*"Language Study data is not included/.test(emptyState) &&
    /detailTitle\?\.textContent === "Language Study"/.test(dom),
  "Visible detail, picker, empty, unavailable, and pressed-state text must use Language Study.",
);
assert(
  /createRelatedEntryControl/.test(flow) &&
    /language-study:open-strong/.test(flow) &&
    /createStrongReferenceControl/.test(flow) &&
    /pointerenter/.test(strongReferenceControl) && /focus/.test(strongReferenceControl) && /pointerdown/.test(strongReferenceControl) &&
    /\^\[HG\]/.test(strongReferenceControl),
  "Source-backed Hebrew and Greek Strong's relations must preview and navigate through app-controlled controls.",
);
assert(
  /\.interlinear-lazy-reader > \.verse-context-tabs\s*{[\s\S]*?position:\s*sticky;/.test(styles) &&
    /\.original-language-verse-reference\s*{[\s\S]*?position:\s*sticky;[\s\S]*?background:\s*var\(--panel-alt\);/.test(styles),
  "Context tabs and full verse references must remain sticky with opaque themed backgrounds.",
);
assert(
  /\.interlinear-token\.original-language-word-card\s*{[\s\S]*?width:\s*100%;/.test(styles) &&
    /\.original-language-word-summary,[\s\S]*?\.original-language-word-source\s*{[\s\S]*?width:\s*100%;/.test(styles) &&
    /\.original-language-word-origin\s*{[\s\S]*?width:\s*100%;/.test(styles),
  "Cards and their direct visual sections must fill the available grid track width.",
);
assert(
  /data-service\.js\?v=pr13-live-qa-20260711e/.test(flow),
  "The study flow must version the original-language source data contract.",
);
assert(
  /function enhanceVerseSection\(section\)/.test(flow) &&
    /function decorateSourceList\(sourceList, tokenList\)/.test(flow) &&
    /Original Hebrew/.test(flow) &&
    /Original Greek/.test(flow) &&
    /Original.*source text unavailable/.test(flow) &&
    /Transliteration/.test(flow) &&
    !/Full source verse/.test(flow) &&
    /Word-by-word study/.test(flow) &&
    /original-language-word-card/.test(flow),
  "The study flow must distinguish source script, unavailable states, transliteration, and word-level cards.",
);
assert(
  /function enhanceWordCard\(card\)/.test(flow) &&
    /original-language-word-summary/.test(flow) &&
    /original-language-word-source/.test(flow) &&
    /Word origin/.test(flow) &&
    /Related Hebrew entries/.test(flow) &&
    /Related Greek entries/.test(flow) &&
    /summary[\s\S]*source/.test(flow),
  "Word cards must place meaning before accurately labeled source/transliteration and lexical context.",
);
assert(
  /setTransliterationTextWithTooltips/.test(flow) &&
    /sourceLabel:\s*"Bundled interlinear transliteration"/.test(flow),
  "Verse and word transliterations must use the accessible bundled-source annotation treatment.",
);
assert(
  /const originText = String\(entry\.word_origin/.test(flow) &&
    /Array\.isArray\(entry\.word_origin_refs\)/.test(flow) &&
    /if \(!originText && !related\.length\) return;/.test(flow),
  "Origin and related-entry sections must be omitted unless explicit lexicon fields supply them.",
);
assert(
  /MutationObserver\(queueStudyEnhancement\)/.test(flow) &&
    /\.interlinear-verse-section/.test(flow),
  "Lazy-loaded and restored interlinear verses must receive the study-card enhancement.",
);
assert(
  /\.original-language-verse-card\s*{[\s\S]*?display:\s*grid;/.test(styles) &&
    /\.original-language-word-grid\s*{[\s\S]*?grid-template-columns:\s*repeat\(auto-fit, minmax\(min\(100%, 220px\), 1fr\)\);/.test(styles),
  "Original-language verse and word cards must use responsive grid layouts.",
);
assert(
  /@media\s*\(max-width:\s*768px\)[\s\S]*?\.original-language-word-grid\s*{[\s\S]*?grid-template-columns:\s*1fr;/.test(styles),
  "Original-language word cards must collapse to one column on narrow screens.",
);

console.log(JSON.stringify({ status: "ok", assertions: 13 }, null, 2));
