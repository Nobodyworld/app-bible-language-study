#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { startStaticAppServer } from "../tools/serve-app.mjs";

const VIEWPORTS = Object.freeze([
  Object.freeze({ name: "portrait-tall", width: 960, height: 2600 }),
  Object.freeze({ name: "portrait-constrained", width: 960, height: 1200 }),
]);

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

function attachHealthChecks(page, baseUrl, label) {
  const consoleErrors = [];
  const pageErrors = [];
  const requestFailures = [];
  const responseFailures = [];
  const appOrigin = new URL(baseUrl).origin;
  const isApplicationRequest = (url) => {
    try {
      const parsed = new URL(url);
      return parsed.origin === appOrigin && parsed.pathname !== "/favicon.ico";
    } catch {
      return false;
    }
  };

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (isApplicationRequest(request.url())) {
      requestFailures.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText || "failed"}`);
    }
  });
  page.on("response", (response) => {
    if (isApplicationRequest(response.url()) && response.status() >= 400) {
      responseFailures.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });

  return () => {
    assert.deepEqual(consoleErrors, [], `${label}: console errors were reported`);
    assert.deepEqual(pageErrors, [], `${label}: page errors were reported`);
    assert.deepEqual(requestFailures, [], `${label}: application requests failed`);
    assert.deepEqual(responseFailures, [], `${label}: application responses failed`);
  };
}

async function waitForFrames(page, count = 2) {
  await page.evaluate(async (frameCount) => {
    for (let index = 0; index < frameCount; index += 1) {
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    }
  }, count);
}

async function waitForApp(page, baseUrl) {
  await page.goto(`${baseUrl}/#/read/bsb/2_timothy/2/1`, { waitUntil: "load" });
  await page.waitForFunction(() =>
    document.querySelector("#chapterTitle")?.textContent.includes("2 Timothy 2") &&
    document.querySelector("#statusText")?.textContent.trim() === "BSB data loaded" &&
    document.querySelectorAll("#chapterContent .strong-token").length > 0,
  );
  await page.waitForLoadState("networkidle");
  await waitForFrames(page, 3);
}

async function layoutState(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const value = document.querySelector(selector)?.getBoundingClientRect();
      return value
        ? { top: value.top, right: value.right, bottom: value.bottom, left: value.left, width: value.width, height: value.height }
        : null;
    };
    const iconButtons = [...document.querySelectorAll(
      "[data-study-workspace-width-mode], #clearDetail, #hideStudyWorkspace",
    )].map((button) => {
      const bounds = button.getBoundingClientRect();
      return {
        id: button.id || button.dataset.studyWorkspaceWidthMode,
        width: bounds.width,
        height: bounds.height,
        fontSize: Number.parseFloat(getComputedStyle(button).fontSize),
        ariaLabel: button.getAttribute("aria-label") || "",
      };
    });
    return {
      titleText: document.querySelector(".brand h1")?.textContent.trim() || "",
      title: rect(".brand h1"),
      brand: rect("#homeButton"),
      status: rect("#statusText"),
      controls: rect(".reader-controls"),
      theme: rect("#themeToggle"),
      header: rect(".app-header"),
      shell: rect(".app-shell"),
      detail: rect(".detail-pane"),
      iconButtons,
      documentOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
}

function assertPortraitLayout(state, label) {
  assert.equal(state.titleText, "Bible Reader", `${label}: visible title was not shortened`);
  assert(state.title && state.status && state.controls && state.header && state.shell && state.detail, `${label}: layout geometry is incomplete`);
  assert(state.status.left >= state.title.right + 4, `${label}: BSB status is not to the right of the title`);
  const verticalOverlap = Math.min(state.status.bottom, state.title.bottom) - Math.max(state.status.top, state.title.top);
  assert(verticalOverlap > 0, `${label}: title and status do not share the same header row`);
  assert(state.controls.top >= Math.max(state.brand.bottom, state.status.bottom) - 1, `${label}: reader controls are not the final header row`);
  assert(state.shell.top >= state.header.bottom, `${label}: app shell overlaps the header`);
  assert(state.shell.top - state.header.bottom <= 24, `${label}: excessive gap remains below reader controls`);
  assert(state.detail.top >= state.header.bottom + 6, `${label}: detail pane begins above the measured header`);
  assert(state.detail.bottom <= state.viewport.height + 1, `${label}: detail pane exceeds the visible viewport`);
  assert(state.documentOverflow <= 1, `${label}: document has horizontal overflow`);
  assert.equal(state.iconButtons.length, 5, `${label}: compact detail-header control set is incomplete`);
  for (const button of state.iconButtons) {
    assert(
      button.height >= 30 && button.height <= 32 && button.width >= 30,
      `${label}: ${button.id} is outside the approved compact target range: ${JSON.stringify(button)}`,
    );
    if (["compact", "standard", "expanded"].includes(button.id)) {
      assert(button.width <= 32, `${label}: ${button.id} width control is oversized: ${JSON.stringify(button)}`);
      assert(button.fontSize <= 1, `${label}: ${button.id} still presents a text-sized label`);
    }
    assert(button.ariaLabel, `${label}: ${button.id} lacks an accessible label`);
  }
}

async function openStrongDetail(page) {
  const token = page.locator('#chapterContent .strong-token[data-strong-code="G2424"]').first();
  assert.equal(await token.count(), 1, "The deterministic G2424 token was not found in 2 Timothy 2");
  await token.scrollIntoViewIfNeeded();
  await token.click();
  await page.waitForFunction(() =>
    document.querySelector("#detailTitle")?.textContent === "Strong's" &&
    Boolean(document.querySelector("#detailContent .strong-detail")) &&
    Boolean(document.querySelector(".reader-context-word")),
  );
  await waitForFrames(page, 2);
}

async function exerciseIndependentScroll(page) {
  const initial = await page.evaluate(() => {
    const detail = document.querySelector("#detailContent");
    if (!detail) throw new Error("Detail content is missing");
    detail.scrollTop = 0;
    const selected = document.querySelector(".reader-context-word");
    return {
      pageY: window.scrollY,
      maxScrollTop: detail.scrollHeight - detail.clientHeight,
      selected: selected ? {
        strongCode: selected.dataset.strongCode || "",
        tokenIndex: selected.dataset.tokenIndex || "",
        text: selected.textContent.trim(),
      } : null,
      hash: window.location.hash,
    };
  });
  assert(initial.maxScrollTop > 80, `Strong's detail is not independently scrollable: ${JSON.stringify(initial)}`);
  await page.evaluate(() => {
    const detail = document.querySelector("#detailContent");
    detail.scrollTop = detail.scrollHeight;
  });
  await page.waitForFunction(() => {
    const detail = document.querySelector("#detailContent");
    return detail && detail.scrollTop >= detail.scrollHeight - detail.clientHeight - 2;
  });
  const final = await page.evaluate(() => {
    const selected = document.querySelector(".reader-context-word");
    return {
      pageY: window.scrollY,
      selected: selected ? {
        strongCode: selected.dataset.strongCode || "",
        tokenIndex: selected.dataset.tokenIndex || "",
        text: selected.textContent.trim(),
      } : null,
      hash: window.location.hash,
    };
  });
  assert(Math.abs(final.pageY - initial.pageY) <= 1, "Scrolling the detail pane moved the scripture document");
  assert.deepEqual(final.selected, initial.selected, "Detail scrolling changed the selected source word");
  assert.equal(final.hash, initial.hash, "Detail scrolling changed the reader route");
}

async function exerciseHideAndRestore(page) {
  await page.evaluate(() => {
    const detail = document.querySelector("#detailContent");
    detail.scrollTop = Math.min(220, Math.max(0, detail.scrollHeight - detail.clientHeight));
    window.__portraitQaDetailFirst = detail.firstElementChild;
    window.__portraitQaReaderWord = document.querySelector(".reader-context-word");
  });
  const before = await page.evaluate(() => ({
    hash: window.location.hash,
    pageY: window.scrollY,
    detailTitle: document.querySelector("#detailTitle")?.textContent || "",
    detailScrollTop: document.querySelector("#detailContent")?.scrollTop || 0,
    panelMode: document.querySelector(".detail-pane")?.dataset.panelMode || "",
    selectedText: document.querySelector(".reader-context-word")?.textContent.trim() || "",
  }));

  await page.locator("#hideStudyWorkspace").click();
  await page.waitForFunction(() =>
    document.documentElement.dataset.studyWorkspaceHidden === "true" &&
    document.querySelector("#showStudyWorkspace")?.hidden === false &&
    getComputedStyle(document.querySelector(".detail-pane")).display === "none",
  );
  assert(
    await page.locator("#showStudyWorkspace").evaluate((node) => document.activeElement === node),
    "Hiding the workspace did not move focus to the stable Show control",
  );

  await page.locator("#showStudyWorkspace").click();
  await page.waitForFunction(() =>
    document.documentElement.dataset.studyWorkspaceHidden !== "true" &&
    document.querySelector("#showStudyWorkspace")?.hidden === true &&
    getComputedStyle(document.querySelector(".detail-pane")).display !== "none",
  );
  await waitForFrames(page, 3);

  const after = await page.evaluate(() => ({
    hash: window.location.hash,
    pageY: window.scrollY,
    detailTitle: document.querySelector("#detailTitle")?.textContent || "",
    detailScrollTop: document.querySelector("#detailContent")?.scrollTop || 0,
    panelMode: document.querySelector(".detail-pane")?.dataset.panelMode || "",
    selectedText: document.querySelector(".reader-context-word")?.textContent.trim() || "",
    sameDetail: window.__portraitQaDetailFirst === document.querySelector("#detailContent")?.firstElementChild,
    sameWord: window.__portraitQaReaderWord === document.querySelector(".reader-context-word"),
  }));
  assert.equal(after.hash, before.hash, "Hide/Show changed the reader route");
  assert(Math.abs(after.pageY - before.pageY) <= 6, "Hide/Show moved the semantic reader position");
  assert.equal(after.detailTitle, before.detailTitle, "Hide/Show changed the detail view");
  assert(Math.abs(after.detailScrollTop - before.detailScrollTop) <= 2, "Hide/Show changed detail scroll position");
  assert.equal(after.panelMode, before.panelMode, "Hide/Show changed follow/locked state");
  assert.equal(after.selectedText, before.selectedText, "Hide/Show changed the selected word");
  assert(after.sameDetail, "Hide/Show reconstructed detail content");
  assert(after.sameWord, "Hide/Show reconstructed the selected reader token");
  assert(
    await page.locator("#hideStudyWorkspace").evaluate((node) => document.activeElement === node),
    "Showing the workspace did not restore focus to Hide",
  );
}

async function exerciseBookPicker(page) {
  const pageY = await page.evaluate(() => window.scrollY);
  await page.locator("#bookPickerButton").click();
  await page.waitForFunction(() => document.querySelector("#bookPickerPanel")?.hidden === false);
  await waitForFrames(page, 4);

  const state = await page.evaluate(() => {
    const panel = document.querySelector("#bookPickerPanel");
    const columns = [...panel.querySelectorAll(".book-picker-column")];
    const newList = columns[1]?.querySelector(".book-picker-list");
    const revelation = [...(newList?.querySelectorAll(".reader-picker-option") || [])]
      .find((button) => button.textContent.trim() === "Revelation");
    if (newList) newList.scrollTop = newList.scrollHeight;
    const panelRect = panel.getBoundingClientRect();
    const listRect = newList?.getBoundingClientRect();
    const revelationRect = revelation?.getBoundingClientRect();
    revelation?.focus({ preventScroll: true });
    return {
      pageY: window.scrollY,
      columns: columns.length,
      panel: { top: panelRect.top, right: panelRect.right, bottom: panelRect.bottom, left: panelRect.left },
      list: listRect ? { top: listRect.top, bottom: listRect.bottom } : null,
      revelation: revelationRect ? { top: revelationRect.top, bottom: revelationRect.bottom } : null,
      revelationFocused: document.activeElement === revelation,
    };
  });
  assert.equal(state.columns, 2, "Portrait book picker did not retain two testament columns");
  assert(state.panel.left >= -1 && state.panel.right <= 961, `Book picker escapes horizontally: ${JSON.stringify(state)}`);
  assert(state.panel.top >= -1 && state.panel.bottom <= 1201, `Book picker escapes vertically: ${JSON.stringify(state)}`);
  assert(state.list && state.revelation, "New Testament list or Revelation option is missing");
  assert(state.revelation.top >= state.list.top - 1 && state.revelation.bottom <= state.list.bottom + 1, "Revelation is not reachable inside the New Testament scroller");
  assert(state.revelationFocused, "Revelation could not receive keyboard focus");
  assert(Math.abs(state.pageY - pageY) <= 1, "Opening or centering the book picker moved the scripture document");

  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.querySelector("#bookPickerPanel")?.hidden === true);
}

async function runViewport(browser, baseUrl, viewport) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  const page = await context.newPage();
  const assertHealthy = attachHealthChecks(page, baseUrl, viewport.name);
  try {
    await waitForApp(page, baseUrl);
    assertPortraitLayout(await layoutState(page), viewport.name);
    if (viewport.name === "portrait-constrained") {
      await openStrongDetail(page);
      await exerciseIndependentScroll(page);
      await exerciseHideAndRestore(page);
      await exerciseBookPicker(page);
      await page.locator("#themeToggle").click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
      assertPortraitLayout(await layoutState(page), `${viewport.name}/dark`);
    }
    assertHealthy();
    return { name: viewport.name, width: viewport.width, height: viewport.height };
  } finally {
    await context.close();
  }
}

async function main() {
  const edgePath = findEdgePath();
  const { server, url } = await startStaticAppServer({ port: 0 });
  const browser = await chromium.launch({
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

  try {
    const results = [];
    for (const viewport of VIEWPORTS) results.push(await runViewport(browser, url, viewport));
    console.log(JSON.stringify({
      status: "ok",
      browser: { executablePath: edgePath, version: browser.version() },
      viewports: results,
      coverage: [
        "short-title-status-row",
        "compact-icon-controls",
        "measured-sticky-height",
        "independent-detail-scroll",
        "lossless-hide-show",
        "viewport-contained-book-picker",
      ],
    }, null, 2));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

await main();
