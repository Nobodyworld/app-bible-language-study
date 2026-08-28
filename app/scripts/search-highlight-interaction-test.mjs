#!/usr/bin/env node

import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { startStaticAppServer } from "../tools/serve-app.mjs";

const EDGE_PATHS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Copilot\\Application\\msedge.exe",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function srgbChannel(value) {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function rgb(value) {
  const channels = String(value).match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length !== 3) throw new Error(`Unsupported computed color: ${value}`);
  return channels;
}

function luminance(value) {
  const [red, green, blue] = rgb(value).map(srgbChannel);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground, background) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

async function waitForReader(page) {
  await page.waitForFunction(
    () =>
      document.querySelector("#chapterTitle")?.textContent.includes("Proverbs 1") &&
      document.querySelector("#statusText")?.textContent.includes("data loaded") &&
      document.querySelectorAll(".strong-token").length > 0,
    undefined,
    { timeout: 30_000 },
  );
}

async function openPopulatedSearch(page) {
  await page.locator("#showSearch").click();
  await page.waitForFunction(() => document.querySelector("#detailTitle")?.textContent === "Search");
  await page.locator('.search-form input[name="query"]').fill("wisdom");
  await page.locator('.search-form button[type="submit"]').click();
  await page.waitForFunction(
    () => document.querySelector(".search-result")?.textContent.includes("Proverbs 1:2"),
    undefined,
    { timeout: 15_000 },
  );
  await page.waitForSelector(".search-result-text mark", { state: "visible" });
}

async function captureSearchMatch(page) {
  return page.locator(".search-result-text mark").first().evaluate((mark) => {
    const style = getComputedStyle(mark);
    const parentStyle = getComputedStyle(mark.parentElement);
    const rootStyle = getComputedStyle(document.documentElement);
    const bounds = mark.getBoundingClientRect();
    const resultBounds = mark.closest(".search-result").getBoundingClientRect();
    return {
      text: mark.textContent,
      color: style.color,
      background: style.backgroundColor,
      parentColor: parentStyle.color,
      parentBackground: parentStyle.backgroundColor,
      forcedColorAdjust: style.forcedColorAdjust,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      contractBackground: rootStyle.getPropertyValue("--search-match-bg").trim(),
      contractForeground: rootStyle.getPropertyValue("--search-match-fg").trim(),
      visible: bounds.width > 0 && bounds.height > 0,
      contained:
        bounds.left >= resultBounds.left - 0.5 &&
        bounds.right <= resultBounds.right + 0.5 &&
        bounds.top >= resultBounds.top - 0.5 &&
        bounds.bottom <= resultBounds.bottom + 0.5,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      panelOverflow: document.querySelector("#detailContent").scrollWidth - document.querySelector("#detailContent").clientWidth,
    };
  });
}

function verifyReadable(label, evidence) {
  const ratio = contrast(evidence.color, evidence.background);
  assert(evidence.text.toLowerCase() === "wisdom", `${label} did not render the deterministic Search match: ${JSON.stringify(evidence)}`);
  assert(evidence.visible && evidence.contained, `${label} Search match is hidden or clipped: ${JSON.stringify(evidence)}`);
  assert(ratio >= 4.5, `${label} Search match contrast ${ratio.toFixed(2)}:1 is below 4.5:1: ${JSON.stringify(evidence)}`);
  assert(
    evidence.background !== evidence.parentBackground && evidence.background !== "rgba(0, 0, 0, 0)",
    `${label} Search match is not visibly distinct from surrounding text: ${JSON.stringify(evidence)}`,
  );
  assert(evidence.pageOverflow <= 0 && evidence.panelOverflow <= 0, `${label} introduced horizontal overflow: ${JSON.stringify(evidence)}`);
  return Number(ratio.toFixed(2));
}

const edgePath = EDGE_PATHS.find((candidate) => existsSync(candidate));
if (!edgePath) throw new Error("Microsoft Edge executable not found.");

const { server, url } = await startStaticAppServer({ port: 0 });
const browser = await chromium.launch({
  executablePath: edgePath,
  headless: true,
  args: ["--disable-gpu", "--disable-background-networking", "--disable-extensions", "--no-first-run", "--no-default-browser-check"],
});
const browserHealth = { consoleErrors: [], pageErrors: [], failedRequests: [], errorResponses: [] };
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "light" });
const page = await context.newPage();
page.on("console", (message) => {
  if (message.type() === "error") browserHealth.consoleErrors.push(message.text());
});
page.on("pageerror", (error) => browserHealth.pageErrors.push(error.message));
page.on("requestfailed", (request) => browserHealth.failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText || "failed"}`));
page.on("response", (response) => {
  const host = new URL(response.url()).hostname;
  if (response.status() >= 400 && (host === "127.0.0.1" || host === "localhost")) {
    browserHealth.errorResponses.push(`${response.status()} ${response.request().method()} ${response.url()}`);
  }
});

const evidence = { edgeVersion: browser.version(), query: "wisdom", viewport: { width: 1280, height: 800 } };

try {
  await page.goto(`${url}/#/read/bsb/proverbs/1`, { waitUntil: "load" });
  await waitForReader(page);

  await page.locator(".strong-token").first().click();
  await page.waitForSelector(".reader-context-word");
  evidence.readerHighlight = await page.locator(".reader-context-word").first().evaluate((node) => {
    const style = getComputedStyle(node);
    return { color: style.color, background: style.backgroundColor, outline: style.outlineColor };
  });

  await page.locator("#showInterlinear").click();
  await page.waitForSelector(".interlinear-picker", { state: "visible", timeout: 20_000 });
  await page.locator(".interlinear-picker .mini-button").first().click();
  await page.waitForSelector(".interlinear-token", { state: "visible", timeout: 20_000 });
  evidence.languageStudyHighlight = await page.locator(".interlinear-token").first().evaluate((node) => {
    const style = getComputedStyle(node);
    return { color: style.color, background: style.backgroundColor, border: style.borderColor };
  });

  await openPopulatedSearch(page);
  await page.evaluate(() => {
    localStorage.setItem("bibleAppTheme", "light");
    document.documentElement.setAttribute("data-theme", "light");
  });
  evidence.light = await captureSearchMatch(page);
  evidence.light.contrast = verifyReadable("explicit light mode", evidence.light);

  await page.evaluate(() => {
    localStorage.setItem("bibleAppTheme", "dark");
    document.documentElement.setAttribute("data-theme", "dark");
  });
  evidence.dark = await captureSearchMatch(page);
  evidence.dark.contrast = verifyReadable("explicit dark mode", evidence.dark);

  await page.emulateMedia({ colorScheme: "dark", forcedColors: "none" });
  await page.evaluate(() => {
    localStorage.removeItem("bibleAppTheme");
    document.documentElement.removeAttribute("data-theme");
  });
  evidence.osPreferredDark = await captureSearchMatch(page);
  evidence.osPreferredDark.contrast = verifyReadable("OS-preferred dark mode", evidence.osPreferredDark);
  assert(
    evidence.osPreferredDark.color === evidence.dark.color && evidence.osPreferredDark.background === evidence.dark.background,
    `OS-preferred dark mode does not use the explicit dark Search contract: ${JSON.stringify(evidence)}`,
  );

  await page.emulateMedia({ colorScheme: "dark", forcedColors: "active" });
  evidence.forcedColors = await captureSearchMatch(page);
  assert(evidence.forcedColors.visible && evidence.forcedColors.contained, `forced-colors Search match is hidden or clipped: ${JSON.stringify(evidence.forcedColors)}`);
  assert(
    evidence.forcedColors.forcedColorAdjust === "none" &&
      evidence.forcedColors.outlineStyle === "solid" &&
      parseFloat(evidence.forcedColors.outlineWidth) >= 1 &&
      evidence.forcedColors.background !== evidence.forcedColors.parentBackground,
    `forced-colors Search match does not expose the system Highlight/HighlightText contract: ${JSON.stringify(evidence.forcedColors)}`,
  );

  await page.emulateMedia({ colorScheme: "dark", forcedColors: "none" });
  await page.setViewportSize({ width: 390, height: 844 });
  evidence.mobile = await captureSearchMatch(page);
  evidence.mobile.viewport = { width: 390, height: 844 };
  evidence.mobile.contrast = verifyReadable("narrow OS-preferred dark mode", evidence.mobile);

  assert(
    evidence.readerHighlight.background !== evidence.light.background &&
      evidence.languageStudyHighlight.background !== evidence.light.background,
    `Search match styling leaked into Reader or Language Study highlights: ${JSON.stringify(evidence)}`,
  );
  assert(
    Object.values(browserHealth).every((items) => items.length === 0),
    `Search highlight browser health failures: ${JSON.stringify(browserHealth)}`,
  );

  console.log(JSON.stringify({ ...evidence, browserHealth }, null, 2));
} finally {
  await page.close();
  await context.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
