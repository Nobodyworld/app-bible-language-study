#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const screenshotRoot = String(process.env.PANEL_CONTEXT_SCREENSHOT_DIR || "").trim();
const captureOnly = process.env.PANEL_CONTEXT_CAPTURE_ONLY === "1";
const THEMES = Object.freeze(["light", "dark"]);
const TEMPORARY_TAG_COUNT = 9;
const VIEWPORTS = Object.freeze({
  desktop: Object.freeze({ width: 1280, height: 720 }),
  narrow: Object.freeze({ width: 820, height: 900 }),
  mobile: Object.freeze({ width: 390, height: 844 }),
});

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
    await delay(150);
  }
  throw new Error(`Timed out waiting for: ${predicate}`);
}

async function click(page, selector) {
  await page.waitForSelector(selector, { state: "attached" });
  await page.evaluate((target) => {
    const node = document.querySelector(target);
    node?.scrollIntoView({ block: "center" });
    node?.click();
  }, selector);
}

async function capturePanel(page, mode, theme, stateName) {
  if (!screenshotRoot) return null;
  await mkdir(screenshotRoot, { recursive: true });
  const path = join(screenshotRoot, `panel-context-${mode}-${theme}-${stateName}.png`);
  await page.locator(".detail-pane").screenshot({ path });
  return path;
}

async function setTheme(page, theme) {
  await page.waitForFunction(() => ["light", "dark"].includes(document.documentElement.dataset.theme));
  if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) {
    await click(page, "#themeToggle");
  }
  await page.waitForFunction((expectedTheme) => document.documentElement.dataset.theme === expectedTheme, theme);
}

async function createTemporaryTags(page, labels) {
  await click(page, "#showTags");
  await waitFor(page, () => Boolean(document.querySelector("#detailContent .custom-tag-form")));
  const created = await page.evaluate((temporaryLabels) => {
    for (const label of temporaryLabels) {
      const form = document.querySelector("#detailContent .custom-tag-form");
      const labelInput = form?.querySelector('input[name="label"]');
      const colorInput = form?.querySelector('input[name="color"]');
      const iconInput = form?.querySelector('input[name="icon"]');
      const descriptionInput = form?.querySelector('input[name="description"]');
      if (!form || !labelInput || !colorInput || !iconInput || !descriptionInput) return false;
      labelInput.value = label;
      colorInput.value = "#4f6f91";
      iconInput.value = "Q";
      descriptionInput.value = "Temporary panel popover browser test tag";
      form.requestSubmit();
    }
    return temporaryLabels.every((label) =>
      [...document.querySelectorAll("#detailContent .custom-tag-edit-form input[name='edit-label']")].some(
        (input) => input.value === label,
      ),
    );
  }, labels);
  assert(created, "temporary custom Study Marks tags were not created through the canonical tag manager");
}

async function removeTemporaryTags(page, labels) {
  await click(page, "#showTags");
  await waitFor(page, () => Boolean(document.querySelector("#detailContent .custom-tag-form")));
  const cleanup = await page.evaluate((temporaryLabels) => {
    const removed = [];
    for (const label of temporaryLabels) {
      const form = [...document.querySelectorAll("#detailContent .custom-tag-edit-form")].find(
        (node) => node.querySelector('input[name="edit-label"]')?.value === label,
      );
      const remove = form?.querySelector(".danger-button");
      if (!remove) continue;
      remove.click();
      if (remove.dataset.confirm !== "true") continue;
      remove.click();
      removed.push(label);
    }
    const remaining = temporaryLabels.filter((label) =>
      [...document.querySelectorAll("#detailContent .custom-tag-edit-form input[name='edit-label']")].some(
        (input) => input.value === label,
      ),
    );
    return { removed, remaining };
  }, labels);
  assert.deepEqual(cleanup.removed, labels, `temporary custom tags were not removed: ${JSON.stringify(cleanup)}`);
  assert.deepEqual(cleanup.remaining, [], `retired temporary tags remain visible: ${JSON.stringify(cleanup)}`);
}

async function openStrongFromReader(page) {
  await click(page, ".verse-study-button");
  await waitFor(page, () => Boolean(document.querySelector("#detailContext .panel-context-navigation")));
  await click(
    page,
    "#detailContext [data-panel-scope='verse'] .verse-context-tab[data-visible-label='Language']",
  );
  await waitFor(page, () =>
    document.querySelector("#detailTitle")?.textContent === "Language Study" &&
    document.querySelectorAll("#detailContent .interlinear-token").length > 0,
  );
  await click(page, ".strong-token[data-strong-code]");
  await waitFor(page, () =>
    document.querySelector("#detailTitle")?.textContent === "Strong's" &&
    document.querySelector("#detailContext [data-panel-scope='word']") &&
    document.querySelector("#detailContext [data-panel-scope='word'] .study-marks-trigger") &&
    document.querySelector("#detailContext [data-panel-scope='verse'] .study-marks-trigger"),
  );
}

async function panelStudyMarksState(page, selector) {
  return page.evaluate((target) => {
    const rect = (node) => {
      if (!node) return null;
      const value = node.getBoundingClientRect();
      return {
        left: value.left,
        top: value.top,
        right: value.right,
        bottom: value.bottom,
        width: value.width,
        height: value.height,
      };
    };
    const trigger = document.querySelector(target);
    const menu = trigger?.closest(".target-tag-picker-menu");
    const popover = menu?.querySelector(".target-tag-picker-popover");
    const controls = trigger?.closest(".panel-context-controls");
    const pane = document.querySelector(".detail-pane");
    const detail = document.querySelector("#detailContent");
    return {
      activeMarks: [...(popover?.querySelectorAll('.tag-picker-option[aria-pressed="true"]') || [])]
        .map((option) => option.getAttribute("aria-label"))
        .sort(),
      activeWord: document.querySelector("#detailContext [data-panel-scope='word'] .verse-context-tab[data-visible-label='Word']")?.getAttribute("aria-current") || "",
      controlHeight: controls?.getBoundingClientRect().height || 0,
      controlRows: controls
        ? new Set([...controls.children].map((node) => Math.round(node.getBoundingClientRect().top))).size
        : 0,
      controls: rect(controls),
      detailChildCount: detail?.children.length || 0,
      detailScrollTop: detail?.scrollTop || 0,
      detailTitle: document.querySelector("#detailTitle")?.textContent.trim() || "",
      documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
      focusedTrigger: document.activeElement === trigger,
      forwardDisabled: document.querySelector("#detailForward")?.disabled ?? null,
      historyBackDisabled: document.querySelector("#detailBack")?.disabled ?? null,
      lock: pane?.dataset.panelMode || "",
      menuBoundary: menu?.dataset.menuBoundary || "",
      menuOpen: menu?.dataset.menuOpen === "true",
      pane: rect(pane),
      paneOverflow: pane ? pane.scrollWidth - pane.clientWidth : 0,
      popover: rect(popover),
      popoverClientHeight: popover?.clientHeight || 0,
      popoverScrollHeight: popover?.scrollHeight || 0,
      popoverScrollTop: popover?.scrollTop || 0,
      popoverWidthOverflow: popover ? popover.scrollWidth - popover.clientWidth : 0,
      readerToken:
        document.querySelector(".reader-context-word")?.dataset.strongCode ||
        document.querySelector(".reader-context-word")?.textContent.trim() ||
        "",
      selectedToken: document.querySelector("#detailContent .strong-code")?.textContent.trim() || "",
      strongDetail: Boolean(document.querySelector("#detailContent .strong-detail")),
      theme: document.documentElement.dataset.theme || "",
      trigger: rect(trigger),
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  }, selector);
}

function assertRectStable(before, after, label) {
  assert(before && after, `${label}: required geometry is missing`);
  ["left", "top", "right", "bottom", "width", "height"].forEach((field) => {
    assert(
      Math.abs(before[field] - after[field]) <= 1,
      `${label}: ${field} changed by more than 1px: ${JSON.stringify({ before, after })}`,
    );
  });
}

function assertPanelStudyMarksInvariant(before, after, label) {
  assert.equal(after.detailTitle, before.detailTitle, `${label}: menu interaction changed the detail title`);
  assert.equal(after.selectedToken, before.selectedToken, `${label}: menu interaction changed the selected Strong's token`);
  assert.equal(after.readerToken, before.readerToken, `${label}: menu interaction changed the reader highlight`);
  assert.equal(after.lock, before.lock, `${label}: menu interaction changed panel lock state`);
  assert.equal(after.activeWord, before.activeWord, `${label}: menu interaction changed the active Word state`);
  assert.equal(after.historyBackDisabled, before.historyBackDisabled, `${label}: menu interaction changed Back history state`);
  assert.equal(after.forwardDisabled, before.forwardDisabled, `${label}: menu interaction changed Forward history state`);
  assert.equal(after.detailChildCount, before.detailChildCount, `${label}: menu interaction rebuilt the Strong's detail`);
  assert.equal(after.controlRows, before.controlRows, `${label}: menu interaction changed control-strip wrapping`);
  assert.equal(after.controlHeight, before.controlHeight, `${label}: menu interaction changed control-strip height`);
  assert.deepEqual(after.activeMarks, before.activeMarks, `${label}: menu interaction changed Study Marks assertions`);
  assertRectStable(before.trigger, after.trigger, `${label}: trigger geometry`);
  assertRectStable(before.controls, after.controls, `${label}: control-strip geometry`);
}

function assertPanelStudyMarksContainment(state, label) {
  assert.equal(state.menuBoundary, "detail-pane", `${label}: picker is not opted into detail-pane containment`);
  assert(state.menuOpen, `${label}: picker did not remain open: ${JSON.stringify(state)}`);
  assert(state.popover && state.pane, `${label}: popover or detail pane geometry is missing`);
  const left = Math.max(0, state.pane.left);
  const top = Math.max(0, state.pane.top);
  const right = Math.min(state.viewport.width, state.pane.right);
  const bottom = Math.min(state.viewport.height, state.pane.bottom);
  assert(
    state.popover.left >= left - 1 &&
      state.popover.right <= right + 1 &&
      state.popover.top >= top - 1 &&
      state.popover.bottom <= bottom + 1,
    `${label}: picker escaped the detail pane or viewport: ${JSON.stringify({ popover: state.popover, pane: state.pane, viewport: state.viewport })}`,
  );
  assert(state.popoverWidthOverflow <= 1, `${label}: picker has horizontal overflow`);
  assert(state.paneOverflow <= 1, `${label}: detail pane has horizontal overflow`);
  assert(state.documentOverflow <= 1, `${label}: document has horizontal overflow`);
}

async function exercisePanelStudyMarksPopover(page, selector, label) {
  await page.evaluate(() => document.querySelector("#themeToggle")?.focus());
  await page.evaluate(() => {
    const detail = document.querySelector("#detailContent");
    if (!detail) return;
    detail.scrollTop = Math.min(64, Math.max(0, detail.scrollHeight - detail.clientHeight));
  });
  const triggerLocator = page.locator(selector);
  await triggerLocator.scrollIntoViewIfNeeded();
  const before = await panelStudyMarksState(page, selector);
  assert.equal(before.detailTitle, "Strong's", `${label}: expected a Strong's panel`);
  assert(
    before.strongDetail && before.selectedToken,
    `${label}: selected Strong's context is incomplete: ${JSON.stringify(before)}`,
  );

  const triggerBox = await triggerLocator.boundingBox();
  assert(triggerBox, `${label}: Study Marks trigger is not visible`);
  if (await page.evaluate(() => window.matchMedia("(hover: hover)").matches)) {
    await triggerLocator.hover();
  } else {
    await triggerLocator.click();
  }
  await page.waitForFunction(
    (target) => document.querySelector(target)?.closest(".target-tag-picker-menu")?.dataset.menuOpen === "true",
    selector,
  );
  const opened = await panelStudyMarksState(page, selector);
  assertPanelStudyMarksContainment(opened, `${label}: opening`);
  assertPanelStudyMarksInvariant(before, opened, `${label}: opening`);
  assert(
    opened.popoverScrollHeight > opened.popoverClientHeight,
    `${label}: temporary tags did not make the picker vertically scrollable`,
  );

  const popoverPoint = {
    x: opened.popover.left + opened.popover.width / 2,
    y: opened.popover.top + Math.min(16, opened.popover.height / 2),
  };
  await page.mouse.move(popoverPoint.x, popoverPoint.y);
  const pointerEntry = await page.evaluate(({ target, point }) => {
    const menu = document.querySelector(target)?.closest(".target-tag-picker-menu");
    const element = document.elementFromPoint(point.x, point.y);
    return {
      element: element?.className || element?.tagName || "",
      menuContainsPoint: Boolean(menu?.contains(element)),
      menuHovered: menu?.matches(":hover") || false,
    };
  }, { target: selector, point: popoverPoint });
  assert(
    pointerEntry.menuContainsPoint && pointerEntry.menuHovered,
    `${label}: pointer could not enter the contained popover: ${JSON.stringify(pointerEntry)}`,
  );
  await delay(220);
  const hovered = await panelStudyMarksState(page, selector);
  assertPanelStudyMarksContainment(hovered, `${label}: pointer transition`);
  assertPanelStudyMarksInvariant(before, hovered, `${label}: pointer transition`);

  await page.mouse.wheel(0, 180);
  await delay(120);
  const scrolled = await panelStudyMarksState(page, selector);
  assertPanelStudyMarksContainment(scrolled, `${label}: wheel scroll`);
  assertPanelStudyMarksInvariant(before, scrolled, `${label}: wheel scroll`);
  assert(scrolled.popoverScrollTop > hovered.popoverScrollTop, `${label}: wheel did not scroll the picker`);
  assert.equal(scrolled.detailScrollTop, before.detailScrollTop, `${label}: wheel scrolled underlying Strong's content`);

  await page.keyboard.press("Escape");
  await page.waitForFunction(
    (target) => document.querySelector(target)?.closest(".target-tag-picker-menu")?.dataset.menuOpen !== "true",
    selector,
  );
  const dismissed = await panelStudyMarksState(page, selector);
  assertPanelStudyMarksInvariant(before, dismissed, `${label}: Escape dismissal`);
  assert(dismissed.focusedTrigger, `${label}: Escape did not restore focus to the active trigger`);
  return {
    placement: opened.popover?.top >= opened.trigger?.bottom ? "below" : "above",
    popoverScrollTop: scrolled.popoverScrollTop,
    popoverScrollHeight: opened.popoverScrollHeight,
  };
}

async function contextState(page) {
  return page.evaluate(() => {
    const parseColor = (value) => {
      const normalized = String(value || "").trim();
      const hex = normalized.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
      if (hex) {
        const digits = hex[1].length === 3 ? hex[1].split("").map((digit) => `${digit}${digit}`).join("") : hex[1];
        return [
          Number.parseInt(digits.slice(0, 2), 16),
          Number.parseInt(digits.slice(2, 4), 16),
          Number.parseInt(digits.slice(4, 6), 16),
          1,
        ];
      }
      const rgb = normalized.match(/rgba?\(([^)]+)\)/i);
      if (!rgb) return null;
      const values = rgb[1].split(",").map((part) => Number.parseFloat(part.trim()));
      if (values.length < 3 || values.slice(0, 3).some((valuePart) => !Number.isFinite(valuePart))) return null;
      return [values[0], values[1], values[2], Number.isFinite(values[3]) ? values[3] : 1];
    };
    const composite = (foreground, background) => {
      const alpha = foreground?.[3] ?? 1;
      return [0, 1, 2].map((index) => foreground[index] * alpha + background[index] * (1 - alpha));
    };
    const renderedBackground = (node) => {
      const ancestors = [];
      for (let current = node; current; current = current.parentElement) ancestors.push(current);
      return ancestors.reverse().reduce((background, current) => {
        const color = parseColor(getComputedStyle(current).backgroundColor);
        return color ? composite(color, background) : background;
      }, [255, 255, 255]);
    };
    const luminance = (color) => color
      .slice(0, 3)
      .map((channel) => channel / 255)
      .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
      .reduce((total, channel, index, values) => total + [0.2126, 0.7152, 0.0722][index] * channel, 0);
    const contrast = (foreground, background) => {
      if (!foreground || !background) return null;
      const first = luminance(foreground);
      const second = luminance(background);
      return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    };
    const colorState = (node) => {
      if (!node) return null;
      const foreground = parseColor(getComputedStyle(node).color);
      const background = renderedBackground(node);
      return {
        foreground,
        background,
        contrast: contrast(foreground, background),
      };
    };
    const nav = document.querySelector("#detailContext .panel-context-navigation");
    const pane = document.querySelector(".detail-pane");
    const appHeader = document.querySelector(".app-header");
    const detailHeader = document.querySelector(".detail-header");
    const paneRect = pane?.getBoundingClientRect();
    const appHeaderRect = appHeader?.getBoundingClientRect();
    const detailHeaderRect = detailHeader?.getBoundingClientRect();
    const groupScopes = [...document.querySelectorAll("#detailContext .panel-context-group")].map(
      (node) => node.dataset.panelScope,
    );
    const staticScopes = [...document.querySelectorAll(".detail-tool-nav .panel-context-group")].map(
      (node) => node.dataset.panelScope,
    );
    const active = [...document.querySelectorAll("#detailContext .verse-context-tab[aria-current='page']")].map(
      (node) => `${node.dataset.panelScope}:${node.dataset.visibleLabel}`,
    );
    const wordButton = document.querySelector(
      "#detailContext [data-panel-scope='word'] .verse-context-tab[data-visible-label='Word']",
    );
    const parallelButton = document.querySelector(
      "#detailContext [data-panel-scope='verse'] .verse-context-tab[data-visible-label='Parallel']",
    );
    const verseButton = document.querySelector(
      "#detailContext [data-panel-scope='verse'] .verse-context-tab[data-visible-label='Verse']",
    );
    const summary = document.querySelector("#detailContext .panel-context-summary");
    const transliteration = document.querySelector(
      "#detailContent .original-language-transliteration, #detailContent .original-language-word-source .token-translit, #detailContent .original-language-word-source .original-language-token-transliteration",
    );
    const wordStyle = wordButton ? getComputedStyle(wordButton) : null;
    const rootStyle = getComputedStyle(document.documentElement);
    const primaryText = parseColor(rootStyle.getPropertyValue("--text"));
    const mutedText = parseColor(rootStyle.getPropertyValue("--muted"));
    const summaryColor = colorState(summary);
    return {
      title: document.querySelector("#detailTitle")?.textContent.trim() || "",
      lock: pane?.dataset.panelMode || "",
      scopeOrder: nav?.dataset.scopeOrder || "",
      groupScopes,
      staticScopes,
      active,
      panelOccupant: nav?.dataset.panelOccupant || "",
      summary: summary?.textContent.trim() || "",
      summaryOverflow: summary ? summary.scrollWidth - summary.clientWidth : 0,
      summaryColor,
      summaryUsesPrimary: Boolean(
        summaryColor?.foreground && primaryText && summaryColor.foreground.slice(0, 3).every((value, index) => Math.abs(value - primaryText[index]) < 1),
      ),
      summaryUsesMuted: Boolean(
        summaryColor?.foreground && mutedText && summaryColor.foreground.slice(0, 3).every((value, index) => Math.abs(value - mutedText[index]) < 1),
      ),
      transliteration: transliteration
        ? {
            text: transliteration.textContent.trim(),
            ...colorState(transliteration),
            usesMuted: Boolean(
              colorState(transliteration)?.foreground &&
                mutedText &&
                colorState(transliteration).foreground.slice(0, 3).every((value, index) => Math.abs(value - mutedText[index]) < 1),
            ),
          }
        : null,
      wordDisabled: wordButton?.disabled ?? null,
      wordActiveBackground: wordStyle?.backgroundColor || "",
      wordActiveColor: wordStyle?.color || "",
      parallelDisabled: parallelButton?.disabled ?? null,
      verseDisabled: verseButton?.disabled ?? null,
      verseCurrent: verseButton?.getAttribute("aria-current") || "",
      strongSectionControls: [...document.querySelectorAll("#detailContext [data-strong-section-control]")].map((button) => ({
        section: button.dataset.strongSectionControl,
        disabled: button.disabled,
        ariaDisabled: button.getAttribute("aria-disabled"),
        controlState: button.dataset.controlState,
        unavailable: button.dataset.unavailable,
        title: button.title,
        ariaLabel: button.getAttribute("aria-label"),
      })),
      strongSectionAnchors: [...document.querySelectorAll("#detailContent [data-strong-section]")].map(
        (node) => node.dataset.strongSection,
      ),
      readerToken: document.querySelector(".reader-context-word")?.dataset.strongCode || "",
      readerVerse: document.querySelector(".reader-context-verse")?.dataset.verse || "",
      navOverflow: nav ? nav.scrollWidth - nav.clientWidth : 0,
      navHeight: nav ? nav.getBoundingClientRect().height : 0,
      hasSummaryBoundary: Boolean(summary),
      theme: document.documentElement.dataset.theme || "",
      documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
      panelHeaderGap:
        paneRect && appHeaderRect ? Math.round((paneRect.top - appHeaderRect.bottom) * 100) / 100 : null,
      detailHeaderTop: detailHeaderRect ? Math.round(detailHeaderRect.top * 100) / 100 : null,
    };
  });
}

function assertPanelPlacement(state, mode) {
  if (captureOnly) return;
  if (mode === "narrow") {
    assert(
      state.panelHeaderGap >= 0,
      `${mode}: sticky detail panel overlaps the app header: ${JSON.stringify({ panelHeaderGap: state.panelHeaderGap })}`,
    );
    return;
  }
  assert(state.detailHeaderTop >= 0, `${mode}: detail heading is clipped above the viewport`);
}

async function exerciseReaderVerseMarks(page, mode) {
  const rowSelector = ".verse-row[data-verse='1']";
  const menuSelector = `${rowSelector} .verse-number-menu-wrap`;
  const initial = await page.evaluate((selector) => {
    const row = document.querySelector(selector);
    return {
      duplicateTriggers: row?.querySelectorAll(".verse-study-marks-button").length || 0,
      numberMenus: row?.querySelectorAll(".verse-number-menu-wrap").length || 0,
      numberPickers: row?.querySelectorAll(".verse-number-menu-wrap .tag-picker-popover").length || 0,
      actionPickers: row?.querySelectorAll(".verse-row-actions .target-tag-picker-menu, .verse-row-actions .tag-picker-popover").length || 0,
      studyLaunchers: row?.querySelectorAll(".verse-row-actions .verse-study-button").length || 0,
      studyLauncherVisible: (() => {
        const launcher = row?.querySelector(".verse-row-actions .verse-study-button");
        const rect = launcher?.getBoundingClientRect();
        return Boolean(rect && rect.width >= 28 && rect.height >= 28);
      })(),
    };
  }, rowSelector);
  assert.equal(initial.duplicateTriggers, 0, `${mode}: reader verse row must not retain a duplicate Study Marks trigger`);
  assert.equal(initial.numberMenus, 1, `${mode}: reader verse row must retain one verse-number picker`);
  assert.equal(initial.numberPickers, 1, `${mode}: reader verse row must retain one inline Study Marks menu`);
  assert.equal(initial.actionPickers, 0, `${mode}: reader row actions must contain only study tools, not a hidden marks picker`);
  assert.equal(initial.studyLaunchers, 1, `${mode}: reader verse row must retain one ellipsis study-tools launcher`);
  if (mode === "mobile") {
    assert(initial.studyLauncherVisible, `${mode}: ellipsis study-tools launcher is not touch-reachable`);
  }

  const number = page.locator(`${menuSelector} .verse-number`);
  await number.focus();
  await page.waitForFunction(
    (selector) => document.querySelector(selector)?.dataset.menuOpen === "true",
    menuSelector,
  );
  const added = await page.evaluate((selector) => {
    const menu = document.querySelector(selector);
    const favorite = [...(menu?.querySelectorAll(".tag-picker-option") || [])].find(
      (option) => /Favorite/u.test(option.textContent.trim()),
    );
    favorite?.click();
    return Boolean(favorite);
  }, menuSelector);
  assert(added, `${mode}: verse-number picker did not expose the Favorite mark`);
  await page.waitForFunction(
    (selector) => document.querySelector(selector)?.querySelector(".tag-badge")?.textContent.includes("Favorite"),
    rowSelector,
  );
  const afterAdd = await page.evaluate((selector) => {
    const row = document.querySelector(selector);
    return {
      duplicateTriggers: row?.querySelectorAll(".verse-study-marks-button").length || 0,
      numberMenus: row?.querySelectorAll(".verse-number-menu-wrap").length || 0,
      numberPickers: row?.querySelectorAll(".verse-number-menu-wrap .tag-picker-popover").length || 0,
      favoriteBadge: row?.querySelector(".tag-badge")?.textContent.trim() || "",
    };
  }, rowSelector);
  assert.deepEqual(
    { duplicateTriggers: afterAdd.duplicateTriggers, numberMenus: afterAdd.numberMenus, numberPickers: afterAdd.numberPickers },
    { duplicateTriggers: 0, numberMenus: 1, numberPickers: 1 },
    `${mode}: reader rerender introduced a duplicate verse Study Marks menu`,
  );
  assert.match(afterAdd.favoriteBadge, /Favorite/, `${mode}: verse-number mark did not rerender as an active badge`);

  await page.locator(`${menuSelector} .verse-number`).focus();
  await page.waitForFunction(
    (selector) => document.querySelector(selector)?.dataset.menuOpen === "true",
    menuSelector,
  );
  const removed = await page.evaluate((selector) => {
    const menu = document.querySelector(selector);
    const favorite = [...(menu?.querySelectorAll(".tag-picker-option") || [])].find(
      (option) => /Favorite/u.test(option.textContent.trim()),
    );
    favorite?.click();
    return Boolean(favorite);
  }, menuSelector);
  assert(removed, `${mode}: verse-number picker could not remove Favorite`);
  await page.waitForFunction(
    (selector) => !document.querySelector(selector)?.querySelector(".tag-badge"),
    rowSelector,
  );
}

function assertLanguageSpecificStrong(state, expectedSection, label) {
  const unexpectedSection = expectedSection === "hebrew" ? "greek" : "hebrew";
  assert.deepEqual(
    state.strongSectionControls.map((control) => control.section),
    [expectedSection],
    `${label}: opposite-language control must be absent from the DOM`,
  );
  const control = state.strongSectionControls[0];
  assert.equal(control.disabled, false, `${label}: rendered concordance control must become enabled when its section is present`);
  assert.equal(control.ariaDisabled, "false", `${label}: rendered concordance aria-disabled state is incorrect`);
  assert.equal(control.controlState, "enabled", `${label}: rendered concordance control state is incorrect`);
  assert.equal(control.unavailable, "false", `${label}: rendered concordance availability state is incorrect`);
  assert.match(control.title, /scroll to/i, `${label}: rendered concordance title is incorrect`);
  assert.match(control.ariaLabel || "", /scroll to/i, `${label}: rendered concordance accessible name is incorrect`);
  assert(state.strongSectionAnchors.includes(expectedSection), `${label}: matching concordance anchor is missing`);
  assert(!state.strongSectionAnchors.includes(unexpectedSection), `${label}: opposite-language concordance anchor must be absent`);
}

async function exerciseGreekStrong(page, baseUrl, mode, theme) {
  await page.goto(`${baseUrl}/#/read/bsb/john/1/1`, { waitUntil: "load" });
  await waitFor(page, () =>
    document.querySelector("#chapterTitle")?.textContent.includes("John 1") &&
    !document.body.textContent.includes("Loading data"),
  );
  await openStrongFromReader(page);
  await page.waitForFunction(
    () => {
      const control = document.querySelector("#detailContext [data-strong-section-control]");
      return Boolean(control && control.dataset.controlState !== "loading");
    },
  );
  const state = await contextState(page);
  assert.match(state.summary, /G\d+.*John 1:1|John 1:1.*G\d+/, `${mode}/${theme}: Greek summary must identify the selected token`);
  assertLanguageSpecificStrong(state, "greek", `${mode}/${theme}: Greek John word`);
  return state;
}

async function runScenario(browser, baseUrl, mode, theme) {
  const mobile = mode === "mobile";
  const context = await browser.newContext({
    viewport: VIEWPORTS[mode],
    deviceScaleFactor: mobile ? 3 : 1,
    isMobile: mobile,
    hasTouch: mobile,
  });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  let temporaryTagLabels = [];
  let temporaryTagsCleaned = false;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  try {
    await page.goto(`${baseUrl}/#/read/bsb/proverbs/1/1`, { waitUntil: "load" });
    await waitFor(page, () =>
      document.querySelector("#chapterTitle")?.textContent.includes("Proverbs 1") &&
      !document.body.textContent.includes("Loading data"),
    );
    await setTheme(page, theme);
    await exerciseReaderVerseMarks(page, mode);

    await click(page, ".verse-study-button");
    await waitFor(page, () => Boolean(document.querySelector("#detailContext .panel-context-navigation")));
    await click(
      page,
      "#detailContext [data-panel-scope='verse'] .verse-context-tab[data-visible-label='Language']",
    );
    await waitFor(page, () =>
      document.querySelector("#detailTitle")?.textContent === "Language Study" &&
      document.querySelectorAll("#detailContent .interlinear-token").length > 0,
    );
    const languageStudyState = await contextState(page);
    assert(
      languageStudyState.transliteration?.text &&
        languageStudyState.transliteration.contrast >= 4.5,
      `${mode}/${theme}: Language Study transliteration has insufficient rendered contrast: ${JSON.stringify(languageStudyState.transliteration)}`,
    );
    assert(
      !languageStudyState.transliteration.usesMuted,
      `${mode}/${theme}: Language Study transliteration must not use the muted foreground treatment`,
    );
    await click(page, ".strong-token[data-strong-code]");
    await waitFor(page, () =>
      document.querySelector("#detailTitle")?.textContent === "Strong's" &&
      document.querySelector("#detailContext [data-panel-scope='word']"),
    );
    await page.waitForFunction(
      () => {
        const control = document.querySelector("#detailContext [data-strong-section-control]");
        return Boolean(control && control.dataset.controlState !== "loading");
      },
    );

    const wordState = await contextState(page);
    assert.equal(wordState.scopeOrder, "word verse", `${mode}: Word must lead the compact scope order`);
    assert.deepEqual(wordState.groupScopes, ["word", "verse"], `${mode}: contextual groups must be Word then Verse`);
    assert.deepEqual(wordState.staticScopes, [], `${mode}: Chapter and Book groups must be absent from the side panel`);
    assert.deepEqual(wordState.active, ["word:Word"], `${mode}: Strong's must mark Word as current`);
    assert.match(wordState.summary, /H\d+.*Proverbs 1:1|Proverbs 1:1.*H\d+/, `${mode}: summary must identify word and verse`);
    assert.equal(wordState.theme, theme, `${mode}: requested ${theme} theme was not applied`);
    assert(wordState.summaryOverflow <= 1, `${mode}/${theme}: selected-word summary is clipped`);
    assert(wordState.summaryUsesPrimary, `${mode}/${theme}: selected-word summary must use the rendered primary foreground`);
    assert(!wordState.summaryUsesMuted, `${mode}/${theme}: selected-word summary must not use the muted foreground`);
    assert(
      wordState.summaryColor?.contrast >= 4.5,
      `${mode}/${theme}: selected-word summary contrast is too low: ${JSON.stringify(wordState.summaryColor)}`,
    );
    assert(
      !["transparent", "rgba(0, 0, 0, 0)"].includes(wordState.wordActiveBackground),
      `${mode}/${theme}: active Word state is not visually distinct`,
    );
    assert(wordState.navOverflow <= 1, `${mode}: Word-first navigation has horizontal overflow`);
    assert(wordState.hasSummaryBoundary, `${mode}: selected-word summary boundary is missing`);
    assert(wordState.navHeight < 180, `${mode}: compact navigation is unexpectedly tall`);
    assert(wordState.documentOverflow <= 1, `${mode}: document has horizontal overflow`);
    assertPanelPlacement(wordState, mode);
    assertLanguageSpecificStrong(wordState, "hebrew", `${mode}/${theme}: Hebrew Proverbs word`);
    await capturePanel(page, mode, theme, "word");

    const wordReactivation = await page.evaluate(() => {
      const button = document.querySelector("#detailContext [data-panel-scope='word'] .verse-context-tab[data-visible-label='Word']");
      const detail = document.querySelector("#detailContent .strong-detail");
      const overview = detail?.querySelector("[data-strong-section='word']");
      const before = {
        disabled: button?.disabled,
        lock: document.querySelector(".detail-pane")?.dataset.panelMode,
        token: document.querySelector("#detailContent .strong-code")?.textContent,
        detail,
        backDisabled: document.querySelector("#detailBack")?.disabled,
        readerToken: document.querySelector(".reader-context-word")?.dataset.strongCode,
      };
      button?.click();
      return {
        ...before,
        sameDetail: detail === document.querySelector("#detailContent .strong-detail"),
        sameToken: before.token === document.querySelector("#detailContent .strong-code")?.textContent,
        sameLock: before.lock === document.querySelector(".detail-pane")?.dataset.panelMode,
        sameHistoryState: before.backDisabled === document.querySelector("#detailBack")?.disabled,
        scrolled: overview?.dataset.strongSectionActive === "true",
      };
    });
    assert(!wordReactivation.disabled && wordReactivation.sameDetail && wordReactivation.sameToken && wordReactivation.sameLock && wordReactivation.sameHistoryState && wordReactivation.scrolled, `${mode}: active Word must scroll without replacing detail, changing context, lock, or history`);

    await click(page, "#detailBack");
    await waitFor(page, () => document.querySelector("#detailTitle")?.textContent === "Language Study");
    const backState = await page.evaluate(() => ({
      title: document.querySelector("#detailTitle")?.textContent,
      hasStrong: Boolean(document.querySelector("#detailContent .strong-detail")),
    }));
    assert.equal(backState.title, "Language Study", `${mode}: Back after current Word must return directly to the preceding view`);
    assert.equal(backState.hasStrong, false, `${mode}: current Word must not add a duplicate Strong's history entry`);
    await click(page, "#detailForward");
    await waitFor(page, () => document.querySelector("#detailTitle")?.textContent === "Strong's");
    const forwardState = await page.evaluate(() => ({
      token: document.querySelector("#detailContent .strong-code")?.textContent,
      lock: document.querySelector(".detail-pane")?.dataset.panelMode,
      wordControl: document.querySelector("#detailContext [data-panel-scope='word'] .verse-context-tab[data-visible-label='Word']")?.getAttribute("aria-current"),
      readerToken: document.querySelector(".reader-context-word")?.dataset.strongCode,
    }));
    assert.equal(forwardState.token, wordReactivation.token, `${mode}: Forward must restore the selected Strong's word`);
    assert.equal(forwardState.lock, wordReactivation.lock, `${mode}: Forward must restore the locked panel state`);
    assert.equal(forwardState.wordControl, "page", `${mode}: Forward must restore the active Word control`);
    assert.equal(forwardState.readerToken, wordReactivation.readerToken, `${mode}: Forward must restore the selected reader highlight`);

    await click(
      page,
      "#detailContext [data-panel-scope='verse'] .verse-context-tab[data-visible-label='Parallel']",
    );
    await waitFor(page, () => document.querySelector("#detailTitle")?.textContent === "Parallel");
    const inheritedState = await contextState(page);
    assert.equal(inheritedState.scopeOrder, "word verse", `${mode}: Verse view must retain containing Word context`);
    assert.deepEqual(inheritedState.groupScopes, ["word", "verse"], `${mode}: inherited Word and Verse groups are out of order`);
    assert.deepEqual(inheritedState.active, ["word:Word"], `${mode}: exact selected word must remain the current canonical context`);
    assert.equal(inheritedState.panelOccupant, "par", `${mode}: visible Parallel panel occupant must remain identifiable`);
    assert.equal(inheritedState.wordDisabled, true, `${mode}: Word must not claim it can scroll a detached Strong's panel`);
    assert.equal(inheritedState.verseCurrent, "", `${mode}: Verse must not claim a whole-verse selection while an exact word is selected`);
    assertPanelPlacement(inheritedState, mode);
    await capturePanel(page, mode, theme, "inherited-verse");

    await click(page, "#showOutline");
    await waitFor(page, () => document.querySelector("#detailTitle")?.textContent === "Outline");
    await click(page, ".verse-study-button");
    await waitFor(page, () => document.querySelector("#detailTitle")?.textContent === "Cross References");
    const verseOnlyState = await contextState(page);
    assert.equal(verseOnlyState.scopeOrder, "verse", `${mode}: cleared context must return to Verse-only order`);
    assert.deepEqual(verseOnlyState.groupScopes, ["verse"], `${mode}: cleared context must not render a Word group`);
    assert.deepEqual(verseOnlyState.active, ["verse:Verse"], `${mode}: Verse self-control must identify the whole-verse context`);
    assert.equal(verseOnlyState.verseCurrent, "page", `${mode}: Verse self-control must expose current state accessibly`);
    assert.equal(verseOnlyState.verseDisabled, false, `${mode}: current Verse must permit a no-op activation`);
    assert(verseOnlyState.navOverflow <= 1, `${mode}: Verse-only navigation has horizontal overflow`);
    assert(verseOnlyState.documentOverflow <= 1, `${mode}: cleared layout has horizontal overflow`);
    assertPanelPlacement(verseOnlyState, mode);
    await capturePanel(page, mode, theme, "verse-only");

    const verseReactivation = await page.evaluate(() => {
      const button = document.querySelector("#detailContext [data-panel-scope='verse'] .verse-context-tab[data-visible-label='Verse']");
      const detail = document.querySelector("#detailContent");
      const before = {
        title: document.querySelector("#detailTitle")?.textContent,
        firstChild: detail?.firstElementChild,
        lock: document.querySelector(".detail-pane")?.dataset.panelMode,
        readerVerse: document.querySelector(".reader-context-verse")?.dataset.verse,
        backDisabled: document.querySelector("#detailBack")?.disabled,
        forwardDisabled: document.querySelector("#detailForward")?.disabled,
      };
      button?.click();
      return {
        ...before,
        sameTitle: before.title === document.querySelector("#detailTitle")?.textContent,
        sameDetail: before.firstChild === detail?.firstElementChild,
        sameLock: before.lock === document.querySelector(".detail-pane")?.dataset.panelMode,
        sameVerse: before.readerVerse === document.querySelector(".reader-context-verse")?.dataset.verse,
        sameBack: before.backDisabled === document.querySelector("#detailBack")?.disabled,
        sameForward: before.forwardDisabled === document.querySelector("#detailForward")?.disabled,
      };
    });
    assert(
      verseReactivation.sameTitle &&
        verseReactivation.sameDetail &&
        verseReactivation.sameLock &&
        verseReactivation.sameVerse &&
        verseReactivation.sameBack &&
        verseReactivation.sameForward,
      `${mode}: current Verse activation must not rebuild detail, alter lock/selection, or add history: ${JSON.stringify(verseReactivation)}`,
    );
    await click(page, "#detailBack");
    await waitFor(page, () => document.querySelector("#detailTitle")?.textContent === "Outline");
    await click(page, "#detailForward");
    await waitFor(page, () => document.querySelector("#detailTitle")?.textContent === "Cross References");
    const verseForwardState = await contextState(page);
    assert.deepEqual(verseForwardState.active, ["verse:Verse"], `${mode}: Forward must restore the Verse current state`);
    assert.equal(verseForwardState.readerVerse, verseReactivation.readerVerse, `${mode}: Forward must restore the selected verse`);
    assert.equal(verseForwardState.title, verseReactivation.title, `${mode}: Forward must restore the same Verse detail panel`);
    assert.equal(verseForwardState.lock, verseReactivation.lock, `${mode}: Forward must restore the locked panel state`);
    assert.equal(verseForwardState.panelOccupant, "refs", `${mode}: Forward must restore the visible Verse panel occupant`);

    temporaryTagLabels = Array.from(
      { length: TEMPORARY_TAG_COUNT },
      (_, index) => `Panel QA ${mode} ${theme} ${Date.now()} ${index + 1}`,
    );
    await createTemporaryTags(page, temporaryTagLabels);
    await openStrongFromReader(page);
    const sourcePopover = await exercisePanelStudyMarksPopover(
      page,
      "#detailContext [data-panel-scope='word'] .study-marks-trigger",
      `${mode}/${theme}: source-word Study Marks`,
    );
    const versePopover = await exercisePanelStudyMarksPopover(
      page,
      "#detailContext [data-panel-scope='verse'] .study-marks-trigger",
      `${mode}/${theme}: verse Study Marks`,
    );
    await removeTemporaryTags(page, temporaryTagLabels);
    temporaryTagsCleaned = true;
    const greekState = await exerciseGreekStrong(page, baseUrl, mode, theme);

    assert.deepEqual(pageErrors, [], `${mode}/${theme}: browser page errors were reported`);
    assert.deepEqual(consoleErrors, [], `${mode}/${theme}: browser console errors were reported`);

    return {
      mode,
      theme,
      viewport: VIEWPORTS[mode],
      panelHeaderGap: wordState.panelHeaderGap,
      detailHeaderTop: wordState.detailHeaderTop,
      wordOrder: wordState.scopeOrder,
      inheritedOrder: inheritedState.scopeOrder,
      sourcePopover,
      versePopover,
      verseOnlyOrder: verseOnlyState.scopeOrder,
      greekOrder: greekState.scopeOrder,
    };
  } finally {
    if (temporaryTagLabels.length && !temporaryTagsCleaned) {
      try {
        await removeTemporaryTags(page, temporaryTagLabels);
      } catch {
        // The isolated browser context is discarded below; cleanup is best-effort after a failed assertion.
      }
    }
    await context.close();
  }
}

const { server, url } = await startAppServer();
const browser = await chromium.launch({
  executablePath: findEdgePath(),
  headless: true,
  args: ["--disable-gpu", "--disable-dev-shm-usage", "--disable-background-networking", "--no-first-run"],
});

try {
  const results = [];
  for (const mode of Object.keys(VIEWPORTS)) {
    for (const theme of THEMES) {
      results.push(await runScenario(browser, url, mode, theme));
    }
  }
  const report = { status: "ok", screenshots: Boolean(screenshotRoot), captureOnly, results };
  if (screenshotRoot) {
    await mkdir(screenshotRoot, { recursive: true });
    await writeFile(join(screenshotRoot, "panel-context-metrics.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
