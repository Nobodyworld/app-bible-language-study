#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { startStaticAppServer } from "../tools/serve-app.mjs";

const BROWSERS = {
  chrome: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  edge: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
};
const EXPECTED_DESTINATION = "#/read/bsb/ezekiel/34/11";
const START_ROUTE = "#/read/bsb/psalms/23";
const TRIGGER_SELECTOR = 'button.reference-hover[data-reference-label^="Ezekiel 34:11"]';
const TOOLTIP_SELECTOR = ".reference-hover-tooltip-layer:not([hidden])";
const cliArgs = process.argv.slice(2);
const browserName = optionValue("--browser") || "edge";
const touchMode = cliArgs.includes("--touch");
const repeatCount = Number(optionValue("--repeat") || 3);

function optionValue(name) {
  const argument = cliArgs.find((value) => value.startsWith(`${name}=`));
  if (argument) return argument.slice(name.length + 1);
  const index = cliArgs.indexOf(name);
  return index >= 0 ? cliArgs[index + 1] : "";
}

function assertRectContained(rect, viewport, label) {
  const epsilon = 1;
  assert(rect.left >= 10 - epsilon, `${label} escaped the left viewport margin: ${JSON.stringify(rect)}`);
  assert(rect.top >= 10 - epsilon, `${label} escaped the top viewport margin: ${JSON.stringify(rect)}`);
  assert(rect.right <= viewport.width - 10 + epsilon, `${label} escaped the right viewport margin: ${JSON.stringify(rect)}`);
  assert(rect.bottom <= viewport.height - 10 + epsilon, `${label} escaped the bottom viewport margin: ${JSON.stringify(rect)}`);
}

function assertCollisionSafe(state, label) {
  assert(state.tooltip, `${label}: preview was not visible`);
  assert(!state.overlap, `${label}: preview intersects its trigger: ${JSON.stringify(state)}`);
  assert(
    state.tooltip.bottom <= state.trigger.top - 7 || state.tooltip.top >= state.trigger.bottom + 7,
    `${label}: preview did not preserve the eight-pixel trigger offset: ${JSON.stringify(state)}`,
  );
  assert(
    state.hit?.inTrigger,
    `${label}: trigger-center hit-test did not return the button or its descendant: ${JSON.stringify(state.hit)}`,
  );
  assert.equal(state.pointerEvents, "auto", `${label}: preview must remain pointer-interactive`);
  assert.equal(state.overflowY, "auto", `${label}: preview must retain internal vertical scrolling`);
  assertRectContained(state.tooltip, state.viewport, `${label} preview`);
}

async function waitForReader(page, baseUrl) {
  await page.goto(`${baseUrl}/${START_ROUTE}`, { waitUntil: "load" });
  await page.waitForFunction(
    () => document.readyState === "complete" && !document.body.textContent.includes("Loading data"),
    null,
    { timeout: 30_000 },
  );
  const trigger = page.locator(TRIGGER_SELECTOR).first();
  await trigger.waitFor({ state: "visible", timeout: 30_000 });
  await trigger.scrollIntoViewIfNeeded();
  await page.waitForFunction(
    (selector) => document.querySelector(selector)?.dataset.previewLoaded === "true",
    TRIGGER_SELECTOR,
    { timeout: 30_000 },
  );
  return trigger;
}

async function hidePreview(page) {
  await page.mouse.move(1270, 10);
  await page.waitForFunction(
    (selector) => {
      const tooltip = document.querySelector(selector);
      return !tooltip || tooltip.hidden;
    },
    ".reference-hover-tooltip-layer",
    { timeout: 5_000 },
  );
}

async function showPreview(page, trigger) {
  const box = await trigger.boundingBox();
  assert(box, "Reference trigger did not have a rendered rectangle.");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.locator(TOOLTIP_SELECTOR).waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(100);
  return box;
}

async function previewState(page, trigger) {
  return page.evaluate(
    ({ button, tooltipSelector }) => {
      const tooltip = document.querySelector(tooltipSelector);
      const triggerRect = button.getBoundingClientRect();
      const tooltipRect = tooltip?.getBoundingClientRect();
      const center = {
        x: triggerRect.left + triggerRect.width / 2,
        y: triggerRect.top + triggerRect.height / 2,
      };
      const hit = document.elementFromPoint(center.x, center.y);
      const rect = (value) =>
        value
          ? {
              bottom: value.bottom,
              height: value.height,
              left: value.left,
              right: value.right,
              top: value.top,
              width: value.width,
              x: value.x,
              y: value.y,
            }
          : null;
      return {
        center,
        hit: hit
          ? {
              className: String(hit.className),
              inTooltip: Boolean(hit.closest(".reference-hover-tooltip-layer")),
              inTrigger: hit === button || button.contains(hit),
              tag: hit.tagName,
            }
          : null,
        maxHeight: tooltip?.style.maxHeight || "",
        overflowY: tooltip ? getComputedStyle(tooltip).overflowY : "",
        overlap: Boolean(
          tooltipRect &&
            triggerRect.left < tooltipRect.right &&
            triggerRect.right > tooltipRect.left &&
            triggerRect.top < tooltipRect.bottom &&
            triggerRect.bottom > tooltipRect.top
        ),
        placement: tooltip?.dataset.placement || "",
        pointerEvents: tooltip ? getComputedStyle(tooltip).pointerEvents : "",
        scroll: tooltip
          ? {
              clientHeight: tooltip.clientHeight,
              scrollHeight: tooltip.scrollHeight,
              scrollTop: tooltip.scrollTop,
            }
          : null,
        tooltip: rect(tooltipRect),
        trigger: rect(triggerRect),
        viewport: { height: window.innerHeight, width: window.innerWidth },
      };
    },
    { button: await trigger.elementHandle(), tooltipSelector: TOOLTIP_SELECTOR },
  );
}

async function detailState(page) {
  return page.evaluate(() => ({
    backDisabled: document.querySelector("#detailBack")?.disabled ?? null,
    content: document.querySelector("#detailContent")?.textContent || "",
    forwardDisabled: document.querySelector("#detailForward")?.disabled ?? null,
    historyLength: window.history.length,
    hoverLocked: document.querySelector(".detail-pane")?.dataset.hoverLocked || "",
    route: window.location.hash,
    title: document.querySelector("#detailTitle")?.textContent || "",
  }));
}

async function tooltipInlineState(page) {
  return page.evaluate(() => {
    const tooltip = document.querySelector(".reference-hover-tooltip-layer");
    return tooltip
      ? {
          left: tooltip.style.left,
          maxHeight: tooltip.style.maxHeight,
          placement: tooltip.dataset.placement || "",
          top: tooltip.style.top,
        }
      : null;
  });
}

function watchPageErrors(page) {
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  return { consoleErrors, pageErrors };
}

async function runDesktopIteration(browser, baseUrl, iteration) {
  const context = await browser.newContext({ viewport: { height: 720, width: 1280 } });
  const page = await context.newPage();
  const errors = watchPageErrors(page);
  const result = { iteration };
  try {
    await page.mouse.move(1270, 10);
    const trigger = await waitForReader(page, baseUrl);
    await hidePreview(page);
    await page.locator(".verse-number").first().click();
    await page.waitForFunction(() => document.querySelector(".detail-pane")?.dataset.hoverLocked === "true");
    const panelBefore = await detailState(page);
    await showPreview(page, trigger);
    const initial = await previewState(page, trigger);
    assertCollisionSafe(initial, `desktop iteration ${iteration}`);
    assert(
      initial.scroll.scrollHeight > initial.scroll.clientHeight,
      `desktop iteration ${iteration}: long preview was not internally scrollable: ${JSON.stringify(initial.scroll)}`,
    );
    assert(initial.maxHeight.endsWith("px"), `desktop iteration ${iteration}: regional max-height was not applied`);

    const tooltipPoint = {
      x: initial.tooltip.left + Math.min(40, initial.tooltip.width / 2),
      y: initial.tooltip.top + Math.min(40, initial.tooltip.height / 2),
    };
    await page.mouse.move(tooltipPoint.x, tooltipPoint.y, { steps: 4 });
    await page.waitForTimeout(220);
    assert.equal(await page.locator(TOOLTIP_SELECTOR).count(), 1, "Preview dismissed while moving from trigger to tooltip.");
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(100);
    const afterInternalScroll = await previewState(page, trigger);
    assert(afterInternalScroll.scroll.scrollTop > 0, "Pointer inspection did not scroll the long preview.");

    await hidePreview(page);
    assert.equal(await page.locator(TOOLTIP_SELECTOR).count(), 0, "Preview did not dismiss after leaving trigger and tooltip.");
    assert.deepEqual(
      await tooltipInlineState(page),
      { left: "", maxHeight: "", placement: "", top: "" },
      "Hidden preview retained stale inline placement state.",
    );
    assert.deepEqual(await detailState(page), panelBefore, "Transient preview changed route, panel lock, content, or history state.");

    await showPreview(page, trigger);
    await page.setViewportSize({ height: 640, width: 1000 });
    await page.waitForTimeout(150);
    const resized = await previewState(page, trigger);
    assertCollisionSafe(resized, `desktop iteration ${iteration} resized`);

    const scrollResult = await page.evaluate((button) => {
      let node = button.parentElement;
      while (node && node !== document.body) {
        const style = getComputedStyle(node);
        if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
          const before = node.scrollTop;
          node.scrollTop = Math.min(node.scrollTop + 40, node.scrollHeight - node.clientHeight);
          return { after: node.scrollTop, before, scroller: node.className || node.id || node.tagName };
        }
        node = node.parentElement;
      }
      const before = window.scrollY;
      window.scrollBy(0, 40);
      return { after: window.scrollY, before, scroller: "window" };
    }, await trigger.elementHandle());
    await page.waitForTimeout(150);
    const repositioned = await previewState(page, trigger);
    assertCollisionSafe(repositioned, `desktop iteration ${iteration} scrolled`);
    assert(
      scrollResult.after !== scrollResult.before || repositioned.trigger.top === resized.trigger.top,
      `desktop iteration ${iteration}: relevant scroll state was indeterminate: ${JSON.stringify(scrollResult)}`,
    );

    await page.setViewportSize({ height: 720, width: 1280 });
    await hidePreview(page);
    await trigger.scrollIntoViewIfNeeded();
    await showPreview(page, trigger);
    const activation = await previewState(page, trigger);
    assertCollisionSafe(activation, `desktop iteration ${iteration} activation`);
    await page.mouse.click(activation.center.x, activation.center.y);
    await page.waitForFunction((destination) => window.location.hash === destination, EXPECTED_DESTINATION);
    result.pointerRoute = await page.evaluate(() => window.location.hash);

    const keyboardPage = await context.newPage();
    const keyboardErrors = watchPageErrors(keyboardPage);
    const keyboardTrigger = await waitForReader(keyboardPage, baseUrl);
    await keyboardTrigger.focus();
    await keyboardTrigger.press("Enter");
    await keyboardPage.waitForFunction((destination) => window.location.hash === destination, EXPECTED_DESTINATION);
    result.keyboardRoute = await keyboardPage.evaluate(() => window.location.hash);
    errors.consoleErrors.push(...keyboardErrors.consoleErrors);
    errors.pageErrors.push(...keyboardErrors.pageErrors);
    result.initial = initial;
    result.resized = resized;
    result.repositioned = repositioned;
    result.scrollResult = scrollResult;
    result.tooltipScrollTop = afterInternalScroll.scroll.scrollTop;
    assert.deepEqual(errors.consoleErrors, [], `desktop iteration ${iteration}: browser console errors`);
    assert.deepEqual(errors.pageErrors, [], `desktop iteration ${iteration}: uncaught page errors`);
    result.consoleErrors = errors.consoleErrors;
    result.pageErrors = errors.pageErrors;
    return result;
  } finally {
    await context.close();
  }
}

async function installTouchGeometryCapture(page) {
  await page.addInitScript(
    ({ triggerSelector }) => {
      document.addEventListener(
        "pointerdown",
        (event) => {
          const trigger = document.querySelector(triggerSelector);
          const tooltip = document.querySelector(".reference-hover-tooltip-layer:not([hidden])");
          if (!trigger || !tooltip) return;
          const triggerRect = trigger.getBoundingClientRect();
          const tooltipRect = tooltip.getBoundingClientRect();
          const center = {
            x: triggerRect.left + triggerRect.width / 2,
            y: triggerRect.top + triggerRect.height / 2,
          };
          const hit = document.elementFromPoint(center.x, center.y);
          const rect = (value) => ({
            bottom: value.bottom,
            height: value.height,
            left: value.left,
            right: value.right,
            top: value.top,
            width: value.width,
            x: value.x,
            y: value.y,
          });
          sessionStorage.setItem(
            "__referencePreviewTouchGeometry",
            JSON.stringify({
              eventTargetInTrigger: event.target === trigger || trigger.contains(event.target),
              hit: {
                className: String(hit?.className || ""),
                inTooltip: Boolean(hit?.closest(".reference-hover-tooltip-layer")),
                inTrigger: hit === trigger || trigger.contains(hit),
                tag: hit?.tagName || "",
              },
              maxHeight: tooltip.style.maxHeight,
              overflowY: getComputedStyle(tooltip).overflowY,
              overlap:
                triggerRect.left < tooltipRect.right &&
                triggerRect.right > tooltipRect.left &&
                triggerRect.top < tooltipRect.bottom &&
                triggerRect.bottom > tooltipRect.top,
              placement: tooltip.dataset.placement || "",
              pointerEvents: getComputedStyle(tooltip).pointerEvents,
              tooltip: rect(tooltipRect),
              trigger: rect(triggerRect),
              viewport: { height: window.innerHeight, width: window.innerWidth },
            }),
          );
        },
        true,
      );
    },
    { triggerSelector: TRIGGER_SELECTOR },
  );
}

async function runTouchIteration(browser, baseUrl, iteration) {
  const context = await browser.newContext({
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
    viewport: { height: 844, width: 390 },
  });
  const page = await context.newPage();
  const errors = watchPageErrors(page);
  try {
    await installTouchGeometryCapture(page);
    const trigger = await waitForReader(page, baseUrl);
    const box = await trigger.boundingBox();
    assert(box, "Touch reference trigger did not have a rendered rectangle.");
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction((destination) => window.location.hash === destination, EXPECTED_DESTINATION);
    const captured = await page.evaluate(() => JSON.parse(sessionStorage.getItem("__referencePreviewTouchGeometry") || "null"));
    assert(captured, `touch iteration ${iteration}: pointerdown geometry was not captured`);
    assertCollisionSafe(captured, `touch iteration ${iteration}`);
    assert(captured.eventTargetInTrigger, `touch iteration ${iteration}: real pointerdown did not target the reference button`);
    assert.deepEqual(errors.consoleErrors, [], `touch iteration ${iteration}: browser console errors`);
    assert.deepEqual(errors.pageErrors, [], `touch iteration ${iteration}: uncaught page errors`);
    return {
      captured,
      consoleErrors: errors.consoleErrors,
      iteration,
      pageErrors: errors.pageErrors,
      touchRoute: await page.evaluate(() => window.location.hash),
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
    results.push(
      touchMode
        ? await runTouchIteration(browser, url, iteration)
        : await runDesktopIteration(browser, url, iteration),
    );
  }
  console.log(
    JSON.stringify(
      {
        browser: browserName,
        executablePath,
        mode: touchMode ? "touch" : "desktop",
        repeatCount,
        results,
        version: browser.version(),
      },
      null,
      2,
    ),
  );
  console.log(`Reference preview interaction test passed (${browserName} ${touchMode ? "touch" : "desktop"}).`);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
