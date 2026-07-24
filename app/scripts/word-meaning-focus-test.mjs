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

async function workspaceSnapshot(page) {
  return page.evaluate(async () => {
    const localStorageKey = "bibleapp:translation-workspace:v1";
    const readLocalWorkspace = () => {
      try {
        const raw = window.localStorage.getItem(localStorageKey);
        return raw ? JSON.parse(raw) : {};
      } catch {
        return {};
      }
    };

    const readWorkspace = () =>
      new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          resolve(value || readLocalWorkspace());
        };
        const timeout = window.setTimeout(() => finish(readLocalWorkspace()), 3000);
        if (!window.indexedDB) {
          window.clearTimeout(timeout);
          finish(readLocalWorkspace());
          return;
        }
        let request;
        try {
          request = window.indexedDB.open("bibleapp", 2);
        } catch {
          window.clearTimeout(timeout);
          finish(readLocalWorkspace());
          return;
        }
        request.onerror = () => {
          window.clearTimeout(timeout);
          finish(readLocalWorkspace());
        };
        request.onblocked = () => {
          window.clearTimeout(timeout);
          finish(readLocalWorkspace());
        };
        request.onsuccess = () => {
          const db = request.result;
          try {
            const transaction = db.transaction("user_stores", "readonly");
            const get = transaction.objectStore("user_stores").get("workspace");
            get.onsuccess = () => {
              window.clearTimeout(timeout);
              const store = get.result?.value || readLocalWorkspace();
              db.close();
              finish(store);
            };
            get.onerror = () => {
              window.clearTimeout(timeout);
              db.close();
              finish(readLocalWorkspace());
            };
          } catch {
            window.clearTimeout(timeout);
            db.close();
            finish(readLocalWorkspace());
          }
        };
      });

    const store = await readWorkspace();
    return JSON.stringify({
      indexedDbWorkspace: store || {},
      localStorageWorkspace: window.localStorage.getItem(localStorageKey),
      tokenRenderings: store?.token_renderings || {},
      tagAssertions: store?.tag_assertions || {},
      workspaceJobs: store?.job_events || [],
    });
  });
}

async function runProfile(browser, url, profile) {
  const context = await browser.newContext({
    viewport: profile.viewport,
    isMobile: profile.mobile,
    hasTouch: profile.mobile,
    deviceScaleFactor: profile.mobile ? 3 : 1,
    userAgent: profile.mobile
      ? "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0 Mobile Safari/537.36 BibleAppQA"
      : undefined,
  });
  const page = await context.newPage();
  let stage = "navigate";

  try {
    await page.goto(`${url}/#/read/bsb/proverbs/1/1`, { waitUntil: "load" });
    await waitFor(page, () => Boolean(document.querySelector("#chapterTitle")?.textContent.includes("Proverbs 1")));

    stage = "open verse context";
    await page.evaluate(() => {
      const button = document.querySelector(".verse-study-button");
      if (!button) throw new Error("Verse study button not found");
      button.click();
    });
    await waitFor(page, () =>
      [...document.querySelectorAll("#detailContext .verse-context-tab")].some(
        (button) => button.textContent.trim() === "Int" && !button.disabled,
      ),
    );

    stage = "open Language Study";
    await page
      .locator("#detailContext .verse-context-tab")
      .filter({ hasText: /^Int$/ })
      .first()
      .click();
    await waitFor(page, () => Boolean(document.querySelector("#detailTitle")?.textContent === "Language Study"));
    await waitFor(page, () =>
      Boolean(document.querySelector('.interlinear-verse-section[data-verse="1"] .word-meaning-control')),
    );

    stage = "prepare exact-token controls";
    const cards = page
      .locator('.interlinear-verse-section[data-verse="1"] .interlinear-token')
      .filter({ has: page.locator(".word-meaning-control") });
    assert((await cards.count()) >= 2, `${profile.name}: two exact-token Meaning controls were not rendered`);
    const firstCard = cards.nth(0);
    const secondCard = cards.nth(1);
    const firstMeaning = firstCard.locator(".word-meaning-trigger");
    const secondMeaning = secondCard.locator(".word-meaning-trigger");
    const firstStudyMarks = firstCard.locator(".study-marks-trigger");
    await firstCard.evaluate((node) => {
      const existing = node.querySelector("#qa-word-meaning-outside-focus");
      if (existing) existing.remove();
      const outside = document.createElement("button");
      outside.id = "qa-word-meaning-outside-focus";
      outside.type = "button";
      outside.textContent = "Outside focus target";
      node.append(outside);
    });
    const outsideControl = firstCard.locator("#qa-word-meaning-outside-focus");
    const assertWorkspaceUnchanged = async (label) => {
      const after = await workspaceSnapshot(page);
      assert(before === after, `${profile.name}: ${label} mutated token renderings, Study Marks, jobs, IndexedDB, or local storage`);
    };
    const before = await workspaceSnapshot(page);

    stage = "Meaning A to Meaning B";
    await firstMeaning.scrollIntoViewIfNeeded();
    await firstMeaning.focus();
    await firstMeaning.press("Enter");
    await waitFor(page, () => document.querySelectorAll(".word-meaning-menu:not([hidden])").length === 1);
    await secondMeaning.focus();
    await secondMeaning.press("Enter");
    await waitFor(page, () => document.querySelectorAll(".word-meaning-menu:not([hidden])").length === 1);
    const meaningSwitch = await page.evaluate(() => {
      const triggers = [...document.querySelectorAll('.interlinear-verse-section[data-verse="1"] .word-meaning-trigger')];
      return {
        visible: document.querySelectorAll(".word-meaning-menu:not([hidden])").length,
        firstExpanded: triggers[0]?.getAttribute("aria-expanded"),
        secondExpanded: triggers[1]?.getAttribute("aria-expanded"),
        firstFocused: document.activeElement === triggers[0],
      };
    });
    assert(
      meaningSwitch.visible === 1 && meaningSwitch.firstExpanded === "false" &&
        meaningSwitch.secondExpanded === "true" && !meaningSwitch.firstFocused,
      `${profile.name}: Meaning A to B did not leave B as the sole overlay: ${JSON.stringify(meaningSwitch)}`,
    );
    await secondMeaning.press("Escape");
    const meaningEscape = await page.evaluate(() => {
      const triggers = [...document.querySelectorAll('.interlinear-verse-section[data-verse="1"] .word-meaning-trigger')];
      return {
        visible: document.querySelectorAll(".word-meaning-menu:not([hidden])").length,
        secondFocused: document.activeElement === triggers[1],
      };
    });
    assert(meaningEscape.visible === 0 && meaningEscape.secondFocused, `${profile.name}: Escape did not close/focus Meaning B`);
    await assertWorkspaceUnchanged("Meaning A to Meaning B switching");

    stage = "Study Marks focus to Meaning";
    await firstStudyMarks.focus();
    await waitFor(page, () => document.querySelector('.interlinear-verse-section[data-verse="1"] .study-marks-menu')?.dataset.menuOpen === "true");
    await firstMeaning.focus();
    await firstMeaning.press("Enter");
    const marksToMeaning = await page.evaluate(() => {
      const card = document.querySelector('.interlinear-verse-section[data-verse="1"] .interlinear-token:has(.word-meaning-control)');
      return {
        marksOpen: card?.querySelector(".study-marks-menu")?.dataset.menuOpen === "true",
        meaningsVisible: document.querySelectorAll(".word-meaning-menu:not([hidden])").length,
      };
    });
    assert(!marksToMeaning.marksOpen && marksToMeaning.meaningsVisible === 1, `${profile.name}: Study Marks to Meaning overlap: ${JSON.stringify(marksToMeaning)}`);
    await firstMeaning.press("Escape");
    assert(await firstMeaning.evaluate((node) => document.activeElement === node), `${profile.name}: Meaning trigger did not regain focus`);
    await assertWorkspaceUnchanged("Study Marks focus to Meaning switching");

    stage = "Study Marks click to Meaning";
    await outsideControl.focus();
    await firstStudyMarks.evaluate((trigger) => trigger.click());
    await waitFor(page, () => document.querySelector('.interlinear-verse-section[data-verse="1"] .study-marks-menu')?.dataset.menuOpen === "true");
    await firstMeaning.focus();
    await firstMeaning.press("Enter");
    assert(
      await page.evaluate(() =>
        document.querySelector('.interlinear-verse-section[data-verse="1"] .study-marks-menu')?.dataset.menuOpen !== "true" &&
        document.querySelectorAll(".word-meaning-menu:not([hidden])").length === 1),
      `${profile.name}: click-open Study Marks remained open behind Meaning`,
    );
    await firstMeaning.press("Escape");
    await assertWorkspaceUnchanged("Study Marks click to Meaning switching");

    if (!profile.mobile) {
      stage = "Study Marks hover to Meaning";
      const studyMenu = firstCard.locator(".study-marks-menu");
      await outsideControl.focus();
      await studyMenu.hover();
      await waitFor(page, () => document.querySelector('.interlinear-verse-section[data-verse="1"] .study-marks-menu')?.dataset.menuOpen === "true");
      await firstMeaning.focus();
      await firstMeaning.press("Enter");
      assert(
        await page.evaluate(() =>
          document.querySelector('.interlinear-verse-section[data-verse="1"] .study-marks-menu')?.dataset.menuOpen !== "true" &&
          document.querySelectorAll(".word-meaning-menu:not([hidden])").length === 1),
        `${profile.name}: hover-open Study Marks remained open behind Meaning`,
      );
      await firstMeaning.press("Escape");
      await assertWorkspaceUnchanged("Study Marks hover to Meaning switching");
    }

    stage = "Meaning to Study Marks";
    await firstMeaning.focus();
    await firstMeaning.press("Enter");
    await waitFor(page, () => document.querySelectorAll(".word-meaning-menu:not([hidden])").length === 1);
    await firstStudyMarks.focus();
    await waitFor(page, () => document.querySelector('.interlinear-verse-section[data-verse="1"] .study-marks-menu')?.dataset.menuOpen === "true");
    const meaningToMarks = await page.evaluate(() => ({
      meaningsVisible: document.querySelectorAll(".word-meaning-menu:not([hidden])").length,
      marksOpen: document.querySelector('.interlinear-verse-section[data-verse="1"] .study-marks-menu')?.dataset.menuOpen === "true",
    }));
    assert(meaningToMarks.meaningsVisible === 0 && meaningToMarks.marksOpen, `${profile.name}: Meaning to Study Marks overlap: ${JSON.stringify(meaningToMarks)}`);
    await firstStudyMarks.press("Escape");
    assert(await firstStudyMarks.evaluate((node) => document.activeElement === node), `${profile.name}: Study Marks trigger did not regain focus`);
    await assertWorkspaceUnchanged("Meaning to Study Marks switching");

    stage = "outside dismissal";
    await firstMeaning.focus();
    await firstMeaning.press("Enter");
    await waitFor(page, () => Boolean(document.querySelector(".word-meaning-menu:not([hidden])")));
    await outsideControl.click();
    await waitFor(page, () => !document.querySelector(".word-meaning-menu:not([hidden])"));
    await delay(100);
    const focusState = await page.evaluate(() => ({
      outsideFocused: document.activeElement?.id === "qa-word-meaning-outside-focus",
      meaningFocused: document.activeElement?.classList?.contains("word-meaning-trigger") || false,
    }));
    const after = await workspaceSnapshot(page);

    assert(
      focusState.outsideFocused && !focusState.meaningFocused,
      `${profile.name}: outside control did not retain focus after Meaning dismissal: ${JSON.stringify(focusState)}`,
    );
    assert(before === after, `${profile.name}: outside Meaning dismissal mutated workspace data`);

    stage = "detached Meaning cleanup";
    const preRerenderState = await page.evaluate(() => ({
      title: document.querySelector("#detailTitle")?.textContent,
      meanings: document.querySelectorAll(".word-meaning-control").length,
      hash: location.hash,
      focus: document.activeElement?.id || document.activeElement?.className || document.activeElement?.tagName,
    }));
    assert(preRerenderState.meanings >= 2, `${profile.name}: Language Study rerendered unexpectedly before cleanup test: ${JSON.stringify(preRerenderState)}`);
    await firstMeaning.focus();
    await firstMeaning.press("Enter");
    await waitFor(page, () => Boolean(document.querySelector(".word-meaning-menu:not([hidden])")));
    await page.evaluate(() => {
      const current = [...document.querySelectorAll("#detailContext .verse-context-tab")]
        .find((button) => !button.disabled && button.getAttribute("aria-current") !== "page");
      if (!current) throw new Error("No non-destructive detail rerender control is available");
      current.dataset.qaRerenderTarget = "true";
      window.__detachedMeaningRoot = document.querySelector('.interlinear-verse-section[data-verse="1"] .word-meaning-control');
      current.focus();
    });
    await page.locator('[data-qa-rerender-target="true"]').press("Enter");
    await waitFor(page, () => Boolean(window.__detachedMeaningRoot && !window.__detachedMeaningRoot.isConnected));
    await page.locator("#themeToggle").focus();
    await page.locator("#themeToggle").press("Escape");
    const detachedState = await page.evaluate(() => ({
      focusUnchanged: document.activeElement?.id === "themeToggle",
      visibleMeanings: document.querySelectorAll(".word-meaning-menu:not([hidden])").length,
      detachedExpanded: window.__detachedMeaningRoot?.querySelector(".word-meaning-trigger")?.getAttribute("aria-expanded"),
    }));
    assert(
      detachedState.focusUnchanged && detachedState.visibleMeanings === 0 && detachedState.detachedExpanded === "false",
      `${profile.name}: detached Meaning owner responded to Escape: ${JSON.stringify(detachedState)}`,
    );
    await assertWorkspaceUnchanged("detached Meaning cleanup");

    stage = "closed-state Escape";
    const closedEscapeTarget = page.locator("#themeToggle");
    await closedEscapeTarget.focus();
    await closedEscapeTarget.press("Escape");
    assert(await closedEscapeTarget.evaluate((node) => document.activeElement === node), `${profile.name}: closed-state Escape moved focus`);
    assert(
      await page.evaluate(() => !document.querySelector(".word-meaning-menu:not([hidden])") &&
        !document.querySelector('.target-tag-picker-menu[data-menu-open="true"]')),
      `${profile.name}: closed-state Escape exposed an overlay`,
    );
    await assertWorkspaceUnchanged("closed-state Escape");

    return { name: profile.name, assertions: profile.mobile ? 18 : 20 };
  } catch (error) {
    error.message = `${profile.name} at ${stage}: ${error.message}`;
    throw error;
  } finally {
    await context.close();
  }
}

async function main() {
  const { server, url } = await startStaticAppServer({ port: 0 });
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
    const profiles = [
      { name: "desktop", viewport: { width: 1280, height: 720 }, mobile: false },
      { name: "mobile", viewport: { width: 390, height: 844 }, mobile: true },
    ];
    const completed = [];
    for (const profile of profiles) completed.push(await runProfile(browser, url, profile));
    console.log(JSON.stringify({
      status: "ok",
      profiles: completed.map(({ name }) => name),
      assertions: completed.reduce((total, profile) => total + profile.assertions, 0),
    }, null, 2));
  } finally {
    await browser.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

await main();
