#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { startStaticAppServer } from "../tools/serve-app.mjs";

const WIDTH_SEQUENCE = Object.freeze(["compact", "standard", "expanded"]);

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

function attachHealthChecks(page, baseUrl) {
  const consoleErrors = [];
  const pageErrors = [];
  const requestFailures = [];
  const responseFailures = [];
  const origin = new URL(baseUrl).origin;
  const inApp = (url) => {
    try {
      const parsed = new URL(url);
      return parsed.origin === origin && parsed.pathname !== "/favicon.ico";
    } catch {
      return false;
    }
  };
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (inApp(request.url())) requestFailures.push(`${request.method()} ${request.url()}`);
  });
  page.on("response", (response) => {
    if (inApp(response.url()) && response.status() >= 400) responseFailures.push(`${response.status()} ${response.url()}`);
  });
  return () => {
    assert.deepEqual(consoleErrors, [], "Frozen-highlight test reported console errors");
    assert.deepEqual(pageErrors, [], "Frozen-highlight test reported page errors");
    assert.deepEqual(requestFailures, [], "Frozen-highlight test reported request failures");
    assert.deepEqual(responseFailures, [], "Frozen-highlight test reported HTTP failures");
  };
}

async function waitForReader(page) {
  await page.waitForFunction(() =>
    document.querySelector("#chapterTitle")?.textContent.includes("Psalms 23") &&
    !document.body.textContent.includes("Loading data") &&
    document.querySelectorAll(".strong-token").length > 0 &&
    document.querySelectorAll("[data-study-workspace-width-cycle]").length === 1,
  );
  await page.waitForLoadState("networkidle");
}

async function selectExactPhrase(page, phrase) {
  return page.evaluate((selectedPhrase) => {
    const body = document.querySelector('.verse-row[data-verse="1"] .verse-body');
    if (!body) throw new Error("Psalm 23:1 body is unavailable");
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let text = "";
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement?.closest("button")) continue;
      nodes.push({ node, start: text.length, end: text.length + node.data.length });
      text += node.data;
    }
    const start = text.indexOf(selectedPhrase);
    const end = start + selectedPhrase.length;
    const first = nodes.find((entry) => entry.start <= start && entry.end > start);
    const last = nodes.find((entry) => entry.start < end && entry.end >= end);
    if (start < 0 || !first || !last) throw new Error(`Could not map exact phrase in: ${text}`);
    const range = document.createRange();
    range.setStart(first.node, start - first.start);
    range.setEnd(last.node, end - last.start);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    body.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    return { start, end, nativeText: String(selection), route: location.hash };
  }, phrase);
}

async function wordState(page) {
  return page.evaluate(() => {
    const word = document.querySelector(".reader-context-word");
    const verse = document.querySelector(".reader-context-verse");
    return {
      route: location.hash,
      detailTitle: document.querySelector("#detailTitle")?.textContent || "",
      wordCount: document.querySelectorAll(".reader-context-word").length,
      verseCount: document.querySelectorAll(".reader-context-verse").length,
      wordKey: word?.dataset.interlinearKey || "",
      strongCode: word?.dataset.strongCode || "",
      wordText: word?.textContent.trim() || "",
      verse: verse?.dataset.verse || word?.closest(".verse-row, .source-bearing-segment")?.dataset.verse || "",
      widthMode: document.documentElement.dataset.studyWorkspaceWidth || "",
    };
  });
}

async function phraseState(page) {
  return page.evaluate(() => ({
    route: location.hash,
    detailTitle: document.querySelector("#detailTitle")?.textContent || "",
    phraseText: [...document.querySelectorAll(".reader-context-phrase")].map((node) => node.textContent || "").join(""),
    phraseVerseCount: document.querySelectorAll(".reader-context-phrase-verse").length,
    selectedSummary: document.querySelector(".language-study-selection-summary blockquote")?.textContent || "",
    selectedPairs: document.querySelectorAll(".translation-token-pair.selected-range").length,
    widthMode: document.documentElement.dataset.studyWorkspaceWidth || "",
  }));
}

async function cycleTo(page, targetMode) {
  const cycle = page.locator("[data-study-workspace-width-cycle]");
  for (let attempt = 0; attempt < WIDTH_SEQUENCE.length; attempt += 1) {
    const current = await cycle.getAttribute("data-study-workspace-width-current");
    if (current === targetMode) return;
    await cycle.click();
    await page.waitForFunction(
      (previous) => document.querySelector("[data-study-workspace-width-cycle]")?.dataset.studyWorkspaceWidthCurrent !== previous,
      current,
    );
  }
  throw new Error(`Could not cycle Study workspace to ${targetMode}`);
}

async function assertWordFrozenAcrossWidths(page, baseline) {
  for (const mode of WIDTH_SEQUENCE) {
    await cycleTo(page, mode);
    const state = await wordState(page);
    assert.equal(state.widthMode, mode, `${mode}: width cycle did not apply`);
    assert.equal(state.wordCount, 1, `${mode}: frozen word highlight disappeared`);
    assert.equal(state.verseCount, 1, `${mode}: frozen verse highlight disappeared`);
    assert.equal(state.wordKey, baseline.wordKey, `${mode}: frozen word identity changed`);
    assert.equal(state.strongCode, baseline.strongCode, `${mode}: frozen Strong's identity changed`);
    assert.equal(state.wordText, baseline.wordText, `${mode}: frozen word text changed`);
    assert.equal(state.route, baseline.route, `${mode}: width cycle changed the Reader route`);
  }
}

async function assertPhraseFrozenAcrossWidths(page, phrase) {
  for (const mode of WIDTH_SEQUENCE) {
    await cycleTo(page, mode);
    const state = await phraseState(page);
    assert.equal(state.widthMode, mode, `${mode}: width cycle did not apply to phrase state`);
    assert.equal(state.phraseText, phrase, `${mode}: exact phrase highlight changed`);
    assert.equal(state.phraseVerseCount, 1, `${mode}: phrase highlight escaped its verse`);
    assert.equal(state.selectedSummary, phrase, `${mode}: Language Study summary changed the selected phrase`);
    assert(state.selectedPairs > 1, `${mode}: Language Study lost multi-token alignment for the selected phrase`);
  }
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
    const assertHealthy = attachHealthChecks(page, url);
    await page.goto(`${url}/#/read/bsb/psalms/23/1`, { waitUntil: "load" });
    await waitForReader(page);

    const readerToken = page.locator(".strong-token").filter({ hasText: /LORD/i }).first();
    const token = await readerToken.count() ? readerToken : page.locator(".strong-token").first();
    await token.scrollIntoViewIfNeeded();
    await token.click();
    await page.waitForFunction(() => Boolean(document.querySelector(".reader-context-word") && document.querySelector(".reader-context-verse")));
    const wordBaseline = await wordState(page);
    assert.equal(wordBaseline.wordCount, 1);
    assert.equal(wordBaseline.verseCount, 1);

    await page.locator("#showInterlinear").click();
    await page.waitForFunction(() => document.querySelector("#detailTitle")?.textContent === "Language Study");
    const languageStudyWord = await wordState(page);
    assert.equal(languageStudyWord.wordKey, wordBaseline.wordKey, "Opening Language Study changed the frozen word identity");
    await assertWordFrozenAcrossWidths(page, wordBaseline);

    await page.locator("#nextChapter").click();
    await page.waitForFunction(() => document.querySelector("#chapterTitle")?.textContent.includes("Psalms 24"));
    const navigationState = await wordState(page);
    assert.equal(navigationState.wordCount, 0, "Chapter navigation did not release the frozen word highlight");
    assert.equal(navigationState.verseCount, 0, "Chapter navigation did not release the frozen verse highlight");

    await page.goto(`${url}/?case=phrase#/read/bsb/psalms/23/1`, { waitUntil: "load" });
    await waitForReader(page);
    const phrase = "The LORD is my shepherd;";
    const selection = await selectExactPhrase(page, phrase);
    assert.equal(selection.nativeText, phrase, "Native selection did not contain the exact phrase");
    assert.equal(selection.start, 0);
    assert.equal(selection.end, phrase.length);
    await page.waitForFunction(() => !document.querySelector(".selection-action-menu")?.hidden);
    await page.locator(".selection-action-menu button", { hasText: "Study" }).click();
    await page.waitForFunction(() =>
      document.querySelector("#detailTitle")?.textContent === "Language Study" &&
      Boolean(document.querySelector(".language-study-selection-summary")) &&
      Boolean(document.querySelector(".reader-context-phrase")),
    );
    const selected = await phraseState(page);
    assert.equal(selected.phraseText, phrase, "Persistent Reader highlight did not match the selected phrase");
    assert.equal(selected.selectedSummary, phrase, "Language Study summary shortened the selected phrase");
    assert(selected.selectedPairs > 1, "Selected phrase did not preserve multi-token alignment");
    await assertPhraseFrozenAcrossWidths(page, phrase);

    assertHealthy();
    console.log(JSON.stringify({
      status: "ok",
      wordHighlightAcrossWidths: WIDTH_SEQUENCE,
      phraseHighlightAcrossWidths: WIDTH_SEQUENCE,
      navigationRelease: true,
      phrase,
    }, null, 2));
  } finally {
    await browser.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

await main();
