#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolvePort(address.port));
    });
  });
}

async function startServer() {
  const port = await freePort();
  const types = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
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
        "cache-control": "no-store",
        "content-type": types[extname(filePath).toLowerCase()] || "application/octet-stream",
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
  return { server, url: `http://127.0.0.1:${port}/` };
}

function edgePath() {
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Copilot\\Application\\msedge.exe",
  ];
  const path = candidates.find(existsSync);
  if (!path) throw new Error("Could not find Microsoft Edge executable.");
  return path;
}

async function waitReady(page) {
  await page.waitForLoadState("load");
  await page.locator("#showMyData").waitFor({ state: "visible", timeout: 30000 });
  await page.waitForFunction(() => !document.body.textContent.includes("Loading data"), null, { timeout: 30000 });
  await page.waitForFunction(() => Boolean(document.querySelector("#chapterSelect")?.value), null, { timeout: 30000 });
}

async function openManager(page) {
  await page.locator("#showMyData").click();
  const diagnostics = page.locator(".advanced-diagnostics");
  await diagnostics.waitFor({ state: "visible" });
  if (!(await diagnostics.getAttribute("open"))) await diagnostics.locator(":scope > summary").click();
  await page.locator("[data-physical-pack-manager='true']").waitFor({ state: "visible" });
}

async function waitCompleted(page, label) {
  await page.locator(".physical-pack-live-status").filter({ hasText: `${label} completed.` }).waitFor({ state: "visible", timeout: 30000 });
}

function packCard(page, packId) {
  return page.locator(`.physical-pack-card[data-pack-id="${packId}"]`);
}

async function planAndConfirm(page, packId, triggerName, confirmName, completionLabel) {
  const card = packCard(page, packId);
  await card.getByRole("button", { name: triggerName, exact: true }).click();
  const dialog = page.locator(".physical-pack-confirmation:not([hidden])");
  await dialog.waitFor({ state: "visible" });
  await dialog.getByRole("button", { name: confirmName, exact: true }).click();
  await waitCompleted(page, completionLabel);
}

async function registryRecords(page) {
  return page.evaluate(async () => new Promise((resolveRecords, reject) => {
    const request = indexedDB.open("bibleapp-physical-packs", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const tx = database.transaction("pack_records", "readonly");
      const all = tx.objectStore("pack_records").getAll();
      all.onerror = () => reject(all.error);
      all.onsuccess = () => resolveRecords(all.result);
    };
  }));
}

async function assertContained(page, label) {
  const result = await page.evaluate(() => {
    const root = document.documentElement;
    const manager = document.querySelector("[data-physical-pack-manager='true']");
    const rect = manager?.getBoundingClientRect();
    return {
      documentOverflow: root.scrollWidth - root.clientWidth,
      left: rect?.left ?? -1,
      right: rect?.right ?? -1,
      viewport: innerWidth,
      staleLoading: document.body.textContent.includes("Loading data"),
    };
  });
  assert(result.documentOverflow <= 1, `${label} has horizontal document overflow: ${result.documentOverflow}px`);
  assert(result.left >= -1 && result.right <= result.viewport + 1, `${label} physical manager escapes the viewport: left=${result.left}, right=${result.right}, viewport=${result.viewport}`);
  assert(!result.staleLoading, `${label} retained a stale loading state`);
}

const { server, url } = await startServer();
const browser = await chromium.launch({
  executablePath: edgePath(),
  headless: true,
  args: ["--disable-gpu", "--disable-dev-shm-usage", "--disable-background-networking", "--disable-extensions", "--no-first-run"],
});

const browserVersion = browser.version();
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
const httpErrors = [];
const timings = {};

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || "failed"}`));
  page.on("response", (response) => { if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`); });

  await page.goto(`${url}?physicalPackCatalog=data/physical-pack-fixtures/catalog-v1.json#/read/bsb/genesis/1`, { waitUntil: "load" });
  await waitReady(page);
  const readerContext = await page.evaluate(() => ({ hash: location.hash, title: document.title, chapter: document.querySelector("#chapterSelect")?.value }));
  await openManager(page);

  const refresh = page.getByRole("button", { name: "Refresh catalog", exact: true });
  await refresh.click();
  await waitCompleted(page, "Catalog refresh");
  await page.getByRole("button", { name: "Use managed packs", exact: true }).click();
  await waitCompleted(page, "Managed-pack mode");

  const beforePlan = await registryRecords(page);
  const installTrigger = packCard(page, "search-verses").getByRole("button", { name: "Plan install", exact: true });
  await installTrigger.click();
  const dialog = page.locator(".physical-pack-confirmation:not([hidden])");
  await dialog.waitFor({ state: "visible" });
  assert((await dialog.textContent()).includes("Opening or cancelling this plan makes no changes."), "plan must disclose no-mutation cancellation");
  await page.keyboard.press("Escape");
  assert(await installTrigger.evaluate((node) => document.activeElement === node), "Escape must restore focus to the plan trigger");
  assert.deepEqual(await registryRecords(page), beforePlan, "plan cancellation mutated the physical registry");

  await page.locator("#showSearch").click();
  await page.getByRole("heading", { name: "Search unavailable", exact: true }).waitFor();
  assert((await page.locator(".physical-pack-unavailable").textContent()).includes("Ordinary scripture reading remains available"), "Search unavailable state lacks safe reader guidance");
  await openManager(page);

  const installStarted = performance.now();
  await planAndConfirm(page, "search-verses", "Plan install", "Install Search", "Search install");
  timings.install_search_ms = Math.round(performance.now() - installStarted);
  await planAndConfirm(page, "commentary-verse-index", "Plan install", "Install Commentary", "Commentary install");
  assert((await packCard(page, "search-verses").locator(".physical-pack-state").textContent()).match(/State: (active|rollback available)/), "Search did not activate");
  assert((await packCard(page, "commentary-verse-index").locator(".physical-pack-state").textContent()).includes("State: active"), "Commentary did not activate");

  const reloadStarted = performance.now();
  await page.reload({ waitUntil: "load" });
  await waitReady(page);
  timings.reload_persistence_ms = Math.round(performance.now() - reloadStarted);
  await openManager(page);
  assert((await packCard(page, "search-verses").locator(".physical-pack-state").textContent()).match(/State: (active|rollback available)/), "Search activation did not persist across reload");
  assert((await packCard(page, "commentary-verse-index").locator(".physical-pack-state").textContent()).includes("State: active"), "Commentary activation did not persist across reload");

  await context.setOffline(true);
  const offlineStarted = performance.now();
  const offline = await page.evaluate(async () => {
    const service = await import(`./src/${"data-service.js"}?v=pr13-live-qa-20260711e`);
    const search = await service.fetchJson("./data/search/manifest.json");
    const commentary = await service.fetchJson("./data/commentaries/verses/genesis.json");
    return { searchVersion: search?.version, commentaryVersion: commentary?.version };
  });
  timings.offline_managed_read_ms = Math.round(performance.now() - offlineStarted);
  assert.deepEqual(offline, { searchVersion: 1, commentaryVersion: 1 }, "offline managed reads did not resolve both fixtures");
  await context.setOffline(false);

  await page.evaluate(async () => {
    const record = await new Promise((resolveRecord, reject) => {
      const request = indexedDB.open("bibleapp-physical-packs", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const tx = request.result.transaction("pack_records", "readonly");
        const get = tx.objectStore("pack_records").get("search-verses");
        get.onerror = () => reject(get.error);
        get.onsuccess = () => resolveRecord(get.result);
      };
    });
    const cache = await caches.open(record.active_cache);
    await cache.delete(new URL("data/search/manifest.json", document.baseURI).href);
  });
  await packCard(page, "search-verses").getByRole("button", { name: "Verify", exact: true }).click();
  const verifyDialog = page.locator(".physical-pack-confirmation:not([hidden])");
  await verifyDialog.waitFor({ state: "visible" });
  await verifyDialog.getByRole("button", { name: "Verify Search", exact: true }).click();
  await page.locator(".physical-pack-live-status").filter({ hasText: "Search verify failed:" }).waitFor({ state: "visible", timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('.physical-pack-card[data-pack-id="search-verses"] .physical-pack-state')?.textContent.includes("State: corrupt"));
  await planAndConfirm(page, "search-verses", "Plan repair", "Repair Search", "Search repair");

  const catalogInput = page.locator(".physical-pack-catalog-controls input");
  await catalogInput.fill("data/physical-pack-fixtures/catalog-v2.json");
  await page.getByRole("button", { name: "Refresh catalog", exact: true }).click();
  await waitCompleted(page, "Catalog refresh");
  assert((await packCard(page, "search-verses").locator(".physical-pack-state").textContent()).includes("State: update available"), "fixture update was not detected");
  const updateStarted = performance.now();
  await planAndConfirm(page, "search-verses", "Plan update", "Update Search", "Search update");
  timings.update_search_ms = Math.round(performance.now() - updateStarted);
  assert((await packCard(page, "search-verses").locator(".physical-pack-state").textContent()).includes("State: rollback available"), "updated Search did not retain rollback");
  await planAndConfirm(page, "search-verses", "Plan rollback", "Rollback Search", "Search rollback");
  assert((await packCard(page, "search-verses").locator(".physical-pack-state").textContent()).includes("fixture-v1"), "rollback did not restore fixture-v1");

  await planAndConfirm(page, "commentary-verse-index", "Plan removal", "Remove Commentary", "Commentary remove");
  await planAndConfirm(page, "search-verses", "Plan removal", "Remove Search", "Search remove");
  assert((await packCard(page, "search-verses").locator(".physical-pack-state").textContent()).includes("not installed"), "Search removal did not clear active state");
  await page.getByRole("button", { name: "Use bundled data", exact: true }).click();
  await waitCompleted(page, "Bundled-data mode");
  await page.locator("#showSearch").click();
  await page.locator(".search-form").waitFor({ state: "visible" });

  const finalReaderContext = await page.evaluate(() => ({ hash: location.hash, title: document.title, chapter: document.querySelector("#chapterSelect")?.value }));
  assert.deepEqual(finalReaderContext, readerContext, "physical-pack operations changed the reader route or chapter context");
  await openManager(page);

  const initialTheme = await page.locator("html").getAttribute("data-theme");
  await page.locator("#themeToggle").click();
  const toggledTheme = await page.locator("html").getAttribute("data-theme");
  assert(toggledTheme !== initialTheme, "theme toggle did not change the manager theme");
  await page.locator("#themeToggle").click();
  await page.emulateMedia({ reducedMotion: "reduce" });

  const viewports = [
    [1280, 720, "desktop"],
    [900, 1100, "portrait"],
    [700, 900, "narrow"],
    [390, 844, "mobile-width"],
  ];
  for (const [width, height, label] of viewports) {
    await page.setViewportSize({ width, height });
    await page.reload({ waitUntil: "load" });
    await waitReady(page);
    await openManager(page);
    await assertContained(page, label);
  }

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
    colorScheme: "dark",
  });
  const mobilePage = await mobileContext.newPage();
  mobilePage.on("console", (message) => { if (message.type() === "error") consoleErrors.push(`mobile: ${message.text()}`); });
  mobilePage.on("pageerror", (error) => pageErrors.push(`mobile: ${error.message}`));
  mobilePage.on("requestfailed", (request) => failedRequests.push(`mobile: ${request.method()} ${request.url()} ${request.failure()?.errorText || "failed"}`));
  mobilePage.on("response", (response) => { if (response.status() >= 400) httpErrors.push(`mobile: ${response.status()} ${response.url()}`); });
  await mobilePage.goto(url, { waitUntil: "load" });
  await waitReady(mobilePage);
  await openManager(mobilePage);
  await assertContained(mobilePage, "mobile-device");
  await mobileContext.close();
  await context.close();

  assert.equal(consoleErrors.length, 0, `console errors: ${consoleErrors.join(" | ")}`);
  assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join(" | ")}`);
  assert.equal(failedRequests.length, 0, `failed app requests: ${failedRequests.join(" | ")}`);
  assert.equal(httpErrors.length, 0, `HTTP errors: ${httpErrors.join(" | ")}`);

  console.log(JSON.stringify({
    browser: `Microsoft Edge ${browserVersion}`,
    fixtures: ["Search fixture-v1/v2", "Commentary fixture-v1"],
    lifecycle: ["plan-cancel", "install", "activation", "reload", "offline-read", "corruption", "repair", "update", "rollback", "remove", "bundled-fallback"],
    accessibility: ["Escape focus restoration", "progress status", "light/dark", "reduced motion"],
    viewports: viewports.map(([width, height, label]) => ({ label, width, height })).concat([{ label: "mobile-device", width: 390, height: 844 }]),
    timings,
    console_errors: consoleErrors.length,
    page_errors: pageErrors.length,
    failed_requests: failedRequests.length,
    http_errors: httpErrors.length,
  }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
