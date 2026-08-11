#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { startStaticAppServer } from "../tools/serve-app.mjs";

const BROWSERS = Object.freeze({
  chrome: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  edge: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
});
const VIEWPORTS = Object.freeze({
  desktop: Object.freeze({ width: 1280, height: 720 }),
  narrow: Object.freeze({ width: 820, height: 900 }),
  mobile: Object.freeze({ width: 390, height: 844 }),
});
const START_ROUTE = "#/read/bsb/psalms/23";
const SECTION_SELECTOR =
  '#detailContent .interlinear-verse-section[data-verse="1"][data-original-language-study="true"]';
const TOKEN_SELECTOR =
  `${SECTION_SELECTOR} .interlinear-token[data-token-index="3"]` +
  '[data-strong-code="H3068"][data-interlinear-key="verse:1:token:3"]' +
  '[data-original-language-study="true"]';
const MORPHOLOGY_SELECTOR = `${TOKEN_SELECTOR} .morphology-help[data-morphology="N-proper-ms"]`;
const TRANSLITERATION_SELECTOR = `${TOKEN_SELECTOR} .transliteration-symbol[data-tooltip]`;
const LANGUAGE_MARK_SELECTOR =
  `${SECTION_SELECTOR} .source-text-row[data-source-id="wlc"] .language-letter-hover[data-tooltip]`;
const MORPHOLOGY_TOOLTIP_SELECTOR = ".morphology-tooltip-layer";
const LANGUAGE_TOOLTIP_SELECTOR = ".language-tooltip-layer";
const cliArgs = process.argv.slice(2);
const browserName = optionValue("--browser") || "edge";
const touchMode = cliArgs.includes("--touch");
const repeatCount = Number(optionValue("--repeat") || 1);

function optionValue(name) {
  const argument = cliArgs.find((value) => value.startsWith(`${name}=`));
  if (argument) return argument.slice(name.length + 1);
  const index = cliArgs.indexOf(name);
  return index >= 0 ? cliArgs[index + 1] : "";
}

function watchPageDiagnostics(page) {
  const consoleErrors = [];
  const pageErrors = [];
  const requestFailures = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push({ location: message.location(), text: message.text() });
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push({ message: error.message, name: error.name, stack: error.stack || "" });
  });
  page.on("requestfailed", (request) => {
    requestFailures.push({
      errorText: request.failure()?.errorText || "Unknown request failure",
      method: request.method(),
      resourceType: request.resourceType(),
      url: request.url(),
    });
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    requestFailures.push({
      errorText: `HTTP ${response.status()} ${response.statusText()}`.trim(),
      method: response.request().method(),
      resourceType: response.request().resourceType(),
      url: response.url(),
    });
  });
  return { consoleErrors, pageErrors, requestFailures };
}

async function captureReadinessDiagnostics(page, diagnostics, phase) {
  let pageState;
  try {
    pageState = await page.evaluate(
      ({ languageMarkSelector, morphologySelector, sectionSelector, tokenSelector, transliterationSelector }) => {
        const snapshotControl = (element) =>
          element
            ? {
                ariaBusy: element.getAttribute("aria-busy"),
                ariaLabel: element.getAttribute("aria-label"),
                connected: element.isConnected,
                controlState: element.dataset.controlState || "",
                disabled: Boolean(element.disabled),
                title: element.getAttribute("title") || "",
                unavailable: element.dataset.unavailable || "",
              }
            : null;
        const verseStudy = document.querySelector(
          '.verse-row[data-verse="1"] .verse-study-button[aria-label="Open study tools for Psalms 23:1"]',
        );
        return {
          chapterTitle: document.querySelector("#chapterTitle")?.textContent.trim() || "",
          detailTitle: document.querySelector("#detailTitle")?.textContent.trim() || "",
          documentReadyState: document.readyState,
          languageStudyControl: snapshotControl(document.querySelector("#showInterlinear")),
          languageTab: snapshotControl(
            document.querySelector(
              "#detailContext [data-panel-scope='verse'] .verse-context-tab[data-visible-label='Language']",
            ),
          ),
          locators: {
            hydratedLexicalContent: document.querySelectorAll(
              `${tokenSelector} .original-language-word-origin, ${tokenSelector} .original-language-dictionary-word`,
            ).length,
            languageMark: document.querySelectorAll(languageMarkSelector).length,
            morphology: document.querySelectorAll(morphologySelector).length,
            section: document.querySelectorAll(sectionSelector).length,
            token: document.querySelectorAll(tokenSelector).length,
            transliteration: document.querySelectorAll(transliterationSelector).length,
            verseStudy: document.querySelectorAll(
              '.verse-row[data-verse="1"] .verse-study-button[aria-label="Open study tools for Psalms 23:1"]',
            ).length,
          },
          route: window.location.hash,
          statusText: document.querySelector("#statusText")?.textContent.trim() || "",
          url: window.location.href,
          verseStudyControl: snapshotControl(verseStudy),
        };
      },
      {
        languageMarkSelector: LANGUAGE_MARK_SELECTOR,
        morphologySelector: MORPHOLOGY_SELECTOR,
        sectionSelector: SECTION_SELECTOR,
        tokenSelector: TOKEN_SELECTOR,
        transliterationSelector: TRANSLITERATION_SELECTOR,
      },
    );
  } catch (error) {
    pageState = {
      evaluationError: error instanceof Error ? error.message : String(error),
      url: page.url(),
    };
  }
  return {
    consoleErrors: [...diagnostics.consoleErrors],
    pageErrors: [...diagnostics.pageErrors],
    pageState,
    phase,
    requestFailures: [...diagnostics.requestFailures],
  };
}

async function readinessFailure(page, diagnostics, phase, error) {
  const evidence = await captureReadinessDiagnostics(page, diagnostics, phase);
  const causeMessage = error instanceof Error ? error.message : String(error);
  const causeStack = error instanceof Error ? error.stack || "" : "";
  return new Error(
    `Language Study readiness failed during ${phase}: ${causeMessage}\n` +
      `Readiness diagnostics: ${JSON.stringify({ ...evidence, causeStack }, null, 2)}`,
    { cause: error },
  );
}

function themeForIteration(iteration) {
  return iteration % 2 === 0 ? "dark" : "light";
}

async function setTheme(page, theme) {
  await page.waitForFunction(() => ["light", "dark"].includes(document.documentElement.dataset.theme));
  if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) {
    await page.locator("#themeToggle").click();
  }
  await page.waitForFunction((expected) => document.documentElement.dataset.theme === expected, theme);
}

async function waitForLanguageStudyReady(page, baseUrl, theme, diagnostics) {
  let phase = "navigation";
  try {
    await page.goto(`${baseUrl}/${START_ROUTE}`, { waitUntil: "load" });
    phase = "initial reader readiness";
    await page.waitForFunction(
      ({ expectedRoute, expectedStatus, expectedTitle }) => {
        const languageStudy = document.querySelector("#showInterlinear");
        const verseStudy = document.querySelector(
          '.verse-row[data-verse="1"] .verse-study-button[aria-label="Open study tools for Psalms 23:1"]',
        );
        return (
          document.readyState === "complete" &&
          window.location.hash === expectedRoute &&
          document.querySelector("#chapterTitle")?.textContent.trim() === expectedTitle &&
          document.querySelector("#statusText")?.textContent.trim() === expectedStatus &&
          verseStudy?.isConnected === true &&
          verseStudy.disabled === false &&
          verseStudy.dataset.unavailable !== "true" &&
          languageStudy?.isConnected === true &&
          languageStudy.disabled === false &&
          languageStudy.getAttribute("aria-busy") === "false" &&
          languageStudy.dataset.controlState === "enabled" &&
          languageStudy.dataset.unavailable === "false"
        );
      },
      { expectedRoute: START_ROUTE, expectedStatus: "BSB data loaded", expectedTitle: "Psalms 23" },
      { timeout: 30_000 },
    );
    phase = "theme readiness";
    await setTheme(page, theme);
    phase = "verse study activation";
    const verseStudy = page.locator(
      '.verse-row[data-verse="1"] .verse-study-button[aria-label="Open study tools for Psalms 23:1"]',
    );
    await verseStudy.evaluate((button) => button.click());
    const languageTab = page.locator(
      "#detailContext [data-panel-scope='verse'] .verse-context-tab[data-visible-label='Language']",
    );
    await languageTab.waitFor({ state: "visible", timeout: 30_000 });
    phase = "Language Study activation";
    await languageTab.click();

    phase = "exact H3068 and morphology readiness";
    await page.waitForFunction(
      ({ languageMarkSelector, morphologySelector, sectionSelector, tokenSelector, transliterationSelector }) => {
        if (document.querySelector("#detailTitle")?.textContent.trim() !== "Language Study") return false;
        const section = document.querySelector(sectionSelector);
        const token = document.querySelector(tokenSelector);
        const languageMark = document.querySelector(languageMarkSelector);
        const transliteration = document.querySelector(transliterationSelector);
        const morphology = document.querySelector(morphologySelector);
        const hydratedLexicalContent = token?.querySelector(
          ".original-language-word-origin, .original-language-dictionary-word",
        );
        return Boolean(
          section?.isConnected &&
            token?.isConnected &&
            token.dataset.interlinearKey === "verse:1:token:3" &&
            token.dataset.strongCode === "H3068" &&
            languageMark?.isConnected &&
            transliteration?.isConnected &&
            morphology?.isConnected &&
            hydratedLexicalContent?.isConnected,
        );
      },
      {
        languageMarkSelector: LANGUAGE_MARK_SELECTOR,
        morphologySelector: MORPHOLOGY_SELECTOR,
        sectionSelector: SECTION_SELECTOR,
        tokenSelector: TOKEN_SELECTOR,
        transliterationSelector: TRANSLITERATION_SELECTOR,
      },
      { timeout: 30_000 },
    );
  } catch (error) {
    throw await readinessFailure(page, diagnostics, phase, error);
  }
}

async function panelState(page) {
  return page.evaluate(({ tokenSelector }) => {
    const pane = document.querySelector(".detail-pane");
    const readerWord = document.querySelector(".reader-context-word");
    const token = document.querySelector(tokenSelector);
    return {
      activeReaderToken: readerWord
        ? {
            strongCode: readerWord.dataset.strongCode || "",
            tokenIndex: readerWord.dataset.tokenIndex || "",
            verse: readerWord.dataset.verse || "",
          }
        : null,
      backDisabled: document.querySelector("#detailBack")?.disabled ?? null,
      forwardDisabled: document.querySelector("#detailForward")?.disabled ?? null,
      historyLength: window.history.length,
      hoverLocked: pane?.dataset.hoverLocked || "",
      panelMode: pane?.dataset.panelMode || "",
      route: window.location.hash,
      targetIdentity: token?.dataset.interlinearKey || "",
      targetMorphology: token?.querySelector(".morphology-help")?.dataset.morphology || "",
      targetStrongCode: token?.dataset.strongCode || "",
      theme: document.documentElement.dataset.theme || "",
      title: document.querySelector("#detailTitle")?.textContent.trim() || "",
    };
  }, { tokenSelector: TOKEN_SELECTOR });
}

async function tooltipState(page, tooltipSelector, targetSelector) {
  return page.evaluate(
    ({ targetSelector: selector, tooltipSelector: layerSelector }) => {
      const rect = (value) =>
        value
          ? {
              bottom: value.bottom,
              height: value.height,
              left: value.left,
              right: value.right,
              top: value.top,
              width: value.width,
            }
          : null;
      const pane = document.querySelector(".detail-pane");
      const target = document.querySelector(selector);
      const tooltip = document.querySelector(layerSelector);
      const token = target?.closest(".interlinear-token");
      return {
        activeElementMatches: document.activeElement === target,
        documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
        expectedText: target?.dataset.tooltip || target?.dataset.morphology || "",
        hidden: tooltip?.hidden ?? true,
        inline: tooltip
          ? {
              left: tooltip.style.left,
              maxWidth: tooltip.style.maxWidth,
              top: tooltip.style.top,
            }
          : null,
        panel: rect(pane?.getBoundingClientRect()),
        panelOverflow: pane ? pane.scrollWidth - pane.clientWidth : 0,
        target: rect(target?.getBoundingClientRect()),
        targetIdentity: token?.dataset.interlinearKey || "",
        targetStrongCode: token?.dataset.strongCode || "",
        text: tooltip?.textContent.trim() || "",
        tooltip: rect(tooltip?.getBoundingClientRect()),
        viewport: { height: window.innerHeight, width: window.innerWidth },
      };
    },
    { targetSelector, tooltipSelector },
  );
}

function assertContained(state, label) {
  const epsilon = 1;
  assert(state.tooltip, `${label}: tooltip rectangle is unavailable`);
  assert(state.panel, `${label}: detail panel rectangle is unavailable`);
  assert(!state.hidden, `${label}: tooltip is hidden: ${JSON.stringify(state)}`);
  assert(
    state.tooltip.left >= state.panel.left - epsilon &&
      state.tooltip.right <= state.panel.right + epsilon &&
      state.tooltip.top >= state.panel.top - epsilon &&
      state.tooltip.bottom <= state.panel.bottom + epsilon,
    `${label}: tooltip escaped the detail panel: ${JSON.stringify(state)}`,
  );
  assert(
    state.tooltip.left >= -epsilon &&
      state.tooltip.right <= state.viewport.width + epsilon &&
      state.tooltip.top >= -epsilon &&
      state.tooltip.bottom <= state.viewport.height + epsilon,
    `${label}: tooltip escaped the viewport: ${JSON.stringify(state)}`,
  );
  assert(state.documentOverflow <= 1, `${label}: document has horizontal overflow`);
  assert(state.panelOverflow <= 1, `${label}: detail panel has horizontal overflow`);
}

function assertMorphology(state, label) {
  assertContained(state, label);
  assert.equal(state.targetIdentity, "verse:1:token:3", `${label}: exact token identity changed`);
  assert.equal(state.targetStrongCode, "H3068", `${label}: exact Strong's identity changed`);
  assert.match(state.text, /noun/i, `${label}: noun explanation is missing`);
  assert.match(state.text, /proper name/i, `${label}: proper-name explanation is missing`);
  assert.match(state.text, /masculine singular/i, `${label}: masculine-singular explanation is missing`);
  assert.match(state.inline?.maxWidth || "", /^\d+(?:\.\d+)?px$/u, `${label}: bounded max-width was not applied`);
}

function assertLanguageMark(state, label) {
  assertContained(state, label);
  assert(state.expectedText, `${label}: language mark has no expected explanation`);
  assert.equal(state.text, state.expectedText, `${label}: language mark explanation changed`);
}

function assertLockedLanguageStudy(state, label) {
  assert.equal(state.panelMode, "locked", `${label}: panel mode is not locked`);
  assert.equal(state.hoverLocked, "true", `${label}: hover lock is not true`);
  assert.equal(state.route, START_ROUTE, `${label}: route changed`);
  assert.equal(state.title, "Language Study", `${label}: detail title changed`);
  assert.equal(state.targetIdentity, "verse:1:token:3", `${label}: exact token identity changed`);
  assert.equal(state.targetStrongCode, "H3068", `${label}: exact Strong's identity changed`);
  assert.equal(state.targetMorphology, "N-proper-ms", `${label}: exact morphology identity changed`);
}

async function waitForTooltip(page, selector, visible) {
  await page.waitForFunction(
    ({ selector: layerSelector, visible: expectedVisible }) => {
      const tooltip = document.querySelector(layerSelector);
      return expectedVisible ? Boolean(tooltip && !tooltip.hidden) : Boolean(!tooltip || tooltip.hidden);
    },
    { selector, visible },
    { timeout: 10_000 },
  );
}

async function assertHiddenAndCleared(page, selector, label) {
  await waitForTooltip(page, selector, false);
  if (selector !== MORPHOLOGY_TOOLTIP_SELECTOR) return;
  const inline = await page.evaluate((layerSelector) => {
    const tooltip = document.querySelector(layerSelector);
    return tooltip
      ? {
          left: tooltip.style.left,
          maxWidth: tooltip.style.maxWidth,
          top: tooltip.style.top,
        }
      : null;
  }, selector);
  assert.deepEqual(inline, { left: "", maxWidth: "", top: "" }, `${label}: stale inline geometry remains`);
}

async function hoverTarget(page, targetSelector, tooltipSelector, assertion, label) {
  const target = page.locator(targetSelector).first();
  await target.scrollIntoViewIfNeeded();
  await target.hover();
  await waitForTooltip(page, tooltipSelector, true);
  const state = await tooltipState(page, tooltipSelector, targetSelector);
  assertion(state, label);
  await page.mouse.move(5, 5);
  await assertHiddenAndCleared(page, tooltipSelector, `${label} pointer exit`);
  return state;
}

async function focusTarget(page, targetSelector, tooltipSelector, assertion, label) {
  const target = page.locator(targetSelector).first();
  await target.scrollIntoViewIfNeeded();
  await target.focus();
  await waitForTooltip(page, tooltipSelector, true);
  const state = await tooltipState(page, tooltipSelector, targetSelector);
  assert(state.activeElementMatches, `${label}: target did not receive keyboard focus`);
  assertion(state, label);
  await page.locator("#clearDetail").focus();
  await assertHiddenAndCleared(page, tooltipSelector, `${label} focus loss`);
  return state;
}

async function assertReplacement(page, label) {
  await page.locator(MORPHOLOGY_SELECTOR).first().focus();
  await waitForTooltip(page, MORPHOLOGY_TOOLTIP_SELECTOR, true);
  await page.locator(LANGUAGE_MARK_SELECTOR).first().focus();
  await waitForTooltip(page, LANGUAGE_TOOLTIP_SELECTOR, true);
  await waitForTooltip(page, MORPHOLOGY_TOOLTIP_SELECTOR, false);
  assertLanguageMark(
    await tooltipState(page, LANGUAGE_TOOLTIP_SELECTOR, LANGUAGE_MARK_SELECTOR),
    `${label} morphology-to-mark replacement`,
  );

  await page.locator(MORPHOLOGY_SELECTOR).first().focus();
  await waitForTooltip(page, MORPHOLOGY_TOOLTIP_SELECTOR, true);
  await waitForTooltip(page, LANGUAGE_TOOLTIP_SELECTOR, false);
  assertMorphology(
    await tooltipState(page, MORPHOLOGY_TOOLTIP_SELECTOR, MORPHOLOGY_SELECTOR),
    `${label} mark-to-morphology replacement`,
  );
  await page.locator("#clearDetail").focus();
  await assertHiddenAndCleared(page, MORPHOLOGY_TOOLTIP_SELECTOR, `${label} replacement focus loss`);
}

async function assertScrollAndResize(page, viewport, label) {
  const target = page.locator(MORPHOLOGY_SELECTOR).first();
  await target.scrollIntoViewIfNeeded();
  await target.focus();
  await waitForTooltip(page, MORPHOLOGY_TOOLTIP_SELECTOR, true);
  const before = await tooltipState(page, MORPHOLOGY_TOOLTIP_SELECTOR, MORPHOLOGY_SELECTOR);
  assertMorphology(before, `${label} before scroll`);
  const scroll = await page.evaluate(() => {
    const scroller = document.querySelector("#detailContent");
    const beforeScrollTop = scroller?.scrollTop || 0;
    if (scroller) scroller.scrollTop = Math.min(beforeScrollTop + 32, scroller.scrollHeight - scroller.clientHeight);
    return { after: scroller?.scrollTop || 0, before: beforeScrollTop };
  });
  await page.waitForFunction(
    ({ previousTop, selector }) => {
      const tooltip = document.querySelector(selector);
      return Boolean(tooltip && !tooltip.hidden && tooltip.getBoundingClientRect().top !== previousTop);
    },
    { previousTop: before.tooltip.top, selector: MORPHOLOGY_TOOLTIP_SELECTOR },
    { timeout: 5_000 },
  ).catch(() => {});
  const scrolled = await tooltipState(page, MORPHOLOGY_TOOLTIP_SELECTOR, MORPHOLOGY_SELECTOR);
  assertMorphology(scrolled, `${label} after scroll`);
  if (scroll.after !== scroll.before) {
    assert.notEqual(scrolled.target.top, before.target.top, `${label}: target did not move after panel scroll`);
    assert.notEqual(scrolled.tooltip.top, before.tooltip.top, `${label}: tooltip did not reposition after panel scroll`);
  }

  const resizedViewport = {
    width: Math.max(360, viewport.width - 40),
    height: Math.max(640, viewport.height - 40),
  };
  await page.setViewportSize(resizedViewport);
  await target.scrollIntoViewIfNeeded();
  const resized = await tooltipState(page, MORPHOLOGY_TOOLTIP_SELECTOR, MORPHOLOGY_SELECTOR);
  assertMorphology(resized, `${label} after resize`);
  await page.setViewportSize(viewport);
  await target.scrollIntoViewIfNeeded();
  const restored = await tooltipState(page, MORPHOLOGY_TOOLTIP_SELECTOR, MORPHOLOGY_SELECTOR);
  assertMorphology(restored, `${label} after resize restore`);
  await page.locator("#clearDetail").focus();
  await assertHiddenAndCleared(page, MORPHOLOGY_TOOLTIP_SELECTOR, `${label} resize focus loss`);
  return { before, resized, restored, scroll, scrolled };
}

async function runDesktopViewport(browser, baseUrl, iteration, mode) {
  const viewport = VIEWPORTS[mode];
  const theme = themeForIteration(iteration);
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = watchPageDiagnostics(page);
  try {
    await waitForLanguageStudyReady(page, baseUrl, theme, errors);
    const before = await panelState(page);
    assertLockedLanguageStudy(before, `${mode} iteration ${iteration} initial state`);

    const morphologyHover = await hoverTarget(
      page,
      MORPHOLOGY_SELECTOR,
      MORPHOLOGY_TOOLTIP_SELECTOR,
      assertMorphology,
      `${mode} iteration ${iteration} morphology pointer hover`,
    );
    const morphologyFocus = await focusTarget(
      page,
      MORPHOLOGY_SELECTOR,
      MORPHOLOGY_TOOLTIP_SELECTOR,
      assertMorphology,
      `${mode} iteration ${iteration} morphology keyboard focus`,
    );
    const languageHover = await hoverTarget(
      page,
      LANGUAGE_MARK_SELECTOR,
      LANGUAGE_TOOLTIP_SELECTOR,
      assertLanguageMark,
      `${mode} iteration ${iteration} language mark pointer hover`,
    );
    const languageFocus = await focusTarget(
      page,
      LANGUAGE_MARK_SELECTOR,
      LANGUAGE_TOOLTIP_SELECTOR,
      assertLanguageMark,
      `${mode} iteration ${iteration} language mark keyboard focus`,
    );
    await assertReplacement(page, `${mode} iteration ${iteration}`);
    const reposition = await assertScrollAndResize(page, viewport, `${mode} iteration ${iteration}`);

    assert.deepEqual(
      await panelState(page),
      before,
      `${mode} iteration ${iteration}: tooltip interactions changed route, history, lock, or active token`,
    );
    assert.deepEqual(errors.consoleErrors, [], `${mode} iteration ${iteration}: browser console errors`);
    assert.deepEqual(errors.pageErrors, [], `${mode} iteration ${iteration}: uncaught page errors`);
    const backgroundDisengage = await assertBackgroundDisengage(
      page,
      `${mode} iteration ${iteration} background`,
      false,
    );
    return {
      backgroundDisengage,
      consoleErrors: errors.consoleErrors,
      iteration,
      languageFocus,
      languageHover,
      mode,
      morphologyFocus,
      morphologyHover,
      pageErrors: errors.pageErrors,
      requestFailures: errors.requestFailures,
      reposition,
      theme,
      viewport,
    };
  } finally {
    await context.close();
  }
}

async function tapTarget(page, targetSelector, tooltipSelector, assertion, label) {
  const target = page.locator(targetSelector).first();
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  assert(box, `${label}: touch target has no rendered rectangle`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await waitForTooltip(page, tooltipSelector, true);
  const state = await tooltipState(page, tooltipSelector, targetSelector);
  assert(state.activeElementMatches, `${label}: native touch did not focus the target`);
  assertion(state, label);
  return state;
}

async function installTouchEventTrace(page, targetSelector, tooltipSelector, traceName) {
  await page.evaluate(
    ({ targetSelector: selector, tooltipSelector: layerSelector, traceName: name }) => {
      window[name] = [];
      for (const type of ["pointerdown", "focusin", "pointerup", "click"]) {
        document.addEventListener(
          type,
          (event) => {
            const target = event.target?.closest?.(selector);
            if (!target) return;
            queueMicrotask(() => {
              const pane = document.querySelector(".detail-pane");
              const tooltip = document.querySelector(layerSelector);
              window[name].push({
                activeElementMatches: document.activeElement === target,
                hoverLocked: pane?.dataset.hoverLocked || "",
                panelMode: pane?.dataset.panelMode || "",
                route: window.location.hash,
                targetIdentity: target.closest(".interlinear-token")?.dataset.interlinearKey || "",
                tooltipVisible: Boolean(tooltip && !tooltip.hidden),
                type,
              });
            });
          },
          true,
        );
      }
    },
    { targetSelector, tooltipSelector, traceName },
  );
}

async function touchEventTrace(page, traceName) {
  return page.evaluate((name) => window[name] || [], traceName);
}

function assertTouchEventTrace(trace, label, { exactToken = false } = {}) {
  for (const type of ["pointerdown", "focusin", "pointerup", "click"]) {
    assert(trace.some((entry) => entry.type === type), `${label}: ${type} was not observed: ${JSON.stringify(trace)}`);
  }
  for (const entry of trace) {
    assert.equal(entry.panelMode, "locked", `${label}: ${entry.type} changed panel mode: ${JSON.stringify(trace)}`);
    assert.equal(entry.hoverLocked, "true", `${label}: ${entry.type} changed hover lock: ${JSON.stringify(trace)}`);
    assert.equal(entry.route, START_ROUTE, `${label}: ${entry.type} changed route: ${JSON.stringify(trace)}`);
    if (exactToken) {
      assert.equal(entry.targetIdentity, "verse:1:token:3", `${label}: ${entry.type} changed token identity`);
    }
  }
  const focused = trace.find((entry) => entry.type === "focusin");
  const completed = [...trace].reverse().find((entry) => entry.type === "click");
  assert(focused?.activeElementMatches, `${label}: native focus did not settle on the target: ${JSON.stringify(trace)}`);
  assert(completed?.tooltipVisible, `${label}: tooltip was not visible after tap completion: ${JSON.stringify(trace)}`);
}

async function assertBackgroundDisengage(page, label, touch) {
  const title = page.locator("#detailTitle");
  const box = await title.boundingBox();
  assert(box, `${label}: non-interactive panel background has no rectangle`);
  if (touch) {
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  } else {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
  await page.waitForFunction(
    () =>
      document.querySelector(".detail-pane")?.dataset.panelMode === "follow" &&
      document.querySelector(".detail-pane")?.dataset.hoverLocked === "false",
  );
  const state = await panelState(page);
  assert.equal(state.route, START_ROUTE, `${label}: background disengage changed route`);
  assert.equal(state.title, "Language Study", `${label}: background disengage changed detail title`);
  assert.equal(state.targetIdentity, "verse:1:token:3", `${label}: background disengage changed exact token content`);
  return state;
}

async function runTouchIteration(browser, baseUrl, iteration) {
  const theme = themeForIteration(iteration);
  const context = await browser.newContext({
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
    viewport: VIEWPORTS.mobile,
  });
  const page = await context.newPage();
  const errors = watchPageDiagnostics(page);
  try {
    await waitForLanguageStudyReady(page, baseUrl, theme, errors);
    const before = await panelState(page);
    assertLockedLanguageStudy(before, `touch iteration ${iteration} initial state`);
    await installTouchEventTrace(page, LANGUAGE_MARK_SELECTOR, LANGUAGE_TOOLTIP_SELECTOR, "__languageMarkTouchTrace");
    const languageTouch = await tapTarget(
      page,
      LANGUAGE_MARK_SELECTOR,
      LANGUAGE_TOOLTIP_SELECTOR,
      assertLanguageMark,
      `touch iteration ${iteration} language mark`,
    );
    const languageTrace = await touchEventTrace(page, "__languageMarkTouchTrace");
    assertTouchEventTrace(languageTrace, `touch iteration ${iteration} language mark`);
    assert.deepEqual(
      await panelState(page),
      before,
      `touch iteration ${iteration}: language-mark tap changed route, history, lock, or exact token`,
    );
    await installTouchEventTrace(page, MORPHOLOGY_SELECTOR, MORPHOLOGY_TOOLTIP_SELECTOR, "__morphologyTouchTrace");
    const morphologyTouch = await tapTarget(
      page,
      MORPHOLOGY_SELECTOR,
      MORPHOLOGY_TOOLTIP_SELECTOR,
      assertMorphology,
      `touch iteration ${iteration} morphology`,
    );
    const morphologyTrace = await touchEventTrace(page, "__morphologyTouchTrace");
    assertTouchEventTrace(morphologyTrace, `touch iteration ${iteration} morphology`, { exactToken: true });
    assert.deepEqual(
      await panelState(page),
      before,
      `touch iteration ${iteration}: morphology tap changed route, history, lock, or exact token`,
    );
    await waitForTooltip(page, LANGUAGE_TOOLTIP_SELECTOR, false);
    await page.locator(LANGUAGE_MARK_SELECTOR).first().focus();
    await waitForTooltip(page, LANGUAGE_TOOLTIP_SELECTOR, true);
    await waitForTooltip(page, MORPHOLOGY_TOOLTIP_SELECTOR, false);
    await page.locator("#clearDetail").focus();
    await assertHiddenAndCleared(page, LANGUAGE_TOOLTIP_SELECTOR, `touch iteration ${iteration} focus loss`);

    assert.deepEqual(
      await panelState(page),
      before,
      `touch iteration ${iteration}: touch focus changed route, history, lock, or active token`,
    );
    assert.deepEqual(errors.consoleErrors, [], `touch iteration ${iteration}: browser console errors`);
    assert.deepEqual(errors.pageErrors, [], `touch iteration ${iteration}: uncaught page errors`);
    const backgroundDisengage = await assertBackgroundDisengage(
      page,
      `touch iteration ${iteration} background`,
      true,
    );
    return {
      backgroundDisengage,
      consoleErrors: errors.consoleErrors,
      iteration,
      languageTrace,
      languageTouch,
      morphologyTrace,
      morphologyTouch,
      pageErrors: errors.pageErrors,
      requestFailures: errors.requestFailures,
      theme,
      viewport: VIEWPORTS.mobile,
    };
  } finally {
    await context.close();
  }
}

if (!Object.hasOwn(BROWSERS, browserName)) {
  throw new Error(`Unsupported browser ${JSON.stringify(browserName)}. Use --browser=edge or --browser=chrome.`);
}
if (!Number.isInteger(repeatCount) || repeatCount < 1) {
  throw new Error(`Invalid repeat count ${JSON.stringify(optionValue("--repeat"))}.`);
}
const executablePath = optionValue("--executable") || BROWSERS[browserName];
if (!existsSync(executablePath)) throw new Error(`Browser executable not found: ${executablePath}`);

const { server, url } = await startStaticAppServer({ port: 0 });
let browser;
try {
  browser = await chromium.launch({
    args: [
      "--disable-background-networking",
      "--disable-extensions",
      "--disable-gpu",
      "--no-default-browser-check",
      "--no-first-run",
    ],
    executablePath,
    headless: true,
  });
  const results = [];
  for (let iteration = 1; iteration <= repeatCount; iteration += 1) {
    if (touchMode) {
      results.push(await runTouchIteration(browser, url, iteration));
    } else {
      for (const mode of Object.keys(VIEWPORTS)) {
        results.push(await runDesktopViewport(browser, url, iteration, mode));
      }
    }
  }
  console.log(
    JSON.stringify(
      {
        browser: browserName,
        executablePath,
        mode: touchMode ? "touch" : "desktop-narrow-mobile",
        repeatCount,
        results,
        version: browser.version(),
      },
      null,
      2,
    ),
  );
  console.log(`Language Study tooltip interaction test passed (${browserName} ${touchMode ? "touch" : "desktop"}).`);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
