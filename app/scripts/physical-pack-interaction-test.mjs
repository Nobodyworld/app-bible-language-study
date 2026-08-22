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

async function captureReaderContext(page, { prepare = false } = {}) {
  if (prepare) {
    await page.evaluate(() => {
      const detail = document.querySelector("#detailContent");
      if (detail) detail.scrollTop = Math.min(120, Math.max(0, detail.scrollHeight - detail.clientHeight));
      const selected = document.querySelector(".reader-context-word, .reader-context-verse");
      if (selected) {
        const rect = selected.getBoundingClientRect();
        window.scrollBy(0, rect.top - 240);
      }
    });
    await page.waitForTimeout(50);
  }
  return page.evaluate(() => {
    const selectedWord = document.querySelector(".reader-context-word");
    const selectedVerse = selectedWord?.closest(".verse-row") || document.querySelector(".reader-context-verse");
    return {
      route: location.hash,
      chapter: document.querySelector("#chapterSelect")?.value || "",
      selected_word: selectedWord ? {
        strong_code: selectedWord.dataset.strongCode || "",
        token_index: selectedWord.dataset.tokenIndex || "",
        interlinear_key: selectedWord.dataset.interlinearKey || "",
        text: selectedWord.textContent.trim(),
      } : null,
      selected_verse: selectedVerse?.dataset.verse || "",
      highlighted_words: [...document.querySelectorAll(".reader-context-word")].map((node) => `${node.dataset.strongCode || ""}:${node.dataset.tokenIndex || ""}`),
      highlighted_verses: [...document.querySelectorAll(".reader-context-verse")].map((node) => node.dataset.verse || node.id),
      reader_scroll: window.scrollY,
      detail_title: document.querySelector("#detailTitle")?.textContent || "",
      detail_back_disabled: document.querySelector("#detailBack")?.disabled,
      detail_forward_disabled: document.querySelector("#detailForward")?.disabled,
      detail_history_length: history.length,
      panel_mode: document.querySelector(".detail-pane")?.dataset.panelMode || "",
      hover_locked: document.querySelector(".detail-pane")?.dataset.hoverLocked || "",
      detail_scroll: document.querySelector("#detailContent")?.scrollTop || 0,
    };
  });
}

async function assertReaderContextPreserved(page, before, label) {
  const after = await captureReaderContext(page);
  for (const key of ["route", "chapter", "selected_word", "selected_verse", "highlighted_words", "highlighted_verses", "detail_title", "detail_back_disabled", "detail_forward_disabled", "detail_history_length", "panel_mode", "hover_locked"]) {
    assert.deepEqual(after[key], before[key], `${label} changed ${key}: ${JSON.stringify({ before: before[key], after: after[key] })}`);
  }
  assert(Math.abs(after.reader_scroll - before.reader_scroll) <= 6, `${label} changed reader scroll: ${JSON.stringify({ before: before.reader_scroll, after: after.reader_scroll })}`);
  assert(Math.abs(after.detail_scroll - before.detail_scroll) <= 4, `${label} changed detail scroll: ${JSON.stringify({ before: before.detail_scroll, after: after.detail_scroll })}`);
  return after;
}

async function delayNextStartupVerification(page, milliseconds = 6000) {
  await page.evaluate((delay) => sessionStorage.setItem("bibleapp:test:physical-pack-verification-delay", String(delay)), milliseconds);
}

async function seedCorruptRollbackClaim(page) {
  return page.evaluate(async () => {
    const database = await new Promise((resolveDatabase, reject) => {
      const request = indexedDB.open("bibleapp-physical-packs", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolveDatabase(request.result);
    });
    const record = await new Promise((resolveRecord, reject) => {
      const tx = database.transaction("pack_records", "readonly");
      const get = tx.objectStore("pack_records").get("search-verses");
      get.onerror = () => reject(get.error);
      get.onsuccess = () => resolveRecord(get.result);
    });
    const rollbackCacheName = `bibleapp-pack:test-invalid-rollback:${Date.now()}`;
    const activeCache = await caches.open(record.active_cache);
    const rollbackCache = await caches.open(rollbackCacheName);
    for (const request of await activeCache.keys()) {
      await rollbackCache.put(request, await activeCache.match(request));
    }
    const manifestUrl = new URL("data/search/manifest.json", document.baseURI).href;
    await rollbackCache.put(manifestUrl, new Response("{}", { headers: { "content-type": "application/json" } }));
    const rollback = {
      pack_version: record.pack_version,
      manifest_sha256: record.manifest_sha256,
      aggregate_sha256: record.aggregate_sha256,
      cache: rollbackCacheName,
      manifest: record.active_manifest,
      verified_files: record.verified_files,
      verified_bytes: record.verified_bytes,
      activated_at: record.activated_at,
    };
    await new Promise((resolvePut, reject) => {
      const tx = database.transaction("pack_records", "readwrite");
      const put = tx.objectStore("pack_records").put({
        ...record,
        state: "rollback_available",
        rollback_cache: rollbackCacheName,
        rollback,
        last_failure: null,
      });
      put.onerror = () => reject(put.error);
      tx.oncomplete = resolvePut;
      tx.onerror = () => reject(tx.error);
    });
    database.close();
    return rollbackCacheName;
  });
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
  await page.addInitScript(() => {
    const delay = Number(sessionStorage.getItem("bibleapp:test:physical-pack-verification-delay") || 0);
    sessionStorage.removeItem("bibleapp:test:physical-pack-verification-delay");
    if (delay > 0) globalThis.__BIBLEAPP_TEST_PHYSICAL_PACK_VERIFICATION_DELAY_MS__ = delay;
  });
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || "failed"}`));
  page.on("response", (response) => { if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`); });

  await page.goto(`${url}?physicalPackCatalog=data/physical-pack-fixtures/catalog-v1.json#/read/bsb/genesis/1`, { waitUntil: "load" });
  await waitReady(page);
  await page.locator(".strong-token[data-strong-code]").first().click();
  await page.waitForFunction(() => document.querySelector(".detail-pane")?.dataset.panelMode === "locked");
  await openManager(page);

  const refresh = page.getByRole("button", { name: "Refresh catalog", exact: true });
  await refresh.click();
  await waitCompleted(page, "Catalog refresh");
  await page.getByRole("button", { name: "Use managed packs", exact: true }).click();
  await waitCompleted(page, "Managed-pack mode");

  const managedCapabilities = await page.evaluate(async () => {
    const { resolveCapability } = await import("/src/capabilities.js");
    const [packageManifest, distributionManifest] = await Promise.all([
      fetch("./data/package-manifest.json").then((response) => response.json()),
      fetch("./data/distribution-manifest.json").then((response) => response.json()),
    ]);
    return Object.fromEntries(
      ["crossrefs", "outlines", "strongs-overlay", "lexicon-language-metadata", "interlinear", "graph-word-map-analysis", "search", "commentary"].map((capabilityId) => [
        capabilityId,
        resolveCapability(packageManifest, {}, capabilityId, {
          physicalDataMode: "managed_cache_packs",
          physicalRecords: [],
          distributionManifest,
        }),
      ]),
    );
  });
  for (const capabilityId of ["crossrefs", "outlines", "strongs-overlay", "lexicon-language-metadata", "interlinear", "graph-word-map-analysis"]) {
    assert.equal(managedCapabilities[capabilityId].state, "available", `${capabilityId} was disabled by managed mode`);
    assert.equal(managedCapabilities[capabilityId].runtime_source, "bundled", `${capabilityId} did not remain bundled`);
  }
  assert.equal(managedCapabilities.search.runtime_source, "bundled_fallback");
  assert.equal(managedCapabilities.commentary.runtime_source, "bundled_fallback");

  const beforePlan = await registryRecords(page);
  const installTrigger = packCard(page, "search-verses").getByRole("button", { name: "Plan install", exact: true });
  await installTrigger.scrollIntoViewIfNeeded();
  let lifecycleReaderContext = await captureReaderContext(page);
  await installTrigger.click();
  const dialog = page.locator(".physical-pack-confirmation:not([hidden])");
  await dialog.waitFor({ state: "visible" });
  const installPlanText = await dialog.textContent();
  assert(installPlanText.includes("Storage usage"), "plan must show storage usage");
  assert(installPlanText.includes("available"), "plan must show available storage");
  assert(installPlanText.includes("required raw bytes"), "plan must show required raw bytes");
  assert(installPlanText.includes("Opening or cancelling this plan makes no changes."), "plan must disclose no-mutation cancellation");
  await page.keyboard.press("Escape");
  assert(await installTrigger.evaluate((node) => document.activeElement === node), "Escape must restore focus to the plan trigger");
  assert.deepEqual(await registryRecords(page), beforePlan, "plan cancellation mutated the physical registry");
  await assertReaderContextPreserved(page, lifecycleReaderContext, "install planning and Escape cancellation");

  await page.locator("#showSearch").click();
  await page.locator(".search-form").waitFor({ state: "visible" });
  const preinstallSource = await page.evaluate(async () => {
    const service = await import(`./src/${"data-service.js"}?v=pr13-live-qa-20260711e`);
    await service.fetchSearchManifest();
    return service.physicalDataSource("./data/search/manifest.json");
  });
  assert.equal(preinstallSource.runtime_source, "bundled_fallback", "managed Search without a pack did not identify bundled fallback");
  await openManager(page);
  await packCard(page, "search-verses").getByRole("button", { name: "Plan install", exact: true }).scrollIntoViewIfNeeded();
  lifecycleReaderContext = await captureReaderContext(page);

  const installStarted = performance.now();
  await planAndConfirm(page, "search-verses", "Plan install", "Install Search", "Search install");
  timings.install_search_ms = Math.round(performance.now() - installStarted);
  await assertReaderContextPreserved(page, lifecycleReaderContext, "Search installation");
  await packCard(page, "commentary-verse-index").getByRole("button", { name: "Plan install", exact: true }).scrollIntoViewIfNeeded();
  lifecycleReaderContext = await captureReaderContext(page);
  await planAndConfirm(page, "commentary-verse-index", "Plan install", "Install Commentary", "Commentary install");
  assert((await packCard(page, "search-verses").locator(".physical-pack-state").textContent()).match(/State: (active|rollback available)/), "Search did not activate");
  assert((await packCard(page, "commentary-verse-index").locator(".physical-pack-state").textContent()).includes("State: active"), "Commentary did not activate");
  await assertReaderContextPreserved(page, lifecycleReaderContext, "Commentary installation");

  await delayNextStartupVerification(page);
  const reloadStarted = performance.now();
  await page.reload({ waitUntil: "load" });
  await waitReady(page);
  await page.locator(".strong-token[data-strong-code]").first().click();
  await page.waitForFunction(() => document.querySelector(".detail-pane")?.dataset.panelMode === "locked");
  await openManager(page);
  await page.waitForFunction(() => document.querySelector('.physical-pack-card[data-pack-id="search-verses"] .physical-pack-state')?.textContent.includes("State: startup verifying"));
  const verifyingCard = packCard(page, "search-verses");
  assert((await verifyingCard.locator(".physical-pack-verification-status").textContent()).includes("unavailable"));
  for (const action of ["Verify", "Plan update", "Plan repair", "Plan rollback", "Plan removal"]) {
    assert.equal(await verifyingCard.getByRole("button", { name: action, exact: true }).count(), 0, `${action} was exposed during startup verification`);
  }
  await page.evaluate(() => {
    const current = document.querySelector("[data-physical-pack-manager='true']");
    globalThis.__removedPhysicalManager = current;
    globalThis.__removedPhysicalManagerUpdates = 0;
    current.addEventListener("bibleapp:physical-pack-snapshot", () => { globalThis.__removedPhysicalManagerUpdates += 1; });
  });
  await openManager(page);
  await page.evaluate(() => {
    const current = document.querySelector("[data-physical-pack-manager='true']");
    globalThis.__mountedPhysicalManagerUpdates = 0;
    current.addEventListener("bibleapp:physical-pack-snapshot", () => { globalThis.__mountedPhysicalManagerUpdates += 1; });
  });
  await page.getByRole("button", { name: "Use bundled data", exact: true }).focus();
  lifecycleReaderContext = await captureReaderContext(page, { prepare: true });
  await page.waitForFunction(() => document.querySelector('.physical-pack-card[data-pack-id="search-verses"] .physical-pack-state')?.textContent.includes("State: active"), null, { timeout: 15000 });
  assert((await packCard(page, "search-verses").locator(".physical-pack-runtime-source").textContent()).includes("verified managed pack"));
  assert.equal(await packCard(page, "search-verses").getByRole("button", { name: "Verify", exact: true }).count(), 1, "Verify did not appear after startup verification");
  assert.equal(await packCard(page, "search-verses").getByRole("button", { name: "Plan removal", exact: true }).count(), 1, "Remove did not appear after startup verification");
  assert(await page.getByRole("button", { name: "Use bundled data", exact: true }).evaluate((node) => document.activeElement === node), "live startup update did not preserve focus");
  await assertReaderContextPreserved(page, lifecycleReaderContext, "delayed startup live update");
  const liveUpdateCounts = await page.evaluate(() => ({
    removed: globalThis.__removedPhysicalManagerUpdates,
    mounted: globalThis.__mountedPhysicalManagerUpdates,
    mountedManagers: document.querySelectorAll("[data-physical-pack-manager='true']").length,
  }));
  assert.deepEqual(liveUpdateCounts, { removed: 0, mounted: 1, mountedManagers: 1 }, "mounted-manager updates leaked or duplicated");
  timings.reload_persistence_ms = Math.round(performance.now() - reloadStarted);
  assert((await packCard(page, "search-verses").locator(".physical-pack-state").textContent()).match(/State: (active|rollback available)/), "Search activation did not persist across reload");
  assert((await packCard(page, "commentary-verse-index").locator(".physical-pack-state").textContent()).includes("State: active"), "Commentary activation did not persist across reload");
  lifecycleReaderContext = await captureReaderContext(page, { prepare: true });

  await context.setOffline(true);
  const offlineStarted = performance.now();
  const offline = await page.evaluate(async () => {
    const service = await import(`./src/${"data-service.js"}?v=pr13-live-qa-20260711e`);
    const search = await service.fetchJson("./data/search/manifest.json");
    const commentary = await service.fetchJson("./data/commentaries/verses/genesis.json");
    return {
      searchVersion: search?.version,
      commentaryVersion: commentary?.version,
      searchSource: service.physicalDataSource("./data/search/manifest.json")?.runtime_source,
      commentarySource: service.physicalDataSource("./data/commentaries/verses/genesis.json")?.runtime_source,
    };
  });
  timings.offline_managed_read_ms = Math.round(performance.now() - offlineStarted);
  assert.deepEqual(offline, { searchVersion: 1, commentaryVersion: 1, searchSource: "managed_pack", commentarySource: "managed_pack" }, "offline managed reads did not resolve both fixtures");
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
  await page.reload({ waitUntil: "load" });
  await waitReady(page);
  await openManager(page);
  await page.waitForFunction(() => document.querySelector('.physical-pack-card[data-pack-id="search-verses"] .physical-pack-state')?.textContent.includes("State: repair required"));
  const beforeRepairPlan = await registryRecords(page);
  const repairTrigger = packCard(page, "search-verses").getByRole("button", { name: "Plan repair", exact: true });
  await repairTrigger.scrollIntoViewIfNeeded();
  lifecycleReaderContext = await captureReaderContext(page);
  await repairTrigger.click();
  const repairDialog = page.locator(".physical-pack-confirmation:not([hidden])");
  await repairDialog.waitFor({ state: "visible" });
  const repairText = await repairDialog.textContent();
  for (const expected of ["raw", "transferred", "Current version: fixture-v1", "Target version: fixture-v1", "Storage usage", "required raw bytes"]) {
    assert(repairText.includes(expected), `repair plan omitted ${expected}`);
  }
  await page.keyboard.press("Escape");
  assert(await repairTrigger.evaluate((node) => document.activeElement === node), "repair Escape must restore focus");
  assert.deepEqual(await registryRecords(page), beforeRepairPlan, "repair planning mutated the registry");
  await assertReaderContextPreserved(page, lifecycleReaderContext, "repair planning and Escape cancellation");
  await planAndConfirm(page, "search-verses", "Plan repair", "Repair Search", "Search repair");
  await assertReaderContextPreserved(page, lifecycleReaderContext, "missing-file repair");

  const mutateActiveSearch = async (mode) => page.evaluate(async (mutationMode) => {
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
    const key = new URL("data/search/manifest.json", document.baseURI).href;
    const original = new Uint8Array(await (await cache.match(key)).arrayBuffer());
    const bytes = mutationMode === "length"
      ? new TextEncoder().encode("{}")
      : (() => { const copy = new Uint8Array(original); copy[0] = copy[0] === 123 ? 91 : 123; return copy; })();
    await cache.put(key, new Response(bytes, { headers: { "content-type": "application/json" } }));
  }, mode);

  for (const corruptionKind of ["digest", "length"]) {
    await mutateActiveSearch(corruptionKind);
    await page.reload({ waitUntil: "load" });
    await waitReady(page);
    await openManager(page);
    await page.waitForFunction(() => document.querySelector('.physical-pack-card[data-pack-id="search-verses"] .physical-pack-state')?.textContent.includes("State: corrupt"));
    await packCard(page, "search-verses").getByRole("button", { name: "Plan repair", exact: true }).scrollIntoViewIfNeeded();
    lifecycleReaderContext = await captureReaderContext(page);
    await planAndConfirm(page, "search-verses", "Plan repair", "Repair Search", "Search repair");
    await assertReaderContextPreserved(page, lifecycleReaderContext, `${corruptionKind} corruption repair`);
  }

  const catalogInput = page.locator(".physical-pack-catalog-controls input");
  await catalogInput.fill("data/physical-pack-fixtures/catalog-v2.json");
  await page.getByRole("button", { name: "Refresh catalog", exact: true }).click();
  await waitCompleted(page, "Catalog refresh");
  assert((await packCard(page, "search-verses").locator(".physical-pack-state").textContent()).includes("State: update available"), "fixture update was not detected");
  await packCard(page, "search-verses").getByRole("button", { name: "Plan update", exact: true }).scrollIntoViewIfNeeded();
  lifecycleReaderContext = await captureReaderContext(page);
  const updateStarted = performance.now();
  await planAndConfirm(page, "search-verses", "Plan update", "Update Search", "Search update");
  timings.update_search_ms = Math.round(performance.now() - updateStarted);
  assert((await packCard(page, "search-verses").locator(".physical-pack-state").textContent()).includes("State: rollback available"), "updated Search did not retain rollback");
  await assertReaderContextPreserved(page, lifecycleReaderContext, "Search update");

  await page.evaluate(async () => {
    const record = await new Promise((resolveRecord, reject) => {
      const request = indexedDB.open("bibleapp-physical-packs", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const get = request.result.transaction("pack_records", "readonly").objectStore("pack_records").get("search-verses");
        get.onerror = () => reject(get.error);
        get.onsuccess = () => resolveRecord(get.result);
      };
    });
    await caches.delete(record.active_cache);
  });
  await page.reload({ waitUntil: "load" });
  await waitReady(page);
  await openManager(page);
  await page.waitForFunction(() => {
    const text = document.querySelector('.physical-pack-card[data-pack-id="search-verses"] .physical-pack-state')?.textContent || "";
    return text.includes("fixture-v1") && text.includes("update available");
  });
  await packCard(page, "search-verses").getByRole("button", { name: "Plan update", exact: true }).scrollIntoViewIfNeeded();
  lifecycleReaderContext = await captureReaderContext(page);
  await planAndConfirm(page, "search-verses", "Plan update", "Update Search", "Search update");
  assert((await packCard(page, "search-verses").locator(".physical-pack-state").textContent()).includes("fixture-v2"), "valid rollback recovery could not update back to fixture-v2");

  await page.evaluate(async () => {
    const record = await new Promise((resolveRecord, reject) => {
      const request = indexedDB.open("bibleapp-physical-packs", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const get = request.result.transaction("pack_records", "readonly").objectStore("pack_records").get("search-verses");
        get.onerror = () => reject(get.error);
        get.onsuccess = () => resolveRecord(get.result);
      };
    });
    const cache = await caches.open(record.rollback.cache);
    await cache.delete(new URL("data/search/manifest.json", document.baseURI).href);
  });
  const rollbackTrigger = packCard(page, "search-verses").getByRole("button", { name: "Plan rollback", exact: true });
  await rollbackTrigger.scrollIntoViewIfNeeded();
  lifecycleReaderContext = await captureReaderContext(page);
  await rollbackTrigger.click();
  const rollbackDialog = page.locator(".physical-pack-confirmation:not([hidden])");
  await rollbackDialog.getByRole("button", { name: "Rollback Search", exact: true }).click();
  await page.locator(".physical-pack-live-status").filter({ hasText: "Search rollback failed:" }).waitFor({ state: "visible", timeout: 30000 });
  assert((await packCard(page, "search-verses").locator(".physical-pack-state").textContent()).includes("fixture-v2"), "invalid rollback changed the active pointer");
  assert.equal(await packCard(page, "search-verses").getByRole("button", { name: "Plan rollback", exact: true }).count(), 0, "invalid rollback authority remained actionable");
  const explicitRollbackFailureRecord = (await registryRecords(page)).find((record) => record.pack_id === "search-verses");
  assert.equal(explicitRollbackFailureRecord.rollback, null);
  assert.equal(explicitRollbackFailureRecord.rollback_cache, null);
  const activeAfterRollbackFailure = await page.evaluate(async () => {
    const service = await import(`./src/${"data-service.js"}?v=pr13-live-qa-20260711e`);
    const manifest = await service.fetchJson("./data/search/manifest.json");
    return { version: manifest.version, source: service.physicalDataSource("./data/search/manifest.json")?.runtime_source };
  });
  assert.deepEqual(activeAfterRollbackFailure, { version: 2, source: "managed_pack" });
  await assertReaderContextPreserved(page, lifecycleReaderContext, "invalid rollback rejection");

  const seededInvalidRollbackCache = await seedCorruptRollbackClaim(page);
  await delayNextStartupVerification(page);
  await page.reload({ waitUntil: "load" });
  await waitReady(page);
  await page.locator(".strong-token[data-strong-code]").first().click();
  await page.waitForFunction(() => document.querySelector(".detail-pane")?.dataset.panelMode === "locked");
  await openManager(page);
  await page.waitForFunction(() => document.querySelector('.physical-pack-card[data-pack-id="search-verses"] .physical-pack-state')?.textContent.includes("State: startup verifying"));
  assert.equal(await packCard(page, "search-verses").getByRole("button", { name: "Plan rollback", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Use bundled data", exact: true }).focus();
  lifecycleReaderContext = await captureReaderContext(page, { prepare: true });
  await page.waitForFunction(() => {
    const card = document.querySelector('.physical-pack-card[data-pack-id="search-verses"]');
    return card?.querySelector(".physical-pack-state")?.textContent.includes("State: active") &&
      card?.querySelector(".physical-pack-failure")?.textContent.includes("Retained rollback copy was removed");
  }, null, { timeout: 15000 });
  assert.equal(await packCard(page, "search-verses").getByRole("button", { name: "Plan rollback", exact: true }).count(), 0, "lost rollback action returned after startup reconciliation");
  assert((await packCard(page, "search-verses").locator(".physical-pack-runtime-source").textContent()).includes("verified managed pack"));
  assert((await page.locator(".physical-pack-history").textContent()).includes("startup-reconcile failed"), "rollback-loss history did not update live");
  assert(!(await page.evaluate(() => caches.keys())).includes(seededInvalidRollbackCache), "invalid rollback cache was not removed");
  await assertReaderContextPreserved(page, lifecycleReaderContext, "live invalid-rollback reconciliation");

  await packCard(page, "commentary-verse-index").getByRole("button", { name: "Plan removal", exact: true }).scrollIntoViewIfNeeded();
  lifecycleReaderContext = await captureReaderContext(page);
  await planAndConfirm(page, "commentary-verse-index", "Plan removal", "Remove Commentary", "Commentary remove");
  await assertReaderContextPreserved(page, lifecycleReaderContext, "Commentary removal");
  await packCard(page, "search-verses").getByRole("button", { name: "Plan removal", exact: true }).scrollIntoViewIfNeeded();
  lifecycleReaderContext = await captureReaderContext(page);
  await planAndConfirm(page, "search-verses", "Plan removal", "Remove Search", "Search remove");
  assert((await packCard(page, "search-verses").locator(".physical-pack-state").textContent()).includes("not installed"), "Search removal did not clear active state");
  assert((await packCard(page, "search-verses").locator(".physical-pack-runtime-source").textContent()).includes("bundled fallback"), "Search removal did not expose bundled fallback in managed mode");
  await assertReaderContextPreserved(page, lifecycleReaderContext, "Search removal");
  await page.locator("#showSearch").click();
  await page.locator(".search-form").waitFor({ state: "visible" });
  const removedSource = await page.evaluate(async () => {
    const service = await import(`./src/${"data-service.js"}?v=pr13-live-qa-20260711e`);
    await service.fetchSearchManifest();
    return service.physicalDataSource("./data/search/manifest.json");
  });
  assert.equal(removedSource.runtime_source, "bundled_fallback", "removed Search did not resolve bundled fallback");
  assert.equal(await page.locator("#chapterSelect").inputValue(), "1", "physical lifecycle changed the reader chapter");
  assert.equal(new URL(page.url()).hash, "#/read/bsb/genesis/1", "physical lifecycle changed the reader route");
  await openManager(page);

  const initialTheme = await page.locator("html").getAttribute("data-theme");
  await page.locator("#themeToggle").click();
  const toggledTheme = await page.locator("html").getAttribute("data-theme");
  assert(toggledTheme !== initialTheme, "theme toggle did not change the manager theme");
  await page.locator("#themeToggle").click();
  await page.emulateMedia({ reducedMotion: "reduce" });

  const strictCapabilityStates = await page.evaluate(async () => {
    const { resolveCapability } = await import("/src/capabilities.js");
    const [packageManifest, distributionManifest] = await Promise.all([
      fetch("./data/package-manifest.json").then((response) => response.json()),
      fetch("./data/distribution-manifest.json").then((response) => response.json()),
    ]);
    const strict = { ...distributionManifest, bundled_fallback: false };
    const baseRecord = {
      pack_id: "search-verses",
      state: "active",
      active_cache: "test-cache",
      expected_files: 1,
      verified_files: 1,
      expected_bytes: 1,
      verified_bytes: 1,
      active_manifest: { dependencies: [] },
    };
    const resolve = (capabilityId, physicalRecords = [], packageStore = {}) => resolveCapability(packageManifest, packageStore, capabilityId, {
      physicalDataMode: "managed_cache_packs",
      physicalRecords,
      distributionManifest: strict,
    }).state;
    return {
      not_installed: resolve("search"),
      disabled: resolve("search", [], { disabled_capability_ids: ["search"] }),
      incompatible_version: resolve("search", [{ ...baseRecord, state: "incompatible" }]),
      corrupt: resolve("search", [{ ...baseRecord, state: "corrupt" }]),
      load_failed: resolve("search", [{ ...baseRecord, state: "failed" }]),
      dependency_missing: resolve("commentary", [{
        ...baseRecord,
        pack_id: "commentary-verse-index",
        active_manifest: { dependencies: ["search-verses"] },
      }]),
    };
  });
  assert.deepEqual(strictCapabilityStates, {
    not_installed: "not_installed",
    disabled: "disabled",
    incompatible_version: "incompatible_version",
    corrupt: "corrupt",
    load_failed: "load_failed",
    dependency_missing: "dependency_missing",
  });

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

  const quotaContext = await browser.newContext({ viewport: { width: 900, height: 900 } });
  await quotaContext.addInitScript(() => {
    Object.defineProperty(navigator.storage, "estimate", { configurable: true, value: async () => ({ usage: 999, quota: 1000 }) });
  });
  const quotaPage = await quotaContext.newPage();
  quotaPage.on("console", (message) => { if (message.type() === "error") consoleErrors.push(`quota: ${message.text()}`); });
  quotaPage.on("pageerror", (error) => pageErrors.push(`quota: ${error.message}`));
  quotaPage.on("requestfailed", (request) => failedRequests.push(`quota: ${request.method()} ${request.url()} ${request.failure()?.errorText || "failed"}`));
  quotaPage.on("response", (response) => { if (response.status() >= 400) httpErrors.push(`quota: ${response.status()} ${response.url()}`); });
  await quotaPage.goto(`${url}?physicalPackCatalog=data/physical-pack-fixtures/catalog-v1.json`, { waitUntil: "load" });
  await waitReady(quotaPage);
  await openManager(quotaPage);
  await quotaPage.getByRole("button", { name: "Refresh catalog", exact: true }).click();
  await waitCompleted(quotaPage, "Catalog refresh");
  const quotaRecordsBefore = await registryRecords(quotaPage);
  const quotaCachesBefore = await quotaPage.evaluate(() => caches.keys());
  await packCard(quotaPage, "search-verses").getByRole("button", { name: "Plan install", exact: true }).click();
  const quotaDialog = quotaPage.locator(".physical-pack-confirmation:not([hidden])");
  assert((await quotaDialog.textContent()).includes("approximately 1 B available"), "quota plan did not disclose available storage");
  await quotaDialog.getByRole("button", { name: "Install Search", exact: true }).click();
  await quotaPage.locator(".physical-pack-live-status").filter({ hasText: "Search install failed:" }).waitFor({ state: "visible", timeout: 30000 });
  assert((await quotaPage.locator(".physical-pack-live-status").textContent()).includes("requires"), "quota failure was not structured and visible");
  assert.deepEqual(await registryRecords(quotaPage), quotaRecordsBefore, "insufficient quota mutated registry state");
  assert.deepEqual(await quotaPage.evaluate(() => caches.keys()), quotaCachesBefore, "insufficient quota created staging cache storage");
  await quotaContext.close();

  const unknownStorageContext = await browser.newContext({ viewport: { width: 900, height: 900 } });
  await unknownStorageContext.addInitScript(() => {
    Object.defineProperty(navigator.storage, "estimate", { configurable: true, value: async () => { throw new Error("estimate unavailable"); } });
  });
  const unknownStoragePage = await unknownStorageContext.newPage();
  unknownStoragePage.on("console", (message) => { if (message.type() === "error") consoleErrors.push(`unknown-storage: ${message.text()}`); });
  unknownStoragePage.on("pageerror", (error) => pageErrors.push(`unknown-storage: ${error.message}`));
  unknownStoragePage.on("requestfailed", (request) => failedRequests.push(`unknown-storage: ${request.method()} ${request.url()} ${request.failure()?.errorText || "failed"}`));
  unknownStoragePage.on("response", (response) => { if (response.status() >= 400) httpErrors.push(`unknown-storage: ${response.status()} ${response.url()}`); });
  await unknownStoragePage.goto(`${url}?physicalPackCatalog=data/physical-pack-fixtures/catalog-v1.json`, { waitUntil: "load" });
  await waitReady(unknownStoragePage);
  await openManager(unknownStoragePage);
  await unknownStoragePage.getByRole("button", { name: "Refresh catalog", exact: true }).click();
  await waitCompleted(unknownStoragePage, "Catalog refresh");
  await packCard(unknownStoragePage, "search-verses").getByRole("button", { name: "Plan install", exact: true }).click();
  const unknownDialog = unknownStoragePage.locator(".physical-pack-confirmation:not([hidden])");
  assert((await unknownDialog.textContent()).includes("Storage estimate unavailable"), "unknown storage estimate was not disclosed");
  await unknownDialog.getByRole("button", { name: "Install Search", exact: true }).click();
  await waitCompleted(unknownStoragePage, "Search install");
  await unknownStorageContext.close();

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
    lifecycle: ["plan-cancel", "install", "activation", "delayed-startup-live-transition", "reload", "offline-read", "missing-file-reconcile", "digest-reconcile", "byte-length-reconcile", "repair", "update", "valid-rollback-recovery", "invalid-rollback-rejection", "invalid-rollback-live-loss", "remove", "bundled-fallback"],
    distribution: ["unrelated-bundled-capabilities", "managed-override", "strict-structured-states"],
    storage: ["visible-plan-estimate", "insufficient-before-staging", "unavailable-estimate-safe"],
    reader_context: ["route", "chapter", "selected-word-or-verse", "highlight", "reader-scroll", "detail-history", "detail-lock-follow", "detail-scroll"],
    management_updates: ["startup-actions-suppressed", "mounted-node-only-event", "removed-node-no-update", "focus-preserved", "rollback-action-cleared"],
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
