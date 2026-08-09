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

async function openLanguageStudy(page, { keyboard = false } = {}) {
  if (keyboard) {
    await page.locator("#showInterlinear").focus();
    await page.locator("#showInterlinear").press("Enter");
  } else {
    await page.locator("#showInterlinear").click();
  }
  await page.waitForSelector(".interlinear-picker", { state: "visible", timeout: 20_000 });
  const firstVerse = page.locator(".interlinear-picker .mini-button").first();
  if (keyboard) {
    await firstVerse.focus();
    await firstVerse.press("Enter");
  } else {
    await firstVerse.click();
  }
  await page.waitForSelector(".original-language-source-card", { state: "visible", timeout: 20_000 });
}

async function captureReaderSurface(page) {
  return page.evaluate(() => ({
    route: window.location.hash,
    title: document.querySelector("#chapterTitle")?.textContent,
    chapterPicker: document.querySelector("#chapterPickerButton")?.textContent,
    detailTitle: document.querySelector("#detailTitle")?.textContent,
    detailText: document.querySelector("#detailContent")?.textContent,
    backDisabled: document.querySelector("#detailBack")?.disabled,
    forwardDisabled: document.querySelector("#detailForward")?.disabled,
    panelMode: document.querySelector(".detail-pane")?.dataset?.panelMode,
    historyLength: window.history.length,
    activeElement: {
      id: document.activeElement?.id || "",
      className: document.activeElement?.className || "",
      verse: document.activeElement?.closest?.(".verse-row")?.dataset?.verse || "",
      connected: document.activeElement?.isConnected === true,
    },
    highlightedVerses: [...document.querySelectorAll(".reader-context-verse")].map((node) => node.dataset.verse || node.id),
    highlightedTokens: [...document.querySelectorAll(".reader-context-word")].map(
      (node) => `${node.dataset.strongCode || ""}:${node.dataset.tokenIndex || ""}`,
    ),
  }));
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
  await openLanguageStudy(page, { keyboard: true });
  const interlinearAfterFirst = requests.filter((requestUrl) => requestUrl.includes("/interlinear/books/psalms.json")).length;
  assert(interlinearAfterFirst === interlinearBefore + 1, "first Language Study activation did not fetch exactly one interlinear book");
  assert(await page.locator(".original-language-word-card").count(), "first Language Study activation did not render word cards");
  assert(await page.evaluate(() => document.activeElement?.isConnected === true), "keyboard Language Study activation left detached focus");
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

  const genesisCrossPattern = "**/data/crossrefs/genesis.json*";
  await page.route(genesisCrossPattern, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ book: { id: "genesis", name: "Genesis", osis: "Gen" }, verses: {} }),
    });
  });
  await navigateHash(page, "#/read/bsb/genesis/1/1", "Genesis", 1);
  const genesisCrossrefsBefore = requests.filter((requestUrl) => requestUrl.includes("/crossrefs/genesis.json")).length;
  const genesisInterlinearBefore = requests.filter((requestUrl) => requestUrl.includes("/interlinear/books/genesis.json")).length;
  const defaultStudyButton = page.locator('.verse-row[data-verse="1"] .verse-study-button');
  await page.locator('.verse-row[data-verse="1"] .verse-number').focus();
  for (let tabCount = 0; tabCount < 100; tabCount += 1) {
    if (await defaultStudyButton.evaluate((button) => document.activeElement === button)) break;
    await page.keyboard.press("Tab");
  }
  assert(await defaultStudyButton.evaluate((button) => document.activeElement === button), "Tab did not reach the default verse-study button");
  await page.keyboard.press("Enter");
  await page
    .waitForFunction(() => document.querySelector("#detailTitle")?.textContent === "Language Study", null, { timeout: 20_000 })
    .catch(async (error) => {
      const diagnostics = await page.evaluate(() => ({
        detailTitle: document.querySelector("#detailTitle")?.textContent,
        detailText: document.querySelector("#detailContent")?.textContent,
        status: document.querySelector("#statusText")?.textContent,
        activeConnected: document.activeElement?.isConnected === true,
        activeClass: document.activeElement?.className,
      }));
      throw new Error(
        `no-record default study did not open Language Study: ${JSON.stringify({
          diagnostics,
          crossrefRequests: requests.filter((requestUrl) => requestUrl.includes("/crossrefs/genesis.json")).length,
          interlinearRequests: requests.filter((requestUrl) => requestUrl.includes("/interlinear/books/genesis.json")).length,
          consoleErrors,
          pageErrors,
        })}`,
        { cause: error },
      );
    });
  await page.waitForSelector(".original-language-source-card", { state: "visible", timeout: 20_000 });
  const genesisCrossrefsAfterFirst = requests.filter((requestUrl) => requestUrl.includes("/crossrefs/genesis.json")).length;
  const genesisInterlinearAfterFirst = requests.filter((requestUrl) => requestUrl.includes("/interlinear/books/genesis.json")).length;
  assert(genesisCrossrefsAfterFirst === genesisCrossrefsBefore + 1, "no-record fallback did not fetch cross-references exactly once");
  assert(genesisInterlinearAfterFirst === genesisInterlinearBefore + 1, "no-record fallback did not fetch Language Study exactly once");
  const focusedFallback = await page.evaluate(() => ({
    connected: document.activeElement?.isConnected === true,
    isStudyButton: document.activeElement?.matches?.(".verse-study-button") === true,
    verse: document.activeElement?.closest?.(".verse-row")?.dataset?.verse,
  }));
  assert(
    focusedFallback.connected && focusedFallback.isStudyButton && focusedFallback.verse === "1",
    `default study fallback did not intentionally preserve keyboard focus: ${JSON.stringify(focusedFallback)}`,
  );
  await clickExisting(page, '.verse-row[data-verse="3"] .verse-study-button');
  await page.waitForFunction(() => document.querySelector("#detailTitle")?.textContent === "Language Study");
  assert(
    requests.filter((requestUrl) => requestUrl.includes("/crossrefs/genesis.json")).length === genesisCrossrefsAfterFirst &&
      requests.filter((requestUrl) => requestUrl.includes("/interlinear/books/genesis.json")).length === genesisInterlinearAfterFirst,
    "another no-record verse refetched a loaded deferred dataset",
  );
  await page.unroute(genesisCrossPattern);
  pass("default no-record verse falls through to Language Study in one keyboard activation and reuses both loaded datasets");

  const delayedPattern = "**/data/outlines/books/genesis.json*";
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
  await page.locator("#showOutline").click();
  await intercepted;
  await navigateHash(page, "#/read/bsb/genesis/2/1", "Genesis", 2);
  const sameBookStateBeforeRelease = await captureReaderSurface(page);
  releaseDelayed();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(100);
  const sameBookStateAfterRelease = await captureReaderSurface(page);
  assert(
    JSON.stringify(sameBookStateAfterRelease) === JSON.stringify(sameBookStateBeforeRelease),
    `same-book stale completion changed route/title/panel/history/lock/focus/token/highlight state: ${JSON.stringify({ before: sameBookStateBeforeRelease, after: sameBookStateAfterRelease })}`,
  );
  assert(
    sameBookStateAfterRelease.route === "#/read/bsb/genesis/2/1" &&
      sameBookStateAfterRelease.title?.includes("Genesis 2") &&
      sameBookStateAfterRelease.detailTitle !== "Outline",
    `same-book stale outline activation escaped its route guard: ${JSON.stringify(sameBookStateAfterRelease)}`,
  );
  await page.unroute(delayedPattern);
  pass("pending same-book chapter activation retains its cache without changing the new route or reader/detail state");

  const leviticusCrossPattern = "**/data/crossrefs/leviticus.json*";
  const leviticusInterlinearPattern = "**/data/interlinear/books/leviticus.json*";
  await page.route(leviticusCrossPattern, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ book: { id: "leviticus", name: "Leviticus", osis: "Lev" }, verses: {} }),
    });
  });
  await page.route(leviticusInterlinearPattern, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ book: { id: "leviticus", name: "Leviticus", osis: "Lev" }, chapters: {} }),
    });
  });
  await navigateHash(page, "#/read/bsb/leviticus/1/1", "Leviticus", 1);
  const leviticusCrossrefsBefore = requests.filter((requestUrl) => requestUrl.includes("/crossrefs/leviticus.json")).length;
  const leviticusInterlinearBefore = requests.filter((requestUrl) => requestUrl.includes("/interlinear/books/leviticus.json")).length;
  await clickExisting(page, '.verse-row[data-verse="1"] .verse-study-button');
  await page.waitForFunction(() => document.querySelector("#detailTitle")?.textContent === "Commentary");
  await page.waitForFunction(() => !document.querySelector("#detailContent")?.textContent.includes("Loading commentary"));
  assert(
    requests.filter((requestUrl) => requestUrl.includes("/crossrefs/leviticus.json")).length === leviticusCrossrefsBefore + 1 &&
      requests.filter((requestUrl) => requestUrl.includes("/interlinear/books/leviticus.json")).length === leviticusInterlinearBefore + 1,
    "neither-data fallback did not bound cross-reference and Language Study loading to one request each",
  );
  await page.unroute(leviticusCrossPattern);
  await page.unroute(leviticusInterlinearPattern);
  pass("default verse study falls through from absent cross-reference and Language Study data to commentary");

  await navigateHash(page, "#/read/bsb/john/1/1", "John", 1);

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
