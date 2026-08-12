#!/usr/bin/env node

import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = resolve(workspaceRoot, "app");
const outputRoot = resolve(workspaceRoot, "docs", "images");
const evidenceRoot = "C:\\tmp\\bibleapp-flexible-study-workspace-screenshot-evidence";
const require = createRequire(import.meta.url);
const playwrightVersion = require("playwright-core/package.json").version;

const DESKTOP_VIEWPORT = Object.freeze({ width: 1365, height: 768 });
const BOOK_PICKER_VIEWPORT = Object.freeze({ width: 1365, height: 631 });
const STRONG_DETAIL_VIEWPORT = Object.freeze({ width: 1365, height: 520 });
const LANGUAGE_STUDY_VIEWPORT = Object.freeze({ width: 1365, height: 1420 });
const STUDY_MARKS_VIEWPORT = Object.freeze({ width: 1365, height: 670 });
const MY_DATA_SUMMARY_VIEWPORT = Object.freeze({ width: 1365, height: 1450 });
const MY_DATA_BACKUP_VIEWPORT = Object.freeze({ width: 1365, height: 600 });
const MY_DATA_MAINTENANCE_VIEWPORT = Object.freeze({ width: 1365, height: 480 });
const MOBILE_VIEWPORT = Object.freeze({ width: 390, height: 844 });
const STUDY_WORKSPACE_WIDTH_STORAGE_KEY = "bibleapp:study-workspace-width:v1";
const STANDARD_STUDY_WORKSPACE_WIDTH = "standard";

export const PUBLIC_SCREENSHOT_MANIFEST = Object.freeze([
  {
    filename: "reader.png",
    route: "/#/read/bsb/psalms/23",
    viewport: DESKTOP_VIEWPORT,
    theme: "light",
    widthMode: STANDARD_STUDY_WORKSPACE_WIDTH,
    panelTitle: "Details",
    toolKind: "",
    selectedVerse: "",
    intendedState: "Psalm 23 reader",
  },
  {
    filename: "reader-dark.png",
    route: "/#/read/bsb/psalms/23",
    viewport: DESKTOP_VIEWPORT,
    theme: "dark",
    widthMode: STANDARD_STUDY_WORKSPACE_WIDTH,
    panelTitle: "Details",
    toolKind: "",
    selectedVerse: "",
    intendedState: "Psalm 23 reader",
  },
  {
    filename: "book-picker.png",
    route: "/#/read/bsb/psalms/23",
    viewport: BOOK_PICKER_VIEWPORT,
    theme: "light",
    widthMode: STANDARD_STUDY_WORKSPACE_WIDTH,
    panelTitle: "Details",
    toolKind: "",
    selectedVerse: "",
    intendedState: "open book picker",
  },
  {
    filename: "detail-panel.png",
    route: "/#/read/bsb/john/1/1",
    viewport: STRONG_DETAIL_VIEWPORT,
    theme: "light",
    widthMode: STANDARD_STUDY_WORKSPACE_WIDTH,
    panelTitle: "Strong's",
    toolKind: "",
    selectedVerse: "1",
    selectedStrongCode: "G1722",
    intendedState: "Standard-width Word to Verse exact-token detail",
  },
  {
    filename: "detail-panel-dark.png",
    route: "/#/read/bsb/john/1/1",
    viewport: STRONG_DETAIL_VIEWPORT,
    theme: "dark",
    widthMode: STANDARD_STUDY_WORKSPACE_WIDTH,
    panelTitle: "Strong's",
    toolKind: "",
    selectedVerse: "1",
    selectedStrongCode: "G1722",
    intendedState: "Standard-width Word to Verse exact-token detail",
  },
  {
    filename: "verse-context-controls.png",
    route: "/#/read/bsb/psalms/118/4",
    viewport: DESKTOP_VIEWPORT,
    theme: "light",
    widthMode: STANDARD_STUDY_WORKSPACE_WIDTH,
    panelTitle: "Cross References",
    toolKind: "",
    selectedVerse: "4",
    intendedState: "Verse context controls",
  },
  {
    filename: "interlinear.png",
    route: "/#/read/bsb/john/11/35",
    viewport: LANGUAGE_STUDY_VIEWPORT,
    theme: "light",
    widthMode: STANDARD_STUDY_WORKSPACE_WIDTH,
    panelTitle: "Language Study",
    toolKind: "",
    selectedVerse: "35",
    intendedState: "Language Study",
  },
  {
    filename: "interlinear-dark.png",
    route: "/#/read/bsb/john/11/35",
    viewport: LANGUAGE_STUDY_VIEWPORT,
    theme: "dark",
    widthMode: STANDARD_STUDY_WORKSPACE_WIDTH,
    panelTitle: "Language Study",
    toolKind: "",
    selectedVerse: "35",
    intendedState: "Language Study",
  },
  {
    filename: "hebrew-side-panel.png",
    route: "/#/read/bsb/proverbs/1/1",
    viewport: STRONG_DETAIL_VIEWPORT,
    theme: "light",
    widthMode: STANDARD_STUDY_WORKSPACE_WIDTH,
    panelTitle: "Strong's",
    toolKind: "",
    selectedVerse: "1",
    selectedStrongCode: "H4912",
    intendedState: "exact Hebrew H4912 Strong's detail",
  },
  {
    filename: "hebrew-side-panel-dark.png",
    route: "/#/read/bsb/proverbs/1/1",
    viewport: STRONG_DETAIL_VIEWPORT,
    theme: "dark",
    widthMode: STANDARD_STUDY_WORKSPACE_WIDTH,
    panelTitle: "Strong's",
    toolKind: "",
    selectedVerse: "1",
    selectedStrongCode: "H4912",
    intendedState: "exact Hebrew H4912 Strong's detail",
  },
  {
    filename: "search.png",
    route: "/#/read/bsb/proverbs/1/1",
    viewport: DESKTOP_VIEWPORT,
    theme: "light",
    widthMode: STANDARD_STUDY_WORKSPACE_WIDTH,
    panelTitle: "Search",
    toolKind: "",
    selectedVerse: "",
    intendedState: "search for discernment with three populated results",
  },
  {
    filename: "study-marks.png",
    route: "/#/read/bsb/john/1/1",
    viewport: STUDY_MARKS_VIEWPORT,
    theme: "light",
    widthMode: STANDARD_STUDY_WORKSPACE_WIDTH,
    panelTitle: "Language Study",
    toolKind: "study-marks",
    selectedVerse: "1",
    selectedTokenId: "target:source_token:bsb:new:john:1:1:2",
    intendedState: "contained exact-token Study Marks with seeded Favorite",
  },
  {
    filename: "study-marks-dark.png",
    route: "/#/read/bsb/john/1/1",
    viewport: STUDY_MARKS_VIEWPORT,
    theme: "dark",
    widthMode: STANDARD_STUDY_WORKSPACE_WIDTH,
    panelTitle: "Study Marks",
    toolKind: "",
    selectedVerse: "1",
    intendedState: "Study Marks index with seeded exact-token Favorite",
  },
  {
    filename: "meaning.png",
    route: "/#/read/bsb/john/1/1",
    viewport: DESKTOP_VIEWPORT,
    theme: "light",
    widthMode: STANDARD_STUDY_WORKSPACE_WIDTH,
    panelTitle: "Language Study",
    toolKind: "meaning",
    selectedVerse: "1",
    selectedTokenId: "target:source_token:bsb:new:john:1:1:2",
    intendedState: "contained exact-token Meaning with saved personal meaning",
  },
  {
    filename: "my-data.png",
    route: "/#/read/bsb/john/1/1",
    viewport: MY_DATA_SUMMARY_VIEWPORT,
    theme: "light",
    widthMode: STANDARD_STUDY_WORKSPACE_WIDTH,
    panelTitle: "My Data",
    toolKind: "",
    selectedVerse: "1",
    intendedState: "My study data summary",
  },
  {
    filename: "my-data-backup-restore.png",
    route: "/#/read/bsb/john/1/1",
    viewport: MY_DATA_BACKUP_VIEWPORT,
    theme: "light",
    widthMode: STANDARD_STUDY_WORKSPACE_WIDTH,
    panelTitle: "My Data",
    toolKind: "",
    selectedVerse: "1",
    intendedState: "Backup and restore controls",
  },
  {
    filename: "my-data-maintenance.png",
    route: "/#/read/bsb/john/1/1",
    viewport: MY_DATA_MAINTENANCE_VIEWPORT,
    theme: "light",
    widthMode: STANDARD_STUDY_WORKSPACE_WIDTH,
    panelTitle: "My Data",
    toolKind: "",
    selectedVerse: "1",
    intendedState: "completed local Study Marks maintenance",
  },
  {
    filename: "mobile.png",
    route: "/#/read/bsb/psalms/118/4",
    viewport: MOBILE_VIEWPORT,
    theme: "light",
    widthMode: "mobile-drawer",
    panelTitle: "Cross References",
    toolKind: "",
    selectedVerse: "4",
    intendedState: "open full-screen mobile Verse study drawer",
  },
  {
    filename: "mobile-dark.png",
    route: "/#/read/bsb/john/1/1",
    viewport: MOBILE_VIEWPORT,
    theme: "dark",
    widthMode: "mobile-drawer",
    panelTitle: "My Data",
    toolKind: "",
    selectedVerse: "",
    intendedState: "full-screen mobile My Data drawer",
  },
].map((entry) => Object.freeze(entry)));

const retiredScreenshots = Object.freeze([
  `${["verse", "context", "tabs"].join("-")}.png`,
  `${["study", "data"].join("-")}.png`,
  `${["local", "processing"].join("-")}.png`,
]);

export function renderScreenshotInventory(manifest = PUBLIC_SCREENSHOT_MANIFEST) {
  return `# Public Screenshots\n\n${manifest.map(({ filename }) => `- ${filename}`).join("\n")}\n`;
}

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

function findEdgePath() {
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Copilot\\Application\\msedge.exe",
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("Could not find Microsoft Edge executable.");
  return found;
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function captureDescriptor(filename) {
  const descriptor = PUBLIC_SCREENSHOT_MANIFEST.find((entry) => entry.filename === filename);
  if (!descriptor) throw new Error(`Screenshot is not declared in the public manifest: ${filename}`);
  return descriptor;
}

function attachBrowserIssueCapture(page, applicationUrl) {
  const issues = [];
  let activeState = "bootstrap";
  const applicationOrigin = new URL(applicationUrl).origin;
  const isApplicationUrl = (url) => {
    try {
      return new URL(url).origin === applicationOrigin;
    } catch {
      return false;
    }
  };
  const record = (issue) => {
    issues.push({
      state: activeState,
      url: page.url(),
      ...issue,
    });
  };

  page.on("pageerror", (error) => {
    record({
      type: "pageerror",
      text: error.message,
      stack: error.stack || "",
    });
  });
  page.on("console", (message) => {
    if (!["warning", "error"].includes(message.type())) return;
    record({
      type: `console:${message.type()}`,
      text: message.text(),
      location: message.location(),
    });
  });
  page.on("requestfailed", (request) => {
    if (!isApplicationUrl(request.url())) return;
    record({
      type: "requestfailed",
      method: request.method(),
      resourceType: request.resourceType(),
      text: request.failure()?.errorText || "Application request failed",
      requestUrl: request.url(),
    });
  });
  page.on("response", (response) => {
    if (response.status() < 400 || !isApplicationUrl(response.url())) return;
    record({
      type: "http",
      method: response.request().method(),
      status: response.status(),
      statusText: response.statusText(),
      responseUrl: response.url(),
    });
  });

  return {
    issues,
    setState(state) {
      activeState = state;
    },
    assertClean() {
      if (!issues.length) return;
      throw new Error(`Browser warnings/errors occurred during public screenshot capture:\n${JSON.stringify(issues, null, 2)}`);
    },
  };
}

async function setStudyWorkspaceWidth(page, widthMode = STANDARD_STUDY_WORKSPACE_WIDTH) {
  await page.evaluate(({ key, mode }) => {
    localStorage.setItem(key, mode);
    const button = document.querySelector(`[data-study-workspace-width-mode="${mode}"]`);
    if (!button) throw new Error(`Study workspace width control is missing: ${mode}`);
    if (document.documentElement.dataset.studyWorkspaceWidth !== mode || button.getAttribute("aria-pressed") !== "true") {
      button.click();
    }
  }, { key: STUDY_WORKSPACE_WIDTH_STORAGE_KEY, mode: widthMode });
  await page.waitForFunction(
    ({ key, mode }) =>
      localStorage.getItem(key) === mode &&
      document.documentElement.dataset.studyWorkspaceWidth === mode &&
      document.querySelector(`[data-study-workspace-width-mode="${mode}"]`)?.getAttribute("aria-pressed") === "true",
    { key: STUDY_WORKSPACE_WIDTH_STORAGE_KEY, mode: widthMode },
  );
}

async function assertStandardDesktopEnvironment(page, descriptor) {
  if (descriptor.widthMode !== STANDARD_STUDY_WORKSPACE_WIDTH) return;
  const state = await page.evaluate(() => {
    const overflow = (selector) => {
      const node = document.querySelector(selector);
      return node ? node.scrollWidth - node.clientWidth : null;
    };
    const root = document.documentElement;
    const pressed = (mode) =>
      document.querySelector(`[data-study-workspace-width-mode="${mode}"]`)?.getAttribute("aria-pressed") || "";
    return {
      compactPressed: pressed("compact"),
      detailContentOverflow: overflow("#detailContent"),
      documentOverflow: Math.max(root.scrollWidth, document.body.scrollWidth) - window.innerWidth,
      expandedPressed: pressed("expanded"),
      mode: root.getAttribute("data-study-workspace-width") || "",
      paneOverflow: overflow(".detail-pane"),
      shellOverflow: overflow(".app-shell"),
      standardPressed: pressed("standard"),
      toolContentOverflow: overflow("#detailToolContent"),
      toolSurfaceOverflow: overflow("#detailToolSurface"),
      workspaceOverflow: overflow("#detailWorkspace"),
      storedMode: localStorage.getItem("bibleapp:study-workspace-width:v1") || "",
      detailOverflowY: getComputedStyle(document.querySelector("#detailContent")).overflowY,
      paneWidth: document.querySelector(".detail-pane")?.getBoundingClientRect().width || 0,
      viewportWidth: window.innerWidth,
      widthControlsVisible: document.querySelector("#studyWorkspaceWidthControls")?.getClientRects().length > 0,
      workAreaOverflow: overflow("#detailWorkArea"),
    };
  });
  const overflowKeys = [
    "documentOverflow",
    "shellOverflow",
    "paneOverflow",
    "workspaceOverflow",
    "workAreaOverflow",
    "detailContentOverflow",
    "toolSurfaceOverflow",
    "toolContentOverflow",
  ];
  if (
    state.mode !== STANDARD_STUDY_WORKSPACE_WIDTH ||
    state.storedMode !== STANDARD_STUDY_WORKSPACE_WIDTH ||
    state.standardPressed !== "true" ||
    state.compactPressed !== "false" ||
    state.expandedPressed !== "false" ||
    !state.widthControlsVisible ||
    state.detailOverflowY !== "auto" ||
    state.paneWidth / state.viewportWidth < 0.32 ||
    state.paneWidth / state.viewportWidth > 0.35 ||
    overflowKeys.some((key) => state[key] != null && state[key] > 1)
  ) {
    throw new Error(`Standard desktop capture environment drifted for ${descriptor.filename}: ${JSON.stringify(state)}`);
  }
}

async function assertCaptureIdentity(page, descriptor) {
  const actual = await page.evaluate(() => {
    const selectedTokenId = document.querySelector("#detailToolSurface:not([hidden])")?.getAttribute("data-target-id") || "";
    const selectedToken = [...document.querySelectorAll(".word-meaning-control[data-target-id]")]
      .find((node) => node.getAttribute("data-target-id") === selectedTokenId);
    return {
      hash: window.location.hash,
      panelTitle: document.querySelector("#detailTitle")?.textContent.trim() || "",
      selectedStrongCode: (document.querySelector("#detailContext .panel-context-summary")?.textContent || "")
        .match(/\b[GH]\d+\b/)?.[0] || "",
      selectedVerse: document.querySelector(".reader-context-verse")?.getAttribute("data-verse") ||
        document.querySelector(".reader-context-word")?.closest(".verse-row, .source-bearing-segment")?.getAttribute("data-verse") ||
        selectedToken?.closest(".interlinear-verse-section[data-verse]")?.getAttribute("data-verse") || "",
      selectedTokenId,
      toolKind: document.querySelector("#detailToolSurface:not([hidden])")?.getAttribute("data-tool-kind") || "",
    };
  });
  const expectedHash = descriptor.route.startsWith("/") ? descriptor.route.slice(1) : descriptor.route;
  if (
    actual.hash !== expectedHash ||
    actual.panelTitle !== descriptor.panelTitle ||
    actual.toolKind !== descriptor.toolKind ||
    actual.selectedVerse !== descriptor.selectedVerse ||
    (descriptor.selectedStrongCode && actual.selectedStrongCode !== descriptor.selectedStrongCode) ||
    (descriptor.selectedTokenId && actual.selectedTokenId !== descriptor.selectedTokenId)
  ) {
    throw new Error(`Capture identity drifted for ${descriptor.filename}: ${JSON.stringify({ actual, expectedHash, descriptor })}`);
  }
}

async function findFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolvePort(address.port));
    });
  });
}

async function startAppServer() {
  const port = await findFreePort();
  const server = createHttpServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
      const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      const filePath = resolve(appRoot, relativePath);
      if (filePath !== appRoot && !filePath.startsWith(`${appRoot}${sep}`)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      const body = await readFile(filePath);
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": contentTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });

  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolveListen);
  });

  return { server, url: `http://127.0.0.1:${port}` };
}

async function waitForApp(page) {
  await page.waitForLoadState("load");
  await page.waitForFunction(
    () => document.readyState === "complete" && !document.body.textContent.includes("Loading data"),
    null,
    { timeout: 30000 },
  );
  await page.locator("#chapterTitle").waitFor({ state: "visible", timeout: 30000 });
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });
}

async function settleForCapture(page) {
  await page.mouse.move(1, 1);
  const residualInteraction = await page.evaluate(async () => {
    window.scrollTo(0, 0);
    window.getSelection()?.removeAllRanges();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    if (document.fonts?.ready) await document.fonts.ready;
    await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
    const focused = document.querySelector(":focus-visible");
    const hovered = document.querySelector(
      "a:hover, button:hover, input:hover, select:hover, summary:hover, [role='button']:hover",
    );
    return {
      focused: focused?.outerHTML.slice(0, 240) || "",
      hovered: hovered?.outerHTML.slice(0, 240) || "",
    };
  });
  if (residualInteraction.focused || residualInteraction.hovered) {
    throw new Error(`Transient interaction state remained before capture: ${JSON.stringify(residualInteraction)}`);
  }
  await delay(150);
}

async function captureNamed(page, browserHealth, generated, outputDirectory, filename) {
  const descriptor = captureDescriptor(filename);
  if (generated.has(filename)) throw new Error(`Screenshot was generated more than once: ${filename}`);
  const viewport = page.viewportSize();
  if (viewport?.width !== descriptor.viewport.width || viewport?.height !== descriptor.viewport.height) {
    throw new Error(
      `Viewport drift before ${filename}: expected ${descriptor.viewport.width}x${descriptor.viewport.height}, got ${viewport?.width}x${viewport?.height}`,
    );
  }
  const themeState = await page.evaluate(() => {
    const rootTheme = document.documentElement.dataset.theme || "";
    const toggle = document.querySelector("#themeToggle");
    let storedTheme = "";
    try {
      storedTheme = localStorage.getItem("bibleAppTheme") || "";
    } catch {
      // The interactive state remains authoritative when browser storage is unavailable.
    }
    return {
      rootTheme,
      storedTheme,
      pressed: toggle?.getAttribute("aria-pressed") || "",
      label: toggle?.getAttribute("aria-label") || "",
      title: toggle?.getAttribute("title") || "",
    };
  });
  const expectedThemeControl = descriptor.theme === "dark"
    ? { pressed: "true", action: "light" }
    : { pressed: "false", action: "dark" };
  if (
    themeState.rootTheme !== descriptor.theme ||
    themeState.storedTheme !== descriptor.theme ||
    themeState.pressed !== expectedThemeControl.pressed ||
    themeState.label !== `Switch to ${expectedThemeControl.action} theme` ||
    themeState.title !== `Switch to ${expectedThemeControl.action} theme`
  ) {
    throw new Error(
      `Theme state drift before ${filename}: expected ${descriptor.theme}, got ${JSON.stringify(themeState)}`,
    );
  }
  await assertStandardDesktopEnvironment(page, descriptor);
  await assertCaptureIdentity(page, descriptor);
  await settleForCapture(page);
  browserHealth.assertClean();
  await page.screenshot({
    path: resolve(outputDirectory, filename),
    fullPage: false,
    animations: "disabled",
    caret: "hide",
  });
  generated.add(filename);
}

async function setTheme(page, theme) {
  await page.waitForFunction(() => {
    const rootTheme = document.documentElement.dataset.theme;
    const pressed = document.querySelector("#themeToggle")?.getAttribute("aria-pressed");
    return ["light", "dark"].includes(rootTheme) && ["true", "false"].includes(pressed);
  });
  const initialThemeState = await page.evaluate(() => ({
    rootTheme: document.documentElement.dataset.theme || "",
    storedTheme: localStorage.getItem("bibleAppTheme") || "",
  }));
  if (initialThemeState.rootTheme !== theme) {
    await page.locator("#themeToggle").click();
  } else if (initialThemeState.storedTheme !== theme) {
    // A fresh profile can inherit the requested OS theme without persisting it.
    // Exercise the real control in both directions so the public state is stored
    // and the switch's visible and accessible state stays synchronized.
    await page.locator("#themeToggle").click();
    await page.waitForFunction(
      (expectedTheme) => document.documentElement.dataset.theme !== expectedTheme,
      theme,
    );
    await page.locator("#themeToggle").click();
  }
  await page.waitForFunction(
    (expectedTheme) => {
      const toggle = document.querySelector("#themeToggle");
      const isDark = expectedTheme === "dark";
      let storedTheme = "";
      try {
        storedTheme = localStorage.getItem("bibleAppTheme") || "";
      } catch {
        storedTheme = expectedTheme;
      }
      return Boolean(
        document.documentElement.dataset.theme === expectedTheme &&
        storedTheme === expectedTheme &&
        toggle?.getAttribute("aria-pressed") === String(isDark) &&
        toggle?.getAttribute("aria-label") === `Switch to ${isDark ? "light" : "dark"} theme` &&
        toggle?.getAttribute("title") === `Switch to ${isDark ? "light" : "dark"} theme`
      );
    },
    theme,
  );
}

async function setCaptureEnvironment(page, browserHealth, filename) {
  const descriptor = captureDescriptor(filename);
  browserHealth.setState(filename);
  await page.setViewportSize(descriptor.viewport);
  await setTheme(page, descriptor.theme);
  if (descriptor.widthMode === STANDARD_STUDY_WORKSPACE_WIDTH) {
    await setStudyWorkspaceWidth(page, descriptor.widthMode);
  }
  return descriptor;
}

async function openReader(page, browserHealth, baseUrl, filename, expectedTitle) {
  const descriptor = captureDescriptor(filename);
  browserHealth.setState(filename);
  await page.setViewportSize(descriptor.viewport);
  await page.goto(`${baseUrl}${descriptor.route}`);
  await waitForApp(page);
  await setTheme(page, descriptor.theme);
  if (descriptor.widthMode === STANDARD_STUDY_WORKSPACE_WIDTH) {
    await setStudyWorkspaceWidth(page, descriptor.widthMode);
  }
  if (expectedTitle) {
    await page.waitForFunction(
      (title) => document.querySelector("#chapterTitle")?.textContent.includes(title),
      expectedTitle,
      { timeout: 30000 },
    );
  }
}

async function openVerseStudy(page, verse = 1) {
  const row = page.locator(`.verse-row[data-verse="${verse}"]`).first();
  await row.waitFor({ state: "visible", timeout: 30000 });
  await row.hover();
  const button = row.locator(".verse-study-button");
  await button.waitFor({ state: "visible", timeout: 30000 });
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await page.locator("#detailTitle").filter({ hasText: /^Cross References$/ }).waitFor({
    state: "visible",
    timeout: 15000,
  });
  await page.locator("#detailContext .panel-context-navigation").waitFor({
    state: "visible",
    timeout: 15000,
  });
}

async function openLanguageStudy(page) {
  const control = page.locator(
    "#detailContext [data-panel-scope='verse'] .verse-context-tab[data-visible-label='Language']",
  );
  await control.waitFor({ state: "visible", timeout: 15000 });
  await control.click();
  await page.locator("#detailTitle").filter({ hasText: /^Language Study$/ }).waitFor({
    state: "visible",
    timeout: 15000,
  });
  await page.locator(".interlinear-verse-section[data-original-language-study='true']").first().waitFor({
    state: "visible",
    timeout: 15000,
  });
  await page.locator(".interlinear-token").first().waitFor({ state: "visible", timeout: 15000 });
  await page.waitForFunction(
    () => {
      const detail = document.querySelector("#detailContent");
      return Boolean(
        detail &&
        !detail.textContent.includes("Loading") &&
        detail.querySelector(".original-language-source-card .source-text") &&
        detail.querySelector(".original-language-word-card"),
      );
    },
    null,
    { timeout: 30000 },
  );
  await scrollDetailToTop(page);
}

async function scrollDetailToTop(page) {
  await page.evaluate(() => {
    const detail = document.querySelector("#detailContent");
    if (detail) detail.scrollTop = 0;
  });
}

async function openStrongDetail(page, strongCode, languageLabel) {
  const control = page.locator(
    `.interlinear-verse-section[data-verse="1"] .interlinear-token[data-strong-code="${strongCode}"] .compact-link`,
  ).first();
  await control.waitFor({ state: "visible", timeout: 15000 });
  await control.scrollIntoViewIfNeeded();
  await control.click();
  await page.locator("#detailTitle").filter({ hasText: /^Strong's$/ }).waitFor({
    state: "visible",
    timeout: 15000,
  });
  await page.waitForFunction(
    ({ code, languageClass }) => {
      const detail = document.querySelector("#detailContent");
      const text = detail?.textContent || "";
      return Boolean(
        text.includes(code) &&
        !text.includes("Loading lexicon entry") &&
        detail?.querySelector(".strong-detail") &&
        detail?.querySelector(`.language-breakdown.${languageClass}`) &&
        detail?.querySelector(".lexicon-sections"),
      );
    },
    { code: strongCode, languageClass: languageLabel.toLocaleLowerCase() },
    { timeout: 30000 },
  );
  const contextState = await page.evaluate(() => ({
    lock: document.querySelector(".detail-pane")?.dataset.panelMode || "",
    summary: document.querySelector("#detailContext .panel-context-summary")?.textContent.trim() || "",
    scopes: [...document.querySelectorAll("#detailContext .panel-context-group")].map(
      (node) => node.dataset.panelScope,
    ),
  }));
  if (
    contextState.lock !== "locked" ||
    !contextState.summary.includes(strongCode) ||
    contextState.scopes.join(" ") !== "word verse"
  ) {
    throw new Error(`Exact Strong's context is incomplete for ${strongCode}: ${JSON.stringify(contextState)}`);
  }
  await scrollDetailToTop(page);
}

async function ensureMobileDetailVisible(page) {
  const pane = page.locator(".detail-pane");
  if (await pane.evaluate((node) => node.classList.contains("visible"))) return;
  const launcher = page.locator("#openStudyPanel");
  await launcher.waitFor({ state: "visible", timeout: 10000 });
  await launcher.click();
  await page.waitForFunction(() => document.querySelector(".detail-pane")?.classList.contains("visible"));
}

async function scrollSectionIntoView(page, selector) {
  await page.waitForFunction(
    (target) => Boolean(document.querySelector(target)),
    selector,
    { timeout: 10000 },
  );
  await page.evaluate((target) => {
    const detail = document.querySelector("#detailContent");
    const section = document.querySelector(target);
    if (!detail || !section) return;
    const detailRect = detail.getBoundingClientRect();
    const sectionRect = section.getBoundingClientRect();
    detail.scrollTop += sectionRect.top - detailRect.top - 12;
  }, selector);
}

async function frameLanguageStudy(page, verse) {
  const sectionSelector = `.interlinear-verse-section[data-verse="${verse}"]`;
  await scrollSectionIntoView(page, sectionSelector);
  const framing = await page.evaluate((selector) => {
    const detail = document.querySelector("#detailContent");
    const section = document.querySelector(selector);
    const source = section?.querySelector(".original-language-source-card");
    const card = section?.querySelector(".original-language-word-card");
    if (!detail || !source || !card) return null;

    const detailRect = detail.getBoundingClientRect();
    const sourceRect = source.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const regionHeight = cardRect.bottom - sourceRect.top;
    const availableHeight = detailRect.height - 24;
    const regionTop = sourceRect.top - detailRect.top + detail.scrollTop;
    detail.scrollTop = Math.max(
      0,
      regionTop - 12 - Math.max(0, (availableHeight - regionHeight) / 2),
    );
    const overflow = card.getBoundingClientRect().bottom - (detail.getBoundingClientRect().bottom - 8);
    if (overflow > 0) detail.scrollTop += Math.ceil(overflow) + 2;

    const finalDetail = detail.getBoundingClientRect();
    const finalSource = source.getBoundingClientRect();
    const finalCard = card.getBoundingClientRect();
    return {
      sourceVisible: finalSource.bottom > finalDetail.top + 12 && finalSource.top < finalDetail.bottom - 12,
      cardFullyVisible: finalCard.top >= finalDetail.top + 4 && finalCard.bottom <= finalDetail.bottom - 4,
      sourceText: source.querySelector(".source-text")?.textContent.trim() || "",
      cardText: card.textContent.trim(),
      detailHeight: finalDetail.height,
      sourceHeight: finalSource.height,
      cardHeight: finalCard.height,
      detailTop: finalDetail.top,
      detailBottom: finalDetail.bottom,
      sourceTop: finalSource.top,
      sourceBottom: finalSource.bottom,
      cardTop: finalCard.top,
      cardBottom: finalCard.bottom,
      scrollTop: detail.scrollTop,
      scrollHeight: detail.scrollHeight,
    };
  }, sectionSelector);
  if (
    !framing?.sourceVisible ||
    !framing.cardFullyVisible ||
    !framing.sourceText ||
    !framing.cardText
  ) {
    throw new Error(`Language Study source/token framing is incomplete: ${JSON.stringify(framing)}`);
  }
}

async function seedPersonalData(page, browserHealth, baseUrl) {
  browserHealth.setState("setup:personal-data");
  await page.setViewportSize(DESKTOP_VIEWPORT);
  await page.goto(`${baseUrl}/#/read/bsb/john/1/1`);
  await waitForApp(page);
  await setTheme(page, "light");
  await setStudyWorkspaceWidth(page);
  await openVerseStudy(page);
  await openLanguageStudy(page);

  const card = page.locator(
    '.interlinear-verse-section[data-verse="1"] .interlinear-token[data-token-index="2"][data-strong-code="G746"]',
  ).filter({ has: page.locator(".word-meaning-trigger") }).first();
  await card.waitFor({ state: "visible", timeout: 15000 });
  await card.scrollIntoViewIfNeeded();

  const targetId = await card.locator(".word-meaning-control").getAttribute("data-target-id");
  const tokenIdentity = await card.evaluate((node) => ({
    strongCode: node.dataset.strongCode || "",
    sourceText: node.querySelector(".original-language-word-source .token-original, .token-original")?.textContent.trim() || "",
    tokenIndex: node.dataset.tokenIndex || "",
    targetId: node.querySelector(".word-meaning-control")?.getAttribute("data-target-id") || "",
  }));
  if (
    targetId !== "target:source_token:bsb:new:john:1:1:2" ||
    tokenIdentity.strongCode !== "G746" ||
    tokenIdentity.sourceText !== "archē" ||
    tokenIdentity.tokenIndex !== "2"
  ) {
    throw new Error(`Could not resolve deterministic exact-token identity: ${JSON.stringify(tokenIdentity)}`);
  }

  await card.locator(".word-meaning-trigger").click();
  const meaningSurface = page.locator('#detailToolSurface[data-tool-kind="meaning"]:not([hidden])');
  await meaningSurface.waitFor({ state: "visible", timeout: 10000 });
  const meaningContent = page.locator("#detailToolContent");
  await meaningContent.locator('.word-meaning-option[data-source="exact_bsb"]').waitFor({
    state: "visible",
    timeout: 15000,
  });
  await meaningContent.locator('.word-meaning-option[data-source="lexicon"]').waitFor({
    state: "visible",
    timeout: 15000,
  });
  const exactEnglishOption = meaningContent.locator('.word-meaning-option[data-source="exact_bsb"]');
  if ((await exactEnglishOption.textContent())?.trim() !== "the beginning") {
    throw new Error("Exact-English Meaning choice for the deterministic token is not 'the beginning'.");
  }
  await exactEnglishOption.click();
  await meaningSurface.waitFor({ state: "hidden", timeout: 10000 });

  const exactCard = page.locator(".interlinear-token")
    .filter({ has: page.locator(`.word-meaning-control[data-target-id="${targetId}"]`) })
    .first();
  await exactCard.locator(".word-meaning-badge").filter({ hasText: /^the beginning$/ }).waitFor({
    state: "visible",
    timeout: 10000,
  });
  await exactCard.locator(".word-meaning-badge").click();
  await meaningSurface.waitFor({ state: "visible", timeout: 10000 });
  await meaningContent.locator(".word-meaning-remove").click();
  await meaningSurface.waitFor({ state: "hidden", timeout: 10000 });
  await page.waitForFunction(
    (id) => !document.querySelector(`.word-meaning-control[data-target-id="${id}"] .word-meaning-badge`),
    targetId,
  );
  await exactCard.locator(".word-meaning-trigger").click();
  await meaningSurface.waitFor({ state: "visible", timeout: 10000 });
  await meaningContent.locator(".word-meaning-other").click();
  await meaningContent.locator(".word-meaning-custom-input").fill("origin");
  await meaningContent.locator(".word-meaning-save").click();
  await meaningSurface.waitFor({ state: "hidden", timeout: 10000 });
  await exactCard.locator(".word-meaning-badge").filter({ hasText: /^origin$/ }).waitFor({
    state: "visible",
    timeout: 10000,
  });

  const marksTrigger = exactCard.locator(".token-study-marks-button");
  await marksTrigger.click();
  const marksSurface = page.locator('#detailToolSurface[data-tool-kind="study-marks"]:not([hidden])');
  await marksSurface.waitFor({ state: "visible", timeout: 10000 });
  await page.locator('#detailToolContent .tag-picker-option[aria-label="Add Favorite tag"]').click();
  await exactCard.locator(".token-target-badges .target-tag-badge").filter({ hasText: "Favorite" }).waitFor({
    state: "visible",
    timeout: 10000,
  });

  const verified = await exactCard.evaluate((node) => ({
    meaning: node.querySelector(".word-meaning-badge")?.textContent.trim() || "",
    marks: [...node.querySelectorAll(".token-target-badges .target-tag-badge-label")].map((badge) => badge.textContent.trim()),
    marksExpanded: node.querySelector(".token-study-marks-button")?.getAttribute("aria-expanded") || "",
  }));
  if (
    verified.meaning !== "origin" ||
    !verified.marks.some((label) => label.includes("Favorite")) ||
    verified.marksExpanded !== "true"
  ) {
    throw new Error(`UI-created personal data did not verify: ${JSON.stringify(verified)}`);
  }
  await closeContainedTool(page, marksSurface, "escape");
  browserHealth.assertClean();
  return { ...tokenIdentity, meaning: verified.meaning, studyMark: "Favorite" };
}

async function openMyData(page) {
  await page.locator("#showMyData").click();
  await page.locator("#detailTitle").filter({ hasText: /^My Data$/ }).waitFor({
    state: "visible",
    timeout: 10000,
  });
  await page.locator(".user-data-panel").waitFor({ state: "visible", timeout: 10000 });
  await page.locator(".study-data-section .user-data-summary").waitFor({ state: "visible", timeout: 10000 });
}

async function verifyMyDataSummary(page) {
  const summary = await page.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll(".study-data-section .user-data-summary-item")].map((item) => [
      item.querySelector("span")?.textContent.trim() || "",
      Number(item.querySelector("strong")?.textContent.trim() || 0),
    ]),
  ));
  if (
    summary["Personal meanings"] !== 1 ||
    summary["Active Study Marks"] !== 1 ||
    summary["Study Mark assertions"] !== 1
  ) {
    throw new Error(`My Data does not reflect the UI-seeded Meaning and Study Mark: ${JSON.stringify(summary)}`);
  }
  const diagnosticsOpen = await page.locator(".advanced-diagnostics").evaluate((node) => node.open);
  if (diagnosticsOpen) throw new Error("Advanced diagnostics must be collapsed for public My Data captures.");
  return summary;
}

async function openExactTokenTool(page, dataSetup, toolKind) {
  const exactCard = page.locator(".interlinear-token")
    .filter({ has: page.locator(`.word-meaning-control[data-target-id="${dataSetup.targetId}"]`) })
    .first();
  await exactCard.waitFor({ state: "visible", timeout: 15000 });
  await exactCard.scrollIntoViewIfNeeded();
  const trigger = toolKind === "meaning"
    ? exactCard.locator(".word-meaning-badge")
    : exactCard.locator(".token-study-marks-button");
  await trigger.click();
  const surface = page.locator(`#detailToolSurface[data-tool-kind="${toolKind}"]:not([hidden])`);
  await surface.waitFor({ state: "visible", timeout: 10000 });
  return { exactCard, surface, trigger };
}

async function assertContainedToolCapture(page, dataSetup, toolKind) {
  const state = await page.evaluate(({ expectedTargetId, expectedToolKind }) => {
    const surface = document.querySelector("#detailToolSurface:not([hidden])");
    const content = document.querySelector("#detailToolContent");
    const workArea = document.querySelector("#detailWorkArea");
    const workspace = document.querySelector("#detailWorkspace");
    const pane = document.querySelector(".detail-pane");
    const rect = (node) => {
      const bounds = node?.getBoundingClientRect();
      return bounds ? { bottom: bounds.bottom, left: bounds.left, right: bounds.right, top: bounds.top } : null;
    };
    return {
      activeInside: Boolean(surface?.contains(document.activeElement)),
      ariaLabelledBy: surface?.getAttribute("aria-labelledby") || "",
      canonicalTargetId: surface?.getAttribute("data-target-id") || "",
      contentOverflow: content ? content.scrollWidth - content.clientWidth : null,
      contentText: content?.textContent || "",
      meaningControls: Boolean(content?.querySelector(".word-meaning-contained")),
      marksControls: Boolean(content?.querySelector(".contained-target-tag-picker")),
      pane: rect(pane),
      position: surface ? getComputedStyle(surface).position : "",
      role: surface?.getAttribute("role") || "",
      surface: rect(surface),
      surfaceCount: document.querySelectorAll("#detailToolSurface:not([hidden])").length,
      surfaceParent: surface?.parentElement?.id || "",
      title: document.querySelector("#detailToolTitle")?.textContent.trim() || "",
      toolKind: surface?.getAttribute("data-tool-kind") || "",
      toolTargetId: surface?.getAttribute("data-tool-target-id") || "",
      unrelatedOverlay: Boolean(document.querySelector(
        ".reader-picker-panel:not([hidden]), .word-meaning-menu:not([hidden]), .target-tag-picker-menu[data-menu-open='true'] .target-tag-picker-popover",
      )),
      workAreaInert: Boolean(workArea?.inert && workArea.getAttribute("aria-hidden") === "true"),
      workspace: rect(workspace),
      expectedTargetId,
      expectedToolKind,
    };
  }, { expectedTargetId: dataSetup.targetId, expectedToolKind: toolKind });
  const container = state.workspace || state.pane;
  if (
    state.surfaceCount !== 1 ||
    state.surfaceParent !== "detailWorkspace" ||
    state.position === "fixed" ||
    state.role !== "dialog" ||
    state.ariaLabelledBy !== "detailToolTitle" ||
    state.toolKind !== toolKind ||
    state.canonicalTargetId !== dataSetup.targetId ||
    state.toolTargetId !== dataSetup.targetId ||
    state.title !== (toolKind === "meaning" ? "Meaning" : "Study Marks") ||
    !state.workAreaInert ||
    !state.activeInside ||
    state.contentOverflow > 1 ||
    !state.surface ||
    !container ||
    state.surface.left < container.left - 1 ||
    state.surface.right > container.right + 1 ||
    state.surface.top < container.top - 1 ||
    state.surface.bottom > container.bottom + 1 ||
    state.unrelatedOverlay ||
    (toolKind === "meaning" && (!state.meaningControls || state.marksControls)) ||
    (toolKind === "study-marks" && (!state.marksControls || state.meaningControls))
  ) {
    throw new Error(`Contained ${toolKind} capture state is invalid: ${JSON.stringify(state)}`);
  }
}

async function closeContainedTool(page, surface, method = "escape") {
  if (method === "close") await page.locator("#detailToolClose").click();
  else await page.keyboard.press("Escape");
  await surface.waitFor({ state: "hidden", timeout: 10000 });
  await page.waitForFunction(() => {
    const workArea = document.querySelector("#detailWorkArea");
    const content = document.querySelector("#detailToolContent");
    const closedSurface = document.querySelector("#detailToolSurface");
    return Boolean(
      closedSurface?.hidden &&
      closedSurface.getAttribute("aria-hidden") === "true" &&
      !closedSurface.hasAttribute("data-tool-kind") &&
      !closedSurface.hasAttribute("data-target-id") &&
      !closedSurface.hasAttribute("data-tool-target-id") &&
      !content?.childElementCount &&
      !workArea?.inert &&
      workArea?.getAttribute("aria-hidden") !== "true"
    );
  });
}

async function removeOwnedDirectory(path) {
  await rm(path, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}

async function promoteGeneratedScreenshots(stagingRoot, backupRoot) {
  const expectedFiles = PUBLIC_SCREENSHOT_MANIFEST.map(({ filename }) => filename);
  const expectedEntries = [...expectedFiles, "SCREENSHOTS.md"].sort();
  const stagedEntries = (await readdir(stagingRoot)).sort();
  if (JSON.stringify(stagedEntries) !== JSON.stringify(expectedEntries)) {
    throw new Error(`Staged public screenshot set is incomplete or unexpected: ${JSON.stringify(stagedEntries)}`);
  }
  const currentEntries = (await readdir(outputRoot)).sort();
  const allowedCurrentEntries = new Set([...expectedEntries, ...retiredScreenshots]);
  const unexpectedCurrentEntries = currentEntries.filter((entry) => !allowedCurrentEntries.has(entry));
  if (unexpectedCurrentEntries.length) {
    throw new Error(`Refusing to replace docs/images with unexpected files present: ${unexpectedCurrentEntries.join(", ")}`);
  }

  await removeOwnedDirectory(backupRoot);
  let existingMoved = false;
  try {
    await rename(outputRoot, backupRoot);
    existingMoved = true;
    await rename(stagingRoot, outputRoot);
  } catch (error) {
    const rollbackErrors = [];
    if (existingMoved && !existsSync(outputRoot) && existsSync(backupRoot)) {
      try {
        await rename(backupRoot, outputRoot);
      } catch (rollbackError) {
        rollbackErrors.push(new Error(
          `Could not restore the prior screenshot directory from ${backupRoot} to ${outputRoot}: ${rollbackError.message}`,
          { cause: rollbackError },
        ));
      }
    }
    if (rollbackErrors.length) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "Public screenshot promotion and rollback failed.",
      );
    }
    throw error;
  }
  await removeOwnedDirectory(backupRoot);
}

async function main() {
  const generated = new Set();
  let context;
  let edgePath = "";
  let edgeVersion = "";
  let dataSetup = null;
  let myDataSummary = null;
  let localServer = null;
  let primaryError = null;
  let backupRoot = "";
  let profileRoot = "";
  let stagingRoot = "";

  try {
    await mkdir(outputRoot, { recursive: true });
    await mkdir(resolve(outputRoot, ".."), { recursive: true });
    await mkdir(evidenceRoot, { recursive: true });
    stagingRoot = await mkdtemp(resolve(outputRoot, "..", ".public-screenshots-"));
    profileRoot = await mkdtemp(resolve(evidenceRoot, "edge-profile-"));
    localServer = await startAppServer();
    edgePath = findEdgePath();
    context = await chromium.launchPersistentContext(profileRoot, {
      executablePath: edgePath,
      headless: true,
      viewport: { width: 1365, height: 768 },
      deviceScaleFactor: 1,
      args: [
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-background-networking",
        "--disable-extensions",
        "--no-first-run",
        "--no-default-browser-check",
      ],
    });
    await context.addInitScript(({ key, mode }) => {
      localStorage.setItem(key, mode);
    }, { key: STUDY_WORKSPACE_WIDTH_STORAGE_KEY, mode: STANDARD_STUDY_WORKSPACE_WIDTH });
    const page = await context.newPage();
    const browserHealth = attachBrowserIssueCapture(page, localServer.url);
    const versionSession = await context.newCDPSession(page);
    const versionInfo = await versionSession.send("Browser.getVersion");
    edgeVersion = versionInfo.product || "";

    await openReader(page, browserHealth, localServer.url, "reader.png", "Psalms 23");
    await captureNamed(page, browserHealth, generated, stagingRoot, "reader.png");

    await openReader(page, browserHealth, localServer.url, "reader-dark.png", "Psalms 23");
    await captureNamed(page, browserHealth, generated, stagingRoot, "reader-dark.png");

    await openReader(page, browserHealth, localServer.url, "book-picker.png", "Psalms 23");
    await page.locator("#bookPickerButton").click();
    await page.locator("#bookPickerPanel").waitFor({ state: "visible", timeout: 10000 });
    await captureNamed(page, browserHealth, generated, stagingRoot, "book-picker.png");
    await page.locator("#bookPickerButton").click();
    await page.locator("#bookPickerPanel").waitFor({ state: "hidden", timeout: 10000 });

    for (const filename of ["detail-panel.png", "detail-panel-dark.png"]) {
      await openReader(page, browserHealth, localServer.url, filename, "John 1");
      await openVerseStudy(page);
      await openLanguageStudy(page);
      await openStrongDetail(page, "G1722", "Greek");
      await captureNamed(page, browserHealth, generated, stagingRoot, filename);
    }

    await openReader(page, browserHealth, localServer.url, "verse-context-controls.png", "Psalms 118");
    await openVerseStudy(page, 4);
    const verseContext = await page.evaluate(() => ({
      groups: [...document.querySelectorAll("#detailContext .panel-context-group")].map((node) => node.dataset.panelScope),
      hasChapterOrBook: Boolean(document.querySelector(
        "#detailContext [data-panel-scope='chapter'], #detailContext [data-panel-scope='book']",
      )),
      title: document.querySelector("#detailTitle")?.textContent.trim() || "",
    }));
    if (verseContext.title !== "Cross References" || verseContext.hasChapterOrBook || verseContext.groups.join(" ") !== "verse") {
      throw new Error(`Verse context controls do not match the accepted Standard workspace model: ${JSON.stringify(verseContext)}`);
    }
    await captureNamed(page, browserHealth, generated, stagingRoot, "verse-context-controls.png");

    for (const filename of ["interlinear.png", "interlinear-dark.png"]) {
      await openReader(page, browserHealth, localServer.url, filename, "John 11");
      await openVerseStudy(page, 35);
      await openLanguageStudy(page);
      await frameLanguageStudy(page, 35);
      await captureNamed(page, browserHealth, generated, stagingRoot, filename);
    }

    for (const filename of ["hebrew-side-panel.png", "hebrew-side-panel-dark.png"]) {
      await openReader(page, browserHealth, localServer.url, filename, "Proverbs 1");
      await openVerseStudy(page);
      await openLanguageStudy(page);
      await openStrongDetail(page, "H4912", "Hebrew");
      await captureNamed(page, browserHealth, generated, stagingRoot, filename);
    }

    await openReader(page, browserHealth, localServer.url, "search.png", "Proverbs 1");
    await page.locator("#showSearch").click();
    await page.locator("#detailTitle").filter({ hasText: /^Search$/ }).waitFor({
      state: "visible",
      timeout: 10000,
    });
    await page.locator(".search-form input[name='query']").fill("discernment");
    await page.locator(".search-form input[name='limit']").fill("10");
    await page.locator(".search-form button[type='submit']").click();
    await page.locator(".search-result").first().waitFor({ state: "visible", timeout: 15000 });
    await page.waitForFunction(
      () => document.querySelector(".search-result")?.textContent.toLocaleLowerCase().includes("discernment"),
      null,
      { timeout: 15000 },
    );
    if (await page.locator(".search-result").count() !== 3) {
      throw new Error("The deterministic public search capture must contain exactly three complete results.");
    }
    await captureNamed(page, browserHealth, generated, stagingRoot, "search.png");

    dataSetup = await seedPersonalData(page, browserHealth, localServer.url);
    await setCaptureEnvironment(page, browserHealth, "meaning.png");
    const meaningTool = await openExactTokenTool(page, dataSetup, "meaning");
    await page.locator("#detailToolContent .word-meaning-saved-actions").filter({ hasText: "Saved: origin" }).waitFor({
      state: "visible",
      timeout: 10000,
    });
    await page.locator('#detailToolContent .word-meaning-option[data-source="exact_bsb"]').filter({
      hasText: /^the beginning$/,
    }).waitFor({ state: "visible", timeout: 15000 });
    await page.locator('#detailToolContent .word-meaning-option[data-source="lexicon"]').waitFor({
      state: "visible",
      timeout: 15000,
    });
    if (await page.locator("#detailToolContent .tag-picker-option").count()) {
      throw new Error("Meaning capture overlaps Study Marks controls.");
    }
    await assertContainedToolCapture(page, dataSetup, "meaning");
    await captureNamed(page, browserHealth, generated, stagingRoot, "meaning.png");
    await closeContainedTool(page, meaningTool.surface, "escape");

    await setCaptureEnvironment(page, browserHealth, "study-marks.png");
    const studyMarksTool = await openExactTokenTool(page, dataSetup, "study-marks");
    const capturedFavorite = page.locator(
      '#detailToolContent .tag-picker-option[aria-label="Remove Favorite tag"][aria-pressed="true"]',
    );
    await capturedFavorite.waitFor({ state: "visible", timeout: 10000 });
    const marksIdentity = await page.locator("#detailToolContent").evaluate((node) => ({
      preview: node.querySelector(".target-tag-picker-preview")?.textContent.trim() || "",
      target: node.querySelector(".tag-picker-title")?.textContent.trim() || "",
    }));
    if (
      !marksIdentity.target.includes("John 1:1") ||
      !marksIdentity.target.includes("archē") ||
      !marksIdentity.preview.includes("the beginning")
    ) {
      throw new Error(`Contained Study Marks lost exact-token identity: ${JSON.stringify(marksIdentity)}`);
    }
    await assertContainedToolCapture(page, dataSetup, "study-marks");
    await captureNamed(page, browserHealth, generated, stagingRoot, "study-marks.png");
    await closeContainedTool(page, studyMarksTool.surface, "close");

    await page.locator("#showTags").click();
    await page.locator("#detailTitle").filter({ hasText: /^Study Marks$/ }).waitFor({
      state: "visible",
      timeout: 10000,
    });
    await page.waitForFunction(
      () => {
        const detail = document.querySelector("#detailContent");
        const item = [...(detail?.querySelectorAll(".study-mark-item") || [])].find(
          (node) => node.textContent.includes("John 1:1") && node.textContent.includes("Source word"),
        );
        const text = detail?.textContent || "";
        return Boolean(
          item &&
          text.includes("Favorites (1)") &&
          text.includes("Source-word tags (1)") &&
          text.includes("All marked items (1)") &&
          item.querySelector(".study-mark-preview")?.textContent.includes("archē") &&
          item.querySelector(".study-mark-preview")?.textContent.includes("G746"),
        );
      },
      null,
      { timeout: 10000 },
    );
    await scrollDetailToTop(page);
    await setCaptureEnvironment(page, browserHealth, "study-marks-dark.png");
    await captureNamed(page, browserHealth, generated, stagingRoot, "study-marks-dark.png");

    await setCaptureEnvironment(page, browserHealth, "my-data.png");
    await openMyData(page);
    myDataSummary = await verifyMyDataSummary(page);
    await scrollDetailToTop(page);
    const diagnostics = page.locator(".advanced-diagnostics");
    await diagnostics.waitFor({ state: "visible", timeout: 10000 });
    const diagnosticsFrame = await diagnostics.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return {
        open: node.open,
        top: rect.top,
        bottom: rect.bottom,
        viewportHeight: window.innerHeight,
      };
    });
    if (
      diagnosticsFrame.open ||
      diagnosticsFrame.top < 0 ||
      diagnosticsFrame.bottom > diagnosticsFrame.viewportHeight
    ) {
      throw new Error(`Advanced diagnostics is not visibly collapsed: ${JSON.stringify(diagnosticsFrame)}`);
    }
    await captureNamed(page, browserHealth, generated, stagingRoot, "my-data.png");

    await setCaptureEnvironment(page, browserHealth, "my-data-backup-restore.png");
    if (await page.locator(".manual-json-panel[open]").count()) {
      throw new Error("Backup JSON disclosures must remain collapsed for the public capture.");
    }
    await scrollSectionIntoView(page, ".backup-restore-section");
    const backupControls = await page.evaluate(() => {
      const section = document.querySelector(".backup-restore-section");
      const text = section?.textContent || "";
      const bounds = section?.getBoundingClientRect();
      return {
        bottom: bounds?.bottom ?? Number.POSITIVE_INFINITY,
        download: text.includes("Download backup"),
        choose: text.includes("Choose backup file"),
        copyDisclosure: text.includes("Show or copy backup JSON"),
        pasteDisclosure: text.includes("Paste backup JSON"),
        merge: text.includes("Merge backup"),
        replace: text.includes("Replace all local data"),
        top: bounds?.top ?? Number.NEGATIVE_INFINITY,
        viewportHeight: window.innerHeight,
      };
    });
    if (
      !backupControls.download ||
      !backupControls.choose ||
      !backupControls.copyDisclosure ||
      !backupControls.pasteDisclosure ||
      !backupControls.merge ||
      !backupControls.replace ||
      backupControls.top < 0 ||
      backupControls.bottom > backupControls.viewportHeight - 12
    ) {
      throw new Error(`Backup and restore controls are incomplete: ${JSON.stringify(backupControls)}`);
    }
    await captureNamed(page, browserHealth, generated, stagingRoot, "my-data-backup-restore.png");

    await setCaptureEnvironment(page, browserHealth, "my-data-maintenance.png");
    const maintenanceButton = page.locator(".maintenance-section button").filter({
      hasText: /^Refresh Study Marks index$/,
    });
    await scrollSectionIntoView(page, ".maintenance-section");
    await maintenanceButton.click();
    await page.waitForFunction(
      () => {
        const text = document.querySelector(".maintenance-status")?.textContent || "";
        const button = [...document.querySelectorAll(".maintenance-section button")].find(
          (node) => node.textContent.trim() === "Refresh Study Marks index",
        );
        return (
          text === "Study Marks index refreshed for 1 scripture reference(s). Personal study data was not changed." &&
          !document.querySelector(".maintenance-status.error") &&
          !button?.disabled
        );
      },
      null,
      { timeout: 15000 },
    );
    await scrollSectionIntoView(page, ".maintenance-section");
    await verifyMyDataSummary(page);
    await captureNamed(page, browserHealth, generated, stagingRoot, "my-data-maintenance.png");

    await openReader(page, browserHealth, localServer.url, "mobile.png", "Psalms 118");
    await openVerseStudy(page, 4);
    await ensureMobileDetailVisible(page);
    await captureNamed(page, browserHealth, generated, stagingRoot, "mobile.png");

    await openReader(page, browserHealth, localServer.url, "mobile-dark.png", "John 1");
    await openMyData(page);
    await ensureMobileDetailVisible(page);
    await verifyMyDataSummary(page);
    await scrollDetailToTop(page);
    await captureNamed(page, browserHealth, generated, stagingRoot, "mobile-dark.png");

    browserHealth.setState("finalize");
    browserHealth.assertClean();
    const expectedFiles = PUBLIC_SCREENSHOT_MANIFEST.map(({ filename }) => filename);
    const missing = expectedFiles.filter((filename) => !generated.has(filename));
    const unexpected = [...generated].filter((filename) => !expectedFiles.includes(filename));
    if (missing.length || unexpected.length || generated.size !== expectedFiles.length) {
      throw new Error(`Generated public screenshot set drifted: ${JSON.stringify({ missing, unexpected })}`);
    }

    await writeFile(
      resolve(stagingRoot, "SCREENSHOTS.md"),
      renderScreenshotInventory(),
      "utf8",
    );
    backupRoot = `${outputRoot}.public-screenshot-backup-${process.pid}`;
    await promoteGeneratedScreenshots(stagingRoot, backupRoot);
    backupRoot = "";
    stagingRoot = "";
    console.log(JSON.stringify({
      status: "ok",
      output: "docs/images",
      files: expectedFiles,
      dataSetup,
      myDataSummary,
      browserIssues: browserHealth.issues,
      environment: {
        edgeExecutable: edgePath,
        edgeVersion,
        playwrightVersion,
        headless: true,
        deviceScaleFactor: 1,
        viewports: [...new Map(
          PUBLIC_SCREENSHOT_MANIFEST.map(({ viewport }) => [`${viewport.width}x${viewport.height}`, viewport]),
        ).values()],
      },
    }, null, 2));
  } catch (error) {
    primaryError = error;
  } finally {
    const cleanupErrors = [];
    if (context) {
      try {
        await context.close();
      } catch (error) {
        cleanupErrors.push(new Error(`Could not close Edge: ${error.message}`, { cause: error }));
      }
    }
    if (localServer?.server) {
      try {
        localServer.server.closeAllConnections?.();
        await new Promise((resolveClose, rejectClose) => {
          localServer.server.close((error) => error ? rejectClose(error) : resolveClose());
        });
      } catch (error) {
        cleanupErrors.push(new Error(`Could not stop the screenshot server: ${error.message}`, { cause: error }));
      }
    }
    for (const [label, path] of [
      ["staging output", stagingRoot],
      ["prior screenshot backup", backupRoot],
      ["Edge profile", profileRoot],
    ]) {
      if (!path) continue;
      if (
        label === "prior screenshot backup" &&
        existsSync(path) &&
        !existsSync(outputRoot)
      ) {
        cleanupErrors.push(new Error(
          `Preserved the only prior screenshot backup at ${path} because ${outputRoot} is absent.`,
        ));
        continue;
      }
      try {
        await removeOwnedDirectory(path);
      } catch (error) {
        cleanupErrors.push(new Error(`Could not remove ${label}: ${error.message}`, { cause: error }));
      }
    }
    if (primaryError) {
      if (cleanupErrors.length) primaryError.cleanupErrors = cleanupErrors;
      throw primaryError;
    }
    if (cleanupErrors.length) {
      throw new AggregateError(cleanupErrors, "Public screenshot cleanup failed.");
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
