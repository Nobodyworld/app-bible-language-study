#!/usr/bin/env node

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

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
    await delay(100);
  }
  throw new Error(`Timed out waiting for: ${predicate.toString()}`);
}

async function clickWithPointer(page, selectorOrTokenAlias) {
  await page.evaluate((input) => {
    const target = input === "reader-token"
      ? [...document.querySelectorAll(".strong-token")].find((node) => /LORD/i.test(node.textContent || "")) ||
        document.querySelector(".strong-token")
      : document.querySelector(input);
    if (!target) throw new Error(`Target not found: ${input}`);
    target.scrollIntoView({ block: "center", inline: "nearest" });
    target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType: "mouse" }));
    target.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerType: "mouse" }));
    target.click();
  }, selectorOrTokenAlias);
}

async function main() {
  const { server, url } = await startAppServer();
  const browser = await chromium.launch({
    executablePath: findEdgePath(),
    headless: true,
    args: [
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-background-networking",
      "--disable-extensions",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(url, { waitUntil: "load" });
    await waitFor(page, () => document.readyState === "complete" && !document.body.textContent.includes("Loading data"));
    await waitFor(page, () => Boolean(document.querySelector("#chapterTitle")?.textContent.includes("Psalms 23")));
    await waitFor(page, () => document.querySelectorAll(".strong-token").length > 0);

    await clickWithPointer(page, "reader-token");
    await waitFor(page, () => Boolean(document.querySelector(".reader-context-word") && document.querySelector(".reader-context-verse")));

    await clickWithPointer(page, "#showInterlinear");
    await waitFor(page, () => document.querySelector("#detailTitle")?.textContent === "Language Study");
    await delay(1600);

    const interlinearFrozenState = await page.evaluate(() => ({
      wordCount: document.querySelectorAll(".reader-context-word").length,
      verseCount: document.querySelectorAll(".reader-context-verse").length,
      detailTitle: document.querySelector("#detailTitle")?.textContent || "",
    }));

    assert(
      interlinearFrozenState.wordCount === 1 &&
        interlinearFrozenState.verseCount === 1 &&
        interlinearFrozenState.detailTitle === "Language Study",
      `clicked reader word highlight did not persist through Interlinear tool browsing: ${JSON.stringify(interlinearFrozenState)}`,
    );

    await clickWithPointer(page, "#nextChapter");
    await waitFor(page, () => Boolean(document.querySelector("#chapterTitle")?.textContent.includes("Psalms 24")));
    await delay(1400);

    const navigationState = await page.evaluate(() => ({
      wordCount: document.querySelectorAll(".reader-context-word").length,
      verseCount: document.querySelectorAll(".reader-context-verse").length,
      chapterTitle: document.querySelector("#chapterTitle")?.textContent || "",
    }));

    assert(
      navigationState.wordCount === 0 && navigationState.verseCount === 0,
      `chapter navigation did not release the frozen reader highlight: ${JSON.stringify(navigationState)}`,
    );

    console.log(JSON.stringify({ status: "ok", assertions: 2 }, null, 2));
  } finally {
    await browser.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

await main();
