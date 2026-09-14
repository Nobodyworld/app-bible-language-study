#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { startStaticAppServer } from "../tools/serve-app.mjs";

const executablePath = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find(existsSync);
assert(executablePath, "An installed Edge is required");
const evidence = process.env.CLEANUP_SCREENSHOT_DIR;
if (evidence) await mkdir(evidence, { recursive: true });
const { server, url } = await startStaticAppServer({ port: 0 });
const browser = await chromium.launch({ executablePath, headless: true });
const results = [];

async function ready(page) {
  await page.waitForFunction(() => document.querySelectorAll(".strong-token").length > 0 &&
    document.querySelector("#statusText")?.textContent.includes("data loaded"));
}
async function screenshot(page, name) {
  if (evidence) await page.screenshot({ path: resolve(evidence, `${name}.png`) });
}
async function myData(page) {
  await page.locator("#showMyData").click();
  await page.getByRole("heading", { name: "Saved study", exact: true }).waitFor();
}
async function exportBackup(page) {
  const advanced = page.locator(".advanced-backup-options");
  if (!(await advanced.evaluate((node) => node.open))) await advanced.locator(":scope > summary").click();
  const raw = page.locator(".manual-json-panel:not(.paste-json-panel)");
  if (await raw.evaluate((node) => node.open)) await raw.locator(":scope > summary").click();
  await raw.locator(":scope > summary").click();
  await page.waitForFunction(() => Boolean(document.querySelector(".export-textarea")?.value));
  return JSON.parse(await page.locator(".export-textarea").inputValue());
}
async function checkControls(page, touch) {
  const measured = await page.evaluate(async (touch) => {
    const auditUrl = new URL("./src/ui-label-audit.js", document.baseURI).href;
    const { auditStudyControls } = await import(auditUrl);
    const controls = [...document.querySelectorAll("#detailContext .verse-context-tab, #detailContext .word-meaning-trigger, #detailContext .study-marks-trigger")];
    return {
      audit: auditStudyControls(),
      overflow: document.documentElement.scrollWidth - innerWidth,
      invalid: controls.filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.height < (touch ? 44 : 30) || node.scrollWidth > node.clientWidth + 2 ||
          getComputedStyle(node).fontSize === "0px";
      }).map((node) => node.textContent || node.getAttribute("aria-label")),
      word: [...document.querySelectorAll('[data-panel-scope="word"] .verse-context-tab')].map((node) => node.textContent.trim()),
    };
  }, touch);
  assert.deepEqual(measured.audit, { duplicateIds: [], duplicateLabels: [], emptyNames: [] });
  assert(measured.overflow <= 1, "No horizontal page overflow");
  assert.deepEqual(measured.invalid, [], "Controls must be readable and meet their pointer-size contract");
  assert.equal(measured.word[0], "Definition");
  assert.equal(measured.word.filter((name) => name === "Concordance").length, 1);
}

try {
  for (const profile of [
    { name: "compact-light", width: 1365, height: 900, mode: "compact", theme: "light" },
    { name: "standard-dark", width: 1365, height: 900, mode: "standard", theme: "dark" },
    { name: "narrow-light", width: 700, height: 900, mode: "compact", theme: "light" },
    { name: "touch-dark", width: 390, height: 844, mode: "standard", theme: "dark", touch: true },
  ]) {
    const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height }, hasTouch: Boolean(profile.touch), isMobile: Boolean(profile.touch), colorScheme: profile.theme, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
    await page.goto(`${url}/#/read/bsb/psalms/23`);
    await ready(page);
    if (await page.locator("html").getAttribute("data-theme") !== profile.theme) await page.locator("#themeToggle").click();
    assert.equal(await page.locator("html").getAttribute("data-theme"), profile.theme);
    await myData(page);
    assert.equal(await page.locator(".physical-pack-manager, .user-data-summary-item, .pack-recovery").count(), 0);
    assert.match(await page.locator(".study-data-section").innerText(), /No saved study items yet/);
    await screenshot(page, `${profile.name}-my-data`);
    const fresh = await exportBackup(page);
    assert.equal(fresh.stores.polls, undefined);
    assert.equal(fresh.stores.tags.job_events, undefined);
    assert.equal(fresh.stores.workspace.job_events, undefined);
    if (profile.width <= 768) await page.locator("#hideStudyWorkspace").click();
    await page.locator('.strong-token[data-strong-code="H3068"]').first().click();
    await page.locator("#detailContext .word-meaning-trigger").waitFor();
    if (profile.width >= 769) {
      const width = page.locator("#studyWorkspaceWidthCycle");
      for (let attempt = 0; attempt < 3 && !(await width.getAttribute("aria-label")).includes(`width: ${profile.mode[0].toUpperCase()}${profile.mode.slice(1)}.`); attempt++) await width.click();
    }
    await checkControls(page, Boolean(profile.touch));
    await screenshot(page, `${profile.name}-study`);
    const trigger = page.locator("#detailContext .word-meaning-trigger");
    await trigger.focus();
    await trigger.press("Enter");
    await page.getByRole("heading", { name: "Word interpretation", exact: true }).waitFor();
    const options = page.locator("#detailToolContent .word-meaning-option[data-source]");
    assert(await options.count() > 0);
    for (const option of await options.all()) {
      assert((await option.locator(".word-meaning-choice-value").innerText()).trim());
      assert((await option.locator(".word-meaning-choice-source").innerText()).trim());
    }
    await screenshot(page, `${profile.name}-interpretation`);
    await page.getByRole("button", { name: "Add alternative wording", exact: true }).click();
    const input = page.getByRole("textbox", { name: /Alternative wording for/ });
    await input.fill("Unsaved fixture");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await page.locator("#detailContext .word-meaning-badge").count(), 0);
    await page.waitForFunction(() => document.activeElement === document.querySelector("#detailContext .word-meaning-trigger"));
    await trigger.press("Enter");
    await page.getByRole("button", { name: "Add alternative wording", exact: true }).click();
    await input.fill("Fixture interpretation");
    await input.press("Enter");
    await page.locator("#detailContext .word-meaning-badge").filter({ hasText: "Fixture interpretation" }).waitFor();
    await trigger.click();
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    assert.equal(await page.locator("#detailContext .word-meaning-badge").count(), 0);
    if (profile.width <= 768) await page.locator("#hideStudyWorkspace").click();
    await page.goto(`${url}/#/read/bsb/john/1`);
    await ready(page);
    await page.locator('.strong-token[data-strong-code="G3056"]').first().click();
    await page.locator("#detailContext .word-meaning-trigger").waitFor();
    await checkControls(page, Boolean(profile.touch));
    assert.deepEqual(errors, [], `${profile.name}: browser health`);
    results.push(`${profile.name}: Hebrew/Greek labels, choices, keyboard save/cancel/remove and geometry passed`);
    await context.close();
  }

  // Existing Stable managed state is synthetic and confined to this context.
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto(`${url}/#/read/bsb/psalms/23`);
  await ready(page);
  await page.locator('.strong-token[data-strong-code="H3068"]').first().click();
  await page.locator("#detailContext .word-meaning-trigger").click();
  await page.getByRole("button", { name: "Add alternative wording", exact: true }).click();
  await page.getByRole("textbox", { name: /Alternative wording for/ }).fill("Retain through recovery");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.evaluate(async () => {
    const registryUrl = new URL("./src/physical-pack-registry.js", document.baseURI).href;
    const { BrowserPhysicalPackRegistry } = await import(registryUrl);
    const registry = new BrowserPhysicalPackRegistry();
    await registry.open();
    await registry.setMeta("physical_data_mode", "managed_cache_packs");
    const cache = await caches.open("bibleapp-pack:cleanup-fixture");
    await cache.put("./cleanup-fixture.json", new Response("retained fixture bytes"));
  });
  await page.reload();
  await ready(page);
  await myData(page);
  const before = await exportBackup(page);
  await page.locator(".advanced-backup-options > summary").click();
  await page.locator(".advanced-diagnostics > summary").click();
  await page.getByRole("button", { name: "Use included data", exact: true }).waitFor();
  assert.equal(await page.locator(".physical-pack-manager").count(), 0);
  assert.equal(await page.evaluate(async () => {
    const registryUrl = new URL("./src/physical-pack-registry.js", document.baseURI).href;
    const { BrowserPhysicalPackRegistry } = await import(registryUrl);
    return (await new BrowserPhysicalPackRegistry().open()).getMeta("physical_data_mode");
  }), "managed_cache_packs", "Opening recovery cannot silently change mode");
  await page.getByRole("button", { name: "Use included data", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Your notes and separately saved files were kept" }).waitFor();
  await screenshot(page, "stable-managed-recovery");
  const after = await exportBackup(page);
  for (const key of ["tags", "workspace", "assertions", "polls"]) assert.deepEqual(after.stores[key], before.stores[key], `Recovery preserves ${key}`);
  await page.reload();
  await ready(page);
  await myData(page);
  await page.locator(".advanced-diagnostics > summary").click();
  assert.equal(await page.locator(".pack-recovery").count(), 0);
  assert.deepEqual(await page.evaluate(async () => {
    const registryUrl = new URL("./src/physical-pack-registry.js", document.baseURI).href;
    const { BrowserPhysicalPackRegistry } = await import(registryUrl);
    return { mode: await (await new BrowserPhysicalPackRegistry().open()).getMeta("physical_data_mode"), bytes: await (await (await caches.open("bibleapp-pack:cleanup-fixture")).match("./cleanup-fixture.json")).text() };
  }), { mode: "bundled_static_data", bytes: "retained fixture bytes" });
  await page.goto(`${url}/?profile=lab#/read/bsb/psalms/23`);
  await ready(page);
  await myData(page);
  assert.equal(await page.locator(".physical-pack-manager").count(), 1);
  assert.equal(await page.locator(".study-data-section .user-data-summary-item").count(), 0, "Stable interpretations never leak into Lab");
  results.push("Stable managed recovery: explicit mode change, persisted bytes and study data preserved; Lab manager isolated");
  await context.close();
  console.log(JSON.stringify({ status: "ok", results, zoom: "Viewport checks only; actual browser zoom requires separate acceptance" }, null, 2));
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
