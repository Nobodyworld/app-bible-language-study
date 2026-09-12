#!/usr/bin/env node

import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { startStaticAppServer } from "../tools/serve-app.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
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

async function click(page, selector) {
  await page.evaluate((targetSelector) => {
    const target = document.querySelector(targetSelector);
    if (!target) throw new Error(`Target not found: ${targetSelector}`);
    target.scrollIntoView({ block: "center", inline: "nearest" });
    target.click();
  }, selector);
}

async function clickButtonByText(page, text) {
  await page.evaluate((label) => {
    const target = [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === label);
    if (!target) throw new Error(`Button not found: ${label}`);
    target.scrollIntoView({ block: "center", inline: "nearest" });
    target.click();
  }, text);
}

async function waitForEntry(page, code) {
  await page.waitForFunction((expected) =>
    document.querySelector("#detailContent .strong-code")?.textContent === expected &&
    Boolean(document.querySelector("#detailContent .lexical-summary")), code);
}

async function checkLexicalReferences(page, url) {
  await page.goto(`${url}/#/read/bsb/john/4/18`, { waitUntil: "load" });
  const trueToken = page.locator('.verse-row[data-verse="18"] .strong-token[data-strong-code="G227"]').first();
  await trueToken.waitFor({ state: "visible" });
  await trueToken.click();
  await waitForEntry(page, "G227");
  const route = page.url();
  const origin = page.locator("#detailContent .word-origin-value");
  assert(/From a- \(as a negative particle\) and lanthano/.test(await origin.innerText()), "G227 must distinguish the lexical a- from the ordinary article in its explanation");
  const prefix = origin.getByRole("button", { name: "Open Strong's a-, G1", exact: true });
  assert(await prefix.count() === 1 && await origin.locator("button").count() === 2, "G227 must link its two origin words, not the article in '(as a negative particle)'");
  await prefix.focus();
  await page.waitForFunction(() => document.querySelector('.strong-origin-link[aria-label="Open Strong\'s a-, G1"]')?.dataset.previewReady === "true");
  assert(/G1/.test(await prefix.getAttribute("data-tooltip")), "G1 must hydrate through the existing reference control");
  await prefix.press("Enter");
  await waitForEntry(page, "G1");
  assert(page.url() === route, "Opening the lexical prefix must not navigate the Reader");

  // Open an actual G4151 occurrence rather than a synthetic dictionary entry.
  await page.goto(`${url}/#/read/bsb/john/4/24`, { waitUntil: "load" });
  const spirit = page.locator('.verse-row[data-verse="24"] .strong-token[data-strong-code="G4151"]').first();
  await spirit.waitFor({ state: "visible" });
  await spirit.click();
  await waitForEntry(page, "G4151");
  const compare = page.locator("#detailContent .concordance-text .lexicon-line")
    .filter({ hasText: /Compare psuche\./ }).getByRole("button", { name: "Open Strong's psuche, G5590", exact: true }).first();
  await compare.hover();
  await page.waitForFunction(() => [...document.querySelectorAll(".concordance-text .strong-inline-link")]
    .some((node) => node.textContent === "psuche" && node.dataset.previewReady === "true"));
  assert(/G5590/.test(await compare.getAttribute("data-tooltip")), "Compare psuche must hydrate G5590");
  const comparisonRoute = page.url();
  await compare.click();
  await waitForEntry(page, "G5590");
  assert(page.url() === comparisonRoute, "Compare activation must not navigate the Reader");

  // Exercise comma-list control construction using the production parser/control.
  const list = await page.evaluate(async () => {
    const { resolveStrongSeeSegments, createStrongReferenceControl } = await import("/src/strong-reference-control.js?v=pr13-live-qa-20260711e");
    const host = document.createElement("div");
    host.id = "strong-compare-fixture";
    const activated = [];
    host.style.cssText = "position:fixed;left:20px;top:100px;z-index:10000;background:var(--panel);padding:12px";
    const text = "Compare louo, unknown, nipto.";
    const refs = [{ label: "louo", strong_code: "G3068", language: "greek" }, { label: "niptō", strong_code: "G3538", language: "greek" }];
    for (const segment of resolveStrongSeeSegments(text, refs)) {
      const control = segment.ref && createStrongReferenceControl(segment.ref, {
        label: segment.label, onActivate: (ref) => activated.push(ref.strong_code),
      });
      host.append(control || document.createTextNode(segment.text || segment.label || ""));
    }
    host.__activated = activated;
    document.body.append(host);
    return { text: host.textContent, controls: host.querySelectorAll("button").length };
  });
  assert(list.text === "Compare louo, unknown, nipto." && list.controls === 2, "Each exact list reference must become a control; an unresolved label must remain text");
  await page.locator("#strong-compare-fixture button").nth(0).click();
  await page.locator("#strong-compare-fixture button").nth(1).press("Enter");
  const activated = await page.evaluate(() => {
    const host = document.querySelector("#strong-compare-fixture");
    const result = host.__activated;
    host.remove();
    return result;
  });
  assert(JSON.stringify(activated) === '["G3068","G3538"]', "Each comparison must activate its own destination");
}

async function checkWrappedTokenFragments(page, url, viewport) {
  await page.setViewportSize(viewport);
  await page.goto(`${url}/#/read/bsb/mark/9/3`, { waitUntil: "load" });
  await page.waitForSelector('.verse-row[data-verse="3"] .strong-token[data-strong-code="G3021"]');
  // Clone the real rendered verse under the complete production cascade. Cloning
  // isolates geometry from hover-driven Study state without fabricating source text.
  await page.evaluate(() => {
    const source = document.querySelector('.verse-row[data-verse="3"] .verse-body');
    const host = document.createElement("div");
    host.id = "strong-wrap-fixture";
    host.style.cssText = "position:fixed;left:20px;top:140px;z-index:10000;background:var(--panel);width:calc(100vw - 40px)";
    const body = source.cloneNode(true);
    body.querySelectorAll("[data-suppress-tooltip]").forEach((node) => node.removeAttribute("data-suppress-tooltip"));
    host.append(body);
    document.body.append(host);
  });
  const token = page.locator('#strong-wrap-fixture .strong-token[data-strong-code="G3021"]').first();
  const results = [];
  for (const mode of ["light", "dark", "forced-colors"]) {
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme === "light" ? "light" : "dark"; }, mode);
    await page.emulateMedia({ forcedColors: mode === "forced-colors" ? "active" : "none", reducedMotion: "reduce" });
    await token.hover();
    assert(await token.evaluate((node) => getComputedStyle(node, "::after").display !== "none"), `${mode}: pointer tooltip was disabled`);
    await page.keyboard.press("Tab");
    await token.focus();
    const result = await token.evaluate((node, maxWidth) => {
      const host = document.querySelector("#strong-wrap-fixture");
      const before = host.textContent;
      const range = document.createRange();
      range.selectNodeContents(node);
      const orphanFragments = () => {
        const textRects = [...range.getClientRects()].filter((rect) => rect.width > 0.1 && rect.height > 0.1);
        return [...node.getClientRects()].filter((fragment) => fragment.width > 0.1 && fragment.height > 0.1 &&
          !textRects.some((text) => Math.min(text.right, fragment.right) - Math.max(text.left, fragment.left) > 0.1 &&
            Math.min(text.bottom, fragment.bottom) - Math.max(text.top, fragment.top) > 0.1));
      };
      const failures = [];
      let widths = 0;
      // Fractional widths catch the padding-only line fragment missed by the
      // former screenshots and ordinary whole-viewport smoke tests.
      for (let width = 220; width <= maxWidth; width += 0.25) {
        host.style.width = `${width}px`;
        widths += 1;
        if (orphanFragments().length) failures.push(width);
      }
      host.style.width = "85px";
      const wrapsNaturally = node.getClientRects().length > 1 && orphanFragments().length === 0;
      host.style.width = `${maxWidth}px`;
      return {
        widths, failures, wrapsNaturally, unchanged: before === host.textContent,
        selectableText: range.toString(), label: node.textContent,
        keyboardTooltip: node.matches(":focus-visible") && getComputedStyle(node, "::after").display !== "none",
      };
    }, Math.min(viewport.width - 40, 940));
    assert(result.failures.length === 0, `${viewport.width}/${mode}: padding-only Strong fragments at widths ${result.failures.slice(0, 10)}`);
    assert(result.wrapsNaturally, `${viewport.width}/${mode}: multi-word Strong spans must still wrap naturally`);
    assert(result.unchanged && result.selectableText === result.label && result.label.trim(), "Wrapping must preserve selectable scripture text");
    assert(result.keyboardTooltip, `${viewport.width}/${mode}: keyboard tooltip was disabled`);
    results.push({ viewport: viewport.width, mode, widths: result.widths });
  }
  await page.evaluate(() => document.querySelector("#strong-wrap-fixture").remove());
  await page.emulateMedia({ forcedColors: "none", reducedMotion: "no-preference" });
  return results;
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
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`${url}/#/read/bsb/psalms/23/1`, { waitUntil: "load" });
    await waitFor(page, () => Boolean(document.querySelector("#chapterTitle")?.textContent.includes("Psalms 23")));
    await waitFor(page, () => document.querySelectorAll(".strong-token").length > 0);
    await click(page, ".strong-token");
    await waitFor(page, () => document.querySelector("#detailTitle")?.textContent === "Strong's");
    await waitFor(page, () => [...document.querySelectorAll("button")].some((button) => button.textContent.trim() === "Int"));
    await clickButtonByText(page, "Int");
    await waitFor(page, () => Boolean(document.querySelector(".original-language-related-link")));
    const related = page.locator(".original-language-related-link").first();
    await related.hover();
    await waitFor(page, () => document.querySelector(".original-language-related-link")?.dataset.previewReady === "true");
    const preview = await page.evaluate(() => {
      const link = document.querySelector(".original-language-related-link");
      const layer = document.querySelector(".language-tooltip-layer:not([hidden])");
      const panel = document.querySelector(".detail-pane");
      const tooltipRect = layer?.getBoundingClientRect();
      const panelRect = panel?.getBoundingClientRect();
      return {
        dataTooltip: link?.dataset.tooltip || "", visibleTooltip: layer?.textContent || "", visible: Boolean(layer),
        contained: Boolean(tooltipRect && panelRect && tooltipRect.left >= panelRect.left && tooltipRect.right <= panelRect.right &&
          tooltipRect.top >= Math.max(0, panelRect.top) && tooltipRect.bottom <= Math.min(innerHeight, panelRect.bottom)),
      };
    });
    assert(preview.visible && preview.dataTooltip && !/Loading definition/i.test(preview.dataTooltip) &&
      preview.visibleTooltip === preview.dataTooltip && preview.contained,
    `hydrated Strong's preview did not update in place: ${JSON.stringify(preview)}`);

    await checkLexicalReferences(page, url);
    const wrapping = [];
    for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
      const wrappingPage = await browser.newPage({ viewport });
      wrappingPage.on("pageerror", (error) => errors.push(error.message));
      wrappingPage.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
      try {
        wrapping.push(...await checkWrappedTokenFragments(wrappingPage, url, viewport));
      } finally {
        await wrappingPage.close();
      }
    }
    assert(errors.length === 0, `Strong preview regressions reported browser errors: ${JSON.stringify(errors)}`);
    console.log(JSON.stringify({ status: "ok", hydratedPreview: true, lexicalReferences: true, wrapping }, null, 2));
  } finally {
    await browser.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

await main();
