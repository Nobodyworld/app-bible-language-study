import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const captureScriptPath = resolve(workspaceRoot, "tools", "capture-public-screenshots.mjs");
const inventoryPath = resolve(workspaceRoot, "docs", "images", "SCREENSHOTS.md");

const expectedFilenames = Object.freeze([
  "reader.png",
  "reader-dark.png",
  "book-picker.png",
  "detail-panel.png",
  "detail-panel-dark.png",
  "verse-context-controls.png",
  "interlinear.png",
  "interlinear-dark.png",
  "hebrew-side-panel.png",
  "hebrew-side-panel-dark.png",
  "search.png",
  "study-marks.png",
  "study-marks-dark.png",
  "meaning.png",
  "my-data.png",
  "my-data-backup-restore.png",
  "my-data-maintenance.png",
  "mobile.png",
  "mobile-dark.png",
]);
const exactSourceTokenTarget = "target:source_token:bsb:new:john:1:1:2";

const retiredFilenames = Object.freeze([
  `${["verse", "context", "tabs"].join("-")}.png`,
  `${["study", "data"].join("-")}.png`,
  `${["local", "processing"].join("-")}.png`,
]);
const retiredSelectors = Object.freeze([
  ["#show", "User", "Data"].join(""),
  ["#show", "Jobs"].join(""),
]);
const retiredVisibleTitle = ["Inter", "linear"].join("");
const quotedRetiredTitlePattern = new RegExp(`(["'\`])${retiredVisibleTitle}\\1`, "g");

const obsoleteCaptureDependencies = Object.freeze([
  {
    pattern: /\.word-meaning-menu\[role=(["'])dialog\1\]:not\(\[hidden\]\)/,
    description: "the retired viewport Meaning dialog",
  },
  {
    pattern: /\.study-marks-menu/,
    description: "the retired Study Marks popover",
  },
]);

const standardWidthCaptureRequirements = Object.freeze([
  [/bibleapp:study-workspace-width:v1/, "the isolated study-workspace width preference"],
  [/localStorage\.setItem/, "deterministic width preference setup"],
  [/localStorage\.getItem/, "deterministic width preference verification"],
  [/data-study-workspace-width/, "the root study-workspace width state"],
  [/data-study-workspace-width-mode/, "the visible study-workspace width controls"],
  [/aria-pressed/, "the width-control pressed states"],
  [/\bcompact\b/, "the Compact width control state"],
  [/\bstandard\b/, "the Standard width control state"],
  [/\bexpanded\b/, "the Expanded width control state"],
  [/scrollWidth/, "horizontal overflow measurement"],
  [/clientWidth|innerWidth/, "horizontal overflow bounds"],
  [/#detailWorkArea/, "study-workspace work-area overflow"],
  [/\.detail-pane/, "study-workspace panel overflow"],
  [/#detailToolSurface/, "contained-tool surface overflow"],
  [/#detailToolContent/, "contained-tool content overflow"],
  [/standardPressed\s*!==\s*["']true["']/, "the pressed Standard width control"],
  [/compactPressed\s*!==\s*["']false["']/, "the unpressed Compact width control"],
  [/expandedPressed\s*!==\s*["']false["']/, "the unpressed Expanded width control"],
]);

const themeCaptureRequirements = Object.freeze([
  [/bibleAppTheme/, "the persisted public-capture theme"],
  [/locator\(\s*["']#themeToggle["']\s*\)\.click\(/, "theme changes through the visible application control"],
  [/#themeToggle/, "the theme control state"],
  [/rootTheme/, "the rendered root theme"],
  [/aria-pressed/, "the theme control pressed state"],
  [/Switch to [^`]+ theme/, "the theme control accessible action"],
]);

const containedToolCaptureRequirements = Object.freeze([
  [/#detailToolSurface\[data-tool-kind=(["'])meaning\1\]:not\(\[hidden\]\)/, "the contained Meaning surface"],
  [/#detailToolSurface\[data-tool-kind=(["'])study-marks\1\]:not\(\[hidden\]\)/, "the contained Study Marks surface"],
  [/#detailToolSurface:not\(\[hidden\]\)/, "single visible contained-tool inspection"],
  [/#detailToolTitle/, "contained surface title verification"],
  [/#detailToolContent/, "supported contained-tool interactions"],
  [/#detailWorkArea/, "contained surface underlay verification"],
  [/\binert\b/, "inert work-area verification"],
  [/getBoundingClientRect/, "contained surface geometry verification"],
  [/\.word-meaning-trigger/, "the visible Meaning trigger"],
  [/\.word-meaning-option\[data-source=(["'])exact_bsb\1\]/, "the exact-English Meaning choice"],
  [/\.word-meaning-option\[data-source=(["'])lexicon\1\]/, "the lexicon Meaning choice"],
  [/\.word-meaning-other/, "the Other Meaning choice"],
  [/\.word-meaning-custom-input/, "the custom Meaning input"],
  [/\.word-meaning-save/, "the Meaning Save action"],
  [/\.word-meaning-remove/, "the Meaning Remove action"],
  [/\borigin\b/, "the deterministic saved personal meaning"],
  [/data-target-id/, "the canonical source-token target identity"],
  [/data-token-index/, "the exact source-token index"],
  [/data-strong-code/, "the exact source-token Strong's identity"],
  [/\.(?:study-marks-trigger|token-study-marks-button)/, "the visible side-panel Study Marks trigger"],
  [/\.tag-picker-option\[aria-label=(["'])(?:Add|Remove) Favorite tag\1\]/, "the contained Favorite interaction"],
  [/#detailToolContent \.tag-picker-option/, "Meaning and Study Marks content separation"],
  [/Escape|#detailToolClose/, "supported contained-tool closing"],
]);

const browserHealthCaptureRequirements = Object.freeze([
  [
    /page\.on\(\s*["']console["'](?=[\s\S]{0,700}\bwarning\b)(?=[\s\S]{0,700}\berror\b)/,
    "console warning/error capture",
  ],
  [/page\.on\(\s*["']pageerror["']/, "page-error capture"],
  [/page\.on\(\s*["']requestfailed["'][\s\S]{0,700}?request\.url\(\)/, "failed application-request capture"],
  [/page\.on\(\s*["']response["'][\s\S]{0,700}?response\.status\(\)[\s\S]{0,300}?400[\s\S]{0,700}?response\.url\(\)/, "HTTP application-response failure capture"],
]);

const atomicOutputCaptureRequirements = Object.freeze([
  [/mkdtemp/, "owned staged screenshot output"],
  [/rename\(outputRoot,\s*backupRoot\)/, "transactional preservation of the prior screenshot set"],
  [/rename\(stagingRoot,\s*outputRoot\)/, "transactional promotion of the complete staged set"],
  [/maxRetries\s*:\s*\d+/, "Windows cleanup retries for owned directories"],
  [
    /existsSync\(path\)[\s\S]{0,200}!existsSync\(outputRoot\)[\s\S]{0,400}Preserved the only prior screenshot backup/,
    "rollback-failure preservation of the only prior screenshot backup",
  ],
]);

const [captureSource, readme, showcase, trackedInventory] = await Promise.all([
  readFile(captureScriptPath, "utf8"),
  readFile(resolve(workspaceRoot, "README.md"), "utf8"),
  readFile(resolve(workspaceRoot, "docs", "SHOWCASE_SCREENSHOTS.md"), "utf8"),
  readFile(inventoryPath, "utf8"),
]);

for (const selector of retiredSelectors) {
  assert.equal(
    captureSource.includes(selector),
    false,
    `Capture source must not depend on retired control ${selector}.`,
  );
}

for (const filename of retiredFilenames) {
  assert.equal(
    captureSource.includes(filename),
    false,
    `Capture source must not retain a literal dependency on retired file ${filename}.`,
  );
}

for (const { pattern, description } of obsoleteCaptureDependencies) {
  assert.equal(
    pattern.test(captureSource),
    false,
    `Capture source must not depend on ${description}.`,
  );
}

for (const [pattern, description] of [
  ...standardWidthCaptureRequirements,
  ...themeCaptureRequirements,
  ...containedToolCaptureRequirements,
  ...browserHealthCaptureRequirements,
  ...atomicOutputCaptureRequirements,
]) {
  assert.equal(
    pattern.test(captureSource),
    true,
    `Capture source must enforce ${description}.`,
  );
}

assert.equal(
  /\.word-meaning-trigger[\s\S]{0,500}?\.click\(/.test(captureSource),
  true,
  "Personal-data setup must open Meaning through a visible trigger click.",
);
assert.equal(
  /\.(?:study-marks-trigger|token-study-marks-button)[\s\S]{0,700}?\.click\(/.test(captureSource),
  true,
  "Personal-data setup must open Study Marks through a visible trigger click.",
);

assert.equal(
  /Compact, Standard, and Expanded widths[\s\S]*?Standard as the default[\s\S]*?reader and study workspace scroll\s+independently/i.test(readme),
  true,
  "README must describe the flexible desktop workspace and its default and scroll ownership.",
);
assert.equal(
  /contained exact-source-token Meaning surface with saved `origin`/i.test(readme),
  true,
  "README must describe the maintained Meaning image as a contained exact-source-token surface.",
);
assert.equal(
  /Contained Study Marks[\s\S]*?contained exact-token Study Marks workflow[\s\S]*?Dark Study Marks index/i.test(showcase),
  true,
  "Screenshot showcase must distinguish the contained light Study Marks workflow from the dark index.",
);
assert.equal(
  /Contained Meaning[\s\S]*?saved `origin` plus exact-English and lexicon choices/i.test(showcase),
  true,
  "Screenshot showcase must describe the contained Meaning state and its deterministic choices.",
);
for (const [markdown, label] of [[readme, "README"], [showcase, "Screenshot showcase"]]) {
  assert.equal(
    /Meaning dialog|Compact `Word → Verse` detail|compact Verse study panel/i.test(markdown),
    false,
    `${label} must not retain the obsolete screenshot narrative.`,
  );
}

assert.equal(
  (captureSource.match(quotedRetiredTitlePattern) || []).length,
  0,
  `Capture source must not expect the retired visible title ${retiredVisibleTitle}.`,
);

const {
  PUBLIC_SCREENSHOT_MANIFEST,
  renderScreenshotInventory,
} = await import(pathToFileURL(captureScriptPath).href);

assert.ok(Array.isArray(PUBLIC_SCREENSHOT_MANIFEST), "Public screenshot manifest must be an array.");
assert.equal(
  typeof renderScreenshotInventory,
  "function",
  "Capture source must export its generated-inventory renderer.",
);

for (const [index, descriptor] of PUBLIC_SCREENSHOT_MANIFEST.entries()) {
  assert.ok(
    descriptor && typeof descriptor === "object" && !Array.isArray(descriptor),
    `Screenshot manifest entry ${index + 1} must be a descriptor object.`,
  );
  assert.equal(
    typeof descriptor.filename,
    "string",
    `Screenshot manifest entry ${index + 1} must declare a filename.`,
  );
  assert.match(
    descriptor.route,
    /^\/#\/read\/[a-z0-9-]+\/[a-z0-9-]+\/\d+(?:\/\d+)?$/,
    `Screenshot manifest entry ${index + 1} must declare an exact reader route.`,
  );
  assert.ok(
    Number.isInteger(descriptor.viewport?.width) && Number.isInteger(descriptor.viewport?.height),
    `Screenshot manifest entry ${index + 1} must declare an exact viewport.`,
  );
  assert.ok(
    descriptor.theme === "light" || descriptor.theme === "dark",
    `Screenshot manifest entry ${index + 1} must declare its light or dark theme.`,
  );
  assert.equal(
    descriptor.widthMode,
    descriptor.viewport.width <= 768 ? "mobile-drawer" : "standard",
    `Screenshot manifest entry ${index + 1} must declare its maintained workspace width mode.`,
  );
  assert.ok(
    typeof descriptor.panelTitle === "string" && descriptor.panelTitle.length > 0,
    `Screenshot manifest entry ${index + 1} must declare its expected panel title.`,
  );
  assert.ok(
    ["", "meaning", "study-marks"].includes(descriptor.toolKind),
    `Screenshot manifest entry ${index + 1} must declare its expected contained-tool state.`,
  );
  assert.equal(
    typeof descriptor.selectedVerse,
    "string",
    `Screenshot manifest entry ${index + 1} must declare its expected selected-verse state.`,
  );
  assert.ok(
    typeof descriptor.intendedState === "string" && descriptor.intendedState.length > 0,
    `Screenshot manifest entry ${index + 1} must declare its intended visible state.`,
  );
}

const manifestFilenames = PUBLIC_SCREENSHOT_MANIFEST.map(({ filename }) => filename);
assert.equal(
  new Set(manifestFilenames).size,
  manifestFilenames.length,
  "Public screenshot manifest filenames must be unique.",
);
assert.deepEqual(
  manifestFilenames,
  expectedFilenames,
  "Public screenshot manifest must contain the required 19 files in the maintained order.",
);

const manifestByFilename = new Map(
  PUBLIC_SCREENSHOT_MANIFEST.map((descriptor) => [descriptor.filename, descriptor]),
);
assert.deepEqual(
  {
    panelTitle: manifestByFilename.get("meaning.png")?.panelTitle,
    selectedTokenId: manifestByFilename.get("meaning.png")?.selectedTokenId,
    toolKind: manifestByFilename.get("meaning.png")?.toolKind,
    widthMode: manifestByFilename.get("meaning.png")?.widthMode,
  },
  {
    panelTitle: "Language Study",
    selectedTokenId: exactSourceTokenTarget,
    toolKind: "meaning",
    widthMode: "standard",
  },
  "meaning.png must represent contained Meaning inside the Standard Language Study workspace.",
);
assert.deepEqual(
  {
    panelTitle: manifestByFilename.get("study-marks.png")?.panelTitle,
    selectedTokenId: manifestByFilename.get("study-marks.png")?.selectedTokenId,
    toolKind: manifestByFilename.get("study-marks.png")?.toolKind,
    widthMode: manifestByFilename.get("study-marks.png")?.widthMode,
  },
  {
    panelTitle: "Language Study",
    selectedTokenId: exactSourceTokenTarget,
    toolKind: "study-marks",
    widthMode: "standard",
  },
  "study-marks.png must represent contained exact-token Study Marks in the Standard workspace.",
);
assert.deepEqual(
  {
    panelTitle: manifestByFilename.get("study-marks-dark.png")?.panelTitle,
    toolKind: manifestByFilename.get("study-marks-dark.png")?.toolKind,
    widthMode: manifestByFilename.get("study-marks-dark.png")?.widthMode,
  },
  { panelTitle: "Study Marks", toolKind: "", widthMode: "standard" },
  "study-marks-dark.png must retain the distinct dark Study Marks index.",
);

for (const filename of retiredFilenames) {
  assert.equal(
    manifestFilenames.includes(filename),
    false,
    `Public screenshot manifest must not contain retired file ${filename}.`,
  );
}

const expectedInventory = [
  "# Public Screenshots",
  "",
  ...expectedFilenames.map((filename) => `- ${filename}`),
  "",
].join("\n");
const renderedInventory = renderScreenshotInventory(PUBLIC_SCREENSHOT_MANIFEST);
const normalizedTrackedInventory = trackedInventory.replaceAll("\r\n", "\n");

assert.equal(
  renderedInventory,
  expectedInventory,
  "Inventory renderer must preserve the exact maintained manifest order and format.",
);
assert.equal(
  normalizedTrackedInventory,
  expectedInventory,
  "Generated docs/images inventory must exactly match the capture manifest.",
);

function referencedScreenshotFilenames(markdown) {
  const references = [
    ...markdown.matchAll(/(?:docs\/)?images\/([a-z0-9][a-z0-9.-]*\.png)/gi),
  ].map((match) => match[1]);
  return [...new Set(references)].sort();
}

const expectedReferenceSet = [...expectedFilenames].sort();
assert.deepEqual(
  referencedScreenshotFilenames(readme),
  expectedReferenceSet,
  "README screenshot references must exactly match the maintained public set.",
);
assert.deepEqual(
  referencedScreenshotFilenames(showcase),
  expectedReferenceSet,
  "Screenshot showcase references must exactly match the maintained public set.",
);

const trackedPngPaths = execFileSync("git", ["ls-files", "--", "docs/images"], {
  cwd: workspaceRoot,
  encoding: "utf8",
})
  .split(/\r?\n/)
  .map((path) => path.trim().replaceAll("\\", "/"))
  .filter((path) => path.toLowerCase().endsWith(".png"));
const trackedPngFilenames = trackedPngPaths.map((path) => path.split("/").at(-1));
const expectedTrackedPngPaths = expectedFilenames.map((filename) => `docs/images/${filename}`);

assert.equal(
  new Set(trackedPngFilenames).size,
  trackedPngFilenames.length,
  "Tracked screenshot PNG filenames must be unique.",
);
assert.deepEqual(
  [...trackedPngPaths].sort(),
  [...expectedTrackedPngPaths].sort(),
  "Git-tracked docs/images PNGs must exactly match the maintained public set.",
);

for (const filename of expectedFilenames) {
  await assert.doesNotReject(
    access(resolve(workspaceRoot, "docs", "images", filename)),
    `Required public screenshot ${filename} must exist in docs/images.`,
  );
}

console.log("public screenshot contract tests passed");
