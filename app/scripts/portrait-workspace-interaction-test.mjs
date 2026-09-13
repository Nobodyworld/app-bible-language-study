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
      return new URL(url).origin === appOrigin;
    } catch {
      return false;
    }
  };
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (isApplicationRequest(request.url())) requestFailures.push(`${request.method()} ${request.url()}`);
  });
  page.on("response", (response) => {
    if (isApplicationRequest(response.url()) && response.status() >= 400) responseFailures.push(`${response.status()} ${response.url()}`);
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
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }, count);
}

async function waitForApp(page, baseUrl) {
  await page.goto(`${baseUrl}/#/read/bsb/2_timothy/2/1`, { waitUntil: "load" });
  await page.waitForFunction(() =>
    document.querySelector("#chapterTitle")?.textContent.includes("2 Timothy 2") &&
    document.querySelector("#statusText")?.textContent.trim() === "BSB data loaded" &&
    document.querySelectorAll("#chapterContent .strong-token").length > 0 &&
    document.querySelectorAll("[data-study-workspace-width-cycle]").length === 1,
  );
  await page.waitForLoadState("networkidle");
  await waitForFrames(page, 3);
}

async function layoutState(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const value = document.querySelector(selector)?.getBoundingClientRect();
      return value ? { top: value.top, right: value.right, bottom: value.bottom, left: value.left, width: value.width, height: value.height } : null;
    };
    const controlSelectors = ["#studyWorkspaceWidthCycle", "#clearDetail", "#hideStudyWorkspace"];
    const headerControls = controlSelectors.map((selector) => {
      const button = document.querySelector(selector);
      const bounds = button?.getBoundingClientRect();
      return button && bounds ? {
        id: button.id,
        width: bounds.width,
        height: bounds.height,
        fontSize: Number.parseFloat(getComputedStyle(button).fontSize),
        ariaLabel: button.getAttribute("aria-label") || "",
      } : null;
    }).filter(Boolean);
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
      headerControls,
      widthCurrent: document.querySelector("#studyWorkspaceWidthCycle")?.dataset.studyWorkspaceWidthCurrent || "",
      widthNext: document.querySelector("#studyWorkspaceWidthCycle")?.dataset.studyWorkspaceWidthNext || "",
      headerBand: getComputedStyle(document.querySelector(".detail-header")).getPropertyValue("--study-header-layout-band").trim(),
      documentOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
}

function assertPortraitLayout(state, label) {
  assert.equal(state.titleText, "Bible Reader", `${label}: visible title was not shortened`);
  assert(state.title && state.brand && state.status && state.controls && state.theme && state.header && state.shell && state.detail, `${label}: layout geometry is incomplete`);
  assert(state.status.left >= state.title.right + 4, `${label}: BSB status is not to the right of the title`);
  const verticalOverlap = Math.min(state.status.bottom, state.title.bottom) - Math.max(state.status.top, state.title.top);
  assert(verticalOverlap > 0, `${label}: title and status do not share the same header row`);
  const row = [state.brand, state.controls, state.status, state.theme];
  assert(state.header.height <= 88 && Math.max(...row.map(box => box.top)) < Math.min(...row.map(box => box.bottom)),
    `${label}: global header must remain one compact row at a reduced CSS viewport`);
  assert(row.every((box, index) => box.left >= state.header.left && box.right <= state.header.right &&
    (index === 0 || box.left >= row[index - 1].right - 1)), `${label}: global header controls overlap or escape the header`);
  assert(state.shell.top >= state.header.bottom, `${label}: app shell overlaps the header`);
  assert(state.shell.top - state.header.bottom <= 24, `${label}: excessive gap remains below reader controls`);
  assert(state.detail.top >= state.header.bottom + 6, `${label}: detail pane begins above the measured header`);
  assert(state.detail.bottom <= state.viewport.height + 1, `${label}: detail pane exceeds the visible viewport`);
  assert(state.documentOverflow <= 1, `${label}: document has horizontal overflow`);
  assert.equal(state.headerControls.length, 3, `${label}: Study header must expose Width, Clear, and Hide only`);
  assert.equal(state.widthCurrent, "standard", `${label}: width cycle did not start in Standard`);
  assert.equal(state.widthNext, "expanded", `${label}: Standard width must advertise Expanded as its next state`);
  assert(["narrow", "constrained", "wide"].includes(state.headerBand), `${label}: unknown measured Study header band ${state.headerBand}`);
  for (const control of state.headerControls) {
    assert(control.height >= 30 && control.height <= 32 && control.width >= 30, `${label}: ${control.id} is outside the approved compact target range: ${JSON.stringify(control)}`);
    if (control.id === "studyWorkspaceWidthCycle") {
      assert(control.width <= 32, `${label}: width cycle is oversized`);
      assert(control.fontSize <= 1, `${label}: width cycle still presents a text-sized label`);
    }
    assert(control.ariaLabel, `${label}: ${control.id} lacks an accessible label`);
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

async function exerciseIndependentScroll(page, label) {
  const initial = await page.evaluate(() => {
    const detail = document.querySelector("#detailContent");
    const selected = document.querySelector(".reader-context-word");
    if (!detail || !selected) throw new Error("Independent-scroll fixture is incomplete");
    detail.scrollTop = 0;
    return {
      pageY: window.scrollY,
      maxScrollTop: detail.scrollHeight - detail.clientHeight,
      selectedText: selected.textContent.trim(),
      hash: window.location.hash,
    };
  });
  assert(initial.maxScrollTop > 80, `${label}: Strong's detail is not independently scrollable: ${JSON.stringify(initial)}`);
  await page.evaluate(() => {
    const detail = document.querySelector("#detailContent");
    detail.scrollTop = detail.scrollHeight;
  });
  await page.waitForFunction(() => {
    const detail = document.querySelector("#detailContent");
    return detail && detail.scrollTop >= detail.scrollHeight - detail.clientHeight - 2;
  });
  await waitForFrames(page, 2);
  const final = await page.evaluate(() => ({
    pageY: window.scrollY,
    selectedText: document.querySelector(".reader-context-word")?.textContent.trim() || "",
    hash: window.location.hash,
  }));
  assert(Math.abs(final.pageY - initial.pageY) <= 1, `${label}: scrolling detail moved the scripture document`);
  assert.equal(final.selectedText, initial.selectedText, `${label}: detail scrolling changed the selected source word`);
  assert.equal(final.hash, initial.hash, `${label}: detail scrolling changed the reader route`);
}

async function exerciseHideAndRestore(page, label) {
  const before = await page.evaluate(() => {
    const detail = document.querySelector("#detailContent");
    detail.scrollTop = Math.min(220, Math.max(0, detail.scrollHeight - detail.clientHeight));
    window.__portraitQaDetailFirst = detail.firstElementChild;
    window.__portraitQaReaderWord = document.querySelector(".reader-context-word");
    return {
      hash: window.location.hash,
      pageY: window.scrollY,
      detailTitle: document.querySelector("#detailTitle")?.textContent || "",
      detailScrollTop: detail.scrollTop,
      selectedText: document.querySelector(".reader-context-word")?.textContent.trim() || "",
    };
  });

  await page.locator("#hideStudyWorkspace").click();
  await page.waitForFunction(() =>
    document.documentElement.dataset.studyWorkspaceHidden === "true" &&
    document.querySelector("#showStudyWorkspace")?.hidden === false &&
    getComputedStyle(document.querySelector(".detail-pane")).display === "none",
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
    selectedText: document.querySelector(".reader-context-word")?.textContent.trim() || "",
    sameDetailNode: document.querySelector("#detailContent")?.firstElementChild === window.__portraitQaDetailFirst,
    sameReaderWord: document.querySelector(".reader-context-word") === window.__portraitQaReaderWord,
  }));
  assert.equal(after.hash, before.hash, `${label}: Hide/Show changed the route`);
  assert(Math.abs(after.pageY - before.pageY) <= 1, `${label}: Hide/Show moved the scripture document`);
  assert.equal(after.detailTitle, before.detailTitle, `${label}: Hide/Show replaced detail content`);
  assert(Math.abs(after.detailScrollTop - before.detailScrollTop) <= 2, `${label}: Hide/Show lost detail scroll position`);
  assert.equal(after.selectedText, before.selectedText, `${label}: Hide/Show changed the selected source word`);
  assert(after.sameDetailNode, `${label}: Hide/Show destroyed and rebuilt the detail content`);
  assert(after.sameReaderWord, `${label}: Hide/Show replaced the selected Reader token`);
}

async function main() {
  const { server, url } = await startStaticAppServer({ port: 0 });
  const browser = await chromium.launch({
    executablePath: findEdgePath(),
    headless: true,
    args: ["--disable-gpu", "--disable-dev-shm-usage", "--disable-background-networking", "--disable-extensions", "--no-first-run", "--no-default-browser-check"],
  });

  try {
    for (const viewport of VIEWPORTS) {
      const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
      const assertHealthy = attachHealthChecks(page, url, viewport.name);
      try {
        await waitForApp(page, url);
        assertPortraitLayout(await layoutState(page), viewport.name);
        if (viewport.name === "portrait-constrained") {
          await openStrongDetail(page);
          await exerciseIndependentScroll(page, viewport.name);
          await exerciseHideAndRestore(page, viewport.name);
          assertPortraitLayout(await layoutState(page), `${viewport.name}/restored`);
        }
        assertHealthy();
      } finally {
        await page.close();
      }
    }

    console.log(JSON.stringify({ status: "ok", viewports: VIEWPORTS.map(({ name }) => name), headerControls: 3, independentScroll: true, hideRestore: true }, null, 2));
  } finally {
    await browser.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

await main();