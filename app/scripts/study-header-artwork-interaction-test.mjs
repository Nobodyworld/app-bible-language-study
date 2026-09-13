#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { startStaticAppServer } from "../tools/serve-app.mjs";

const WIDTH_STORAGE_KEY = "bibleapp:study-workspace-width:v1";
const WIDTH_SEQUENCE = Object.freeze(["compact", "standard", "expanded"]);

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
    assert.deepEqual(consoleErrors, [], "Study header width-cycle test reported console errors");
    assert.deepEqual(pageErrors, [], "Study header width-cycle test reported page errors");
    assert.deepEqual(requestFailures, [], "Study header width-cycle test reported request failures");
    assert.deepEqual(responseFailures, [], "Study header width-cycle test reported HTTP failures");
  };
}

async function waitForApp(page) {
  await page.waitForFunction(() =>
    document.querySelector("#chapterTitle")?.textContent.includes("Psalms 23") &&
    !document.body.textContent.includes("Loading data") &&
    document.querySelectorAll("[data-study-workspace-width-cycle]").length === 1 &&
    ["compact", "standard", "expanded"].includes(document.documentElement.dataset.studyWorkspaceWidth),
  );
  await page.waitForLoadState("networkidle");
}

async function readGeometry(page) {
  return page.evaluate(() => {
    const center = (rect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    const button = document.querySelector("[data-study-workspace-width-cycle]");
    const svg = button?.querySelector(".study-workspace-width-symbol");
    const frame = svg?.querySelector(".study-workspace-width-frame");
    const visibleDivider = [...(svg?.querySelectorAll(".study-workspace-width-divider") || [])]
      .find((candidate) => getComputedStyle(candidate).display !== "none");
    const buttonRect = button?.getBoundingClientRect();
    const svgRect = svg?.getBoundingClientRect();
    const frameBox = frame?.getBBox();
    const dividerBox = visibleDivider?.getBBox();

    const action = (selector) => {
      const actionButton = document.querySelector(selector);
      const label = actionButton?.querySelector(".detail-header-icon-label");
      const icon = actionButton?.querySelector("svg");
      if (!actionButton || !label || !icon) return null;
      const actionRect = actionButton.getBoundingClientRect();
      const labelRect = label.getBoundingClientRect();
      const iconRect = icon.getBoundingClientRect();
      return {
        buttonCenterY: center(actionRect).y,
        labelCenterY: center(labelRect).y,
        iconCenterY: center(iconRect).y,
      };
    };

    const arrow = (selector) => {
      const icon = document.querySelector(selector);
      const head = icon?.querySelector(".study-workspace-panel-arrow-head");
      const box = head?.getBBox();
      return icon && box ? {
        direction: icon.dataset.workspaceDirection,
        headCenterX: box.x + box.width / 2,
        viewCenterX: icon.viewBox.baseVal.x + icon.viewBox.baseVal.width / 2,
      } : null;
    };

    return {
      rootMode: document.documentElement.dataset.studyWorkspaceWidth || "",
      cycle: button && svg && buttonRect && svgRect && frameBox && dividerBox ? {
        button: { width: buttonRect.width, height: buttonRect.height, center: center(buttonRect) },
        svg: { width: svgRect.width, height: svgRect.height, center: center(svgRect) },
        current: button.dataset.studyWorkspaceWidthCurrent || "",
        modeAttribute: button.dataset.studyWorkspaceWidthMode || "",
        next: button.dataset.studyWorkspaceWidthNext || "",
        ariaLabel: button.getAttribute("aria-label") || "",
        title: button.getAttribute("title") || "",
        ariaPressed: button.getAttribute("aria-pressed"),
        frameCenter: { x: frameBox.x + frameBox.width / 2, y: frameBox.y + frameBox.height / 2 },
        dividerCenterX: dividerBox.x + dividerBox.width / 2,
        visibleDividerClass: visibleDivider.getAttribute("class") || "",
        stroke: getComputedStyle(svg).stroke,
      } : null,
      clear: action("#clearDetail"),
      hide: action("#hideStudyWorkspace"),
      hideArrow: arrow("#hideStudyWorkspace .study-workspace-panel-icon"),
      showArrow: arrow("#showStudyWorkspace .study-workspace-panel-icon"),
      forcedColors: window.matchMedia("(forced-colors: active)").matches,
    };
  });
}

function expectedNext(mode) {
  return WIDTH_SEQUENCE[(WIDTH_SEQUENCE.indexOf(mode) + 1) % WIDTH_SEQUENCE.length];
}

function assertGeometry(state, label) {
  const control = state.cycle;
  assert(control, `${label}: width-cycle geometry is missing`);
  assert(Math.abs(control.button.width - 32) <= 0.25 && Math.abs(control.button.height - 32) <= 0.25, `${label}: width-cycle target is not 32px`);
  assert(Math.abs(control.svg.center.x - control.button.center.x) <= 0.5 && Math.abs(control.svg.center.y - control.button.center.y) <= 0.5, `${label}: width-cycle SVG is not centered in the button`);
  assert(Math.abs(control.frameCenter.x - 10) <= 0.01 && Math.abs(control.frameCenter.y - 8) <= 0.01, `${label}: panel frame is not centered in its viewBox`);
  assert(control.stroke && control.stroke !== "none", `${label}: width-cycle artwork stroke is not visible`);
  assert.equal(control.current, state.rootMode, `${label}: cycle control current state disagrees with the root width state`);
  assert.equal(control.modeAttribute, state.rootMode, `${label}: compatibility width-mode attribute disagrees with the root state`);
  assert.equal(control.next, expectedNext(state.rootMode), `${label}: cycle control points to the wrong next state`);
  assert.equal(control.ariaPressed, null, `${label}: cycle control must not masquerade as a pressed-state radio button`);
  assert.match(control.ariaLabel, new RegExp(`width: ${state.rootMode}`, "i"), `${label}: accessible name omits the current width`);
  assert.match(control.ariaLabel, new RegExp(`to ${control.next}`, "i"), `${label}: accessible name omits the next width`);
  assert(control.visibleDividerClass.includes(`study-workspace-width-divider-${state.rootMode}`), `${label}: visible divider does not represent the current width`);

  for (const [name, action] of [["Clear", state.clear], ["Hide", state.hide]]) {
    assert(action, `${label}/${name}: action geometry is missing`);
    assert(Math.abs(action.labelCenterY - action.iconCenterY) <= 1, `${label}/${name}: label and icon are vertically misaligned`);
    assert(Math.abs(action.buttonCenterY - action.iconCenterY) <= 1, `${label}/${name}: icon is not centered in the button`);
  }
  assert(state.hideArrow?.direction === "collapse-right" && state.hideArrow.headCenterX > state.hideArrow.viewCenterX, `${label}: Hide arrow does not point outward/right`);
  assert(state.showArrow?.direction === "restore-left" && state.showArrow.headCenterX < state.showArrow.viewCenterX, `${label}: Show arrow does not point inward/left`);
}

async function activateAndWait(page, activation, expectedMode) {
  const button = page.locator("[data-study-workspace-width-cycle]");
  await button.focus();
  if (activation === "enter") await button.press("Enter");
  else if (activation === "space") await button.press("Space");
  else await button.click();
  await page.waitForFunction(
    (mode) =>
      document.documentElement.dataset.studyWorkspaceWidth === mode &&
      document.querySelector("[data-study-workspace-width-cycle]")?.dataset.studyWorkspaceWidthCurrent === mode,
    expectedMode,
  );
  assert(await button.evaluate((node) => document.activeElement === node), `${activation}: width-cycle button did not retain focus`);
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), WIDTH_STORAGE_KEY), expectedMode, `${activation}: width choice was not persisted`);
  return readGeometry(page);
}

async function assertHeaderRow(page, label) {
  const geometry = await page.evaluate(() => {
    const pane = document.querySelector('.detail-pane');
    const header = document.querySelector('.detail-header');
    const boxes = ['.detail-title-block h2', '.detail-mode-status', '#studyWorkspaceWidthCycle', '#clearDetail', '#hideStudyWorkspace']
      .map(selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { selector, left:r.left, right:r.right, top:r.top, bottom:r.bottom }; });
    const r = header.getBoundingClientRect();
    return { paneWidth:pane.getBoundingClientRect().width, contentWidth:pane.clientWidth, headerHeight:r.height,
      sameRow: Math.min(...boxes.map(b=>b.bottom)) > Math.max(...boxes.map(b=>b.top)),
      contained: boxes.every(b=>b.left>=r.left && b.right<=r.right),
      noOverlap: boxes.slice(1).every((b,i)=>b.left>=boxes[i].right), boxes };
  });
  if (process.env.BIBLEAPP_UI_EVIDENCE_DIR) {
    mkdirSync(process.env.BIBLEAPP_UI_EVIDENCE_DIR, { recursive:true });
    await page.screenshot({path:path.join(process.env.BIBLEAPP_UI_EVIDENCE_DIR, `header-${label}.png`)});
  }
  assert(geometry.contained, `${label}: Study controls must remain contained: ${JSON.stringify(geometry)}`);
  assert(geometry.paneWidth >= 320 ? geometry.sameRow && geometry.noOverlap : !geometry.sameRow,
    `${label}: Study header must use one row from 320px and stacked fallback below it: ${JSON.stringify(geometry)}`);
  return { label, paneWidth:geometry.paneWidth, contentWidth:geometry.contentWidth, headerHeight:geometry.headerHeight };
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
    await waitForApp(page);

    const dividerCenters = {};
    const initial = await readGeometry(page);
    assert.equal(initial.rootMode, "standard", "Width cycle must default to Standard when no preference exists");
    assertGeometry(initial, "initial/standard");
    dividerCenters.standard = initial.cycle.dividerCenterX;

    const expanded = await activateAndWait(page, "click", "expanded");
    assertGeometry(expanded, "click/expanded");
    dividerCenters.expanded = expanded.cycle.dividerCenterX;

    const compact = await activateAndWait(page, "enter", "compact");
    assertGeometry(compact, "enter/compact");
    const rows = [await assertHeaderRow(page, "compact-320")];
    dividerCenters.compact = compact.cycle.dividerCenterX;

    const standard = await activateAndWait(page, "space", "standard");
    assertGeometry(standard, "space/standard");
    dividerCenters.standard = standard.cycle.dividerCenterX;
    assert(
      dividerCenters.compact > dividerCenters.standard && dividerCenters.standard > dividerCenters.expanded,
      `Right-anchored width icon does not move its divider left as the Study pane grows: ${JSON.stringify(dividerCenters)}`,
    );

    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      assertGeometry(await readGeometry(page), theme);
      for (const mode of ["expanded", "compact", "standard"]) {
        while ((await readGeometry(page)).rootMode !== mode) await activateAndWait(page, "click", expectedNext((await readGeometry(page)).rootMode));
        rows.push(await assertHeaderRow(page, `${theme}-${mode}`));
      }
    }

    await page.emulateMedia({ forcedColors: "active" });
    const forced = await readGeometry(page);
    assert(forced.forcedColors, "Forced-colors emulation did not activate");
    assertGeometry(forced, "forced-colors");
    rows.push(await assertHeaderRow(page, "forced-colors"));
    await page.emulateMedia({ forcedColors: "none" });

    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const width of [900, 1600, 1280]) {
      await page.setViewportSize({ width, height:800 });
      while ((await readGeometry(page)).rootMode !== "compact") await activateAndWait(page, "space", expectedNext((await readGeometry(page)).rootMode));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      rows.push(await assertHeaderRow(page, `resize-${width}-compact`));
    }
    // Force a genuinely smaller measured pane to protect the stacked fallback.
    await page.addStyleTag({content:':root { --study-workspace-inline-size: 290px !important; }'});
    await page.waitForFunction(() => Math.abs(document.querySelector('.detail-pane').getBoundingClientRect().width - 290) < 0.1);
    assert.equal(await page.locator('.detail-header').evaluate(n=>getComputedStyle(n).getPropertyValue('--study-header-layout-band').trim()), "narrow");
    await page.locator('head style').last().evaluate(n=>n.remove());

    await page.locator("#hideStudyWorkspace").click();
    await page.waitForFunction(() => document.documentElement.dataset.studyWorkspaceHidden === "true" && !document.querySelector("#showStudyWorkspace")?.hidden);
    await page.locator("#showStudyWorkspace").click();
    await page.waitForFunction(() => document.documentElement.dataset.studyWorkspaceHidden !== "true" && document.querySelector("#showStudyWorkspace")?.hidden);

    assertHealthy();
    console.log(JSON.stringify({ status: "ok", browser:browser.version(), themes: 3, widthControls: 1, widthStates: 3, actions: 2, directions: 2, rows, reflow:"viewport resizing; not browser zoom" }, null, 2));
  } finally {
    await browser.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

await main();
