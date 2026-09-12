#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { startStaticAppServer } from "../tools/serve-app.mjs";

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
    assert.deepEqual(consoleErrors, [], "Study header artwork test reported console errors");
    assert.deepEqual(pageErrors, [], "Study header artwork test reported page errors");
    assert.deepEqual(requestFailures, [], "Study header artwork test reported request failures");
    assert.deepEqual(responseFailures, [], "Study header artwork test reported HTTP failures");
  };
}

async function waitForApp(page) {
  await page.waitForFunction(() =>
    document.querySelector("#chapterTitle")?.textContent.includes("Psalms 23") &&
    !document.body.textContent.includes("Loading data") &&
    document.querySelectorAll("[data-study-workspace-width-mode]").length === 3,
  );
  await page.waitForLoadState("networkidle");
}

async function readGeometry(page) {
  return page.evaluate(() => {
    const center = (rect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    const widthIcons = Object.fromEntries([...document.querySelectorAll("[data-study-workspace-width-mode]")].map((button) => {
      const svg = button.querySelector(".study-workspace-width-symbol");
      const artwork = svg?.querySelector(".study-workspace-width-artwork");
      const buttonRect = button.getBoundingClientRect();
      const svgRect = svg?.getBoundingClientRect();
      const artworkBox = artwork?.getBBox();
      const viewBox = svg?.viewBox.baseVal;
      return [button.dataset.studyWorkspaceWidthMode, {
        button: { width: buttonRect.width, height: buttonRect.height, center: center(buttonRect) },
        svg: svgRect ? { width: svgRect.width, height: svgRect.height, center: center(svgRect) } : null,
        artworkCenter: artworkBox ? { x: artworkBox.x + artworkBox.width / 2, y: artworkBox.y + artworkBox.height / 2 } : null,
        viewCenter: viewBox ? { x: viewBox.x + viewBox.width / 2, y: viewBox.y + viewBox.height / 2 } : null,
        stroke: svg ? getComputedStyle(svg).stroke : "",
      }];
    }));

    const action = (selector) => {
      const button = document.querySelector(selector);
      const label = button?.querySelector(".detail-header-icon-label");
      const svg = button?.querySelector("svg");
      if (!button || !label || !svg) return null;
      const buttonRect = button.getBoundingClientRect();
      const labelRect = label.getBoundingClientRect();
      const svgRect = svg.getBoundingClientRect();
      return {
        buttonCenterY: center(buttonRect).y,
        labelCenterY: center(labelRect).y,
        iconCenterY: center(svgRect).y,
      };
    };

    const arrow = (selector) => {
      const svg = document.querySelector(selector);
      const head = svg?.querySelector(".study-workspace-panel-arrow-head");
      const box = head?.getBBox();
      return svg && box ? {
        direction: svg.dataset.workspaceDirection,
        headCenterX: box.x + box.width / 2,
        viewCenterX: svg.viewBox.baseVal.x + svg.viewBox.baseVal.width / 2,
      } : null;
    };

    return {
      widthIcons,
      clear: action("#clearDetail"),
      hide: action("#hideStudyWorkspace"),
      hideArrow: arrow("#hideStudyWorkspace .study-workspace-panel-icon"),
      showArrow: arrow("#showStudyWorkspace .study-workspace-panel-icon"),
      forcedColors: window.matchMedia("(forced-colors: active)").matches,
    };
  });
}

function assertCentered(state, label) {
  for (const [mode, icon] of Object.entries(state.widthIcons)) {
    assert(Math.abs(icon.button.width - 32) <= 0.25 && Math.abs(icon.button.height - 32) <= 0.25, `${label}/${mode}: width target is not 32px`);
    assert(icon.svg, `${label}/${mode}: SVG artwork is missing`);
    assert(Math.abs(icon.svg.center.x - icon.button.center.x) <= 0.5 && Math.abs(icon.svg.center.y - icon.button.center.y) <= 0.5, `${label}/${mode}: SVG is not centered in the button`);
    assert(Math.abs(icon.artworkCenter.x - icon.viewCenter.x) <= 0.01 && Math.abs(icon.artworkCenter.y - icon.viewCenter.y) <= 0.01, `${label}/${mode}: artwork is not centered in its viewBox`);
    assert(icon.stroke && icon.stroke !== "none", `${label}/${mode}: artwork stroke is not visible`);
  }
  for (const [name, action] of [["Clear", state.clear], ["Hide", state.hide]]) {
    assert(action, `${label}/${name}: action geometry is missing`);
    assert(Math.abs(action.labelCenterY - action.iconCenterY) <= 1, `${label}/${name}: label and icon are vertically misaligned`);
    assert(Math.abs(action.buttonCenterY - action.iconCenterY) <= 1, `${label}/${name}: icon is not centered in the button`);
  }
  assert(state.hideArrow?.direction === "collapse-right" && state.hideArrow.headCenterX > state.hideArrow.viewCenterX, `${label}: Hide arrow does not point outward/right`);
  assert(state.showArrow?.direction === "restore-left" && state.showArrow.headCenterX < state.showArrow.viewCenterX, `${label}: Show arrow does not point inward/left`);
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

    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      assertCentered(await readGeometry(page), theme);
    }

    await page.emulateMedia({ forcedColors: "active" });
    const forced = await readGeometry(page);
    assert(forced.forcedColors, "Forced-colors emulation did not activate");
    assertCentered(forced, "forced-colors");
    await page.emulateMedia({ forcedColors: "none" });

    await page.locator("#hideStudyWorkspace").click();
    await page.waitForFunction(() => document.documentElement.dataset.studyWorkspaceHidden === "true" && !document.querySelector("#showStudyWorkspace")?.hidden);
    await page.locator("#showStudyWorkspace").click();
    await page.waitForFunction(() => document.documentElement.dataset.studyWorkspaceHidden !== "true" && document.querySelector("#showStudyWorkspace")?.hidden);

    assertHealthy();
    console.log(JSON.stringify({ status: "ok", themes: 3, widthControls: 3, actions: 2, directions: 2 }, null, 2));
  } finally {
    await browser.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

await main();
