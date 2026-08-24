#!/usr/bin/env node

import nodeAssert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
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
  const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const contentTypes = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
  };
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

async function waitFor(page, predicate, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for: ${predicate.toString()}`);
}

async function clickWithPointer(page, selectorOrTokenAlias) {
  await page.evaluate((input) => {
    const target = input === "reader-token"
      ? [...document.querySelectorAll(".strong-token")].find((node) => /LORD/i.test(node.textContent || "")) ||
        document.querySelector(".strong-token")
      : document.querySelector(input);
    if (!target) throw new Error(`Target not found: ${input}`);
    const rect = target.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
      target.scrollIntoView({ block: "center", inline: "nearest" });
    }
    target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType: "mouse" }));
    target.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerType: "mouse" }));
    target.click();
  }, selectorOrTokenAlias);
}

async function selectExactPhrase(page, phrase) {
  return page.evaluate((selectedPhrase) => {
    const body = document.querySelector('.verse-row[data-verse="1"] .verse-body');
    if (!body) throw new Error("Psalm 23:1 body is unavailable");
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let text = "";
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement?.closest("button")) continue;
      nodes.push({ node, start: text.length, end: text.length + node.data.length });
      text += node.data;
    }
    const start = text.indexOf(selectedPhrase);
    const end = start + selectedPhrase.length;
    const first = nodes.find((entry) => entry.start <= start && entry.end > start);
    const last = nodes.find((entry) => entry.start < end && entry.end >= end);
    if (start < 0 || !first || !last) throw new Error(`Could not map exact phrase in: ${text}`);
    const range = document.createRange();
    range.setStart(first.node, start - first.start);
    range.setEnd(last.node, end - last.start);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    body.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    return {
      start,
      end,
      nativeText: String(selection),
      rectangles: [...range.getClientRects()].map((rect) => ({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      })),
      scrollY: window.scrollY,
      detailScrollTop: document.querySelector("#detailContent")?.scrollTop || 0,
      route: window.location.hash,
    };
  }, phrase);
}

async function readerState(page) {
  return page.evaluate(() => ({
    route: window.location.hash,
    scrollY: window.scrollY,
    detailScrollTop: document.querySelector("#detailContent")?.scrollTop || 0,
    detailTitle: document.querySelector("#detailTitle")?.textContent || "",
    wordKeys: [...document.querySelectorAll(".reader-context-word")].map((node) => node.dataset.interlinearKey || ""),
    phraseText: [...document.querySelectorAll(".reader-context-phrase")].map((node) => node.textContent || "").join(""),
    phraseRects: [...document.querySelectorAll(".reader-context-phrase")].map((node) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    }),
    phraseVerseCount: document.querySelectorAll(".reader-context-phrase-verse").length,
    historyReaderContext: history.state?.bibleAppReaderNavigation?.readerContext || null,
    horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
}

async function main() {
  const { server, url } = await startAppServer();
  const browser = await chromium.launch({
    executablePath: findEdgePath(),
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

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const consoleErrors = [];
    const pageErrors = [];
    const failedRequests = [];
    const httpErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()}`));
    page.on("response", (response) => {
      if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`);
    });
    await page.goto(url, { waitUntil: "load" });
    await waitFor(page, () => document.readyState === "complete" && !document.body.textContent.includes("Loading data"));
    await waitFor(page, () => Boolean(document.querySelector("#chapterTitle")?.textContent.includes("Psalms 23")));
    await waitFor(page, () => document.querySelectorAll(".strong-token").length > 0);

    await clickWithPointer(page, "reader-token");
    await waitFor(page, () => Boolean(document.querySelector(".reader-context-word") && document.querySelector(".reader-context-verse")));

    await clickWithPointer(page, "#showInterlinear");
    await waitFor(page, () => document.querySelector("#detailTitle")?.textContent === "Language Study");
    await delay(1600);

    const interlinearFrozenState = await page.evaluate(() => ({
      wordCount: document.querySelectorAll(".reader-context-word").length,
      verseCount: document.querySelectorAll(".reader-context-verse").length,
      detailTitle: document.querySelector("#detailTitle")?.textContent || "",
    }));

    assert(
      interlinearFrozenState.wordCount === 1 &&
        interlinearFrozenState.verseCount === 1 &&
        interlinearFrozenState.detailTitle === "Language Study",
      `clicked reader word highlight did not persist through Interlinear tool browsing: ${JSON.stringify(interlinearFrozenState)}`,
    );

    await clickWithPointer(page, "#nextChapter");
    await waitFor(page, () => Boolean(document.querySelector("#chapterTitle")?.textContent.includes("Psalms 24")));
    await delay(1400);

    const navigationState = await page.evaluate(() => ({
      wordCount: document.querySelectorAll(".reader-context-word").length,
      verseCount: document.querySelectorAll(".reader-context-verse").length,
      chapterTitle: document.querySelector("#chapterTitle")?.textContent || "",
    }));

    assert(
      navigationState.wordCount === 0 && navigationState.verseCount === 0,
      `chapter navigation did not release the frozen reader highlight: ${JSON.stringify(navigationState)}`,
    );

    await page.goto(`${url}/?case=phrase#/read/bsb/psalms/23`, { waitUntil: "load" });
    await waitFor(page, () => document.querySelector("#chapterTitle")?.textContent === "Psalms 23");
    await waitFor(page, () => document.querySelectorAll(".strong-token").length > 0);
    await clickWithPointer(page, "reader-token");
    await waitFor(page, () => document.querySelector("#detailTitle")?.textContent === "Strong's");

    const phrase = "The LORD is my shepherd;";
    const beforeStudy = await selectExactPhrase(page, phrase);
    nodeAssert.equal(beforeStudy.nativeText, phrase, "The native Range did not contain the exact approved phrase.");
    nodeAssert.equal(beforeStudy.start, 0);
    nodeAssert.equal(beforeStudy.end, phrase.length);
    assert(beforeStudy.rectangles.length >= 1, "The exact phrase did not produce a visible native Range rectangle.");
    await waitFor(page, () => !document.querySelector(".selection-action-menu")?.hidden);
    await page.locator(".selection-action-menu button", { hasText: "Study" }).click();
    await waitFor(page, () => document.querySelector("#detailTitle")?.textContent === "Language Study");
    await waitFor(page, () => document.querySelector(".language-study-selection-summary"));
    await page.mouse.move(0, 0);
    await delay(100);

    const afterStudy = await page.evaluate(() => {
      const summary = document.querySelector(".language-study-selection-summary");
      const detail = document.querySelector("#detailContent");
      const summaryRect = summary?.getBoundingClientRect();
      const detailRect = detail?.getBoundingClientRect();
      return {
        phrase: summary?.querySelector("blockquote")?.textContent || "",
        start: Number(summary?.dataset.charStart),
        end: Number(summary?.dataset.charEnd),
        overlapCount: Number(summary?.dataset.overlappingSourceTokens),
        selectedPairs: document.querySelectorAll(".translation-token-pair.selected-range").length,
        nativeText: String(window.getSelection()),
        summaryVisible: Boolean(summaryRect && detailRect && summaryRect.top >= detailRect.top && summaryRect.bottom <= detailRect.bottom),
      };
    });
    const persistentPhrase = await readerState(page);
    nodeAssert.equal(afterStudy.phrase, phrase, "Language Study shortened the selected English phrase.");
    nodeAssert.deepEqual([afterStudy.start, afterStudy.end], [0, phrase.length]);
    assert(afterStudy.overlapCount > 1, `Expected multiple overlapping source tokens: ${JSON.stringify(afterStudy)}`);
    nodeAssert.equal(afterStudy.selectedPairs, afterStudy.overlapCount);
    nodeAssert.equal(afterStudy.nativeText, "", "The native selection should yield to the application highlight.");
    nodeAssert.equal(afterStudy.summaryVisible, true, "The selected phrase summary was not visible when Language Study opened.");
    nodeAssert.equal(persistentPhrase.phraseText, phrase, "The persistent highlight did not cover the exact phrase.");
    nodeAssert.equal(persistentPhrase.phraseVerseCount, 1);
    nodeAssert.equal(
      persistentPhrase.historyReaderContext?.word,
      null,
      "Phrase Study falsely promoted one Strong's word to the canonical reader selection.",
    );
    nodeAssert.equal(persistentPhrase.scrollY, beforeStudy.scrollY, "Opening Language Study moved the document.");
    assert(persistentPhrase.horizontalOverflow <= 0, "Exact phrase state introduced horizontal overflow.");

    await page.evaluate(() => document.querySelector("#chapterSelect")?.dispatchEvent(new Event("change", { bubbles: true })));
    await waitFor(page, () => [...document.querySelectorAll(".reader-context-phrase")].map((node) => node.textContent || "").join("") === "The LORD is my shepherd;");
    nodeAssert.equal((await readerState(page)).phraseText, phrase, "A same-location chapter rerender cleared the exact phrase.");

    await clickWithPointer(page, "#themeToggle");
    nodeAssert.equal((await readerState(page)).phraseText, phrase, "Theme switching cleared the exact phrase.");
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    const alternateMediaPhrase = await page.evaluate(() => ({
      forcedColors: matchMedia("(forced-colors: active)").matches,
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      phrase: [...document.querySelectorAll(".reader-context-phrase")].map((node) => node.textContent || "").join(""),
      visibleRects: [...document.querySelectorAll(".reader-context-phrase")].filter((node) => node.getClientRects().length > 0).length,
    }));
    assert(
      alternateMediaPhrase.forcedColors &&
        alternateMediaPhrase.reducedMotion &&
        alternateMediaPhrase.phrase === phrase &&
        alternateMediaPhrase.visibleRects > 0,
      `Forced-colors/reduced-motion phrase state failed: ${JSON.stringify(alternateMediaPhrase)}`,
    );
    await page.emulateMedia({ forcedColors: "none", reducedMotion: "no-preference" });
    await clickWithPointer(page, "#detailBack");
    await waitFor(page, () => document.querySelector("#detailTitle")?.textContent === "Strong's");
    nodeAssert.equal((await readerState(page)).phraseText, phrase, "Detail Back cleared the exact phrase.");
    await clickWithPointer(page, "#detailForward");
    await waitFor(page, () => document.querySelector("#detailTitle")?.textContent === "Language Study");
    nodeAssert.equal((await readerState(page)).phraseText, phrase, "Detail Forward cleared the exact phrase.");

    await clickWithPointer(page, "#detailBack");
    await waitFor(page, () => document.querySelector("#detailTitle")?.textContent === "Strong's");
    for (const documentTop of [0, 275]) {
      await page.evaluate((top) => window.scrollTo(0, top), documentTop);
      await delay(100);
      for (const mode of ["compact", "standard", "expanded"]) {
        await page.locator(`[data-study-workspace-width-mode="${mode}"]`).click();
        const before = await page.evaluate(() => ({ page: window.scrollY, detail: document.querySelector("#detailContent")?.scrollTop || 0 }));
        await page.locator('#detailContext [data-panel-action="strongs"]').click();
        await delay(500);
        const after = await page.evaluate(() => ({ page: window.scrollY, detail: document.querySelector("#detailContent")?.scrollTop || 0 }));
        nodeAssert.equal(after.page, before.page, `${mode} Word reactivation moved the document at ${documentTop}px.`);
      }
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    const hebrewControl = page.locator('#detailContext [data-strong-section-control="hebrew"]');
    if ((await hebrewControl.count()) && !(await hebrewControl.isDisabled())) {
      const before = await page.evaluate(() => window.scrollY);
      await hebrewControl.click();
      const after = await page.evaluate(() => window.scrollY);
      nodeAssert.equal(after, before, "Reduced-motion Hebrew activation moved the document.");
    }
    await page.emulateMedia({ reducedMotion: "no-preference" });

    await page.goto(`${url}/?case=history#/read/bsb/psalms/23`, { waitUntil: "load" });
    await waitFor(page, () => document.querySelector("#chapterTitle")?.textContent === "Psalms 23");
    await clickWithPointer(page, "reader-token");
    let wordIdentity = await page.evaluate(() => document.querySelector(".reader-context-word")?.dataset.interlinearKey || "");
    await page.evaluate(() => window.scrollTo(0, 0));
    await delay(100);
    const zeroCrossReference = page.locator(".presentation-block .reference-hover", { hasText: "Ezekiel 34" }).first();
    await zeroCrossReference.evaluate((node) => {
      node.focus({ preventScroll: true });
      node.click();
    });
    await waitFor(page, () => document.querySelector("#chapterTitle")?.textContent === "Ezekiel 34");
    await page.goBack();
    await waitFor(page, () => document.querySelector("#chapterTitle")?.textContent === "Psalms 23");
    await waitFor(page, () => window.scrollY === 0);
    const zeroBack = await readerState(page);
    nodeAssert.equal(zeroBack.scrollY, 0, "A stored top-of-document position was mistaken for a missing snapshot.");
    assert(zeroBack.wordKeys.includes(wordIdentity), "Zero-scroll Browser Back lost the word highlight.");

    await page.goto(`${url}/?case=history-moderate#/read/bsb/psalms/23`, { waitUntil: "load" });
    await waitFor(page, () => document.querySelector("#chapterTitle")?.textContent === "Psalms 23");
    await clickWithPointer(page, "reader-token");
    wordIdentity = await page.evaluate(() => document.querySelector(".reader-context-word")?.dataset.interlinearKey || "");
    await page.evaluate(() => window.scrollTo(0, 275));
    await delay(100);
    const historyLengthBeforeReference = await page.evaluate(() => history.length);
    const crossReference = page.locator(".presentation-block .reference-hover", { hasText: "Ezekiel 34" }).first();
    await crossReference.evaluate((node) => {
      node.focus({ preventScroll: true });
      node.click();
    });
    await waitFor(page, () => document.querySelector("#chapterTitle")?.textContent === "Ezekiel 34");
    const destination = await readerState(page);
    assert(destination.route.includes("/ezekiel/34/11"), `Unexpected cross-reference destination: ${destination.route}`);
    nodeAssert.equal(
      await page.evaluate(() => history.length),
      historyLengthBeforeReference + 1,
      "One cross-reference navigation created duplicate browser-history entries.",
    );

    await page.goBack();
    await waitFor(page, () => document.querySelector("#chapterTitle")?.textContent === "Psalms 23");
    await delay(100);
    const browserBack = await readerState(page);
    nodeAssert.equal(browserBack.route, "#/read/bsb/psalms/23");
    assert(Math.abs(browserBack.scrollY - 275) <= 1, `Browser Back restored ${browserBack.scrollY}px instead of 275px.`);
    assert(browserBack.wordKeys.includes(wordIdentity), "Browser Back did not restore the committed word highlight.");
    assert(
      await crossReference.evaluate((node) => document.activeElement === node),
      "Browser Back did not restore focus to the originating cross-reference.",
    );

    await page.goForward();
    await waitFor(page, () => document.querySelector("#chapterTitle")?.textContent === "Ezekiel 34");
    await waitFor(page, () => document.querySelector('.reader-context-verse[data-verse="11"]'));
    await waitFor(page, () => !document.querySelector("#detailBack")?.disabled);
    const browserForward = await readerState(page);
    assert(browserForward.route.includes("/ezekiel/34/11"), "Browser Forward did not restore the destination route.");

    await clickWithPointer(page, "#detailBack");
    await waitFor(page, () => document.querySelector("#chapterTitle")?.textContent === "Psalms 23");
    await delay(100);
    const detailBack = await readerState(page);
    assert(Math.abs(detailBack.scrollY - 275) <= 1, `Detail Back restored ${detailBack.scrollY}px instead of 275px.`);
    assert(detailBack.wordKeys.includes(wordIdentity), "Detail Back did not restore the committed word highlight.");
    await clickWithPointer(page, "#detailForward");
    await waitFor(page, () => document.querySelector("#chapterTitle")?.textContent === "Ezekiel 34");
    await waitFor(page, () => document.querySelector('.reader-context-verse[data-verse="11"]'));
    await waitFor(page, () => window.history.state?.bibleAppReaderNavigation?.bookId === "ezekiel");
    const detailForward = await readerState(page);
    assert(detailForward.route.includes("/ezekiel/34/11"), "Detail Forward did not restore the destination route.");
    assert(
      Math.abs(detailForward.scrollY - browserForward.scrollY) <= 1,
      `Detail Forward restored ${detailForward.scrollY}px instead of ${browserForward.scrollY}px.`,
    );
    assert(
      detailForward.historyReaderContext?.book_id === "ezekiel" &&
        Number(detailForward.historyReaderContext?.verse) === 11,
      "Detail Forward did not restore the destination Reader context.",
    );

    await page.goto(`${url}/?case=long-chapter#/read/bsb/psalms/119`, { waitUntil: "load" });
    await waitFor(page, () => document.querySelector("#chapterTitle")?.textContent === "Psalms 119");
    await waitFor(page, () => document.querySelectorAll(".strong-token").length > 0);
    await page.evaluate(() => window.scrollTo(0, Math.max(0, document.documentElement.scrollHeight - innerHeight - 600)));
    await delay(100);
    const deepToken = page.locator('.verse-row[data-verse="100"] .strong-token').first();
    await deepToken.click();
    await waitFor(page, () => document.querySelector("#detailTitle")?.textContent === "Strong's");
    await page.evaluate(() => { const detail = document.querySelector("#detailContent"); if (detail) detail.scrollTop = Math.min(240, detail.scrollHeight); });
    const deepBefore = await readerState(page);
    await page.locator('#detailContext [data-panel-action="strongs"]').click();
    await delay(500);
    const deepAfter = await readerState(page);
    nodeAssert.equal(deepAfter.scrollY, deepBefore.scrollY, "Deep Psalm 119 Word activation moved the Reader.");

    for (const viewport of [
      { width: 960, height: 1200 },
      { width: 820, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(overflow <= 0, `Viewport ${viewport.width}x${viewport.height} has horizontal overflow: ${overflow}`);
    }

    const touchContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const touchPage = await touchContext.newPage();
    touchPage.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(`touch: ${message.text()}`);
    });
    touchPage.on("pageerror", (error) => pageErrors.push(`touch: ${error.message}`));
    touchPage.on("requestfailed", (request) => failedRequests.push(`touch: ${request.method()} ${request.url()}`));
    touchPage.on("response", (response) => {
      if (response.status() >= 400) httpErrors.push(`touch: ${response.status()} ${response.url()}`);
    });
    await touchPage.goto(`${url}/?case=touch#/read/bsb/psalms/23`, { waitUntil: "load" });
    await waitFor(touchPage, () => document.querySelector("#chapterTitle")?.textContent === "Psalms 23");
    await selectExactPhrase(touchPage, phrase);
    await waitFor(touchPage, () => !document.querySelector(".selection-action-menu")?.hidden);
    await touchPage.locator(".selection-action-menu button", { hasText: "Study" }).tap();
    await waitFor(touchPage, () => document.querySelector(".language-study-selection-summary"));
    const touchPhrase = await readerState(touchPage);
    nodeAssert.equal(touchPhrase.phraseText, phrase, "Touch activation did not preserve the exact phrase.");
    const touchHideReopen = await touchPage.evaluate(() => {
      const pane = document.querySelector(".detail-pane");
      const before = window.scrollY;
      pane?.classList.remove("visible");
      document.querySelector("#openStudyPanel")?.click();
      return {
        before,
        after: window.scrollY,
        visible: pane?.classList.contains("visible") || false,
        phrase: [...document.querySelectorAll(".reader-context-phrase")].map((node) => node.textContent || "").join(""),
      };
    });
    assert(
      touchHideReopen.visible &&
        touchHideReopen.before === touchHideReopen.after &&
        touchHideReopen.phrase === phrase,
      `Touch drawer hide/reopen changed Reader context: ${JSON.stringify(touchHideReopen)}`,
    );
    await touchContext.close();

    nodeAssert.deepEqual(consoleErrors, [], `Console errors: ${JSON.stringify(consoleErrors)}`);
    nodeAssert.deepEqual(pageErrors, [], `Page errors: ${JSON.stringify(pageErrors)}`);
    nodeAssert.deepEqual(failedRequests, [], `Failed requests: ${JSON.stringify(failedRequests)}`);
    nodeAssert.deepEqual(httpErrors, [], `HTTP errors: ${JSON.stringify(httpErrors)}`);

    console.log(JSON.stringify({
      status: "ok",
      assertions: 46,
      phrase: { beforeStudy, afterStudy, persistentPhrase },
      history: { zeroBack, browserBack, browserForward, detailBack, detailForward },
      containedScroll: { deepBefore, deepAfter },
      touch: { touchPhrase, touchHideReopen },
      browser: { executablePath: findEdgePath(), version: browser.version() },
    }, null, 2));
  } finally {
    await browser.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

await main();
