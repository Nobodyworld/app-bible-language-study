#!/usr/bin/env node

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
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
const require = createRequire(import.meta.url);
const playwrightVersion = require("playwright-core/package.json").version;

const DESKTOP_VIEWPORT = Object.freeze({ width: 1365, height: 768 });
const BOOK_PICKER_VIEWPORT = Object.freeze({ width: 1365, height: 631 });
const STRONG_DETAIL_VIEWPORT = Object.freeze({ width: 1365, height: 520 });
const LANGUAGE_STUDY_VIEWPORT = Object.freeze({ width: 1365, height: 1420 });
const STUDY_MARKS_VIEWPORT = Object.freeze({ width: 1365, height: 670 });
const MY_DATA_SUMMARY_VIEWPORT = Object.freeze({ width: 1365, height: 1450 });
const MY_DATA_BACKUP_VIEWPORT = Object.freeze({ width: 1365, height: 525 });
const MY_DATA_MAINTENANCE_VIEWPORT = Object.freeze({ width: 1365, height: 480 });
const MOBILE_VIEWPORT = Object.freeze({ width: 390, height: 844 });

export const PUBLIC_SCREENSHOT_MANIFEST = Object.freeze([
  {
    filename: "reader.png",
    route: "/#/read/bsb/psalms/23",
    viewport: DESKTOP_VIEWPORT,
    theme: "light",
    intendedState: "Psalm 23 reader",
  },
  {
    filename: "reader-dark.png",
    route: "/#/read/bsb/psalms/23",
    viewport: DESKTOP_VIEWPORT,
    theme: "dark",
    intendedState: "Psalm 23 reader",
  },
  {
    filename: "book-picker.png",
    route: "/#/read/bsb/psalms/23",
    viewport: BOOK_PICKER_VIEWPORT,
    theme: "light",
    intendedState: "open book picker",
  },
  {
    filename: "detail-panel.png",
    route: "/#/read/bsb/john/1/1",
    viewport: STRONG_DETAIL_VIEWPORT,
    theme: "light",
    intendedState: "compact Word to Verse exact-token detail",
  },
  {
    filename: "detail-panel-dark.png",
    route: "/#/read/bsb/john/1/1",
    viewport: STRONG_DETAIL_VIEWPORT,
    theme: "dark",
    intendedState: "compact Word to Verse exact-token detail",
  },
  {
    filename: "verse-context-controls.png",
    route: "/#/read/bsb/psalms/118/4",
    viewport: DESKTOP_VIEWPORT,
    theme: "light",
    intendedState: "Verse context controls",
  },
  {
    filename: "interlinear.png",
    route: "/#/read/bsb/john/11/35",
    viewport: LANGUAGE_STUDY_VIEWPORT,
    theme: "light",
    intendedState: "Language Study",
  },
  {
    filename: "interlinear-dark.png",
    route: "/#/read/bsb/john/11/35",
    viewport: LANGUAGE_STUDY_VIEWPORT,
    theme: "dark",
    intendedState: "Language Study",
  },
  {
    filename: "hebrew-side-panel.png",
    route: "/#/read/bsb/proverbs/1/1",
    viewport: STRONG_DETAIL_VIEWPORT,
    theme: "light",
    intendedState: "exact Hebrew H4912 Strong's detail",
  },
  {
    filename: "hebrew-side-panel-dark.png",
    route: "/#/read/bsb/proverbs/1/1",
    viewport: STRONG_DETAIL_VIEWPORT,
    theme: "dark",
    intendedState: "exact Hebrew H4912 Strong's detail",
  },
  {
    filename: "search.png",
    route: "/#/read/bsb/proverbs/1/1",
    viewport: DESKTOP_VIEWPORT,
    theme: "light",
    intendedState: "search for wisdom with populated results",
  },
  {
    filename: "study-marks.png",
    route: "/#/read/bsb/john/1/1",
    viewport: STUDY_MARKS_VIEWPORT,
    theme: "light",
    intendedState: "seeded exact-token Favorite in Study Marks",
  },
  {
    filename: "study-marks-dark.png",
    route: "/#/read/bsb/john/1/1",
    viewport: STUDY_MARKS_VIEWPORT,
    theme: "dark",
    intendedState: "seeded exact-token Favorite in Study Marks",
  },
  {
    filename: "meaning.png",
    route: "/#/read/bsb/john/1/1",
    viewport: DESKTOP_VIEWPORT,
    theme: "light",
    intendedState: "saved exact-token Meaning dialog",
  },
  {
    filename: "my-data.png",
    route: "/#/read/bsb/john/1/1",
    viewport: MY_DATA_SUMMARY_VIEWPORT,
    theme: "light",
    intendedState: "My study data summary",
  },
  {
    filename: "my-data-backup-restore.png",
    route: "/#/read/bsb/john/1/1",
    viewport: MY_DATA_BACKUP_VIEWPORT,
    theme: "light",
    intendedState: "Backup and restore controls",
  },
  {
    filename: "my-data-maintenance.png",
    route: "/#/read/bsb/john/1/1",
    viewport: MY_DATA_MAINTENANCE_VIEWPORT,
    theme: "light",
    intendedState: "completed local Study Marks maintenance",
  },
  {
    filename: "mobile.png",
    route: "/#/read/bsb/psalms/118/4",
    viewport: MOBILE_VIEWPORT,
    theme: "light",
    intendedState: "open mobile Verse study panel",
  },
  {
    filename: "mobile-dark.png",
    route: "/#/read/bsb/john/1/1",
    viewport: MOBILE_VIEWPORT,
    theme: "dark",
    intendedState: "mobile My Data summary",
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

function attachBrowserIssueCapture(page) {
  const issues = [];
  let activeState = "bootstrap";
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

async function captureNamed(page, browserHealth, generated, filename) {
  const descriptor = captureDescriptor(filename);
  if (generated.has(filename)) throw new Error(`Screenshot was generated more than once: ${filename}`);
  const viewport = page.viewportSize();
  if (viewport?.width !== descriptor.viewport.width || viewport?.height !== descriptor.viewport.height) {
    throw new Error(
      `Viewport drift before ${filename}: expected ${descriptor.viewport.width}x${descriptor.viewport.height}, got ${viewport?.width}x${viewport?.height}`,
    );
  }
  const theme = await page.evaluate(() => document.documentElement.dataset.theme || "");
  if (theme !== descriptor.theme) {
    throw new Error(`Theme drift before ${filename}: expected ${descriptor.theme}, got ${theme || "<unset>"}`);
  }
  await settleForCapture(page);
  browserHealth.assertClean();
  await page.screenshot({
    path: resolve(outputRoot, filename),
    fullPage: false,
    animations: "disabled",
    caret: "hide",
  });
  generated.add(filename);
}

async function setTheme(page, theme) {
  await page.evaluate((nextTheme) => {
    localStorage.setItem("bibleAppTheme", nextTheme);
    document.documentElement.setAttribute("data-theme", nextTheme);
  }, theme);
  await page.waitForFunction(
    (expectedTheme) => document.documentElement.dataset.theme === expectedTheme,
    theme,
  );
}

async function setCaptureEnvironment(page, browserHealth, filename) {
  const descriptor = captureDescriptor(filename);
  browserHealth.setState(filename);
  await page.setViewportSize(descriptor.viewport);
  await setTheme(page, descriptor.theme);
  return descriptor;
}

async function openReader(page, browserHealth, baseUrl, filename, expectedTitle) {
  const descriptor = captureDescriptor(filename);
  browserHealth.setState(filename);
  await page.setViewportSize(descriptor.viewport);
  await page.goto(`${baseUrl}${descriptor.route}`);
  await waitForApp(page);
  await setTheme(page, descriptor.theme);
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
  if (!targetId || tokenIdentity.strongCode !== "G746" || tokenIdentity.tokenIndex !== "2") {
    throw new Error(`Could not resolve deterministic exact-token identity: ${JSON.stringify(tokenIdentity)}`);
  }

  await card.locator(".word-meaning-trigger").click();
  const meaningDialog = card.locator('.word-meaning-menu[role="dialog"]:not([hidden])');
  await meaningDialog.waitFor({ state: "visible", timeout: 10000 });
  await meaningDialog.locator(".word-meaning-other").click();
  await meaningDialog.locator(".word-meaning-custom-input").fill("origin");
  await meaningDialog.locator(".word-meaning-save").click();

  const exactCard = page.locator(".interlinear-token")
    .filter({ has: page.locator(`.word-meaning-control[data-target-id="${targetId}"]`) })
    .first();
  await exactCard.locator(".word-meaning-badge").filter({ hasText: /^origin$/ }).waitFor({
    state: "visible",
    timeout: 10000,
  });
  const marksTrigger = exactCard.locator(".token-study-marks-button");
  await marksTrigger.focus();
  const marksMenu = exactCard.locator(".study-marks-menu");
  await page.waitForFunction(
    (id) => document.querySelector(`.word-meaning-control[data-target-id="${id}"]`)
      ?.closest(".interlinear-token")
      ?.querySelector(".study-marks-menu")
      ?.dataset.menuOpen === "true",
    targetId,
  );
  await marksMenu.locator('.tag-picker-option[aria-label="Add Favorite tag"]').click();
  await exactCard.locator(".token-target-badges .target-tag-badge").filter({ hasText: "Favorite" }).waitFor({
    state: "visible",
    timeout: 10000,
  });

  const verified = await exactCard.evaluate((node) => ({
    meaning: node.querySelector(".word-meaning-badge")?.textContent.trim() || "",
    marks: [...node.querySelectorAll(".token-target-badges .target-tag-badge-label")].map((badge) => badge.textContent.trim()),
    marksOpen: node.querySelector(".study-marks-menu")?.dataset.menuOpen === "true",
  }));
  if (verified.meaning !== "origin" || !verified.marks.some((label) => label.includes("Favorite"))) {
    throw new Error(`UI-created personal data did not verify: ${JSON.stringify(verified)}`);
  }
  if (verified.marksOpen) {
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      (id) => document.querySelector(`.word-meaning-control[data-target-id="${id}"]`)
        ?.closest(".interlinear-token")
        ?.querySelector(".study-marks-menu")
        ?.dataset.menuOpen !== "true",
      targetId,
    );
  }
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

async function main() {
  await mkdir(outputRoot, { recursive: true });
  const localServer = await startAppServer();
  const edgePath = findEdgePath();
  const generated = new Set();
  let browser;
  let edgeVersion = "";
  let dataSetup = null;
  let myDataSummary = null;

  try {
    browser = await chromium.launch({
      executablePath: edgePath,
      headless: true,
      args: [
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-background-networking",
        "--disable-extensions",
        "--no-first-run",
        "--no-default-browser-check",
      ],
    });

    const context = await browser.newContext({
      viewport: { width: 1365, height: 768 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const browserHealth = attachBrowserIssueCapture(page);
    edgeVersion = browser.version();

    await openReader(page, browserHealth, localServer.url, "reader.png", "Psalms 23");
    await captureNamed(page, browserHealth, generated, "reader.png");

    await openReader(page, browserHealth, localServer.url, "reader-dark.png", "Psalms 23");
    await captureNamed(page, browserHealth, generated, "reader-dark.png");

    await openReader(page, browserHealth, localServer.url, "book-picker.png", "Psalms 23");
    await page.locator("#bookPickerButton").click();
    await page.locator("#bookPickerPanel").waitFor({ state: "visible", timeout: 10000 });
    await captureNamed(page, browserHealth, generated, "book-picker.png");
    await page.locator("#bookPickerButton").click();
    await page.locator("#bookPickerPanel").waitFor({ state: "hidden", timeout: 10000 });

    for (const filename of ["detail-panel.png", "detail-panel-dark.png"]) {
      await openReader(page, browserHealth, localServer.url, filename, "John 1");
      await openVerseStudy(page);
      await openLanguageStudy(page);
      await openStrongDetail(page, "G1722", "Greek");
      await captureNamed(page, browserHealth, generated, filename);
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
      throw new Error(`Verse context controls do not match the accepted compact model: ${JSON.stringify(verseContext)}`);
    }
    await captureNamed(page, browserHealth, generated, "verse-context-controls.png");

    for (const filename of ["interlinear.png", "interlinear-dark.png"]) {
      await openReader(page, browserHealth, localServer.url, filename, "John 11");
      await openVerseStudy(page, 35);
      await openLanguageStudy(page);
      await frameLanguageStudy(page, 35);
      await captureNamed(page, browserHealth, generated, filename);
    }

    for (const filename of ["hebrew-side-panel.png", "hebrew-side-panel-dark.png"]) {
      await openReader(page, browserHealth, localServer.url, filename, "Proverbs 1");
      await openVerseStudy(page);
      await openLanguageStudy(page);
      await openStrongDetail(page, "H4912", "Hebrew");
      await captureNamed(page, browserHealth, generated, filename);
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
    await captureNamed(page, browserHealth, generated, "search.png");

    dataSetup = await seedPersonalData(page, browserHealth, localServer.url);
    await setCaptureEnvironment(page, browserHealth, "meaning.png");
    const meaningCard = page.locator(".interlinear-token")
      .filter({ has: page.locator(`.word-meaning-control[data-target-id="${dataSetup.targetId}"]`) })
      .first();
    await meaningCard.scrollIntoViewIfNeeded();
    await meaningCard.locator(".word-meaning-trigger").click();
    const savedMeaningDialog = meaningCard.locator('.word-meaning-menu[role="dialog"]:not([hidden])');
    await savedMeaningDialog.waitFor({ state: "visible", timeout: 10000 });
    await savedMeaningDialog.locator(".word-meaning-saved-actions").filter({ hasText: "Saved: origin" }).waitFor({
      state: "visible",
      timeout: 10000,
    });
    await savedMeaningDialog.locator('.word-meaning-option[data-source="exact_bsb"]').waitFor({
      state: "visible",
      timeout: 15000,
    });
    await savedMeaningDialog.locator('.word-meaning-option[data-source="lexicon"]').waitFor({
      state: "visible",
      timeout: 15000,
    });
    if (await meaningCard.locator('.study-marks-menu[data-menu-open="true"]').count()) {
      throw new Error("Meaning capture cannot overlap an open Study Marks menu.");
    }
    await captureNamed(page, browserHealth, generated, "meaning.png");
    await page.keyboard.press("Escape");
    await savedMeaningDialog.waitFor({ state: "hidden", timeout: 10000 });

    await setCaptureEnvironment(page, browserHealth, "study-marks.png");
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
    await captureNamed(page, browserHealth, generated, "study-marks.png");
    await setCaptureEnvironment(page, browserHealth, "study-marks-dark.png");
    await captureNamed(page, browserHealth, generated, "study-marks-dark.png");

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
    await captureNamed(page, browserHealth, generated, "my-data.png");

    await setCaptureEnvironment(page, browserHealth, "my-data-backup-restore.png");
    if (await page.locator(".manual-json-panel[open]").count()) {
      throw new Error("Backup JSON disclosures must remain collapsed for the public capture.");
    }
    await scrollSectionIntoView(page, ".backup-restore-section");
    const backupControls = await page.evaluate(() => {
      const section = document.querySelector(".backup-restore-section");
      const text = section?.textContent || "";
      return {
        download: text.includes("Download backup"),
        choose: text.includes("Choose backup file"),
        copyDisclosure: text.includes("Show or copy backup JSON"),
        pasteDisclosure: text.includes("Paste backup JSON"),
        merge: text.includes("Merge backup"),
        replace: text.includes("Replace all local data"),
      };
    });
    if (Object.values(backupControls).some((available) => !available)) {
      throw new Error(`Backup and restore controls are incomplete: ${JSON.stringify(backupControls)}`);
    }
    await captureNamed(page, browserHealth, generated, "my-data-backup-restore.png");

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
    await captureNamed(page, browserHealth, generated, "my-data-maintenance.png");

    await openReader(page, browserHealth, localServer.url, "mobile.png", "Psalms 118");
    await openVerseStudy(page, 4);
    await ensureMobileDetailVisible(page);
    await captureNamed(page, browserHealth, generated, "mobile.png");

    await openReader(page, browserHealth, localServer.url, "mobile-dark.png", "John 1");
    await openMyData(page);
    await ensureMobileDetailVisible(page);
    await verifyMyDataSummary(page);
    await scrollDetailToTop(page);
    await captureNamed(page, browserHealth, generated, "mobile-dark.png");

    browserHealth.setState("finalize");
    browserHealth.assertClean();
    const expectedFiles = PUBLIC_SCREENSHOT_MANIFEST.map(({ filename }) => filename);
    const missing = expectedFiles.filter((filename) => !generated.has(filename));
    const unexpected = [...generated].filter((filename) => !expectedFiles.includes(filename));
    if (missing.length || unexpected.length || generated.size !== expectedFiles.length) {
      throw new Error(`Generated public screenshot set drifted: ${JSON.stringify({ missing, unexpected })}`);
    }

    for (const filename of retiredScreenshots) {
      try {
        await unlink(resolve(outputRoot, filename));
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    await writeFile(
      resolve(outputRoot, "SCREENSHOTS.md"),
      renderScreenshotInventory(),
      "utf8",
    );
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
  } finally {
    if (browser) await browser.close();
    await new Promise((resolveClose) => localServer.server.close(resolveClose));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
