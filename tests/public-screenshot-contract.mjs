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
