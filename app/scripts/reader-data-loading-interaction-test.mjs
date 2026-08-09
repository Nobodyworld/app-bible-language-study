#!/usr/bin/env node

import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { startStaticAppServer } from "../tools/serve-app.mjs";

const BROWSERS = {
  chrome: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  edge: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
};
const browserName = process.argv.find((argument) => argument.startsWith("--browser="))?.split("=")[1] || "edge";
const executablePath = BROWSERS[browserName];
if (!executablePath || !existsSync(executablePath)) {
  throw new Error(`Browser executable not found for ${browserName}: ${executablePath || "unsupported browser"}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForReader(page, bookName, chapter) {
  await page.waitForFunction(
    ({ expectedBook, expectedChapter }) =>
      document.querySelector("#chapterTitle")?.textContent.includes(`${expectedBook} ${expectedChapter}`) &&
      document.querySelector("#statusText")?.textContent.includes("data loaded") &&
      document.querySelectorAll(".strong-token").length > 0,
    { expectedBook: bookName, expectedChapter: String(chapter) },
    { timeout: 30_000 },
  );
}

async function navigateHash(page, hash, bookName, chapter) {
  await page.evaluate((nextHash) => {
    window.location.hash = nextHash;
  }, hash);
  await waitForReader(page, bookName, chapter);
}

async function clickExisting(page, selector) {
  await page.locator(selector).first().evaluate((element) => element.click());
}

async function openLanguageStudy(page) {
  await page.locator("#showInterlinear").click();
  await page.waitForSelector(".interlinear-picker", { state: "visible", timeout: 20_000 });
  await page.locator(".interlinear-picker .mini-button").first().click();
  await page.waitForSelector(".original-language-source-card", { state: "visible", timeout: 20_000 });
}

const checks = [];
const pass = (name) => checks.push(name);
const requests = [];
const consoleErrors = [];
const pageErrors = [];
const { server, url } = await startStaticAppServer({ port: 0 });
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--disable-gpu", "--disable-background-networking", "--disable-extensions", "--no-first-run", "--no-default-browser-check"],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
page.on("request", (request) => requests.push(request.url()));
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => pageErrors.push(error.message));

try {
  await page.goto(`${url}/#/read/bsb/psalms/23`, { waitUntil: "load" });
  await waitForReader(page, "Psalms", 23);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);

  const initialDeferred = requests.filter((requestUrl) =>
    ["/crossrefs/psalms.json", "/interlinear/books/psalms.json", "/outlines/books/psalms.json"].some((path) => requestUrl.includes(path)),
  );
  assert(initialDeferred.length === 0, `fresh reader requested deferred data: ${JSON.stringify(initialDeferred)}`);
  pass("fresh readiness and post-readiness quiet interval omit deferred datasets");

  const coreState = await page.evaluate(() => ({
    presentation: document.querySelectorAll(".presentation-block").length,
    footnotes: document.querySelectorAll(".fn-marker").length,
    strongs: document.querySelectorAll(".strong-token").length,
    languageEnabled: !document.querySelector("#showInterlinear")?.disabled,
    outlineEnabled: !document.querySelector("#showOutline")?.disabled,
  }));
  assert(
    coreState.presentation > 0 && coreState.footnotes > 0 && coreState.strongs > 0,
    `reader-core rendering is incomplete: ${JSON.stringify(coreState)}`,
  );
  assert(coreState.languageEnabled && coreState.outlineEnabled, `deferred capabilities are hidden: ${JSON.stringify(coreState)}`);
  pass("presentation, footnotes, Strong's, Language Study, and outline capability semantics");

  await clickExisting(page, ".fn-marker");
  await page.waitForFunction(() => document.querySelector("#detailTitle")?.textContent === "Footnote");
  assert(await page.locator(".reader-context-verse").count(), "footnote activation did not preserve reader highlighting");
  await clickExisting(page, ".strong-token");
  await page.waitForFunction(() => document.querySelector("#detailTitle")?.textContent === "Strong's");
  await page.waitForSelector(".strong-overview", { state: "visible", timeout: 20_000 });
  assert(
    (await page.locator(".detail-pane").getAttribute("data-panel-mode")) === "locked",
    "Strong's activation did not lock the detail panel",
  );
  assert(page.url().endsWith("#/read/bsb/psalms/23"), `study activation changed the reader route: ${page.url()}`);
  await page.locator("#detailBack").click();
  await page.waitForFunction(() => document.querySelector("#detailTitle")?.textContent === "Footnote");
  pass("reader presentation, footnote, Strong's, highlight, lock, route, and panel history behavior");

  const interlinearBefore = requests.filter((requestUrl) => requestUrl.includes("/interlinear/books/psalms.json")).length;
  await openLanguageStudy(page);
  const interlinearAfterFirst = requests.filter((requestUrl) => requestUrl.includes("/interlinear/books/psalms.json")).length;
  assert(interlinearAfterFirst === interlinearBefore + 1, "first Language Study activation did not fetch exactly one interlinear book");
  assert(await page.locator(".original-language-word-card").count(), "first Language Study activation did not render word cards");
  await openLanguageStudy(page);
  const interlinearAfterRepeat = requests.filter((requestUrl) => requestUrl.includes("/interlinear/books/psalms.json")).length;
  assert(interlinearAfterRepeat === interlinearAfterFirst, "repeat Language Study activation refetched interlinear data");
  pass("first and repeat Language Study loading");

  const crossrefsBefore = requests.filter((requestUrl) => requestUrl.includes("/crossrefs/psalms.json")).length;
  await clickExisting(page, '.verse-row[data-verse="1"] .verse-study-button');
  await page.waitForFunction(() => document.querySelector("#detailTitle")?.textContent === "Cross References");
  await page.waitForSelector(".crossref-panel", { state: "visible", timeout: 20_000 });
  const crossrefsAfterFirst = requests.filter((requestUrl) => requestUrl.includes("/crossrefs/psalms.json")).length;
  assert(crossrefsAfterFirst === crossrefsBefore + 1, "first reference activation did not fetch exactly one cross-reference book");
  assert(await page.locator(".crossref-item").count(), "cross-reference activation rendered no references");
  await clickExisting(page, '.verse-row[data-verse="1"] .verse-study-button');
  await page.waitForFunction(() => document.querySelector("#detailTitle")?.textContent === "Cross References");
  const crossrefsAfterRepeat = requests.filter((requestUrl) => requestUrl.includes("/crossrefs/psalms.json")).length;
  assert(crossrefsAfterRepeat === crossrefsAfterFirst, "repeat reference activation refetched cross-reference data");
  pass("first and repeat cross-reference loading");

  await openLanguageStudy(page);
  await page.locator("#detailBack").click();
  await page.waitForFunction(() => document.querySelector("#detailTitle")?.textContent === "Cross References");
  pass("deferred views preserve panel Back history");

  await navigateHash(page, "#/read/bsb/john/1/1", "John", 1);
  assert(!(await page.locator(".original-language-word-card").count()), "prior-book Language Study content leaked after navigation");
  await openLanguageStudy(page);
  const johnStudy = await page.locator(".original-language-source-card").innerText();
  assert(/original greek/i.test(johnStudy), `John loaded stale prior-book supplemental data: ${johnStudy.slice(0, 120)}`);
  pass("book navigation replaces prior-book supplemental data");

  await navigateHash(page, "#/read/bsb/genesis/1/1", "Genesis", 1);
  const delayedPattern = "**/data/crossrefs/genesis.json*";
  let releaseDelayed;
  let markIntercepted;
  const delayedRelease = new Promise((resolve) => {
    releaseDelayed = resolve;
  });
  const intercepted = new Promise((resolve) => {
    markIntercepted = resolve;
  });
  await page.route(delayedPattern, async (route) => {
    markIntercepted();
    await delayedRelease;
    await route.continue();
  });
  await clickExisting(page, '.verse-row[data-verse="1"] .verse-study-button');
  await intercepted;
  await navigateHash(page, "#/read/bsb/john/1/1", "John", 1);
  releaseDelayed();
  await page.waitForLoadState("networkidle");
  assert(
    (await page.locator("#chapterTitle").innerText()).includes("John 1") &&
      (await page.locator("#detailTitle").innerText()) !== "Cross References",
    "a stale Genesis cross-reference completion overwrote the John route",
  );
  await page.unroute(delayedPattern);
  pass("pending old-route supplemental completion cannot overwrite the new route");

  const retryPattern = "**/data/outlines/books/john.json*";
  let outlineAttempts = 0;
  await page.route(retryPattern, async (route) => {
    outlineAttempts += 1;
    if (outlineAttempts === 1) await route.fulfill({ status: 200, contentType: "application/json", body: "{" });
    else await route.continue();
  });
  await page.locator("#showOutline").click();
  await page.waitForFunction(() => document.querySelector("#detailContent")?.textContent.includes("could not be loaded"));
  assert(!(await page.locator("#showOutline").isDisabled()), "failed outline load did not leave a retry path");
  await page.locator("#showOutline").click();
  await page.waitForFunction(() => document.querySelector("#detailContent h3")?.textContent.includes("John Outline"));
  assert(outlineAttempts === 2, `outline retry count was not deterministic: ${outlineAttempts}`);
  await page.unroute(retryPattern);
  pass("dataset failure is bounded, visible, and retryable");

  const finalState = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    loadingResidue: document.querySelectorAll("[aria-busy='true'], .loading").length,
    title: document.querySelector("#chapterTitle")?.textContent,
  }));
  assert(finalState.overflow <= 1, `reader has horizontal overflow: ${JSON.stringify(finalState)}`);
  assert(finalState.loadingResidue === 0, `reader left loading residue: ${JSON.stringify(finalState)}`);
  assert(!consoleErrors.length, `browser console errors: ${JSON.stringify(consoleErrors)}`);
  assert(!pageErrors.length, `uncaught page errors: ${JSON.stringify(pageErrors)}`);
  pass("no overflow, loading residue, console errors, or page errors");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        browser: browserName,
        assertions: checks.length,
        checks,
        request_counts: {
          psalms_interlinear: interlinearAfterRepeat,
          psalms_crossrefs: crossrefsAfterRepeat,
          outline_attempts: outlineAttempts,
        },
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
