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

async function waitFor(page, predicate, argument = undefined, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate, argument)) return;
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

async function readerContextSnapshot(page) {
  return page.evaluate(() => JSON.stringify({
    route: location.hash,
    documentScroll: { x: window.scrollX, y: window.scrollY },
    readerScroll: {
      left: document.querySelector("#chapterContent")?.scrollLeft || 0,
      top: document.querySelector("#chapterContent")?.scrollTop || 0,
    },
    highlightedContext: [...document.querySelectorAll(
      ".reader-context-verse, .reader-context-word, .reader-context-phrase-verse, .selected-range",
    )].map((node) => ({
      className: node.className,
      interlinearKey: node.dataset.interlinearKey || "",
      strongCode: node.dataset.strongCode || "",
      textSpanCharEnd: node.dataset.textSpanCharEnd || "",
      textSpanCharStart: node.dataset.textSpanCharStart || "",
      textSpanTargetId: node.dataset.textSpanTargetId || "",
      tokenIndex: node.dataset.tokenIndex || "",
      verse: node.dataset.verse || "",
    })),
    browserHistoryLength: history.length,
    readerNavigation: history.state?.bibleAppReaderNavigation || null,
  }));
}

async function waitForStableReaderContext(page, { timeoutMs = 3000, stableSamples = 3 } = {}) {
  const startedAt = Date.now();
  const recentSamples = [];
  let previous = null;
  let consecutive = 0;
  while (Date.now() - startedAt < timeoutMs) {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    const current = await readerContextSnapshot(page);
    recentSamples.push(JSON.parse(current));
    if (recentSamples.length > 6) recentSamples.shift();
    if (current === previous) consecutive += 1;
    else consecutive = 1;
    if (consecutive >= stableSamples) return current;
    previous = current;
  }
  throw new Error(`Reader context did not stabilize: ${JSON.stringify(recentSamples)}`);
}

function findRendering(snapshot, targetId) {
  const tokenRenderings = JSON.parse(snapshot).tokenRenderings || {};
  for (const verseBucket of Object.values(tokenRenderings)) {
    for (const record of Object.values(verseBucket || {})) {
      if (record?.target_id === targetId || record?.target?.target_id === targetId) return record;
    }
  }
  return null;
}

async function assertSurface(page, profile, kind, targetId) {
  try {
    await waitFor(page, () => {
      const content = document.querySelector("#detailToolContent");
      return Boolean(content && document.activeElement && content.contains(document.activeElement));
    });
  } catch (error) {
    const diagnostics = await page.evaluate(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const content = document.querySelector("#detailToolContent");
      const active = document.activeElement;
      const focusTarget = content?.querySelector(".word-meaning-option, .tag-picker-option, button:not([disabled])");
      let manualFocusSucceeded = false;
      if (focusTarget) {
        focusTarget.focus({ preventScroll: true });
        manualFocusSucceeded = document.activeElement === focusTarget;
      }
      return {
        activeElement: active ? `${active.tagName}#${active.id}.${active.className}` : null,
        surfaceKind: document.querySelector("#detailToolSurface")?.dataset.toolKind,
        surfaceHidden: document.querySelector("#detailToolSurface")?.hidden,
        contentChildren: content?.childElementCount,
        contentButtons: content?.querySelectorAll("button").length,
        expanded: [...document.querySelectorAll('[aria-expanded="true"]')]
          .map((node) => `${node.tagName}#${node.id}.${node.className}:${node.dataset.wordMeaningTargetId || node.dataset.studyMarksTargetId || ""}`),
        manualFocusSucceeded,
      };
    });
    error.message += `; diagnostics=${JSON.stringify(diagnostics)}`;
    throw error;
  }
  const state = await page.evaluate(({ expectedKind, expectedTargetId }) => {
    const pane = document.querySelector(".detail-pane");
    const surface = document.querySelector("#detailToolSurface");
    const workArea = document.querySelector("#detailWorkArea");
    const content = document.querySelector("#detailToolContent");
    const paneBounds = pane?.getBoundingClientRect();
    const surfaceBounds = surface?.getBoundingClientRect();
    const active = document.activeElement;
    return {
      surfaceCount: document.querySelectorAll("#detailToolSurface").length,
      hidden: surface?.hidden,
      ariaHidden: surface?.getAttribute("aria-hidden"),
      kind: surface?.dataset.toolKind,
      targetId: surface?.dataset.targetId,
      title: document.querySelector("#detailToolTitle")?.textContent?.trim(),
      workAreaInert: Boolean(workArea?.inert || workArea?.hasAttribute("inert")),
      workAreaAriaHidden: workArea?.getAttribute("aria-hidden"),
      focusInside: Boolean(active && content?.contains(active)),
      contained:
        Boolean(paneBounds && surfaceBounds) &&
        surfaceBounds.left >= paneBounds.left - 1 &&
        surfaceBounds.right <= paneBounds.right + 1 &&
        surfaceBounds.top >= paneBounds.top - 1 &&
        surfaceBounds.bottom <= paneBounds.bottom + 1,
      position: surface ? getComputedStyle(surface).position : "",
      expectedKind,
      expectedTargetId,
    };
  }, { expectedKind: kind, expectedTargetId: targetId });
  assert(
    state.surfaceCount === 1 && !state.hidden && state.ariaHidden === "false" &&
      state.kind === kind && state.targetId === targetId,
    `${profile.name}: contained tool state is incorrect: ${JSON.stringify(state)}`,
  );
  assert(
    state.workAreaInert && state.workAreaAriaHidden === "true",
    `${profile.name}: underlying detail work area was not inert: ${JSON.stringify(state)}`,
  );
  assert(
    state.contained && state.position !== "fixed",
    `${profile.name}: ${kind} escaped the detail pane or used page-level fixed positioning: ${JSON.stringify(state)}`,
  );
  return state;
}

async function assertSurfaceClosed(page, profile, label) {
  const state = await page.evaluate(() => {
    const surface = document.querySelector("#detailToolSurface");
    const workArea = document.querySelector("#detailWorkArea");
    return {
      hidden: surface?.hidden,
      ariaHidden: surface?.getAttribute("aria-hidden"),
      kind: surface?.dataset.toolKind || "",
      targetId: surface?.dataset.targetId || "",
      contentChildren: document.querySelector("#detailToolContent")?.childElementCount,
      workAreaInert: Boolean(workArea?.inert || workArea?.hasAttribute("inert")),
      workAreaAriaHidden: workArea?.getAttribute("aria-hidden"),
    };
  });
  assert(
    state.hidden && state.ariaHidden === "true" && !state.kind && !state.targetId &&
      state.contentChildren === 0 && !state.workAreaInert && state.workAreaAriaHidden !== "true",
    `${profile.name}: ${label} left stale contained-tool state: ${JSON.stringify(state)}`,
  );
}

async function exerciseDelayedSavedMeaningFocus(page, profile) {
  const fixture = await page.evaluate(async () => {
    const [{ createWordMeaningControl }, { createSourceTokenTarget }] = await Promise.all([
      import(new URL("./src/word-meaning.js", document.baseURI).href),
      import(new URL("./src/semantic-targets.js", document.baseURI).href),
    ]);
    const target = createSourceTokenTarget({
      translation_id: "bsb",
      testament: "old",
      book_id: "proverbs",
      chapter: 1,
      verse: 1,
    }, {
      token_index: 999,
      strong_code: "H9999",
      language: "hebrew",
      original: "qa",
    }, "bsb");
    const state = {
      workspaceStore: {
        token_renderings: {
          "proverbs:1:1": {
            999: {
              schema_version: 2,
              rendering: "W".repeat(180),
              original: "qa",
              strong_code: "H9999",
              target,
              target_id: target.target_id,
              reference_key: "proverbs:1:1",
              token_index: 999,
            },
          },
        },
      },
    };
    let resolveExact;
    const exactPromise = new Promise((resolve) => {
      resolveExact = resolve;
    });
    const control = createWordMeaningControl({
      state,
      target,
      token: {},
      label: "delayed saved QA token",
      presentation: "detail-pane",
      loadExactMappedEnglish: () => exactPromise,
    });
    control.id = "delayedSavedMeaningFixture";
    document.querySelector("#detailContent")?.append(control);
    window.__resolveDelayedSavedMeaning = resolveExact;
    return { targetId: target.target_id };
  });

  const root = page.locator("#delayedSavedMeaningFixture");
  const trigger = root.locator(".word-meaning-trigger");
  const badge = root.locator(".word-meaning-badge");
  await trigger.click();
  await waitFor(page, () => Boolean(document.querySelector("#detailToolContent .word-meaning-remove")));
  const savedLayout = await page.evaluate(() => {
    const content = document.querySelector("#detailToolContent");
    const saved = content?.querySelector(".word-meaning-saved-actions > span");
    const contentBounds = content?.getBoundingClientRect();
    const savedBounds = saved?.getBoundingClientRect();
    return {
      contentOverflow: content ? content.scrollWidth - content.clientWidth : null,
      contained: Boolean(contentBounds && savedBounds) &&
        savedBounds.left >= contentBounds.left - 1 && savedBounds.right <= contentBounds.right + 1,
      text: saved?.textContent || "",
    };
  });
  assert(
    savedLayout.contentOverflow <= 1 && savedLayout.contained && savedLayout.text.includes("W".repeat(180)),
    `${profile.name}: maximum-length unbroken saved Meaning overflowed its contained surface: ${JSON.stringify(savedLayout)}`,
  );
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.locator("#detailToolContent .word-meaning-remove").focus();
  await waitFor(page, () => document.activeElement?.classList.contains("word-meaning-remove"));
  await page.evaluate(() => window.__resolveDelayedSavedMeaning?.("Lazy exact QA"));
  await waitFor(page, () => (
    Boolean(document.querySelector('#detailToolContent .word-meaning-option[data-source="exact_bsb"]')) &&
    document.activeElement?.classList.contains("word-meaning-remove")
  ));
  assert(
    await page.evaluate(() => (
      !document.querySelector("#detailToolSurface")?.hidden &&
      document.querySelector("#detailToolContent")?.contains(document.activeElement)
    )),
    `${profile.name}: lazy Meaning rerender moved Remove focus outside the contained tool`,
  );
  await page.keyboard.press("Escape");
  await waitFor(page, () => document.querySelector("#detailToolSurface")?.hidden === true);
  await waitFor(page, () => document.activeElement === document.querySelector("#delayedSavedMeaningFixture .word-meaning-trigger"));

  await badge.click();
  await waitFor(page, (targetId) => document.querySelector("#detailToolSurface")?.dataset.targetId === targetId, fixture.targetId);
  await page.evaluate(async () => {
    const marker = document.createElement("span");
    marker.hidden = true;
    document.querySelector("#detailToolContent")?.append(marker);
    marker.remove();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const badgeOwnership = await page.evaluate(() => ({
    badgeConnected: Boolean(document.querySelector("#delayedSavedMeaningFixture .word-meaning-badge")?.isConnected),
    badgeExpanded: document.querySelector("#delayedSavedMeaningFixture .word-meaning-badge")?.getAttribute("aria-expanded"),
    surfaceOpen: !document.querySelector("#detailToolSurface")?.hidden,
  }));
  assert(
    badgeOwnership.badgeConnected && badgeOwnership.badgeExpanded === "true" && badgeOwnership.surfaceOpen,
    `${profile.name}: shared surface migrated ownership away from its connected saved badge: ${JSON.stringify(badgeOwnership)}`,
  );
  await page.keyboard.press("Escape");
  await waitFor(page, () => document.querySelector("#detailToolSurface")?.hidden === true);
  await waitFor(page, () => document.activeElement === document.querySelector("#delayedSavedMeaningFixture .word-meaning-badge"));
  assert(
    await badge.evaluate((node) => document.activeElement === node),
    `${profile.name}: delayed Meaning rerender did not restore its still-connected badge opener`,
  );
  await root.evaluate((node) => node.remove());
  await page.evaluate(() => delete window.__resolveDelayedSavedMeaning);
}

async function runProfile(browser, url, profile) {
  const context = await browser.newContext({
    viewport: profile.viewport,
    isMobile: profile.mobile,
    hasTouch: profile.mobile,
    deviceScaleFactor: profile.mobile ? 3 : 1,
    userAgent: profile.mobile
      ? "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0 Mobile Safari/537.36 BibleAppQA"
      : undefined,
  });
  const page = await context.newPage();
  const failures = [];
  let stage = "navigate";
  let clearEscapeEvidence = null;

  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    failures.push(`requestfailed: ${request.method()} ${request.url()} (${request.failure()?.errorText || "unknown"})`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) failures.push(`response: ${response.status()} ${response.url()}`);
  });

  const assertWorkspaceUnchanged = async (before, label) => {
    const after = await workspaceSnapshot(page);
    assert(
      before === after,
      `${profile.name}: ${label} mutated token renderings, Study Marks, jobs, IndexedDB, or local storage`,
    );
  };

  try {
    await page.goto(`${url}/#/read/bsb/proverbs/1/1`, { waitUntil: "load" });
    await waitFor(page, () => Boolean(document.querySelector("#chapterTitle")?.textContent.includes("Proverbs 1")));

    stage = "open verse context";
    await page.locator(".verse-study-button").first().evaluate((button, mobile) => {
      if (mobile) {
        document.querySelectorAll("[data-qa-word-meaning-drawer-invoker]")
          .forEach((node) => node.removeAttribute("data-qa-word-meaning-drawer-invoker"));
        button.setAttribute("data-qa-word-meaning-drawer-invoker", "true");
      }
      button.click();
    }, profile.mobile);
    await waitFor(page, () =>
      [...document.querySelectorAll("#detailContext .verse-context-tab")].some(
        (button) => button.textContent.trim() === "Int" && !button.disabled,
      ),
    );

    stage = "open Language Study";
    await page.locator("#detailContext .verse-context-tab").filter({ hasText: /^Int$/ }).first().click();
    await waitFor(page, () => document.querySelector("#detailTitle")?.textContent === "Language Study");
    await waitFor(page, () =>
      document.querySelectorAll('.interlinear-verse-section[data-verse="1"] .word-meaning-control').length >= 2,
    );

    stage = "prepare exact-token controls";
    const cardSelector = '.interlinear-verse-section[data-verse="1"] .interlinear-token:has(.word-meaning-control)';
    const cards = page.locator(cardSelector);
    assert((await cards.count()) >= 2, `${profile.name}: two exact-token Meaning controls were not rendered`);
    const firstCard = cards.nth(0);
    const secondCard = cards.nth(1);
    const firstMeaning = firstCard.locator(".word-meaning-trigger");
    const secondMeaning = secondCard.locator(".word-meaning-trigger");
    const firstStudyMarks = firstCard.locator(".study-marks-trigger");
    const targets = await page.evaluate((selector) => {
      const cards = [...document.querySelectorAll(selector)].slice(0, 2);
      return cards.map((card) => ({
        meaning: card.querySelector(".word-meaning-trigger")?.dataset.wordMeaningTargetId,
        marks: card.querySelector(".study-marks-trigger")?.dataset.studyMarksTargetId,
      }));
    }, cardSelector);
    assert(
      targets.length === 2 && targets[0].meaning && targets[1].meaning &&
        targets[0].meaning !== targets[1].meaning && targets[0].meaning === targets[0].marks,
      `${profile.name}: exact canonical source-token identities were not distinct and shared: ${JSON.stringify(targets)}`,
    );
    const firstTargetId = targets[0].meaning;
    const secondTargetId = targets[1].meaning;
    const baseline = await workspaceSnapshot(page);
    let historyBaseline = await page.evaluate(() => ({
      hash: location.hash,
      browserLength: history.length,
      title: document.querySelector("#detailTitle")?.textContent,
      backDisabled: document.querySelector("#detailBack")?.disabled,
      forwardDisabled: document.querySelector("#detailForward")?.disabled,
    }));

    stage = "Study Marks requires explicit activation";
    await firstStudyMarks.focus();
    assert(
      await page.evaluate(() => document.querySelector("#detailToolSurface")?.hidden === true),
      `${profile.name}: focusing Study Marks opened a large contained tool`,
    );
    await firstStudyMarks.press("Enter");
    await waitFor(page, () => document.querySelector("#detailToolSurface")?.dataset.toolKind === "study-marks");
    await assertSurface(page, profile, "study-marks", firstTargetId);
    const marksState = await page.evaluate((targetId) => ({
      hasContainedPicker: Boolean(document.querySelector("#detailToolContent .contained-target-tag-picker")),
      hasPreview: Boolean(document.querySelector("#detailToolContent .target-tag-picker-preview")?.textContent?.trim()),
      options: document.querySelectorAll("#detailToolContent .tag-picker-option").length,
      favorite: [...document.querySelectorAll("#detailToolContent .tag-picker-option")]
        .some((button) => /favorite/i.test(button.textContent || button.getAttribute("aria-label") || "")),
      triggerExpanded: document.querySelector(`[data-study-marks-target-id="${CSS.escape(targetId)}"]`)?.getAttribute("aria-expanded"),
    }), firstTargetId);
    assert(
      marksState.hasContainedPicker && marksState.hasPreview && marksState.options > 0 &&
        marksState.favorite && marksState.triggerExpanded === "true",
      `${profile.name}: contained Study Marks omitted target preview, Favorite, tags, or trigger state: ${JSON.stringify(marksState)}`,
    );

    stage = "Study Marks to Meaning replacement";
    await page.evaluate((targetId) => {
      const trigger = [...document.querySelectorAll("button[data-word-meaning-target-id]")]
        .find((button) => button.dataset.wordMeaningTargetId === targetId && button.classList.contains("word-meaning-trigger"));
      trigger?.click();
    }, firstTargetId);
    await waitFor(page, () => document.querySelector("#detailToolSurface")?.dataset.toolKind === "meaning");
    await assertSurface(page, profile, "meaning", firstTargetId);
    const marksToMeaning = await page.evaluate((targetId) => ({
      marksExpanded: [...document.querySelectorAll("button[data-study-marks-target-id]")]
        .find((button) => button.dataset.studyMarksTargetId === targetId)?.getAttribute("aria-expanded"),
      meaningExpanded: [...document.querySelectorAll("button.word-meaning-trigger[data-word-meaning-target-id]")]
        .find((button) => button.dataset.wordMeaningTargetId === targetId)?.getAttribute("aria-expanded"),
      containedMeaning: Boolean(document.querySelector("#detailToolContent .word-meaning-contained")),
      fixedPopoverVisible: document.querySelectorAll(".word-meaning-menu:not([hidden])").length,
    }), firstTargetId);
    assert(
      marksToMeaning.marksExpanded === "false" && marksToMeaning.meaningExpanded === "true" &&
        marksToMeaning.containedMeaning && marksToMeaning.fixedPopoverVisible === 0,
      `${profile.name}: Study Marks and Meaning competed for overlay ownership: ${JSON.stringify(marksToMeaning)}`,
    );

    stage = "lazy Meaning candidates";
    await waitFor(page, () => {
      const content = document.querySelector("#detailToolContent");
      const sourced = [...content.querySelectorAll(".word-meaning-option[data-source]")];
      return Boolean(content.querySelector(".word-meaning-other")) &&
        sourced.some((option) => option.dataset.source === "exact_bsb") &&
        sourced.some((option) => option.dataset.source === "lexicon") &&
        content.contains(document.activeElement);
    });
    const candidateState = await page.evaluate(() => ({
      other: Boolean(document.querySelector("#detailToolContent .word-meaning-other")),
      sources: [...document.querySelectorAll("#detailToolContent .word-meaning-option[data-source]")]
        .map((button) => button.dataset.source),
      firstControlFocused: Boolean(document.activeElement?.closest("#detailToolContent")),
    }));
    assert(
      candidateState.other && candidateState.firstControlFocused &&
        candidateState.sources.includes("exact_bsb") && candidateState.sources.includes("lexicon"),
      `${profile.name}: lazy exact-English or lexicon Meaning choices did not load: ${JSON.stringify(candidateState)}`,
    );

    stage = "Meaning Escape restoration";
    await page.keyboard.press("Escape");
    await waitFor(page, () => document.querySelector("#detailToolSurface")?.hidden === true);
    await waitFor(page, (targetId) => document.activeElement?.dataset.wordMeaningTargetId === targetId, firstTargetId);
    await assertSurfaceClosed(page, profile, "Meaning Escape");
    assert(
      await firstMeaning.evaluate((node) => document.activeElement === node),
      `${profile.name}: Meaning Escape did not restore the exact trigger focus`,
    );
    await assertWorkspaceUnchanged(baseline, "Study Marks/Meaning open, replacement, and Escape");

    stage = "Meaning A to Meaning B replacement";
    await firstMeaning.press("Enter");
    await waitFor(page, (targetId) => document.querySelector("#detailToolSurface")?.dataset.targetId === targetId, firstTargetId);
    await page.evaluate((targetId) => {
      const trigger = [...document.querySelectorAll("button.word-meaning-trigger[data-word-meaning-target-id]")]
        .find((button) => button.dataset.wordMeaningTargetId === targetId);
      trigger?.click();
    }, secondTargetId);
    await waitFor(page, (targetId) => document.querySelector("#detailToolSurface")?.dataset.targetId === targetId, secondTargetId);
    await assertSurface(page, profile, "meaning", secondTargetId);
    const meaningSwitch = await page.evaluate(({ firstId, secondId }) => {
      const triggers = [...document.querySelectorAll("button.word-meaning-trigger[data-word-meaning-target-id]")];
      return {
        firstExpanded: triggers.find((button) => button.dataset.wordMeaningTargetId === firstId)?.getAttribute("aria-expanded"),
        secondExpanded: triggers.find((button) => button.dataset.wordMeaningTargetId === secondId)?.getAttribute("aria-expanded"),
      };
    }, { firstId: firstTargetId, secondId: secondTargetId });
    assert(
      meaningSwitch.firstExpanded === "false" && meaningSwitch.secondExpanded === "true",
      `${profile.name}: Meaning A to B did not leave B as the sole tool owner: ${JSON.stringify(meaningSwitch)}`,
    );
    await page.keyboard.press("Escape");
    await waitFor(page, () => document.querySelector("#detailToolSurface")?.hidden === true);
    await waitFor(page, (targetId) => document.activeElement?.dataset.wordMeaningTargetId === targetId, secondTargetId);
    assert(
      await secondMeaning.evaluate((node) => document.activeElement === node),
      `${profile.name}: Meaning B did not regain focus after replacement and Escape`,
    );
    await assertWorkspaceUnchanged(baseline, "Meaning A to B replacement");

    stage = "Meaning to Study Marks replacement";
    await firstMeaning.press("Enter");
    await waitFor(page, () => document.querySelector("#detailToolSurface")?.dataset.toolKind === "meaning");
    await page.evaluate((targetId) => {
      const trigger = [...document.querySelectorAll("button[data-study-marks-target-id]")]
        .find((button) => button.dataset.studyMarksTargetId === targetId);
      trigger?.click();
    }, firstTargetId);
    await waitFor(page, () => document.querySelector("#detailToolSurface")?.dataset.toolKind === "study-marks");
    await assertSurface(page, profile, "study-marks", firstTargetId);
    assert(
      await firstMeaning.getAttribute("aria-expanded") === "false",
      `${profile.name}: Meaning remained expanded behind Study Marks`,
    );
    await page.keyboard.press("Escape");
    await waitFor(page, () => document.querySelector("#detailToolSurface")?.hidden === true);
    await waitFor(page, (targetId) => document.activeElement?.dataset.studyMarksTargetId === targetId, firstTargetId);
    assert(
      await page.evaluate((targetId) => document.activeElement?.dataset.studyMarksTargetId === targetId, firstTargetId),
      `${profile.name}: Study Marks Escape did not restore its exact or stable replacement trigger focus`,
    );
    await assertWorkspaceUnchanged(baseline, "Meaning to Study Marks replacement");

    stage = "Meaning Cancel is data-neutral";
    await firstMeaning.focus();
    await firstMeaning.press("Enter");
    await waitFor(page, () => Boolean(document.querySelector("#detailToolContent .word-meaning-other")));
    await page.locator("#detailToolContent .word-meaning-other").click();
    await waitFor(page, () => document.activeElement?.classList.contains("word-meaning-custom-input"));
    await page.locator("#detailToolContent .word-meaning-custom-input").fill(`Unsaved ${profile.name} meaning`);
    await page.locator("#detailToolContent .word-meaning-cancel").click();
    await waitFor(page, () => document.querySelector("#detailToolSurface")?.hidden === true);
    await waitFor(page, (targetId) => document.activeElement?.dataset.wordMeaningTargetId === targetId, firstTargetId);
    assert(
      await firstMeaning.evaluate((node) => document.activeElement === node),
      `${profile.name}: Meaning Cancel did not restore the trigger focus`,
    );
    await assertWorkspaceUnchanged(baseline, "Meaning Cancel");

    stage = "Meaning Close is data-neutral";
    await firstMeaning.press("Enter");
    await waitFor(page, () => document.querySelector("#detailToolSurface")?.dataset.toolKind === "meaning");
    await page.locator("#detailToolClose").click();
    await waitFor(page, () => document.querySelector("#detailToolSurface")?.hidden === true);
    await waitFor(page, (targetId) => document.activeElement?.dataset.wordMeaningTargetId === targetId, firstTargetId);
    assert(
      await firstMeaning.evaluate((node) => document.activeElement === node),
      `${profile.name}: contained tool Close did not restore Meaning trigger focus`,
    );
    await assertWorkspaceUnchanged(baseline, "Meaning Close");

    stage = "save first exact Meaning";
    const firstValue = `QA ${profile.name} exact one`;
    await firstMeaning.press("Enter");
    await waitFor(page, () => Boolean(document.querySelector("#detailToolContent .word-meaning-other")));
    await page.locator("#detailToolContent .word-meaning-other").click();
    await page.locator("#detailToolContent .word-meaning-custom-input").fill(firstValue);
    await page.locator("#detailToolContent .word-meaning-save").click();
    await waitFor(page, () => document.querySelector("#detailToolSurface")?.hidden === true);
    await waitFor(page, ({ targetId, value }) => [...document.querySelectorAll(".word-meaning-badge")]
      .some((badge) => badge.dataset.wordMeaningTargetId === targetId && badge.textContent === value), {
      targetId: firstTargetId,
      value: firstValue,
    });
    const firstSavedSnapshot = await workspaceSnapshot(page);
    assert(
      findRendering(firstSavedSnapshot, firstTargetId)?.rendering === firstValue &&
        !findRendering(firstSavedSnapshot, secondTargetId),
      `${profile.name}: Save wrote beyond the first exact source token`,
    );

    stage = "save second exact Meaning";
    const secondValue = `QA ${profile.name} exact two`;
    await secondMeaning.focus();
    await secondMeaning.press("Enter");
    await waitFor(page, () => Boolean(document.querySelector("#detailToolContent .word-meaning-other")));
    await page.locator("#detailToolContent .word-meaning-other").click();
    await page.locator("#detailToolContent .word-meaning-custom-input").fill(secondValue);
    await page.locator("#detailToolContent .word-meaning-save").click();
    await waitFor(page, () => document.querySelector("#detailToolSurface")?.hidden === true);
    await waitFor(page, ({ targetId, value }) => [...document.querySelectorAll(".word-meaning-badge")]
      .some((badge) => badge.dataset.wordMeaningTargetId === targetId && badge.textContent === value), {
      targetId: secondTargetId,
      value: secondValue,
    });
    const bothSavedSnapshot = await workspaceSnapshot(page);
    assert(
      findRendering(bothSavedSnapshot, firstTargetId)?.rendering === firstValue &&
        findRendering(bothSavedSnapshot, secondTargetId)?.rendering === secondValue,
      `${profile.name}: exact-token saves collided: ${JSON.stringify({ firstTargetId, secondTargetId })}`,
    );

    stage = "remove first exact Meaning only";
    await firstMeaning.focus();
    await firstMeaning.press("Enter");
    await waitFor(page, () => Boolean(document.querySelector("#detailToolContent .word-meaning-remove")));
    await page.locator("#detailToolContent .word-meaning-remove").click();
    await waitFor(page, () => document.querySelector("#detailToolSurface")?.hidden === true);
    const removedSnapshot = await workspaceSnapshot(page);
    assert(
      !findRendering(removedSnapshot, firstTargetId) &&
        findRendering(removedSnapshot, secondTargetId)?.rendering === secondValue,
      `${profile.name}: Remove deleted the wrong source-token rendering`,
    );

    stage = "saved badge opener focus restoration";
    const secondBadge = secondCard.locator(`.word-meaning-badge[data-word-meaning-target-id="${secondTargetId}"]`);
    await secondBadge.focus();
    await secondBadge.press("Enter");
    await waitFor(page, (targetId) => document.querySelector("#detailToolSurface")?.dataset.targetId === targetId, secondTargetId);
    await page.locator("#detailToolClose").click();
    await waitFor(page, () => document.querySelector("#detailToolSurface")?.hidden === true);
    await waitFor(page, (targetId) => (
      document.activeElement?.classList.contains("word-meaning-badge") &&
      document.activeElement?.dataset.wordMeaningTargetId === targetId
    ), secondTargetId);
    assert(
      await secondBadge.evaluate((node) => document.activeElement === node),
      `${profile.name}: closing a badge-opened Meaning did not restore badge focus`,
    );
    await assertWorkspaceUnchanged(removedSnapshot, "saved badge open and Close");

    if (!profile.mobile) {
      stage = "delayed saved Meaning focus stability";
      await exerciseDelayedSavedMeaningFocus(page, profile);
      await assertWorkspaceUnchanged(removedSnapshot, "delayed saved Meaning focus fixture");
    }

    stage = "detail history cleanup and restoration";
    if (!(await page.locator("#detailBack").isEnabled())) {
      const strongLink = page.locator("#detailContent .token-meta button:not([disabled])").first();
      assert(await strongLink.count(), `${profile.name}: no Strong's control was available to establish panel history`);
      await strongLink.click();
      await waitFor(page, () => document.querySelector("#detailTitle")?.textContent !== "Language Study");
      await page.locator(".verse-study-button").first().evaluate((button) => button.click());
      await waitFor(page, () => [...document.querySelectorAll("#detailContext .verse-context-tab")]
        .some((button) => button.textContent.trim() === "Int" && !button.disabled));
      await page.locator("#detailContext .verse-context-tab").filter({ hasText: /^Int$/ }).first().click();
      await waitFor(page, () => document.querySelector("#detailTitle")?.textContent === "Language Study" &&
        document.querySelectorAll('.interlinear-verse-section[data-verse="1"] .word-meaning-control').length >= 2);
    }
    assert(await page.locator("#detailBack").isEnabled(), `${profile.name}: failed to establish panel Back history`);
    historyBaseline = await page.evaluate(() => ({
      hash: location.hash,
      browserLength: history.length,
      title: document.querySelector("#detailTitle")?.textContent,
      backDisabled: document.querySelector("#detailBack")?.disabled,
      forwardDisabled: document.querySelector("#detailForward")?.disabled,
    }));
    await secondMeaning.focus();
    await secondMeaning.press("Enter");
    await waitFor(page, (targetId) => document.querySelector("#detailToolSurface")?.dataset.targetId === targetId, secondTargetId);
    await page.evaluate(() => {
      document.querySelector("#detailBack")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await waitFor(page, () => document.querySelector("#detailToolSurface")?.hidden === true &&
      document.querySelector("#detailForward")?.disabled === false);
    await assertSurfaceClosed(page, profile, "detail Back");
    assert(await page.locator("#detailForward").isEnabled(), `${profile.name}: detail Back did not enable Forward`);
    await page.locator("#detailForward").click();
    await waitFor(page, ({ targetId, value }) => document.querySelector("#detailTitle")?.textContent === "Language Study" &&
      [...document.querySelectorAll(".word-meaning-badge")]
        .some((badge) => badge.dataset.wordMeaningTargetId === targetId && badge.textContent === value), {
      targetId: secondTargetId,
      value: secondValue,
    });
    await assertWorkspaceUnchanged(removedSnapshot, "detail Back/Forward contained-tool cleanup");

    stage = "detail history invariants";
    const historyAfterTools = await page.evaluate(() => ({
      hash: location.hash,
      browserLength: history.length,
      title: document.querySelector("#detailTitle")?.textContent,
      backDisabled: document.querySelector("#detailBack")?.disabled,
      forwardDisabled: document.querySelector("#detailForward")?.disabled,
    }));
    assert(
      historyAfterTools.hash === historyBaseline.hash &&
        historyAfterTools.browserLength === historyBaseline.browserLength &&
        historyAfterTools.title === historyBaseline.title &&
        historyAfterTools.backDisabled === historyBaseline.backDisabled &&
        historyAfterTools.forwardDisabled === historyBaseline.forwardDisabled,
      `${profile.name}: tools added duplicate browser/detail history: ${JSON.stringify({ historyBaseline, historyAfterTools })}`,
    );

    stage = "route-change cleanup";
    const restoredSecondMeaning = page.locator(
      `button.word-meaning-trigger[data-word-meaning-target-id="${secondTargetId}"]`,
    ).first();
    await restoredSecondMeaning.focus();
    await restoredSecondMeaning.press("Enter");
    await waitFor(page, (targetId) => document.querySelector("#detailToolSurface")?.dataset.targetId === targetId, secondTargetId);
    await page.evaluate(() => { location.hash = "#/read/bsb/proverbs/1/2"; });
    await waitFor(page, () => location.hash === "#/read/bsb/proverbs/1/2" &&
      document.querySelector("#detailToolSurface")?.hidden === true);
    await assertSurfaceClosed(page, profile, "route change");
    await assertWorkspaceUnchanged(removedSnapshot, "route-change cleanup");

    stage = "Clear cleanup";
    let clearMeaning = page.locator(
      `button.word-meaning-trigger[data-word-meaning-target-id="${secondTargetId}"]`,
    ).first();
    if (profile.mobile) {
      const readerInvoker = page.locator("#chapterContent .strong-token").first();
      await readerInvoker.evaluate((button) => {
        document.querySelectorAll("[data-qa-word-meaning-drawer-invoker]")
          .forEach((node) => node.removeAttribute("data-qa-word-meaning-drawer-invoker"));
        button.setAttribute("data-qa-word-meaning-drawer-invoker", "true");
        button.click();
      });
      await waitFor(page, () => document.querySelector("#detailTitle")?.textContent === "Strong's" &&
        Boolean(document.querySelector("#detailContext button.word-meaning-trigger")) &&
        Boolean(document.querySelector(".reader-context-word")));
      clearMeaning = page.locator("#detailContext button.word-meaning-trigger").first();
    } else if (!(await clearMeaning.count())) {
      await page.locator(".verse-study-button").nth(1).evaluate((button, mobile) => {
        if (mobile) {
          document.querySelectorAll("[data-qa-word-meaning-drawer-invoker]")
            .forEach((node) => node.removeAttribute("data-qa-word-meaning-drawer-invoker"));
          button.setAttribute("data-qa-word-meaning-drawer-invoker", "true");
        }
        button.click();
      }, profile.mobile);
      await waitFor(page, () => [...document.querySelectorAll("#detailContext .verse-context-tab")]
        .some((button) => button.textContent.trim() === "Int" && !button.disabled));
      await page.locator("#detailContext .verse-context-tab").filter({ hasText: /^Int$/ }).first().click();
      await waitFor(page, () => Boolean(document.querySelector("button.word-meaning-trigger")));
      clearMeaning = page.locator("button.word-meaning-trigger").first();
    }
    await clearMeaning.focus();
    await clearMeaning.press("Enter");
    await waitFor(page, () => document.querySelector("#detailToolSurface")?.dataset.toolKind === "meaning");
    if (profile.mobile) {
      await page.locator("#clearDetail").evaluate((button) => button.focus({ preventScroll: true }));
      await waitFor(page, () => document.activeElement === document.querySelector("#clearDetail"));
    }
    const readerContextBeforeClear = profile.mobile
      ? await waitForStableReaderContext(page)
      : await readerContextSnapshot(page);
    if (profile.mobile) {
      assert(
        JSON.parse(readerContextBeforeClear).highlightedContext.some((entry) =>
          entry.className.includes("reader-context-word")),
        `${profile.name}: mobile Clear baseline did not begin from a committed Reader word highlight`,
      );
    }
    if (profile.mobile) {
      await page.locator("#clearDetail").evaluate((button) => button.click());
    } else {
      await page.locator("#clearDetail").click();
    }
    await waitFor(page, () => document.querySelector("#detailToolSurface")?.hidden === true &&
      document.querySelector("#detailTitle")?.textContent === "Details");
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)))));
    await assertSurfaceClosed(page, profile, "Clear");
    await assertWorkspaceUnchanged(removedSnapshot, "Clear cleanup");

    if (profile.mobile) {
      stage = "post-Clear open drawer";
      await waitFor(page, () => document.activeElement === document.querySelector("#clearDetail"));
      const afterClear = await page.evaluate(() => {
        const pane = document.querySelector(".detail-pane");
        const surface = document.querySelector("#detailToolSurface");
        return {
          activeId: document.activeElement?.id || "",
          ariaHidden: pane?.getAttribute("aria-hidden"),
          displayedView: pane?.dataset.displayedView || "",
          inert: Boolean(pane?.inert || pane?.hasAttribute("inert")),
          meaningSurfaceClosed: Boolean(surface?.hidden && surface?.getAttribute("aria-hidden") === "true"),
          mode: pane?.dataset.panelMode || "",
          modeStatus: document.querySelector("#detailModeStatus")?.textContent.trim() || "",
          open: pane?.classList.contains("visible"),
          title: document.querySelector("#detailTitle")?.textContent || "",
        };
      });
      assert(
        afterClear.open && afterClear.ariaHidden !== "true" && !afterClear.inert &&
          afterClear.title === "Details" && !afterClear.displayedView &&
          afterClear.mode === "follow" && afterClear.modeStatus === "Following" &&
          afterClear.activeId === "clearDetail" && afterClear.meaningSurfaceClosed,
        `${profile.name}: Clear did not retain a truthful focused open drawer: ${JSON.stringify(afterClear)}`,
      );
      const readerContextAfterClear = await waitForStableReaderContext(page);
      assert(
        readerContextAfterClear === readerContextBeforeClear,
        `${profile.name}: Clear changed Reader route, scroll, highlight, phrase, canonical context, or history: ${JSON.stringify({
          before: JSON.parse(readerContextBeforeClear),
          after: JSON.parse(readerContextAfterClear),
        })}`,
      );

      stage = "post-Clear drawer Escape close";
      await page.keyboard.press("Escape");
      await waitFor(page, () => {
        const pane = document.querySelector(".detail-pane");
        const expectedInvoker = document.querySelector("[data-qa-word-meaning-drawer-invoker='true']");
        const expectedInvokerAvailable = Boolean(
          expectedInvoker?.isConnected && expectedInvoker.getClientRects().length &&
          !expectedInvoker.closest("[hidden], [inert], [aria-hidden='true']"),
        );
        return Boolean(
          !pane?.classList.contains("visible") &&
          pane?.getAttribute("aria-hidden") === "true" &&
          (pane?.inert || pane?.hasAttribute("inert")) &&
          !pane?.contains(document.activeElement) &&
          (expectedInvokerAvailable
            ? document.activeElement === expectedInvoker
            : document.activeElement === document.querySelector("#openStudyPanel")),
        );
      });
      const afterEscape = await page.evaluate(() => {
        const pane = document.querySelector(".detail-pane");
        const surface = document.querySelector("#detailToolSurface");
        const expectedInvoker = document.querySelector("[data-qa-word-meaning-drawer-invoker='true']");
        const expectedInvokerAvailable = Boolean(
          expectedInvoker?.isConnected && expectedInvoker.getClientRects().length &&
          !expectedInvoker.closest("[hidden], [inert], [aria-hidden='true']"),
        );
        const focusableSelector = [
          "a[href]",
          "button:not([disabled])",
          "input:not([disabled]):not([type='hidden'])",
          "select:not([disabled])",
          "textarea:not([disabled])",
          "[tabindex]:not([tabindex='-1'])",
        ].join(",");
        const sequentiallyFocusableDescendants = [...(pane?.querySelectorAll(focusableSelector) || [])]
          .filter((node) => node.tabIndex >= 0 && node.getClientRects().length &&
            !node.closest("[hidden], [inert], [aria-hidden='true']"));
        return {
          activeClass: document.activeElement?.className || "",
          activeId: document.activeElement?.id || "",
          activeInside: pane?.contains(document.activeElement) || false,
          ariaHidden: pane?.getAttribute("aria-hidden"),
          expectedInvokerAvailable,
          expectedInvokerFocused: document.activeElement === expectedInvoker,
          inert: Boolean(pane?.inert || pane?.hasAttribute("inert")),
          launcherExpanded: document.querySelector("#openStudyPanel")?.getAttribute("aria-expanded"),
          launcherFocused: document.activeElement === document.querySelector("#openStudyPanel"),
          meaningSurfaceClosed: Boolean(surface?.hidden && surface?.getAttribute("aria-hidden") === "true"),
          open: pane?.classList.contains("visible"),
          sequentiallyFocusableDescendants: sequentiallyFocusableDescendants.length,
        };
      });
      assert(
        !afterEscape.open && afterEscape.ariaHidden === "true" && afterEscape.inert &&
          afterEscape.launcherExpanded === "false" && !afterEscape.activeInside &&
          afterEscape.sequentiallyFocusableDescendants === 0 && afterEscape.meaningSurfaceClosed &&
          (afterEscape.expectedInvokerAvailable
            ? afterEscape.expectedInvokerFocused
            : afterEscape.launcherFocused),
        `${profile.name}: Escape did not close, inert, and restore focus truthfully: ${JSON.stringify(afterEscape)}`,
      );
      const readerContextAfterEscape = await waitForStableReaderContext(page);
      assert(
        readerContextAfterEscape === readerContextBeforeClear,
        `${profile.name}: drawer Escape changed Reader route, scroll, highlight, phrase, canonical context, or history: ${JSON.stringify({
          before: JSON.parse(readerContextBeforeClear),
          after: JSON.parse(readerContextAfterEscape),
        })}`,
      );
      await assertSurfaceClosed(page, profile, "post-Clear drawer Escape");
      await assertWorkspaceUnchanged(removedSnapshot, "post-Clear drawer Escape");

      stage = "closed-drawer Escape no-op";
      const closedEscapeTarget = page.locator("#themeToggle");
      await closedEscapeTarget.focus();
      await closedEscapeTarget.press("Escape");
      assert(
        await closedEscapeTarget.evaluate((node) => document.activeElement === node) &&
          await page.locator(".detail-pane").evaluate((pane) => (
            !pane.classList.contains("visible") && pane.getAttribute("aria-hidden") === "true" &&
            Boolean(pane.inert || pane.hasAttribute("inert"))
          )),
        `${profile.name}: Escape outside an already closed drawer changed focus or reopened the drawer`,
      );
      const readerContextAfterClosedEscape = await waitForStableReaderContext(page);
      assert(
        readerContextAfterClosedEscape === readerContextBeforeClear,
        `${profile.name}: closed-drawer Escape changed Reader context: ${JSON.stringify({
          before: JSON.parse(readerContextBeforeClear),
          after: JSON.parse(readerContextAfterClosedEscape),
        })}`,
      );
      clearEscapeEvidence = { afterClear, afterEscape, closedEscapeNoOp: true, readerContextPreserved: true };
    } else {
      stage = "closed-state Escape";
      const closedEscapeTarget = page.locator("#themeToggle");
      await closedEscapeTarget.focus();
      await closedEscapeTarget.press("Escape");
      assert(
        await closedEscapeTarget.evaluate((node) => document.activeElement === node),
        `${profile.name}: closed-state Escape moved focus`,
      );
      await assertSurfaceClosed(page, profile, "closed-state Escape");
      await assertWorkspaceUnchanged(removedSnapshot, "closed-state Escape");
      clearEscapeEvidence = { externalFocusUnchanged: true };
    }

    stage = "console and request health";
    assert(failures.length === 0, `${profile.name}: application failures: ${JSON.stringify(failures)}`);

    return { name: profile.name, assertions: profile.mobile ? 53 : 54, clearEscapeEvidence };
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
      clearEscapeEvidence: Object.fromEntries(
        completed.map(({ name, clearEscapeEvidence }) => [name, clearEscapeEvidence]),
      ),
    }, null, 2));
  } finally {
    await browser.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

await main();
