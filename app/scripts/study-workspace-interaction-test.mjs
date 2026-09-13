#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { startStaticAppServer } from "../tools/serve-app.mjs";

const WIDTH_STORAGE_KEY = "bibleapp:study-workspace-width:v1";
const WIDTH_MODES = Object.freeze(["compact", "standard", "expanded"]);

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

function nextMode(mode) {
  const index = WIDTH_MODES.indexOf(mode);
  return WIDTH_MODES[(index + 1) % WIDTH_MODES.length];
}

function attachHealthChecks(page, baseUrl) {
  const consoleErrors = [];
  const pageErrors = [];
  const requestFailures = [];
  const responseFailures = [];
  const origin = new URL(baseUrl).origin;
  const inApp = (url) => {
    try {
      const parsed = new URL(url);
      return parsed.origin === origin && parsed.pathname !== "/favicon.ico";
    } catch {
      return false;
    }
  };
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (inApp(request.url())) requestFailures.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText || "failed"}`);
  });
  page.on("response", (response) => {
    if (inApp(response.url()) && response.status() >= 400) responseFailures.push(`${response.status()} ${response.url()}`);
  });
  return () => {
    assert.deepEqual(consoleErrors, [], "Study workspace test reported console errors");
    assert.deepEqual(pageErrors, [], "Study workspace test reported page errors");
    assert.deepEqual(requestFailures, [], "Study workspace test reported request failures");
    assert.deepEqual(responseFailures, [], "Study workspace test reported HTTP failures");
  };
}

async function waitForReader(page) {
  await page.waitForFunction(() =>
    document.querySelector("#chapterTitle")?.textContent.includes("Psalms 23") &&
    !document.body.textContent.includes("Loading data") &&
    document.querySelectorAll("[data-study-workspace-width-cycle]").length === 1,
  );
  await page.waitForLoadState("networkidle");
}

async function workspaceState(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const cycle = document.querySelector("[data-study-workspace-width-cycle]");
    const detail = document.querySelector("#detailPane");
    const detailContent = document.querySelector("#detailContent");
    const reader = document.querySelector(".reader-pane");
    const header = document.querySelector(".detail-header");
    const showButton = document.querySelector("#showStudyWorkspace");
    const hideButton = document.querySelector("#hideStudyWorkspace");
    const rect = (node) => {
      const value = node?.getBoundingClientRect();
      return value ? { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height } : null;
    };
    return {
      mode: root.dataset.studyWorkspaceWidth || "",
      hidden: root.dataset.studyWorkspaceHidden === "true",
      cycle: cycle ? {
        current: cycle.dataset.studyWorkspaceWidthCurrent || "",
        modeAttribute: cycle.dataset.studyWorkspaceWidthMode || "",
        next: cycle.dataset.studyWorkspaceWidthNext || "",
        ariaLabel: cycle.getAttribute("aria-label") || "",
        title: cycle.getAttribute("title") || "",
        ariaPressed: cycle.getAttribute("aria-pressed"),
        visible: getComputedStyle(cycle).display !== "none" && rect(cycle)?.width > 0,
        rect: rect(cycle),
      } : null,
      detailRect: rect(detail),
      readerRect: rect(reader),
      headerRect: rect(header),
      headerScrollWidth: header?.scrollWidth ?? 0,
      detailScrollTop: detailContent?.scrollTop ?? 0,
      detailScrollHeight: detailContent?.scrollHeight ?? 0,
      detailClientHeight: detailContent?.clientHeight ?? 0,
      showHidden: showButton?.hidden ?? null,
      showVisible: showButton ? getComputedStyle(showButton).display !== "none" && rect(showButton)?.width > 0 : false,
      hideVisible: hideButton ? getComputedStyle(hideButton).display !== "none" && rect(hideButton)?.width > 0 : false,
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      localStorageMode: localStorage.getItem("bibleapp:study-workspace-width:v1"),
      headerBand: getComputedStyle(header).getPropertyValue("--study-header-layout-band").trim(),
    };
  });
}

function assertCycleState(state, expectedMode, label) {
  assert.equal(state.mode, expectedMode, `${label}: root width mode mismatch`);
  assert(state.cycle, `${label}: width-cycle control is missing`);
  assert.equal(state.cycle.current, expectedMode, `${label}: cycle current state mismatch`);
  assert.equal(state.cycle.modeAttribute, expectedMode, `${label}: compatibility mode attribute mismatch`);
  assert.equal(state.cycle.next, nextMode(expectedMode), `${label}: cycle next state mismatch`);
  assert.equal(state.cycle.ariaPressed, null, `${label}: cycle control must not expose radio-style aria-pressed`);
  assert.match(state.cycle.ariaLabel, new RegExp(`width: ${expectedMode}`, "i"), `${label}: accessible name omits current width`);
  assert.match(state.cycle.ariaLabel, new RegExp(`to ${nextMode(expectedMode)}`, "i"), `${label}: accessible name omits next width`);
  assert(state.documentOverflow <= 1, `${label}: width state created horizontal document overflow (${state.documentOverflow}px)`);
  if (state.headerRect) {
    assert(state.headerScrollWidth <= state.headerRect.width + 1, `${label}: Study header controls overflow their measured pane`);
  }
}

async function activateCycle(page, activation, expectedMode) {
  const cycle = page.locator("[data-study-workspace-width-cycle]");
  await cycle.focus();
  if (activation === "enter") await cycle.press("Enter");
  else if (activation === "space") await cycle.press("Space");
  else await cycle.click();
  await page.waitForFunction(
    (mode) =>
      document.documentElement.dataset.studyWorkspaceWidth === mode &&
      document.querySelector("[data-study-workspace-width-cycle]")?.dataset.studyWorkspaceWidthCurrent === mode,
    expectedMode,
  );
  assert(await cycle.evaluate((node) => document.activeElement === node), `${activation}: cycle button did not retain focus`);
  const state = await workspaceState(page);
  assert.equal(state.localStorageMode, expectedMode, `${activation}: width choice was not persisted`);
  assertCycleState(state, expectedMode, activation);
  return state;
}

async function cycleTo(page, targetMode) {
  for (let attempt = 0; attempt < WIDTH_MODES.length; attempt += 1) {
    const state = await workspaceState(page);
    if (state.mode === targetMode) return state;
    await activateCycle(page, "click", nextMode(state.mode));
  }
  throw new Error(`Could not cycle Study workspace to ${targetMode}`);
}

async function visibleAnchorTop(page) {
  return page.evaluate(() => {
    const anchor = document.querySelector(".reader-context-word") ||
      [...document.querySelectorAll(".verse-row")].find((row) => {
        const rect = row.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < innerHeight;
      });
    return anchor?.getBoundingClientRect().top ?? null;
  });
}

async function main() {
  const { server, url } = await startStaticAppServer({ port: 0 });
  const browser = await chromium.launch({
    executablePath: findEdgePath(),
    headless: true,
    args: ["--disable-gpu", "--disable-dev-shm-usage", "--disable-background-networking", "--disable-extensions", "--no-first-run", "--no-default-browser-check"],
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const assertHealthy = attachHealthChecks(page, url);
    await page.goto(`${url}/#/read/bsb/psalms/23/1`, { waitUntil: "load" });
    await waitForReader(page);

    const initial = await workspaceState(page);
    assertCycleState(initial, "standard", "default");
    assert.equal(initial.localStorageMode, null, "Default Standard width should not require a stored preference");

    const widthByMode = { standard: initial.detailRect?.width ?? 0 };
    const expanded = await activateCycle(page, "click", "expanded");
    widthByMode.expanded = expanded.detailRect?.width ?? 0;
    const compact = await activateCycle(page, "enter", "compact");
    widthByMode.compact = compact.detailRect?.width ?? 0;
    const standard = await activateCycle(page, "space", "standard");
    widthByMode.standard = standard.detailRect?.width ?? 0;
    assert(
      widthByMode.compact < widthByMode.standard && widthByMode.standard < widthByMode.expanded,
      `Study pane widths are not ordered Compact < Standard < Expanded: ${JSON.stringify(widthByMode)}`,
    );

    const firstStrong = page.locator(".strong-token").first();
    await firstStrong.scrollIntoViewIfNeeded();
    await firstStrong.click();
    await page.waitForFunction(() => Boolean(document.querySelector(".reader-context-word")));
    const anchorBefore = await visibleAnchorTop(page);
    await cycleTo(page, "expanded");
    const anchorExpanded = await visibleAnchorTop(page);
    await cycleTo(page, "compact");
    const anchorCompact = await visibleAnchorTop(page);
    for (const [label, value] of [["expanded", anchorExpanded], ["compact", anchorCompact]]) {
      assert(anchorBefore !== null && value !== null && Math.abs(value - anchorBefore) <= 2, `${label}: semantic Reader anchor moved during width change (${anchorBefore} → ${value})`);
    }

    const focusOrder = [];
    await page.locator("[data-study-workspace-width-cycle]").focus();
    focusOrder.push(await page.evaluate(() => document.activeElement?.id || ""));
    await page.keyboard.press("Tab");
    focusOrder.push(await page.evaluate(() => document.activeElement?.id || ""));
    await page.keyboard.press("Tab");
    focusOrder.push(await page.evaluate(() => document.activeElement?.id || ""));
    assert.deepEqual(focusOrder, ["studyWorkspaceWidthCycle", "clearDetail", "hideStudyWorkspace"], "Study header keyboard order must be Width, Clear, Hide");

    const beforeHide = await workspaceState(page);
    await page.locator("#hideStudyWorkspace").click();
    await page.waitForFunction(() => document.documentElement.dataset.studyWorkspaceHidden === "true" && !document.querySelector("#showStudyWorkspace")?.hidden);
    const hidden = await workspaceState(page);
    assert(hidden.hidden, "Hide must set the stable hidden workspace state");
    assert(hidden.showVisible, "Desktop Show control must become visible after hiding the Study workspace");
    assert(hidden.documentOverflow <= 1, "Hidden workspace must not create horizontal overflow");
    await page.locator("#showStudyWorkspace").click();
    await page.waitForFunction(() => document.documentElement.dataset.studyWorkspaceHidden !== "true" && document.querySelector("#showStudyWorkspace")?.hidden);
    const restored = await workspaceState(page);
    assert(!restored.hidden, "Show must restore the Study workspace");
    assert.equal(restored.mode, beforeHide.mode, "Hide/Show must not change the selected width mode");

    await cycleTo(page, "expanded");
    await page.reload({ waitUntil: "load" });
    await waitForReader(page);
    assertCycleState(await workspaceState(page), "expanded", "reload/persisted");

    await page.evaluate((key) => localStorage.setItem(key, "unsupported"), WIDTH_STORAGE_KEY);
    await page.reload({ waitUntil: "load" });
    await waitForReader(page);
    assertCycleState(await workspaceState(page), "standard", "reload/malformed-storage");

    for (const viewport of [
      { width: 900, height: 720 },
      { width: 1100, height: 720 },
      { width: 1280, height: 720 },
      { width: 1600, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      for (const mode of WIDTH_MODES) {
        const state = await cycleTo(page, mode);
        assertCycleState(state, mode, `${viewport.width}x${viewport.height}/${mode}`);
        assert(state.cycle.visible, `${viewport.width}/${mode}: desktop width cycle must remain visible`);
        assert(["narrow", "constrained", "wide"].includes(state.headerBand), `${viewport.width}/${mode}: unrecognized Study header container band ${state.headerBand}`);
      }
    }

    await page.setViewportSize({ width: 740, height: 760 });
    const mobile = await workspaceState(page);
    assert(mobile.cycle && !mobile.cycle.visible, "Mobile must hide the desktop Study width control");
    assert(!mobile.showVisible, "Mobile must not expose the desktop Show workspace button");
    assert(mobile.documentOverflow <= 1, "Mobile Study workspace must not create horizontal overflow");

    assertHealthy();
    console.log(JSON.stringify({
      status: "ok",
      widthControl: "single-cycle",
      modes: WIDTH_MODES,
      widthByMode,
      desktopViewports: 4,
      mobileViewport: 1,
      hideShow: true,
      anchorPreserved: true,
    }, null, 2));
  } finally {
    await browser.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

await main();