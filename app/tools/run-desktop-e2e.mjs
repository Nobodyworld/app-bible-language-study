#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDesktopWebDriverTooling } from "./desktop-webdriver-tooling.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BINARY = process.env.BIBLEAPP_E2E_APPLICATION
  ? path.resolve(process.env.BIBLEAPP_E2E_APPLICATION)
  : path.join(REPO_ROOT, "src-tauri", "target", "debug", "bible-app-reader.exe");
const SKIP_BUILD = process.env.BIBLEAPP_E2E_SKIP_BUILD === "1";
const PROFILE_ID = process.env.BIBLEAPP_E2E_PROFILE || "stable";
const MEANING = "Desktop E2E exact meaning";

assert.match(PROFILE_ID, /^(stable|lab)$/, "Desktop E2E profile must be stable or lab");
if (SKIP_BUILD) {
  assert.ok(process.env.BIBLEAPP_E2E_APPLICATION, "BIBLEAPP_E2E_APPLICATION is required when BIBLEAPP_E2E_SKIP_BUILD=1");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function runLogged(command, args, logPath, options = {}) {
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  const log = await fs.open(logPath, "w");
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd || REPO_ROOT,
        env: options.env || process.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      child.stdout.on("data", (chunk) => { process.stdout.write(chunk); void log.write(chunk); });
      child.stderr.on("data", (chunk) => { process.stderr.write(chunk); void log.write(chunk); });
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}.`)));
    });
  } finally {
    await log.close();
  }
}

class WebDriverClient {
  constructor(port) {
    this.origin = `http://127.0.0.1:${port}`;
    this.sessionId = null;
  }

  async request(method, route, body = undefined) {
    const response = await fetch(`${this.origin}${route}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.value?.error) {
      throw new Error(`WebDriver ${method} ${route} failed: ${payload?.value?.message || response.status}`);
    }
    return payload.value;
  }

  async waitReady(timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    let lastError;
    while (Date.now() < deadline) {
      try {
        await this.request("GET", "/status");
        return;
      } catch (error) {
        lastError = error;
        await delay(150);
      }
    }
    throw lastError || new Error("tauri-driver did not become ready.");
  }

  async createSession(application) {
    const value = await this.request("POST", "/session", {
      capabilities: {
        alwaysMatch: {
          browserName: "wry",
          "tauri:options": { application },
        },
        firstMatch: [{}],
      },
    });
    this.sessionId = value.sessionId;
    assert.ok(this.sessionId, "tauri-driver did not return a session ID");
    await this.request("POST", `/session/${this.sessionId}/timeouts`, { script: 15_000 });
    return this.sessionId;
  }

  async execute(script, args = []) {
    return this.request("POST", `/session/${this.sessionId}/execute/sync`, { script, args });
  }

  async executeAsync(script, args = []) {
    return this.request("POST", `/session/${this.sessionId}/execute/async`, { script, args });
  }

  async waitFor(script, args = [], timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    let value;
    while (Date.now() < deadline) {
      value = await this.execute(script, args);
      if (value) return value;
      await delay(150);
    }
    throw new Error(`Timed out waiting for rendered state: ${script.slice(0, 160)}`);
  }

  async screenshot(destination) {
    const encoded = await this.request("GET", `/session/${this.sessionId}/screenshot`);
    await fs.writeFile(destination, Buffer.from(encoded, "base64"));
  }

  async closeSession() {
    if (!this.sessionId) return;
    const id = this.sessionId;
    this.sessionId = null;
    await this.request("DELETE", `/session/${id}`).catch(() => {});
  }
}

async function click(client, selector) {
  const clicked = await client.execute("const node = document.querySelector(arguments[0]); if (!node) return false; node.scrollIntoView({block:'center'}); node.click(); return true;", [selector]);
  assert.equal(clicked, true, `Rendered control is missing: ${selector}`);
}

async function installErrorCapture(client) {
  await client.execute(`
    window.__desktopE2eErrors = [];
    window.addEventListener('error', event => window.__desktopE2eErrors.push(String(event.message || 'window error')));
    window.addEventListener('unhandledrejection', event => window.__desktopE2eErrors.push(String(event.reason?.message || event.reason || 'unhandled rejection')));
    const original = console.error.bind(console);
    console.error = (...args) => { window.__desktopE2eErrors.push(args.map(String).join(' ')); original(...args); };
    return true;
  `);
}

async function readNativeStores(client) {
  return client.executeAsync(`
    const profileId = arguments[0];
    const done = arguments[arguments.length - 1];
    Promise.all(['tags', 'workspace'].map(storeId =>
      window['__TA' + 'URI__'].core.invoke('read_user_store', { profileId, storeId })
    )).then(values => done({ tags: values[0], workspace: values[1] }), error => done({ error: String(error?.message || error) }));
  `, [PROFILE_ID]);
}

function persistedState(stores, targetId) {
  const tags = stores?.tags?.value?.tag_assertions || {};
  const renderings = Object.values(stores?.workspace?.value?.token_renderings || {}).flatMap((verse) => Object.values(verse || {}));
  return {
    favorite: Object.values(tags).some((record) => record?.active && record?.target_id === targetId && String(record?.tag_id || record?.legacy_tag_id).replace(/^tag:/, "") === "favorite"),
    meaning: renderings.some((record) => record?.target_id === targetId && record?.rendering === MEANING),
    route: stores?.workspace?.value?.last_reader_route || null,
  };
}

async function firstLaunch(client, screenshotPath) {
  await client.waitFor("return document.readyState === 'complete' && Boolean(document.querySelector('#chapterTitle'));", [], 45_000);
  await installErrorCapture(client);
  await client.execute("location.hash = '#/read/bsb/proverbs/1/1'; return location.hash;");
  await client.waitFor("return document.querySelector('#chapterTitle')?.textContent.includes('Proverbs 1') && document.querySelectorAll('.strong-token').length > 0;", [], 45_000);
  await click(client, ".verse-row:has(.verse-study-button) .verse-study-button");
  await client.waitFor("return Boolean(document.querySelector(\"#detailContext .verse-context-tab[data-visible-label='Language Study']\"));");
  await click(client, "#detailContext .verse-context-tab[data-visible-label='Language Study']");
  await client.waitFor("return document.querySelector('#detailTitle')?.textContent === 'Language Study' && document.querySelectorAll('#detailContent .interlinear-token .word-meaning-control').length >= 2;", [], 45_000);

  const targetId = await client.execute("return document.querySelector('#detailContent .interlinear-token .word-meaning-control')?.dataset.targetId || ''; ");
  assert.ok(targetId, "The exact source-token target ID was not rendered");
  await click(client, ".reader-pane .strong-token[data-strong-code]");
  await client.waitFor("return document.querySelector('#detailTitle')?.textContent === \"Strong's\" && Boolean(document.querySelector('#detailContent .strong-detail'));", [], 30_000);
  await click(client, "#detailBack");
  await client.waitFor("return document.querySelector('#detailTitle')?.textContent === 'Language Study' && Boolean(document.querySelector('#detailContent .interlinear-token .word-meaning-control'));", [], 30_000);

  const escaped = JSON.stringify(targetId);
  const openedMarks = await client.execute(`const control = [...document.querySelectorAll('#detailContent .word-meaning-control')].find(node => node.dataset.targetId === ${escaped}); const button = control?.closest('.interlinear-token')?.querySelector('.study-marks-trigger'); if (!button) return false; button.click(); return true;`);
  assert.equal(openedMarks, true, "Study Marks did not open for the exact source token");
  await client.waitFor("return Boolean(document.querySelector(\"#detailToolContent .tag-picker-option[aria-label='Add Favorite tag']\"));");
  await click(client, "#detailToolContent .tag-picker-option[aria-label='Add Favorite tag']");
  await client.waitFor("return document.querySelector(\"#detailToolContent .tag-picker-option[aria-label='Remove Favorite tag']\")?.getAttribute('aria-pressed') === 'true';");

  const openedMeaning = await client.execute(`const control = [...document.querySelectorAll('#detailContent .word-meaning-control')].find(node => node.dataset.targetId === ${escaped}); const button = control?.querySelector('.word-meaning-trigger'); if (!button) return false; button.click(); return true;`);
  assert.equal(openedMeaning, true, "Meaning did not open for the exact source token");
  await client.waitFor("return Boolean(document.querySelector('#detailToolContent .word-meaning-other')); ");
  await click(client, "#detailToolContent .word-meaning-other");
  await client.waitFor("return Boolean(document.querySelector('#detailToolContent .word-meaning-custom-input')); ");
  await client.execute("const input = document.querySelector('#detailToolContent .word-meaning-custom-input'); input.value = arguments[0]; input.dispatchEvent(new Event('input', {bubbles:true})); return input.value;", [MEANING]);
  await click(client, "#detailToolContent .word-meaning-save");
  await client.waitFor("return [...document.querySelectorAll('.word-meaning-badge')].some(node => node.textContent.trim() === arguments[0]);", [MEANING]);

  let persisted;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const stores = await readNativeStores(client);
    if (stores.error) throw new Error(stores.error);
    persisted = persistedState(stores, targetId);
    if (persisted.favorite && persisted.meaning && persisted.route === "#/read/bsb/proverbs/1/1") break;
    await delay(150);
  }
  assert.deepEqual(persisted, { favorite: true, meaning: true, route: "#/read/bsb/proverbs/1/1" });
  await client.screenshot(screenshotPath);
  assert.deepEqual(await client.execute("return window.__desktopE2eErrors || [];"), []);
  return targetId;
}

async function secondLaunch(client, targetId, screenshotPath) {
  await client.waitFor("return document.readyState === 'complete' && document.querySelector('#chapterTitle')?.textContent.includes('Proverbs 1');", [], 45_000);
  await installErrorCapture(client);
  assert.equal(await client.execute("return location.hash;"), "#/read/bsb/proverbs/1/1");
  await click(client, ".verse-row:has(.verse-study-button) .verse-study-button");
  await client.waitFor("return Boolean(document.querySelector(\"#detailContext .verse-context-tab[data-visible-label='Language Study']\"));");
  await click(client, "#detailContext .verse-context-tab[data-visible-label='Language Study']");
  await client.waitFor("return document.querySelector('#detailTitle')?.textContent === 'Language Study' && [...document.querySelectorAll('.word-meaning-badge')].some(node => node.textContent.trim() === arguments[0]);", [MEANING], 45_000);
  const escaped = JSON.stringify(targetId);
  const openedMarks = await client.execute(`const control = [...document.querySelectorAll('#detailContent .word-meaning-control')].find(node => node.dataset.targetId === ${escaped}); const button = control?.closest('.interlinear-token')?.querySelector('.study-marks-trigger'); if (!button) return false; button.click(); return true;`);
  assert.equal(openedMarks, true);
  await client.waitFor("return document.querySelector(\"#detailToolContent .tag-picker-option[aria-label='Remove Favorite tag']\")?.getAttribute('aria-pressed') === 'true';");
  await client.screenshot(screenshotPath);
  assert.deepEqual(await client.execute("return window.__desktopE2eErrors || [];"), []);
}

const tooling = await ensureDesktopWebDriverTooling();
const runId = `${Date.now()}-${process.pid}`;
const runRoot = path.join(tooling.toolsRoot, "e2e", `bibleapp-e2e-${runId}`);
const logsRoot = path.join(runRoot, "logs");
await fs.mkdir(logsRoot, { recursive: true });
if (!SKIP_BUILD) {
  await runLogged(process.execPath, [path.join(REPO_ROOT, "node_modules", "@tauri-apps", "cli", "tauri.js"), "build", "--debug", "--no-bundle"], path.join(logsRoot, "build.log"));
}
await fs.access(BINARY);

const driverPort = await freePort();
const nativePort = await freePort();
const driverLog = await fs.open(path.join(logsRoot, "tauri-driver.log"), "w");
const driver = spawn(tooling.tauriDriver.binary, [
  "--port", String(driverPort),
  "--native-port", String(nativePort),
  "--native-driver", tooling.edgeDriver.binary,
], {
  cwd: REPO_ROOT,
  env: SKIP_BUILD ? { ...process.env } : { ...process.env, BIBLEAPP_E2E_ROOT: runRoot },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
driver.stdout.on("data", (chunk) => { process.stdout.write(chunk); void driverLog.write(chunk); });
driver.stderr.on("data", (chunk) => { process.stderr.write(chunk); void driverLog.write(chunk); });

const client = new WebDriverClient(driverPort);
let targetId;
try {
  await client.waitReady();
  await client.createSession(BINARY);
  targetId = await firstLaunch(client, path.join(runRoot, "first-launch.png"));
  await client.closeSession();
  await client.createSession(BINARY);
  await secondLaunch(client, targetId, path.join(runRoot, "relaunch.png"));
  await client.closeSession();
} finally {
  await client.closeSession();
  driver.kill();
  if (driver.exitCode === null) await new Promise((resolve) => driver.once("exit", resolve));
  await driverLog.close();
}

if (!SKIP_BUILD) {
  const nativeLog = await fs.readFile(path.join(runRoot, "logs", "bible-app-reader.log"), "utf8").catch(() => "");
  assert.equal(/panic|backtrace|fatal/i.test(nativeLog), false, "Native E2E log contains a panic or fatal marker");
}
console.log(JSON.stringify({
  desktop_e2e: "PASS",
  application_mode: SKIP_BUILD ? "supplied" : "debug-build",
  profile_id: PROFILE_ID,
  driver: "tauri-driver",
  tauri_driver_version: tooling.tauriDriver.version,
  webview2_version: tooling.webviewVersion,
  edge_driver_version: tooling.edgeDriver.version,
  edge_driver_sha256: tooling.edgeDriver.sha256,
  binary: SKIP_BUILD ? path.basename(BINARY) : path.relative(REPO_ROOT, BINARY),
  target_id: targetId,
  route_restored: "#/read/bsb/proverbs/1/1",
  marker_persisted: true,
  meaning_persisted: true,
  logs: path.relative(REPO_ROOT, logsRoot),
  screenshots: [path.relative(REPO_ROOT, path.join(runRoot, "first-launch.png")), path.relative(REPO_ROOT, path.join(runRoot, "relaunch.png"))],
}, null, 2));
