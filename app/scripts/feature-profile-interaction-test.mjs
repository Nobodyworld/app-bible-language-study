#!/usr/bin/env node

import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { startStaticAppServer } from "../tools/serve-app.mjs";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
if (!existsSync(edgePath)) throw new Error(`Microsoft Edge was not found at ${edgePath}`);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForReader(page) {
  await page.waitForFunction(() =>
    document.querySelector("#chapterTitle")?.textContent.includes("Psalms 23") &&
    document.querySelector("#statusText")?.textContent.includes("data loaded") &&
    document.querySelectorAll(".strong-token").length > 0,
  null, { timeout: 30_000 });
}

async function openMyData(page) {
  await page.locator("#showMyData").click();
  await page.waitForFunction(() => document.querySelector("#detailTitle")?.textContent === "My Data");
}

async function readExport(page) {
  return page.evaluate(() => {
    const details = document.querySelector(".manual-json-panel");
    details.open = false;
    details.dispatchEvent(new Event("toggle"));
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
    return JSON.parse(document.querySelector(".export-textarea").value);
  });
}

async function mergePayload(page, payload) {
  await page.evaluate((value) => {
    const textarea = document.querySelector(".import-textarea");
    textarea.value = JSON.stringify(value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }, payload);
  await page.getByRole("button", { name: "Merge backup" }).click();
  await page.waitForFunction(() => document.querySelector(".import-status")?.textContent.includes("Backup merged"));
  await page.waitForTimeout(250);
}

function addMarker(payload, marker) {
  const clone = JSON.parse(JSON.stringify(payload));
  clone.stores.workspace ||= {};
  clone.stores.workspace.verse_drafts ||= {};
  clone.stores.workspace.verse_drafts[`profile:test:${marker}`] = {
    draft_text: marker,
    updated_at: "2026-08-28T00:00:00.000Z",
  };
  return clone;
}

function hasMarker(payload, marker) {
  return Object.values(payload?.stores?.workspace?.verse_drafts || {}).some((record) => record?.draft_text === marker);
}

function captureHealth(page, bucket) {
  page.on("console", (message) => {
    if (message.type() === "error") bucket.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => bucket.pageErrors.push(error.message));
  page.on("requestfailed", (request) => bucket.failedRequests.push(`${request.method()} ${request.url()}`));
  page.on("response", (response) => {
    if (response.status() >= 400 && response.url().includes("/app/")) bucket.httpErrors.push(`${response.status()} ${response.url()}`);
  });
}

async function auditProfileLayout(browser, url, scenario) {
  const context = await browser.newContext({
    viewport: scenario.viewport,
    colorScheme: scenario.colorScheme,
    forcedColors: scenario.forcedColors || "none",
    reducedMotion: scenario.reducedMotion || "no-preference",
    isMobile: scenario.mobile || false,
    hasTouch: scenario.mobile || false,
  });
  const page = await context.newPage();
  const health = { consoleErrors: [], pageErrors: [], failedRequests: [], httpErrors: [] };
  captureHealth(page, health);
  const selector = scenario.profile === "lab" ? "?profile=lab" : "";
  await page.goto(`${url}/${selector}#/read/bsb/psalms/23`, { waitUntil: "load" });
  await waitForReader(page);
  await openMyData(page);
  const state = await page.evaluate(() => {
    const root = document.documentElement;
    const diagnostics = document.querySelector(".advanced-diagnostics");
    const warning = document.querySelector(".lab-data-warning");
    const profileIndicator = document.querySelector("#profileIdentity");
    return {
      profile: root.dataset.featureProfile,
      route: location.hash,
      viewport: { width: innerWidth, height: innerHeight },
      indicatorHidden: profileIndicator?.hidden,
      indicatorVisible: Boolean(profileIndicator?.getClientRects().length),
      indicator: profileIndicator?.textContent,
      diagnosticsOpen: diagnostics?.open,
      labWarningVisible: Boolean(warning && getComputedStyle(warning).display !== "none"),
      physicalManagerVisible: Boolean(document.querySelector('[data-physical-pack-manager="true"]')?.getClientRects().length),
      horizontalOverflow: Math.max(root.scrollWidth, document.body.scrollWidth) - innerWidth,
      staleLoading: /loading/i.test(document.querySelector("#statusText")?.textContent || "") ||
        document.querySelectorAll('[aria-busy="true"], .loading').length > 0,
      colorScheme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
      forcedColors: matchMedia("(forced-colors: active)").matches,
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    };
  });
  assert(state.profile === scenario.profile, `${scenario.label}: wrong profile: ${JSON.stringify(state)}`);
  assert(state.route === "#/read/bsb/psalms/23", `${scenario.label}: route changed: ${JSON.stringify(state)}`);
  assert(state.horizontalOverflow <= 1, `${scenario.label}: horizontal overflow: ${JSON.stringify(state)}`);
  assert(!state.staleLoading, `${scenario.label}: stale loading state: ${JSON.stringify(state)}`);
  assert(state.colorScheme === scenario.colorScheme, `${scenario.label}: color scheme mismatch: ${JSON.stringify(state)}`);
  assert(state.forcedColors === (scenario.forcedColors === "active"), `${scenario.label}: forced-colors mismatch: ${JSON.stringify(state)}`);
  assert(state.reducedMotion === (scenario.reducedMotion === "reduce"), `${scenario.label}: reduced-motion mismatch: ${JSON.stringify(state)}`);
  if (scenario.profile === "lab") {
    assert(!state.indicatorHidden && state.indicatorVisible && /isolated local data/i.test(state.indicator), `${scenario.label}: Lab identity missing: ${JSON.stringify(state)}`);
    assert(state.diagnosticsOpen && state.labWarningVisible && state.physicalManagerVisible, `${scenario.label}: complete Lab diagnostics missing: ${JSON.stringify(state)}`);
  } else {
    assert(state.indicatorHidden && !state.indicatorVisible && !state.diagnosticsOpen && !state.labWarningVisible && !state.physicalManagerVisible, `${scenario.label}: Stable diagnostics changed: ${JSON.stringify(state)}`);
  }
  assert(Object.values(health).every((items) => items.length === 0), `${scenario.label}: browser health failed: ${JSON.stringify(health)}`);
  await context.close();
  return { ...scenario, state, health };
}

const checks = [];
const pass = (value) => checks.push(value);
const { server, url } = await startStaticAppServer({ port: 0 });
const browser = await chromium.launch({
  executablePath: edgePath,
  headless: true,
  args: ["--disable-gpu", "--disable-background-networking", "--disable-extensions", "--no-first-run", "--no-default-browser-check"],
});

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const health = { consoleErrors: [], pageErrors: [], failedRequests: [], httpErrors: [] };
  captureHealth(page, health);

  await page.goto(`${url}/#/read/bsb/psalms/23`, { waitUntil: "load" });
  await waitForReader(page);
  const stableIdentity = await page.evaluate(() => ({
    profile: document.documentElement.dataset.featureProfile,
    database: document.documentElement.dataset.userStorageDatabase,
    notification: document.documentElement.dataset.notificationChannel,
    physicalRegistry: document.documentElement.dataset.physicalRegistryDatabase,
    physicalBytes: document.documentElement.dataset.physicalBytePrefix,
    profileIndicatorHidden: document.querySelector("#profileIdentity").hidden,
    profileIndicatorVisible: Boolean(document.querySelector("#profileIdentity").getClientRects().length),
    ordinaryControls: ["showSearch", "showInterlinear", "showOutline", "showTags", "showMyData"].map((id) => ({ id, hidden: document.getElementById(id).hidden })),
  }));
  assert(stableIdentity.profile === "stable", `Stable was not the default: ${JSON.stringify(stableIdentity)}`);
  assert(stableIdentity.database === "bibleapp" && stableIdentity.notification === "bibleapp:user-data", `Stable user identities changed: ${JSON.stringify(stableIdentity)}`);
  assert(stableIdentity.physicalRegistry === "bibleapp-physical-packs" && stableIdentity.physicalBytes === "bibleapp-pack:", `Stable physical identities changed: ${JSON.stringify(stableIdentity)}`);
  assert(stableIdentity.profileIndicatorHidden && !stableIdentity.profileIndicatorVisible && stableIdentity.ordinaryControls.every(({ hidden }) => !hidden), `Stable ordinary UI changed: ${JSON.stringify(stableIdentity)}`);
  pass("Stable is the default and retains existing user/physical identities and ordinary controls");

  await page.locator("#showSearch").click();
  await page.locator(".search-form input[name='query']").fill("lord");
  await page.locator(".search-form button[type='submit']").click();
  await page.waitForSelector(".search-result", { state: "visible", timeout: 20_000 });
  pass("Stable Search remains operational");

  await openMyData(page);
  const stableDiagnostics = await page.locator(".advanced-diagnostics").evaluate((node) => ({ open: node.open, parent: node.closest(".user-data-panel") != null }));
  assert(!stableDiagnostics.open && stableDiagnostics.parent, `Stable diagnostics must remain collapsed inside My Data: ${JSON.stringify(stableDiagnostics)}`);
  await page.locator(".advanced-diagnostics > summary").click();
  await page.waitForSelector('[data-physical-pack-manager="true"]');
  assert(await page.locator("body > [data-physical-pack-manager='true']").count() === 0, "Physical packs acquired an ordinary primary destination");
  pass("Stable physical-pack recovery remains inside collapsed Advanced diagnostics");

  const stableExport = await readExport(page);
  assert(stableExport.kind === "bibleapp:user-data" && stableExport.version === 3, "Stable portable data contract changed");
  await mergePayload(page, addMarker(stableExport, "stable-only"));
  assert(hasMarker(await readExport(page), "stable-only"), "Stable marker did not persist through version-3 import");

  await page.goto(`${url}/?profile=lab#/read/bsb/psalms/23`, { waitUntil: "load" });
  await waitForReader(page);
  const labIdentity = await page.evaluate(() => ({
    profile: document.documentElement.dataset.featureProfile,
    database: document.documentElement.dataset.userStorageDatabase,
    notification: document.documentElement.dataset.notificationChannel,
    physicalRegistry: document.documentElement.dataset.physicalRegistryDatabase,
    physicalBytes: document.documentElement.dataset.physicalBytePrefix,
    indicator: document.querySelector("#profileIdentity")?.textContent,
  }));
  assert(labIdentity.profile === "lab" && /isolated local data/i.test(labIdentity.indicator), `Lab identity is not visible: ${JSON.stringify(labIdentity)}`);
  assert(labIdentity.database === "bibleapp-lab" && labIdentity.notification === "bibleapp:lab:user-data", `Lab user identities are not isolated: ${JSON.stringify(labIdentity)}`);
  assert(labIdentity.physicalRegistry === "bibleapp-physical-packs-lab" && labIdentity.physicalBytes === "bibleapp-pack:lab:", `Lab physical identities are not isolated: ${JSON.stringify(labIdentity)}`);
  await openMyData(page);
  assert(await page.locator(".advanced-diagnostics").evaluate((node) => node.open), "Lab diagnostics are not fully exposed");
  assert(await page.locator(".lab-data-warning").isVisible(), "Lab data-isolation warning is missing");
  const labExport = await readExport(page);
  assert(labExport.kind === "bibleapp:user-data" && labExport.version === 3, "Lab portable data contract changed");
  assert(!hasMarker(labExport, "stable-only"), "Stable study data leaked into fresh Lab");
  await mergePayload(page, addMarker(labExport, "lab-only"));
  assert(hasMarker(await readExport(page), "lab-only"), "Lab marker did not persist through version-3 import");
  pass("Lab identity, complete diagnostics, version-3 portability, and isolated user/physical namespaces");

  await page.goto(`${url}/#/read/bsb/psalms/23`, { waitUntil: "load" });
  await waitForReader(page);
  await openMyData(page);
  const stableAfterLab = await readExport(page);
  assert(hasMarker(stableAfterLab, "stable-only") && !hasMarker(stableAfterLab, "lab-only"), "Lab mutation crossed into Stable");
  await page.goto(`${url}/?profile=lab#/read/bsb/psalms/23`, { waitUntil: "load" });
  await waitForReader(page);
  await openMyData(page);
  const labAfterStable = await readExport(page);
  assert(hasMarker(labAfterStable, "lab-only") && !hasMarker(labAfterStable, "stable-only"), "Stable mutation crossed into Lab");
  pass("Stable and Lab mutations remain bidirectionally isolated across reloads");

  await page.goto(`${url}/?profile=unknown-profile#/read/bsb/psalms/23`, { waitUntil: "load" });
  await waitForReader(page);
  const unknown = await page.evaluate(() => ({ profile: document.documentElement.dataset.featureProfile, diagnostic: document.documentElement.dataset.profileDiagnostic }));
  assert(unknown.profile === "stable" && unknown.diagnostic === "unknown_profile", `Unknown profile did not fall back safely: ${JSON.stringify(unknown)}`);
  pass("Unknown profile falls back to Stable with a testable diagnostic");

  assert(Object.values(health).every((items) => items.length === 0), `Stable/Lab browser health failed: ${JSON.stringify(health)}`);
  await context.close();

  const disabledContext = await browser.newContext({ viewport: { width: 1024, height: 720 } });
  await disabledContext.addInitScript(() => { window.__BIBLEAPP_TEST_DISABLED_OPTIONAL_PROFILE__ = true; });
  const disabledPage = await disabledContext.newPage();
  const disabledHealth = { consoleErrors: [], pageErrors: [], failedRequests: [], httpErrors: [] };
  const disabledRequests = [];
  captureHealth(disabledPage, disabledHealth);
  disabledPage.on("request", (request) => disabledRequests.push(request.url()));
  await disabledPage.goto(`${url}/#/read/bsb/psalms/23`, { waitUntil: "load" });
  await waitForReader(disabledPage);
  const disabledControls = await disabledPage.evaluate(() => ({
    hidden: ["showSearch", "showOutline"].map((id) => ({ id, hidden: document.getElementById(id).hidden, owner: document.getElementById(id).dataset.featureId })),
    visible: ["showInterlinear", "showTags", "showMyData"].map((id) => ({ id, hidden: document.getElementById(id).hidden })),
    readerText: document.querySelector("#chapterContent")?.textContent,
  }));
  assert(disabledControls.hidden.every(({ hidden, owner }) => hidden && owner), `Disabled controls remained interactive: ${JSON.stringify(disabledControls)}`);
  assert(disabledControls.visible.every(({ hidden }) => !hidden) && /The Lord is my shepherd/i.test(disabledControls.readerText), `Unrelated/core features were affected: ${JSON.stringify(disabledControls)}`);
  await disabledPage.locator(".strong-token").first().click();
  await disabledPage.waitForFunction(() => document.querySelector("#detailTitle")?.textContent !== "Details");
  const panelActions = await disabledPage.locator("[data-panel-action]").evaluateAll((nodes) => nodes.map((node) => node.dataset.panelAction));
  assert(!panelActions.includes("refs") && !panelActions.includes("commentary"), `Disabled contextual controls remained: ${JSON.stringify(panelActions)}`);
  const forbiddenRequests = disabledRequests.filter((requestUrl) => [
    "/data/search/", "/data/commentaries/", "/data/crossrefs/", "/data/outlines/",
  ].some((part) => requestUrl.includes(part)));
  assert(forbiddenRequests.length === 0, `Disabled features requested data: ${JSON.stringify(forbiddenRequests)}`);
  assert(Object.values(disabledHealth).every((items) => items.length === 0), `Disabled-profile browser health failed: ${JSON.stringify(disabledHealth)}`);
  pass("Disabled optional features hide only owned controls, omit data requests, and preserve Reader/core tools");
  await disabledContext.close();

  const layoutScenarios = [];
  for (const scenario of [
    { label: "Stable desktop light", profile: "stable", viewport: { width: 1280, height: 800 }, colorScheme: "light" },
    { label: "Stable narrow desktop dark", profile: "stable", viewport: { width: 820, height: 900 }, colorScheme: "dark" },
    { label: "Stable mobile light", profile: "stable", viewport: { width: 390, height: 844 }, colorScheme: "light", mobile: true },
    { label: "Lab desktop dark", profile: "lab", viewport: { width: 1280, height: 800 }, colorScheme: "dark" },
    { label: "Lab narrow desktop light", profile: "lab", viewport: { width: 820, height: 900 }, colorScheme: "light" },
    { label: "Lab mobile dark", profile: "lab", viewport: { width: 390, height: 844 }, colorScheme: "dark", mobile: true },
    { label: "Stable forced colors", profile: "stable", viewport: { width: 1024, height: 720 }, colorScheme: "light", forcedColors: "active" },
    { label: "Lab reduced motion", profile: "lab", viewport: { width: 1024, height: 720 }, colorScheme: "light", reducedMotion: "reduce" },
  ]) {
    layoutScenarios.push(await auditProfileLayout(browser, url, scenario));
  }
  pass("Stable/Lab desktop, narrow, mobile, light, dark, forced-colors, and reduced-motion layouts remain healthy");

  console.log(JSON.stringify({
    status: "ok",
    browser: "Microsoft Edge",
    checks,
    stable_identity: stableIdentity,
    lab_identity: labIdentity,
    health,
    disabled_health: disabledHealth,
    layout_scenarios: layoutScenarios,
  }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
