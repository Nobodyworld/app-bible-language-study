#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

async function read(relativePath) {
  return readFile(join(appRoot, relativePath), "utf8");
}

function fail(message, details = {}) {
  const error = new Error(message);
  error.details = details;
  throw error;
}

function assert(condition, message, details = {}) {
  if (!condition) fail(message, details);
}

function countMatches(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

function staticButtons(html) {
  return [...html.matchAll(/<button\b[\s\S]*?<\/button>/gi)].map((match) => match[0]);
}

function textContent(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAccessibleButtonName(buttonHtml) {
  return /\baria-label\s*=/.test(buttonHtml) || /\btitle\s*=/.test(buttonHtml) || textContent(buttonHtml).length > 0;
}

function checkIndex(indexHtml) {
  assert(/<html\s+[^>]*lang="en"/i.test(indexHtml), "Document must declare html lang.");
  assert(/<meta\s+name="viewport"/i.test(indexHtml), "Document must declare responsive viewport metadata.");
  assert(/<header\b/i.test(indexHtml) && /<main\b/i.test(indexHtml) && /<aside\b/i.test(indexHtml), "Document must expose header, main, and aside landmarks.");
  assert(/<nav\b[^>]*aria-label="Reader controls"/i.test(indexHtml), "Reader controls nav must have an accessible label.");
  assert(/<section\b[^>]*aria-label="Bible reader"/i.test(indexHtml), "Reader pane must have an accessible label.");
  assert(/<aside\b[^>]*aria-label="Reference details"/i.test(indexHtml), "Detail pane must have an accessible label.");
  assert(
    /<label\s+class="reader-control reader-control-translation">[\s\S]*?<span>Translation<\/span>[\s\S]*?<select id="translationSelect"/.test(indexHtml),
    "The exposed Translation selector must retain a visible label.",
  );
  assert(
    /id="bookPickerLabel"[^>]*>Book<\/span>[\s\S]*?id="bookSelect"[^>]*hidden[^>]*aria-hidden="true"[^>]*tabindex="-1"[\s\S]*?id="bookPickerButton"[^>]*aria-label="Book: Select book"/.test(indexHtml) &&
      /id="chapterPickerLabel"[^>]*>Chapter<\/span>[\s\S]*?id="chapterSelect"[^>]*hidden[^>]*aria-hidden="true"[^>]*tabindex="-1"[\s\S]*?id="chapterPickerButton"[^>]*aria-label="Chapter: Select chapter"/.test(indexHtml),
    "Book and Chapter must use visible control labels while their synchronized native selectors stay outside Tab and accessibility navigation.",
  );
  const buttons = staticButtons(indexHtml);
  const unnamed = buttons.filter((button) => !hasAccessibleButtonName(button));
  assert(unnamed.length === 0, "Static buttons must have visible text, title, or aria-label.", { unnamed });
  assert(/id="prevChapterFloat"[\s\S]*aria-label="Previous chapter"/.test(indexHtml), "Floating previous chapter button must distinguish Bible navigation.");
  assert(/id="detailBack"[\s\S]*aria-label="Panel history back"/.test(indexHtml), "Detail history back button must distinguish panel navigation.");
  assert((indexHtml.match(/id="showMyData"/g) || []).length === 1, "Header must expose exactly one My Data control.");
  assert(!/id="showJobs"|id="showUserData"/.test(indexHtml), "Legacy Processing and Study Data controls must be removed.");
  return {
    staticButtons: buttons.length,
    labeledControls: (indexHtml.match(/<(?:label|div) class="reader-control(?:\s|")/g) || []).length,
    landmarks: ["header", "main", "aside", "nav", "section"],
  };
}

function checkMyData(source) {
  assert(/heading\.textContent = "My Data"/.test(source), "My Data panel must have a top-level visible heading.");
  assert(/setAttribute\("role", "alertdialog"\)/.test(source), "Replace confirmation must expose alertdialog semantics.");
  assert(/setAttribute\("aria-modal", "true"\)/.test(source), "Replace confirmation must be modal to assistive technology.");
  assert(/setAttribute\("aria-labelledby", "replace-confirmation-title"\)/.test(source), "Replace confirmation must have an accessible name.");
  assert(/event\.key === "Escape"/.test(source), "Replace confirmation must support Escape cancellation.");
  assert(/cancel\.focus\(\)/.test(source) && /target\?\.focus\(\)/.test(source), "Replace confirmation must move and restore focus.");
  assert(/event\.key !== "Tab"/.test(source), "Replace confirmation must contain keyboard focus.");
  return { namedDialog: true, escapeCancel: true, containedFocus: true, restoredFocus: true };
}

function checkCss(css) {
  const focusVisibleCount = countMatches(css, /:focus-visible/g);
  assert(focusVisibleCount >= 10, "Focusable controls need visible focus styling.", { focusVisibleCount });
  assert(/@media\s*\(hover:\s*none\)/.test(css), "Touch-only mode must expose hover-dependent controls.");
  assert(/@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(css), "Reduced-motion media query is required.");
  assert(/@media\s*\(forced-colors:\s*active\)/.test(css), "Forced-colors high-contrast media query is required.");
  assert(/\.rtl-text\s*{[\s\S]*direction:\s*rtl/.test(css), "RTL text class must set right-to-left direction.");
  assert(/\.token-original\.rtl-token\s*{[\s\S]*direction:\s*rtl/.test(css), "RTL token class must set right-to-left direction.");
  assert(/data-tooltip\]:focus-visible::after/.test(css), "Tooltip content must be available from keyboard focus.");
  return {
    focusVisibleSelectors: focusVisibleCount,
    hasTouchMode: true,
    hasReducedMotion: true,
    hasForcedColors: true,
    hasRtlRules: true,
  };
}

function checkRenderer(source) {
  assert(/className = "strong-token"/.test(source), "Strong token renderer was not found.");
  assert(/token\.tabIndex = 0/.test(source), "Strong tokens must be keyboard focusable.");
  assert(/token\.setAttribute\("role", "button"\)/.test(source), "Strong tokens must expose button role.");
  assert(/token\.setAttribute\("aria-label"/.test(source), "Strong tokens must expose accessible names.");
  assert(/addEventListener\("keydown"/.test(source) && /event\.key !== "Enter" && event\.key !== " "/.test(source), "Strong tokens must support Enter and Space activation.");
  assert(
    /studyButton\.setAttribute\(\s*["']aria-label["']/.test(source),
    "Verse study trigger must have an accessible label.",
  );
  assert(
    /number\.setAttribute\(\s*["']aria-label["']/.test(source) && /Study Marks and parallel translations/.test(source),
    "Verse number must describe its canonical Study Marks and parallel-translation roles.",
  );
  assert(
    /button\.addEventListener\("focus", showPreview\)/.test(source),
    "Reference previews must have a focus equivalent.",
  );
  assert(/body\.addEventListener\("touchend"/.test(source), "Selection menu must have a touch equivalent.");
  return {
    strongTokenKeyboardActivation: true,
    verseStudyAriaLabel: true,
    verseNumberStudyMarksAriaLabel: true,
    focusReferencePreview: true,
    touchSelectionMenu: true,
  };
}

function checkLanguageTooltips(source) {
  assert(/setAttribute\("role", "tooltip"\)/.test(source), "Language tooltip layer must expose tooltip role.");
  assert(/document\.addEventListener\("focusin"/.test(source), "Language letter tooltips must open on focus.");
  assert(/document\.addEventListener\("focusout"/.test(source), "Language letter tooltips must close on focusout.");
  assert(/span\.setAttribute\("aria-label", span\.dataset\.tooltip\)/.test(source), "Language letters must expose tooltip text as accessible labels.");
  assert(/span\.tabIndex = 0/.test(source), "Language letters must be keyboard focusable.");
  return {
    tooltipRole: true,
    focusOpenClose: true,
    letterAriaLabels: true,
    focusableLetters: true,
  };
}

function checkPressedStates(tagsView, tabsView) {
  assert(/button\.setAttribute\("aria-pressed", active \? "true" : "false"\)/.test(tagsView), "Tag toggle buttons must expose aria-pressed.");
  assert(
    /button\.setAttribute\("aria-pressed", (?:action\.current|action\.id === active) \? "true" : "false"\)/.test(tabsView),
    "Contextual panel controls must expose aria-pressed.",
  );
  return {
    tagTogglePressedState: true,
    contextTabPressedState: true,
  };
}

function checkCreatedButtons(sourceByFile) {
  const summary = {};
  for (const [file, source] of Object.entries(sourceByFile)) {
    const created = countMatches(source, /document\.createElement\("button"\)/g);
    const typed = countMatches(source, /\.type = "(button|submit|reset)"/g);
    summary[file] = { created, typed };
    assert(typed >= created, "Programmatically created buttons should explicitly set type=\"button\".", { file, created, typed });
  }
  return summary;
}

async function main() {
  const [
    indexHtml,
    css,
    app,
    chapterRenderer,
    languageTooltips,
    tagsView,
    tabsView,
    interlinearView,
    jobsView,
    searchView,
    referenceView,
    userDataView,
    strongsView,
    dom,
  ] = await Promise.all([
    read("index.html"),
    read("styles.css"),
    read("app.js"),
    read("src/chapter-renderer.js"),
    read("src/language-tooltips.js"),
    read("src/views/tags-view.js"),
    read("src/views/verse-context-tabs.js"),
    read("src/views/interlinear-translation-view.js"),
    read("src/views/jobs-view.js"),
    read("src/views/search-view.js"),
    read("src/views/reference-view.js"),
    read("src/views/user-data-view.js"),
    read("src/views/strongs-view.js"),
    read("src/dom.js"),
  ]);

  const report = {
    schema_version: 1,
    audit_id: "static-accessibility-qa",
    generated_at: new Date().toISOString(),
    coverage: {
      keyboard_operation: "source-checked for focusable Strong tokens, Enter/Space activation, focus-visible styles, and button types",
      touch_operation: "source-checked for touch selection menu and hover-none CSS behavior",
      screen_reader_names: "source-checked for landmarks, labels, static button names, aria labels, tooltip role, and toggle pressed state",
      focus_restoration: "deferred to browser interaction QA",
      rtl_order: "source-checked for RTL CSS classes used by Hebrew source/token rendering",
      zoom_200_percent: "partially covered by responsive CSS breakpoints; visual browser QA still required",
      reduced_motion: "source-checked",
      high_contrast: "source-checked",
      hover_equivalent_mobile: "source-checked for focus/touch equivalents where static inspection is reliable",
    },
    checks: {
      index: checkIndex(indexHtml),
      css: checkCss(css),
      renderer: checkRenderer(chapterRenderer),
      languageTooltips: checkLanguageTooltips(languageTooltips),
      pressedStates: checkPressedStates(tagsView, tabsView),
      myData: checkMyData(userDataView),
      createdButtons: checkCreatedButtons({
        "app.js": app,
        "src/chapter-renderer.js": chapterRenderer,
        "src/views/interlinear-translation-view.js": interlinearView,
        "src/views/jobs-view.js": jobsView,
        "src/views/search-view.js": searchView,
        "src/views/reference-view.js": referenceView,
        "src/views/tags-view.js": tagsView,
        "src/views/user-data-view.js": userDataView,
        "src/views/strongs-view.js": strongsView,
        "src/dom.js": dom,
      }),
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  if (error.details) console.error(JSON.stringify(error.details, null, 2));
  process.exitCode = 1;
});
