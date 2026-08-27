#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { DEFAULT_TAGS } from "../src/config.js";

const screenshotRoot = String(process.env.PANEL_CONTEXT_SCREENSHOT_DIR || "").trim();
const captureOnly = process.env.PANEL_CONTEXT_CAPTURE_ONLY === "1";
const THEMES = Object.freeze(["light", "dark"]);
const TEMPORARY_TAG_COUNT = 9;
const VIEWPORTS = Object.freeze({
  desktop: Object.freeze({ width: 1280, height: 720 }),
  narrow: Object.freeze({ width: 820, height: 900 }),
  mobile: Object.freeze({ width: 390, height: 844 }),
});

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
    await delay(150);
  }
  throw new Error(`Timed out waiting for: ${predicate}`);
}

async function click(page, selector) {
  await page.waitForSelector(selector, { state: "attached" });
  await page.evaluate((target) => {
    const node = document.querySelector(target);
    node?.scrollIntoView({ block: "center" });
    node?.click();
  }, selector);
}

async function capturePanel(page, mode, theme, stateName) {
  if (!screenshotRoot) return null;
  await mkdir(screenshotRoot, { recursive: true });
  const path = join(screenshotRoot, `panel-context-${mode}-${theme}-${stateName}.png`);
  await page.locator(".detail-pane").screenshot({ path });
  return path;
}

async function setTheme(page, theme) {
  await page.waitForFunction(() => ["light", "dark"].includes(document.documentElement.dataset.theme));
  if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) {
    await click(page, "#themeToggle");
  }
  await page.waitForFunction((expectedTheme) => document.documentElement.dataset.theme === expectedTheme, theme);
}

async function createTemporaryTags(page, labels) {
  await click(page, "#showTags");
  await waitFor(page, () => Boolean(document.querySelector("#detailContent .custom-tag-form")));
  const created = await page.evaluate((temporaryLabels) => {
    for (const label of temporaryLabels) {
      const form = document.querySelector("#detailContent .custom-tag-form");
      const labelInput = form?.querySelector('input[name="label"]');
      const colorInput = form?.querySelector('input[name="color"]');
      const iconInput = form?.querySelector('input[name="icon"]');
      const descriptionInput = form?.querySelector('input[name="description"]');
      if (!form || !labelInput || !colorInput || !iconInput || !descriptionInput) return false;
      labelInput.value = label;
      colorInput.value = "#4f6f91";
      iconInput.value = "Q";
      descriptionInput.value = "Temporary contained Study Marks browser test tag";
      form.requestSubmit();
    }
    return temporaryLabels.every((label) =>
      [...document.querySelectorAll("#detailContent .custom-tag-edit-form input[name='edit-label']")].some(
        (input) => input.value === label,
      ),
    );
  }, labels);
  assert(created, "temporary custom Study Marks tags were not created through the canonical tag manager");
}

async function removeTemporaryTags(page, labels) {
  await click(page, "#showTags");
  await waitFor(page, () => Boolean(document.querySelector("#detailContent .custom-tag-form")));
  const cleanup = await page.evaluate((temporaryLabels) => {
    const removed = [];
    for (const label of temporaryLabels) {
      const form = [...document.querySelectorAll("#detailContent .custom-tag-edit-form")].find(
        (node) => node.querySelector('input[name="edit-label"]')?.value === label,
      );
      const remove = form?.querySelector(".danger-button");
      if (!remove) continue;
      remove.click();
      if (remove.dataset.confirm !== "true") continue;
      remove.click();
      removed.push(label);
    }
    const remaining = temporaryLabels.filter((label) =>
      [...document.querySelectorAll("#detailContent .custom-tag-edit-form input[name='edit-label']")].some(
        (input) => input.value === label,
      ),
    );
    return { removed, remaining };
  }, labels);
  assert.deepEqual(cleanup.removed, labels, `temporary custom tags were not removed: ${JSON.stringify(cleanup)}`);
  assert.deepEqual(cleanup.remaining, [], `retired temporary tags remain visible: ${JSON.stringify(cleanup)}`);
}

async function openStrongFromReader(page) {
  await page.mouse.move(0, 0);
  await click(page, ".verse-study-button");
  try {
    await waitFor(page, () => Boolean(document.querySelector("#detailContext .panel-context-navigation")));
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      chapterTitle: document.querySelector("#chapterTitle")?.textContent || "",
      detailContextHidden: document.querySelector("#detailContext")?.hidden ?? null,
      detailMode: document.querySelector(".detail-pane")?.dataset.panelMode || "",
      detailPaneVisible: document.querySelector(".detail-pane")?.classList.contains("visible") || false,
      detailTitle: document.querySelector("#detailTitle")?.textContent || "",
      routeHash: window.location.hash,
      studyButtonCount: document.querySelectorAll(".verse-study-button").length,
      studyButtonUnavailable: document.querySelector(".verse-study-button")?.dataset.unavailable || "",
      surfaceHidden: document.querySelector("#detailToolSurface")?.hidden ?? null,
      surfaceKind: document.querySelector("#detailToolSurface")?.dataset.toolKind || "",
      workAreaInert: Boolean(document.querySelector("#detailWorkArea")?.inert),
    }));
    throw new Error(`${error.message}; verse-study diagnostics: ${JSON.stringify(diagnostics)}`);
  }
  await click(
    page,
    "#detailContext [data-panel-scope='verse'] .verse-context-tab[data-visible-label='Language Study']",
  );
  await waitFor(page, () =>
    document.querySelector("#detailTitle")?.textContent === "Language Study" &&
    document.querySelectorAll("#detailContent .interlinear-token").length > 0,
  );
  await click(page, ".strong-token[data-strong-code]");
  await waitFor(page, () =>
    document.querySelector("#detailTitle")?.textContent === "Strong's" &&
    document.querySelector("#detailContext [data-panel-scope='word']") &&
    document.querySelector("#detailContext [data-panel-scope='word'] .study-marks-trigger") &&
    document.querySelector("#detailContext [data-panel-scope='verse'] .study-marks-trigger"),
  );
}

function expectedStudyMarkLabels(targetType, temporaryLabels) {
  return [
    ...DEFAULT_TAGS
      .filter((tag) => tag.status !== "retired" && tag.allowed_target_types.includes(targetType))
      .map((tag) => tag.label),
    ...temporaryLabels,
  ].sort((left, right) => left.localeCompare(right));
}

async function readStoredTagStore(page) {
  return page.evaluate(async () => {
    const readFallback = () => {
      try {
        return JSON.parse(window.localStorage.getItem("bibleapp:verse-tags:v1") || "null");
      } catch {
        return null;
      }
    };
    if (!window.indexedDB) return readFallback();
    return new Promise((resolveStore) => {
      const request = window.indexedDB.open("bibleapp");
      request.onerror = () => resolveStore(readFallback());
      request.onsuccess = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("user_stores")) {
          database.close();
          resolveStore(readFallback());
          return;
        }
        const transaction = database.transaction("user_stores", "readonly");
        const getRequest = transaction.objectStore("user_stores").get("tags");
        getRequest.onerror = () => {
          database.close();
          resolveStore(readFallback());
        };
        getRequest.onsuccess = () => {
          const value = getRequest.result?.value || readFallback();
          transaction.oncomplete = () => database.close();
          resolveStore(value);
        };
      };
    });
  });
}

function targetAssertionFingerprint(tagStore, targetId) {
  return Object.values(tagStore?.tag_assertions || {})
    .filter((assertion) => assertion?.target_id === targetId || assertion?.target?.target_id === targetId)
    .map((assertion) => ({
      id: assertion.id,
      tagId: assertion.tag_id,
      active: Boolean(assertion.active),
      reviewStatus: assertion.review_status,
      revision: assertion.revision,
      note: assertion.note || "",
      targetId: assertion.target_id || assertion.target?.target_id || "",
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function storedTargetAssertionFingerprint(page, targetId) {
  return targetAssertionFingerprint(await readStoredTagStore(page), targetId);
}

async function waitForStoredFavorite(page, targetId, active, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let latest = [];
  while (Date.now() < deadline) {
    const store = await readStoredTagStore(page);
    latest = Object.values(store?.tag_assertions || {});
    const assertion = latest.find(
      (candidate) =>
        (candidate?.target_id === targetId || candidate?.target?.target_id === targetId) &&
        (candidate?.tag_id === "tag:favorite" || candidate?.legacy_tag_id === "favorite"),
    );
    if (assertion && Boolean(assertion.active) === active) return assertion;
    await delay(75);
  }
  throw new Error(
    `Timed out waiting for Favorite=${active} on ${targetId}: ${JSON.stringify(targetAssertionFingerprint({ tag_assertions: Object.fromEntries(latest.map((assertion) => [assertion.id, assertion])) }, targetId))}`,
  );
}

async function waitForReaderWordPreserved(page, oldTargetId, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let diagnostics = null;
  while (Date.now() < deadline) {
    diagnostics = await page.evaluate((expectedTargetId) => {
      const words = [...document.querySelectorAll(".reader-context-word")];
      const verses = [...document.querySelectorAll(".reader-context-verse")];
      const targetParts = expectedTargetId.split(":");
      const expectedTokenIndex = targetParts[1] === "source_token" ? targetParts.at(-1) : "";
      const selectedVerse = verses[0]?.dataset.verse || targetParts[6] || "";
      const row = selectedVerse
        ? document.querySelector(`.verse-row[data-verse="${CSS.escape(selectedVerse)}"]`)
        : null;
      return {
        activeWordControl: document.querySelector("#detailContext [data-panel-scope='word'] .verse-context-tab[data-visible-label='Word']")?.getAttribute("aria-current") || "",
        contextSummary: String(document.querySelector("#detailContext .panel-context-summary")?.textContent || "").replace(/\s+/gu, " ").trim(),
        detailMode: document.querySelector(".detail-pane")?.dataset.panelMode || "",
        detailTitle: document.querySelector("#detailTitle")?.textContent?.trim() || "",
        newTriggerTargetIds: [...document.querySelectorAll("#detailContext [data-study-marks-target-id]")]
          .map((trigger) => trigger.dataset.studyMarksTargetId)
          .filter(Boolean),
        oldTargetId: expectedTargetId,
        readerVerseCount: verses.length,
        readerVerses: verses.map((verse) => ({
          refKey: verse.dataset.refKey || "",
          segmentId: verse.dataset.segmentId || "",
          verse: verse.dataset.verse || "",
        })),
        readerWordCount: words.length,
        readerWords: words.map((word) => ({
          interlinearKey: word.dataset.interlinearKey || "",
          strongCode: word.dataset.strongCode || "",
          tokenIndex: word.dataset.tokenIndex || "",
        })),
        routeHash: window.location.hash,
        selectedRowStrongTokens: [...(row?.querySelectorAll(".strong-token") || [])].map((word) => ({
          highlighted: word.classList.contains("reader-context-word"),
          interlinearKey: word.dataset.interlinearKey || "",
          matchesExpectedTokenIndex: Boolean(expectedTokenIndex && word.dataset.tokenIndex === expectedTokenIndex),
          strongCode: word.dataset.strongCode || "",
          tokenIndex: word.dataset.tokenIndex || "",
        })),
        surfaceKind: document.querySelector("#detailToolSurface")?.dataset.toolKind || "",
        surfaceTargetId: document.querySelector("#detailToolSurface")?.dataset.targetId || "",
      };
    }, oldTargetId);
    if (diagnostics.readerWordCount === 1 && diagnostics.readerVerseCount === 1) return diagnostics;
    await delay(75);
  }
  throw new Error(`${label}: selected reader word/verse was not preserved after the Study Marks rerender: ${JSON.stringify(diagnostics)}`);
}

async function panelStudyMarksState(page, selector) {
  return page.evaluate((target) => {
    const clean = (value) => String(value || "").replace(/\s+/gu, " ").trim();
    const rect = (node) => {
      if (!node) return null;
      const value = node.getBoundingClientRect();
      return {
        left: value.left,
        top: value.top,
        right: value.right,
        bottom: value.bottom,
        width: value.width,
        height: value.height,
      };
    };
    const trigger = document.querySelector(target);
    const controls = trigger?.closest(".panel-context-controls");
    const pane = document.querySelector(".detail-pane");
    const workspace = document.querySelector("#detailWorkspace");
    const workArea = document.querySelector("#detailWorkArea");
    const detail = document.querySelector("#detailContent");
    const surface = document.querySelector("#detailToolSurface");
    const surfaceContent = document.querySelector("#detailToolContent");
    const targetId = trigger?.dataset.studyMarksTargetId || surface?.dataset.targetId || "";
    const targetType = targetId.split(":")[1] || "";
    const selectedToken = clean(document.querySelector("#detailContent .strong-code")?.textContent);
    const summary = clean(document.querySelector("#detailContext .panel-context-summary")?.textContent);
    const sourceMarker = selectedToken ? ` · ${selectedToken} · in ` : "";
    const sourceMarkerIndex = sourceMarker ? summary.indexOf(sourceMarker) : -1;
    const sourceOriginal = sourceMarkerIndex >= 0 ? summary.slice(0, sourceMarkerIndex) : "";
    const verse = targetId.split(":").at(-1);
    const versePreview = clean(document.querySelector(`.verse-row[data-verse="${CSS.escape(verse || "")}"] .verse-body`)?.textContent);
    const activeElement = document.activeElement;
    return {
      activeWord: document.querySelector("#detailContext [data-panel-scope='word'] .verse-context-tab[data-visible-label='Word']")?.getAttribute("aria-current") || "",
      controlHeight: controls?.getBoundingClientRect().height || 0,
      controlRows: controls
        ? new Set([...controls.children].map((node) => Math.round(node.getBoundingClientRect().top))).size
        : 0,
      controls: rect(controls),
      detailChildCount: detail?.children.length || 0,
      detailScrollTop: detail?.scrollTop || 0,
      detailTitle: clean(document.querySelector("#detailTitle")?.textContent),
      documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
      expectedPreview: targetType === "source_token"
        ? [sourceOriginal, selectedToken].filter(Boolean).join(" — ")
        : versePreview,
      focusedInSurface: Boolean(surface?.contains(activeElement)),
      focusedTargetId: activeElement?.dataset?.studyMarksTargetId || "",
      focusedTrigger: activeElement === trigger,
      forwardDisabled: document.querySelector("#detailForward")?.disabled ?? null,
      historyBackDisabled: document.querySelector("#detailBack")?.disabled ?? null,
      localPopoverCount: document.querySelectorAll("#detailContext .target-tag-picker-popover").length,
      lock: pane?.dataset.panelMode || "",
      pane: rect(pane),
      paneContainsSurface: Boolean(pane?.contains(surface)),
      paneOverflow: pane ? pane.scrollWidth - pane.clientWidth : 0,
      readerToken:
        document.querySelector(".reader-context-word")?.dataset.strongCode ||
        clean(document.querySelector(".reader-context-word")?.textContent),
      routeHash: window.location.hash,
      sameDetailFirstChild: window.__panelStudyMarksDetailFirstChild === detail?.firstElementChild,
      selectedToken,
      strongDetail: Boolean(document.querySelector("#detailContent .strong-detail")),
      surface: rect(surface),
      surfaceAriaHidden: surface?.getAttribute("aria-hidden") || "",
      surfaceClientHeight: surfaceContent?.clientHeight || 0,
      surfaceContainsTarget: surface?.dataset.targetId === targetId,
      surfaceContentChildCount: surfaceContent?.children.length || 0,
      surfaceHidden: surface?.hidden ?? null,
      surfaceKind: surface?.dataset.toolKind || "",
      surfaceOpen: Boolean(surface && !surface.hidden && surface.getAttribute("aria-hidden") === "false"),
      surfaceOptionLabels: [...(surfaceContent?.querySelectorAll(".tag-picker-option") || [])]
        .map((option) => clean(option.querySelector("span:last-child")?.textContent))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right)),
      surfaceOptions: [...(surfaceContent?.querySelectorAll(".tag-picker-option") || [])].map((option) => ({
        label: clean(option.querySelector("span:last-child")?.textContent),
        pressed: option.getAttribute("aria-pressed"),
        ariaLabel: option.getAttribute("aria-label") || "",
      })),
      surfaceOverflow: surface ? surface.scrollWidth - surface.clientWidth : 0,
      surfaceParentId: surface?.parentElement?.id || "",
      surfacePreview: clean(surfaceContent?.querySelector(".target-tag-picker-preview")?.textContent),
      surfaceScrollHeight: surfaceContent?.scrollHeight || 0,
      surfaceScrollTop: surfaceContent?.scrollTop || 0,
      surfaceTargetId: surface?.dataset.targetId || "",
      surfaceTargetTitle: clean(surfaceContent?.querySelector(".tag-picker-title")?.textContent),
      surfaceTitle: clean(document.querySelector("#detailToolTitle")?.textContent),
      targetId,
      targetType,
      theme: document.documentElement.dataset.theme || "",
      trigger: rect(trigger),
      triggerAriaControls: trigger?.getAttribute("aria-controls") || "",
      triggerAriaExpanded: trigger?.getAttribute("aria-expanded") || "",
      triggerAriaHaspopup: trigger?.getAttribute("aria-haspopup") || "",
      triggerAriaLabel: trigger?.getAttribute("aria-label") || "",
      viewport: { width: window.innerWidth, height: window.innerHeight },
      workAreaAriaHidden: workArea?.getAttribute("aria-hidden") || "",
      workAreaInert: Boolean(workArea && (workArea.inert || workArea.hasAttribute("inert"))),
      workspace: rect(workspace),
      workspaceContainsSurface: Boolean(workspace?.contains(surface)),
    };
  }, selector);
}

function assertRectStable(before, after, label) {
  assert(before && after, `${label}: required geometry is missing`);
  ["left", "top", "right", "bottom", "width", "height"].forEach((field) => {
    assert(
      Math.abs(before[field] - after[field]) <= 1,
      `${label}: ${field} changed by more than 1px: ${JSON.stringify({ before, after })}`,
    );
  });
}

function assertPanelStudyMarksInvariant(before, after, label, { geometry = true } = {}) {
  assert.equal(after.detailTitle, before.detailTitle, `${label}: tool interaction changed the detail title`);
  assert.equal(after.selectedToken, before.selectedToken, `${label}: tool interaction changed the selected Strong's token`);
  assert.equal(after.readerToken, before.readerToken, `${label}: tool interaction changed the reader highlight`);
  assert.equal(after.lock, before.lock, `${label}: tool interaction changed panel lock state`);
  assert.equal(after.activeWord, before.activeWord, `${label}: tool interaction changed the active Word state`);
  assert.equal(after.historyBackDisabled, before.historyBackDisabled, `${label}: tool interaction changed Back history state`);
  assert.equal(after.forwardDisabled, before.forwardDisabled, `${label}: tool interaction changed Forward history state`);
  assert.equal(after.routeHash, before.routeHash, `${label}: tool interaction changed the browser route`);
  assert.equal(after.detailChildCount, before.detailChildCount, `${label}: tool interaction rebuilt the Strong's detail`);
  assert.equal(after.detailScrollTop, before.detailScrollTop, `${label}: tool interaction moved the underlying detail scroll`);
  assert(after.sameDetailFirstChild, `${label}: tool interaction replaced the underlying Strong's detail node`);
  if (geometry) {
    assert.equal(after.controlRows, before.controlRows, `${label}: tool interaction changed control-strip wrapping`);
    assert.equal(after.controlHeight, before.controlHeight, `${label}: tool interaction changed control-strip height`);
    assertRectStable(before.trigger, after.trigger, `${label}: trigger geometry`);
    assertRectStable(before.controls, after.controls, `${label}: control-strip geometry`);
  }
}

function assertPanelStudyMarksClosed(state, label) {
  assert(!state.surfaceOpen && state.surfaceHidden, `${label}: contained tool surface remained visible`);
  assert.equal(state.surfaceAriaHidden, "true", `${label}: closed surface is not hidden from assistive technology`);
  assert.equal(state.surfaceKind, "", `${label}: closed surface retained stale tool ownership`);
  assert.equal(state.surfaceTargetId, "", `${label}: closed surface retained a stale target`);
  assert.equal(state.surfaceContentChildCount, 0, `${label}: closed surface retained stale content`);
  assert(!state.workAreaInert, `${label}: underlying detail work area remained inert`);
  assert.notEqual(state.workAreaAriaHidden, "true", `${label}: underlying detail work area remained aria-hidden`);
}

function assertPanelStudyMarksContainment(
  state,
  label,
  { expectedLabel, expectedLabels, expectedPreview = state.expectedPreview, expectedTargetId },
) {
  assert(state.surfaceOpen, `${label}: contained tool surface did not remain open: ${JSON.stringify(state)}`);
  assert.equal(state.surfaceKind, "study-marks", `${label}: shared surface has the wrong tool kind`);
  assert.equal(state.surfaceTargetId, expectedTargetId, `${label}: shared surface has the wrong canonical target`);
  assert(state.surfaceContainsTarget, `${label}: trigger and shared surface target identities diverged`);
  assert.equal(state.surfaceParentId, "detailWorkspace", `${label}: shared surface is not a direct workspace child`);
  assert(state.paneContainsSurface && state.workspaceContainsSurface, `${label}: shared surface escaped the detail workspace`);
  assert(state.surface && state.pane && state.workspace, `${label}: shared surface geometry is missing`);
  for (const boundary of [state.pane, state.workspace]) {
    assert(
      state.surface.left >= boundary.left - 1 &&
        state.surface.right <= boundary.right + 1 &&
        state.surface.top >= boundary.top - 1 &&
        state.surface.bottom <= boundary.bottom + 1,
      `${label}: shared surface escaped its containing geometry: ${JSON.stringify({ surface: state.surface, boundary })}`,
    );
  }
  assert.equal(state.surfaceTitle, "Study Marks", `${label}: shared surface title is incorrect`);
  assert.equal(state.surfaceTargetTitle, expectedLabel, `${label}: exact target label is incorrect`);
  assert(expectedPreview, `${label}: expected target preview could not be resolved`);
  assert.equal(state.surfacePreview, expectedPreview, `${label}: exact target preview is incorrect`);
  assert.deepEqual(state.surfaceOptionLabels, expectedLabels, `${label}: not every valid target tag is shown exactly once`);
  assert(state.surfaceOptionLabels.includes("Favorite"), `${label}: Favorite is missing`);
  assert(state.workAreaInert, `${label}: underlying detail work area is interactive`);
  assert.equal(state.workAreaAriaHidden, "true", `${label}: underlying detail work area is exposed to assistive technology`);
  assert.equal(state.triggerAriaHaspopup, "dialog", `${label}: trigger does not expose dialog semantics`);
  assert.equal(state.triggerAriaExpanded, "true", `${label}: trigger does not expose the open state`);
  assert.equal(state.triggerAriaControls, "detailToolSurface", `${label}: trigger does not identify the shared surface`);
  assert.match(state.triggerAriaLabel, new RegExp(`^Study Marks for ${expectedLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.`), `${label}: trigger accessible label is inaccurate`);
  assert.equal(state.localPopoverCount, 0, `${label}: side-panel trigger retained a local downward popover`);
  assert(state.focusedInSurface, `${label}: opening did not place focus inside the contained tool`);
  assert(state.surfaceOverflow <= 1, `${label}: shared surface has horizontal overflow`);
  assert(state.paneOverflow <= 1, `${label}: detail pane has horizontal overflow`);
  assert(state.documentOverflow <= 1, `${label}: document has horizontal overflow`);
}

async function activatePanelStudyMarks(page, selector, activation) {
  const trigger = page.locator(selector);
  if (activation === "Enter") {
    await trigger.focus();
    await page.keyboard.press("Enter");
  } else {
    await trigger.click();
  }
  await page.waitForFunction(
    (target) => {
      const surface = document.querySelector("#detailToolSurface");
      return Boolean(
        surface &&
          !surface.hidden &&
          surface.getAttribute("aria-hidden") === "false" &&
          surface.dataset.toolKind === "study-marks" &&
          surface.dataset.targetId === document.querySelector(target)?.dataset.studyMarksTargetId &&
          surface.contains(document.activeElement),
      );
    },
    selector,
  );
}

async function waitForContainedToolClose(page, selector, targetId) {
  await page.waitForFunction(
    ({ target, expectedTargetId }) => {
      const surface = document.querySelector("#detailToolSurface");
      const workArea = document.querySelector("#detailWorkArea");
      const currentTrigger = document.querySelector(target);
      const active = document.activeElement;
      const focusRestored = active === currentTrigger || active?.dataset?.studyMarksTargetId === expectedTargetId;
      return Boolean(
        surface?.hidden &&
          surface.getAttribute("aria-hidden") === "true" &&
          !workArea?.inert &&
          !workArea?.hasAttribute("inert") &&
          workArea?.getAttribute("aria-hidden") !== "true" &&
          focusRestored,
      );
    },
    { target: selector, expectedTargetId: targetId },
  );
}

function assertStoredFavoriteTarget(assertion, targetId, targetType, active, label) {
  assert.equal(assertion.target_id, targetId, `${label}: persisted assertion has the wrong canonical target ID`);
  assert.equal(assertion.target?.target_id, targetId, `${label}: persisted assertion target payload diverged`);
  assert.equal(assertion.target?.target_type, targetType, `${label}: persisted assertion has the wrong target type`);
  assert.equal(assertion.target?.translation_id, "bsb", `${label}: persisted assertion has the wrong translation`);
  assert.equal(assertion.target?.reference?.book_id, "proverbs", `${label}: persisted assertion has the wrong book`);
  assert.equal(assertion.target?.reference?.chapter, 1, `${label}: persisted assertion has the wrong chapter`);
  assert.equal(assertion.target?.reference?.verse_start, 1, `${label}: persisted assertion has the wrong verse`);
  assert.equal(Boolean(assertion.active), active, `${label}: persisted assertion has the wrong active state`);
  if (targetType === "source_token") {
    assert.equal(
      assertion.target?.token?.token_index,
      Number(targetId.split(":").at(-1)),
      `${label}: persisted assertion has the wrong exact source token`,
    );
  }
}

async function exercisePanelStudyMarksSurface(
  page,
  selector,
  label,
  { activation, expectedLabel, expectedPreview, targetType, temporaryLabels },
) {
  const triggerLocator = page.locator(selector);
  await triggerLocator.scrollIntoViewIfNeeded();
  const triggerBox = await triggerLocator.boundingBox();
  assert(triggerBox, `${label}: Study Marks trigger is not visible`);

  await triggerLocator.focus();
  await page.waitForFunction((target) => document.activeElement === document.querySelector(target), selector);
  const focusOnly = await panelStudyMarksState(page, selector);
  assertPanelStudyMarksClosed(focusOnly, `${label}: focus alone`);
  assert(focusOnly.focusedTrigger, `${label}: trigger did not retain visible keyboard focus`);
  assert.equal(focusOnly.triggerAriaHaspopup, "dialog", `${label}: trigger has the wrong popup role`);
  assert.equal(focusOnly.triggerAriaExpanded, "false", `${label}: focused trigger incorrectly reports an open tool`);

  await page.evaluate(() => {
    const detail = document.querySelector("#detailContent");
    if (!detail) return;
    detail.scrollTop = Math.min(64, Math.max(0, detail.scrollHeight - detail.clientHeight));
    window.__panelStudyMarksDetailFirstChild = detail.firstElementChild;
  });
  const before = await panelStudyMarksState(page, selector);
  assert.equal(before.detailTitle, "Strong's", `${label}: expected a Strong's panel`);
  assert(before.strongDetail && before.selectedToken, `${label}: selected Strong's context is incomplete: ${JSON.stringify(before)}`);
  assert.equal(before.targetType, targetType, `${label}: trigger has the wrong canonical target type`);
  assert(before.targetId.startsWith(`target:${targetType}:bsb:`), `${label}: trigger has an invalid canonical target ID`);
  assert(before.sameDetailFirstChild, `${label}: underlying detail identity marker was not captured`);
  const targetId = before.targetId;
  const expectedLabels = expectedStudyMarkLabels(targetType, temporaryLabels);
  const initialAssertions = await storedTargetAssertionFingerprint(page, targetId);

  await activatePanelStudyMarks(page, selector, activation);
  const opened = await panelStudyMarksState(page, selector);
  assertPanelStudyMarksContainment(opened, `${label}: ${activation} opening`, {
    expectedLabel,
    expectedLabels,
    expectedPreview,
    expectedTargetId: targetId,
  });
  assertPanelStudyMarksInvariant(before, opened, `${label}: opening`);
  assert(
    opened.surfaceScrollHeight >= opened.surfaceClientHeight,
    `${label}: contained tool reported impossible scroll geometry`,
  );
  assert.deepEqual(
    await storedTargetAssertionFingerprint(page, targetId),
    initialAssertions,
    `${label}: opening the contained tool mutated persisted Study Marks`,
  );

  const surfaceHasOverflow = opened.surfaceScrollHeight > opened.surfaceClientHeight;
  await page.evaluate((shouldScroll) => {
    const content = document.querySelector("#detailToolContent");
    if (content && shouldScroll) {
      content.scrollTop = Math.min(180, Math.max(0, content.scrollHeight - content.clientHeight));
    }
  }, surfaceHasOverflow);
  if (surfaceHasOverflow) {
    await page.waitForFunction(() => document.querySelector("#detailToolContent")?.scrollTop > 0);
  }
  const scrolled = await panelStudyMarksState(page, selector);
  assertPanelStudyMarksContainment(scrolled, `${label}: contained-tool scroll`, {
    expectedLabel,
    expectedLabels,
    expectedPreview,
    expectedTargetId: targetId,
  });
  assertPanelStudyMarksInvariant(before, scrolled, `${label}: contained-tool scroll`);
  assert.equal(
    scrolled.surfaceScrollTop > 0,
    surfaceHasOverflow,
    `${label}: contained tool scroll state does not match its available overflow`,
  );

  await page.locator("#detailToolClose").click();
  await waitForContainedToolClose(page, selector, targetId);
  const closed = await panelStudyMarksState(page, selector);
  assertPanelStudyMarksClosed(closed, `${label}: Close`);
  assertPanelStudyMarksInvariant(before, closed, `${label}: Close`);
  assert.equal(closed.focusedTargetId, targetId, `${label}: Close did not restore trigger or replacement focus`);
  assert.deepEqual(
    await storedTargetAssertionFingerprint(page, targetId),
    initialAssertions,
    `${label}: Close mutated persisted Study Marks`,
  );

  await activatePanelStudyMarks(page, selector, "Enter");
  const escapeAssertions = await storedTargetAssertionFingerprint(page, targetId);
  await page.keyboard.press("Escape");
  await waitForContainedToolClose(page, selector, targetId);
  const escaped = await panelStudyMarksState(page, selector);
  assertPanelStudyMarksClosed(escaped, `${label}: Escape`);
  assertPanelStudyMarksInvariant(before, escaped, `${label}: Escape`);
  assert.equal(escaped.focusedTargetId, targetId, `${label}: Escape did not restore trigger or replacement focus`);
  assert.deepEqual(
    await storedTargetAssertionFingerprint(page, targetId),
    escapeAssertions,
    `${label}: Escape mutated persisted Study Marks`,
  );

  await activatePanelStudyMarks(page, selector, activation);
  const favorite = page.locator("#detailToolContent .tag-picker-option[aria-label='Add Favorite tag']");
  assert.equal(await favorite.getAttribute("aria-pressed"), "false", `${label}: Favorite should start inactive`);
  await favorite.click();
  await page.waitForFunction(
    () => document.querySelector("#detailToolContent .tag-picker-option[aria-label='Remove Favorite tag']")?.getAttribute("aria-pressed") === "true",
  );
  await waitForReaderWordPreserved(page, targetId, `${label}: Favorite add`);
  const persistedAdd = await waitForStoredFavorite(page, targetId, true);
  assertStoredFavoriteTarget(persistedAdd, targetId, targetType, true, `${label}: Favorite add`);
  const toggled = await panelStudyMarksState(page, selector);
  assertPanelStudyMarksContainment(toggled, `${label}: Favorite add`, {
    expectedLabel,
    expectedLabels,
    expectedPreview,
    expectedTargetId: targetId,
  });
  assertPanelStudyMarksInvariant(before, toggled, `${label}: Favorite add`, { geometry: false });
  assert.match(toggled.triggerAriaLabel, /1 selected\./u, `${label}: selected mark count did not update immediately`);

  await page.locator("#detailToolClose").click();
  await waitForContainedToolClose(page, selector, targetId);
  const persistedWhileClosed = await storedTargetAssertionFingerprint(page, targetId);
  await activatePanelStudyMarks(page, selector, "Enter");
  const reopened = await panelStudyMarksState(page, selector);
  assert.equal(
    reopened.surfaceOptions.find((option) => option.label === "Favorite")?.pressed,
    "true",
    `${label}: persisted Favorite was not selected when the tool reopened`,
  );
  assertPanelStudyMarksInvariant(before, reopened, `${label}: persistence reopen`, { geometry: false });
  assert.deepEqual(
    await storedTargetAssertionFingerprint(page, targetId),
    persistedWhileClosed,
    `${label}: reopening mutated the persisted Favorite`,
  );

  await page.locator("#detailToolContent .tag-picker-option[aria-label='Remove Favorite tag']").click();
  await page.waitForFunction(
    () => document.querySelector("#detailToolContent .tag-picker-option[aria-label='Add Favorite tag']")?.getAttribute("aria-pressed") === "false",
  );
  await waitForReaderWordPreserved(page, targetId, `${label}: Favorite remove`);
  const persistedRemove = await waitForStoredFavorite(page, targetId, false);
  assertStoredFavoriteTarget(persistedRemove, targetId, targetType, false, `${label}: Favorite remove`);
  const removedAssertions = await storedTargetAssertionFingerprint(page, targetId);
  await page.keyboard.press("Escape");
  await waitForContainedToolClose(page, selector, targetId);
  const removedAndClosed = await panelStudyMarksState(page, selector);
  assertPanelStudyMarksClosed(removedAndClosed, `${label}: post-remove Escape`);
  assertPanelStudyMarksInvariant(before, removedAndClosed, `${label}: post-remove Escape`, { geometry: false });
  assert.deepEqual(
    await storedTargetAssertionFingerprint(page, targetId),
    removedAssertions,
    `${label}: post-remove Escape mutated persisted Study Marks`,
  );

  await activatePanelStudyMarks(page, selector, activation);
  const beforeManageAssertions = await storedTargetAssertionFingerprint(page, targetId);
  await page.locator("#detailToolContent .tag-picker-manage").click();
  await page.waitForFunction(
    () =>
      document.querySelector("#detailToolSurface")?.hidden &&
      document.querySelector("#detailTitle")?.textContent === "Tags" &&
      Boolean(document.querySelector("#detailContent .target-tag-editor")) &&
      !document.querySelector("#detailWorkArea")?.inert,
  );
  const managed = await page.evaluate(() => ({
    editorPreview: String(document.querySelector("#detailContent .target-tag-preview")?.textContent || "").replace(/\s+/gu, " ").trim(),
    editorTitle: String(document.querySelector("#detailContent .target-tag-editor h3")?.textContent || "").replace(/\s+/gu, " ").trim(),
    routeHash: window.location.hash,
    surfaceAriaHidden: document.querySelector("#detailToolSurface")?.getAttribute("aria-hidden") || "",
    surfaceContentChildren: document.querySelector("#detailToolContent")?.children.length || 0,
    surfaceHidden: document.querySelector("#detailToolSurface")?.hidden ?? null,
    surfaceKind: document.querySelector("#detailToolSurface")?.dataset.toolKind || "",
    title: document.querySelector("#detailTitle")?.textContent || "",
    workAreaAriaHidden: document.querySelector("#detailWorkArea")?.getAttribute("aria-hidden") || "",
    workAreaInert: Boolean(document.querySelector("#detailWorkArea")?.inert),
  }));
  assert.equal(managed.title, "Tags", `${label}: Manage tags did not open the full detail editor`);
  assert.equal(managed.editorTitle, expectedLabel, `${label}: Manage tags lost the exact target label`);
  assert.equal(managed.editorPreview, expectedPreview || opened.expectedPreview, `${label}: Manage tags lost the exact target preview`);
  assert(managed.surfaceHidden && managed.surfaceAriaHidden === "true", `${label}: Manage tags left the contained surface visible`);
  assert.equal(managed.surfaceKind, "", `${label}: Manage tags left stale overlay ownership`);
  assert.equal(managed.surfaceContentChildren, 0, `${label}: Manage tags left stale contained content`);
  assert(!managed.workAreaInert && managed.workAreaAriaHidden !== "true", `${label}: Manage tags left the detail editor inert`);
  assert.equal(managed.routeHash, before.routeHash, `${label}: Manage tags changed the browser route`);
  assert.deepEqual(
    await storedTargetAssertionFingerprint(page, targetId),
    beforeManageAssertions,
    `${label}: Manage tags mutated data without an explicit toggle`,
  );

  await click(page, "#detailBack");
  await waitFor(page, () =>
    document.querySelector("#detailTitle")?.textContent === "Strong's" &&
    Boolean(document.querySelector("#detailContent .strong-detail")) &&
    Boolean(document.querySelector("#detailContext .study-marks-trigger")) &&
    document.querySelector("#detailToolSurface")?.hidden,
  );
  const restored = await panelStudyMarksState(page, selector);
  assert.equal(restored.detailTitle, before.detailTitle, `${label}: Back did not restore the prior panel view`);
  assert.equal(restored.selectedToken, before.selectedToken, `${label}: Back did not restore the selected Strong's token`);
  assert.equal(restored.readerToken, before.readerToken, `${label}: Back did not restore the reader highlight`);
  assert.equal(restored.lock, before.lock, `${label}: Manage transition changed the panel lock`);
  assert.equal(restored.activeWord, before.activeWord, `${label}: Manage transition changed the active Word section`);
  assert.equal(restored.routeHash, before.routeHash, `${label}: Manage transition changed the browser route`);
  assert(restored.sameDetailFirstChild, `${label}: Back did not restore the underlying detail node`);
  assertPanelStudyMarksClosed(restored, `${label}: Manage transition cleanup`);

  await page.evaluate(() => {
    delete window.__panelStudyMarksDetailFirstChild;
  });
  return {
    activation,
    optionCount: opened.surfaceOptionLabels.length,
    surfaceKind: opened.surfaceKind,
    surfaceHasOverflow,
    surfaceScrollHeight: opened.surfaceScrollHeight,
    surfaceScrollTop: scrolled.surfaceScrollTop,
    targetId,
    targetType,
    title: opened.surfaceTitle,
    managed: true,
  };
}

async function contextState(page) {
  return page.evaluate(() => {
    const parseColor = (value) => {
      const normalized = String(value || "").trim();
      const hex = normalized.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
      if (hex) {
        const digits = hex[1].length === 3 ? hex[1].split("").map((digit) => `${digit}${digit}`).join("") : hex[1];
        return [
          Number.parseInt(digits.slice(0, 2), 16),
          Number.parseInt(digits.slice(2, 4), 16),
          Number.parseInt(digits.slice(4, 6), 16),
          1,
        ];
      }
      const rgb = normalized.match(/rgba?\(([^)]+)\)/i);
      if (!rgb) return null;
      const values = rgb[1].split(",").map((part) => Number.parseFloat(part.trim()));
      if (values.length < 3 || values.slice(0, 3).some((valuePart) => !Number.isFinite(valuePart))) return null;
      return [values[0], values[1], values[2], Number.isFinite(values[3]) ? values[3] : 1];
    };
    const composite = (foreground, background) => {
      const alpha = foreground?.[3] ?? 1;
      return [0, 1, 2].map((index) => foreground[index] * alpha + background[index] * (1 - alpha));
    };
    const renderedBackground = (node) => {
      const ancestors = [];
      for (let current = node; current; current = current.parentElement) ancestors.push(current);
      return ancestors.reverse().reduce((background, current) => {
        const color = parseColor(getComputedStyle(current).backgroundColor);
        return color ? composite(color, background) : background;
      }, [255, 255, 255]);
    };
    const luminance = (color) => color
      .slice(0, 3)
      .map((channel) => channel / 255)
      .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
      .reduce((total, channel, index, values) => total + [0.2126, 0.7152, 0.0722][index] * channel, 0);
    const contrast = (foreground, background) => {
      if (!foreground || !background) return null;
      const first = luminance(foreground);
      const second = luminance(background);
      return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    };
    const colorState = (node) => {
      if (!node) return null;
      const foreground = parseColor(getComputedStyle(node).color);
      const background = renderedBackground(node);
      return {
        foreground,
        background,
        contrast: contrast(foreground, background),
      };
    };
    const nav = document.querySelector("#detailContext .panel-context-navigation");
    const pane = document.querySelector(".detail-pane");
    const appHeader = document.querySelector(".app-header");
    const detailHeader = document.querySelector(".detail-header");
    const paneRect = pane?.getBoundingClientRect();
    const appHeaderRect = appHeader?.getBoundingClientRect();
    const detailHeaderRect = detailHeader?.getBoundingClientRect();
    const groupScopes = [...document.querySelectorAll("#detailContext .panel-context-group")].map(
      (node) => node.dataset.panelScope,
    );
    const staticScopes = [...document.querySelectorAll(".detail-tool-nav .panel-context-group")].map(
      (node) => node.dataset.panelScope,
    );
    const active = [...document.querySelectorAll("#detailContext .verse-context-tab[aria-current='page']")].map(
      (node) => `${node.dataset.panelScope}:${node.dataset.visibleLabel}`,
    );
    const wordButton = document.querySelector(
      "#detailContext [data-panel-scope='word'] .verse-context-tab[data-visible-label='Word']",
    );
    const parallelButton = document.querySelector(
      "#detailContext [data-panel-scope='verse'] .verse-context-tab[data-visible-label='Parallel']",
    );
    const verseScopeLabels = [...document.querySelectorAll(
      "#detailContext [data-panel-scope='verse'] .panel-context-scope-label",
    )];
    const currentControls = [...document.querySelectorAll("#detailContext .verse-context-tab")].map((button) => ({
      action: button.dataset.panelAction || "",
      ariaCurrent: button.getAttribute("aria-current") || "",
      ariaLabel: button.getAttribute("aria-label") || "",
      ariaPressed: button.getAttribute("aria-pressed") || "",
      disabled: button.disabled,
      label: button.dataset.visibleLabel || button.textContent.trim(),
      title: button.title,
    }));
    const summary = document.querySelector("#detailContext .panel-context-summary");
    const transliteration = document.querySelector(
      "#detailContent .original-language-transliteration, #detailContent .original-language-word-source .token-translit, #detailContent .original-language-word-source .original-language-token-transliteration",
    );
    const wordStyle = wordButton ? getComputedStyle(wordButton) : null;
    const rootStyle = getComputedStyle(document.documentElement);
    const primaryText = parseColor(rootStyle.getPropertyValue("--text"));
    const mutedText = parseColor(rootStyle.getPropertyValue("--muted"));
    const summaryColor = colorState(summary);
    return {
      title: document.querySelector("#detailTitle")?.textContent.trim() || "",
      lock: pane?.dataset.panelMode || "",
      scopeOrder: nav?.dataset.scopeOrder || "",
      groupScopes,
      staticScopes,
      active,
      currentControls,
      displayedView: pane?.dataset.displayedView || "",
      modeStatus: document.querySelector("#detailModeStatus")?.textContent.trim() || "",
      modeStatusLabel: document.querySelector("#detailModeStatus")?.getAttribute("aria-label") || "",
      panelOccupant: nav?.dataset.panelOccupant || "",
      summary: summary?.textContent.trim() || "",
      summaryOverflow: summary ? summary.scrollWidth - summary.clientWidth : 0,
      summaryColor,
      summaryUsesPrimary: Boolean(
        summaryColor?.foreground && primaryText && summaryColor.foreground.slice(0, 3).every((value, index) => Math.abs(value - primaryText[index]) < 1),
      ),
      summaryUsesMuted: Boolean(
        summaryColor?.foreground && mutedText && summaryColor.foreground.slice(0, 3).every((value, index) => Math.abs(value - mutedText[index]) < 1),
      ),
      transliteration: transliteration
        ? {
            text: transliteration.textContent.trim(),
            ...colorState(transliteration),
            usesMuted: Boolean(
              colorState(transliteration)?.foreground &&
                mutedText &&
                colorState(transliteration).foreground.slice(0, 3).every((value, index) => Math.abs(value - mutedText[index]) < 1),
            ),
          }
        : null,
      wordDisabled: wordButton?.disabled ?? null,
      wordActiveBackground: wordStyle?.backgroundColor || "",
      wordActiveColor: wordStyle?.color || "",
      parallelDisabled: parallelButton?.disabled ?? null,
      parallelActionCount: document.querySelectorAll(
        "#detailContext [data-panel-scope='verse'] .verse-context-tab[data-visible-label='Parallel']",
      ).length,
      verseScopeLabels: verseScopeLabels.map((label) => label.textContent.trim()),
      strongSectionControls: [...document.querySelectorAll("#detailContext [data-strong-section-control]")].map((button) => ({
        section: button.dataset.strongSectionControl,
        disabled: button.disabled,
        ariaDisabled: button.getAttribute("aria-disabled"),
        controlState: button.dataset.controlState,
        unavailable: button.dataset.unavailable,
        title: button.title,
        ariaLabel: button.getAttribute("aria-label"),
      })),
      strongSectionAnchors: [...document.querySelectorAll("#detailContent [data-strong-section]")].map(
        (node) => node.dataset.strongSection,
      ),
      readerToken: document.querySelector(".reader-context-word")?.dataset.strongCode || "",
      readerVerse: document.querySelector(".reader-context-verse")?.dataset.verse || "",
      navOverflow: nav ? nav.scrollWidth - nav.clientWidth : 0,
      navHeight: nav ? nav.getBoundingClientRect().height : 0,
      hasSummaryBoundary: Boolean(summary),
      theme: document.documentElement.dataset.theme || "",
      documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
      panelHeaderGap:
        paneRect && appHeaderRect ? Math.round((paneRect.top - appHeaderRect.bottom) * 100) / 100 : null,
      detailHeaderTop: detailHeaderRect ? Math.round(detailHeaderRect.top * 100) / 100 : null,
    };
  });
}

async function waitForStableDetailScroll(page, { minimum = 0, timeoutMs = 5000 } = {}) {
  return page.evaluate(({ minimumScroll, timeout }) => new Promise((resolveStable, rejectStable) => {
    const started = performance.now();
    const recent = [];
    let stableCount = 0;
    let previous = null;
    const sample = () => {
      const value = document.querySelector("#detailContent")?.scrollTop || 0;
      recent.push(value);
      if (recent.length > 8) recent.shift();
      stableCount = previous !== null && Math.abs(value - previous) <= 0.25 ? stableCount + 1 : 1;
      previous = value;
      if (value >= minimumScroll && stableCount >= 3) {
        resolveStable(value);
        return;
      }
      if (performance.now() - started >= timeout) {
        rejectStable(new Error(`Detail scroll did not settle: ${JSON.stringify(recent)}`));
        return;
      }
      window.requestAnimationFrame(sample);
    };
    window.requestAnimationFrame(sample);
  }), { minimumScroll: minimum, timeout: timeoutMs });
}

function assertTruthfulCurrentState(state, expectedAction, expectedView, label) {
  const navigationActions = new Set(["strongs", "par", "refs", "commentary", "interlinear"]);
  const controls = state.currentControls.filter((control) => navigationActions.has(control.action));
  const current = controls.filter((control) => control.ariaCurrent === "page");
  assert.equal(state.displayedView, expectedView, `${label}: displayed-view identity is incorrect`);
  assert.deepEqual(current.map((control) => control.action), [expectedAction], `${label}: current control is contradictory`);
  controls.forEach((control) => {
    const isCurrent = control.action === expectedAction;
    assert.equal(control.ariaPressed, isCurrent ? "true" : "false", `${label}: ${control.action} aria-pressed is not truthful`);
    assert.equal(control.ariaCurrent, isCurrent ? "page" : "", `${label}: ${control.action} aria-current is not truthful`);
    if (isCurrent) {
      assert.match(control.title, /^Current /, `${label}: current ${control.action} title is not truthful`);
      assert.match(control.ariaLabel, /current view/i, `${label}: current ${control.action} accessible name is not truthful`);
    }
  });
  assert.equal(state.modeStatus, state.lock === "locked" ? "Locked" : "Following", `${label}: visible mode status is stale`);
  assert.equal(
    state.modeStatusLabel,
    `Study workspace mode: ${state.modeStatus}`,
    `${label}: accessible mode status is stale`,
  );
}

async function readerContextInvariantState(page) {
  return page.evaluate(() => {
    const word = document.querySelector(".reader-context-word");
    const verse = word?.closest(".verse-row, .source-bearing-segment") || document.querySelector(".reader-context-verse");
    const navigation = history.state?.bibleAppReaderNavigation || {};
    const phrase = document.querySelector(".reader-context-phrase-verse");
    return {
      hash: location.hash,
      pageScroll: scrollY,
      readerScroll: document.querySelector("#chapterContent")?.scrollTop || 0,
      selectedVerse: verse?.dataset.verse || "",
      selectedWord: word
        ? {
            interlinearKey: word.dataset.interlinearKey || "",
            strongCode: word.dataset.strongCode || "",
            tokenIndex: word.dataset.tokenIndex || "",
          }
        : null,
      phrase: phrase
        ? {
            charEnd: phrase.dataset.textSpanCharEnd || "",
            charStart: phrase.dataset.textSpanCharStart || "",
            targetId: phrase.dataset.textSpanTargetId || "",
          }
        : null,
      readerHistory: {
        index: navigation.navigationIndex ?? null,
        maxIndex: navigation.navigationMaxIndex ?? null,
      },
    };
  });
}

function assertPanelPlacement(state, mode) {
  if (captureOnly) return;
  if (mode === "narrow") {
    assert(
      state.panelHeaderGap >= 0,
      `${mode}: sticky detail panel overlaps the app header: ${JSON.stringify({ panelHeaderGap: state.panelHeaderGap })}`,
    );
    return;
  }
  assert(state.detailHeaderTop >= 0, `${mode}: detail heading is clipped above the viewport`);
}

async function exerciseReaderVerseMarks(page, mode) {
  const rowSelector = ".verse-row[data-verse='1']";
  const menuSelector = `${rowSelector} .verse-number-menu-wrap`;
  const initial = await page.evaluate((selector) => {
    const row = document.querySelector(selector);
    return {
      duplicateTriggers: row?.querySelectorAll(".verse-study-marks-button").length || 0,
      numberMenus: row?.querySelectorAll(".verse-number-menu-wrap").length || 0,
      numberPickers: row?.querySelectorAll(".verse-number-menu-wrap .tag-picker-popover").length || 0,
      actionPickers: row?.querySelectorAll(".verse-row-actions .target-tag-picker-menu, .verse-row-actions .tag-picker-popover").length || 0,
      studyLaunchers: row?.querySelectorAll(".verse-row-actions .verse-study-button").length || 0,
      studyLauncherVisible: (() => {
        const launcher = row?.querySelector(".verse-row-actions .verse-study-button");
        const rect = launcher?.getBoundingClientRect();
        return Boolean(rect && rect.width >= 28 && rect.height >= 28);
      })(),
    };
  }, rowSelector);
  assert.equal(initial.duplicateTriggers, 0, `${mode}: reader verse row must not retain a duplicate Study Marks trigger`);
  assert.equal(initial.numberMenus, 1, `${mode}: reader verse row must retain one verse-number picker`);
  assert.equal(initial.numberPickers, 1, `${mode}: reader verse row must retain one inline Study Marks menu`);
  assert.equal(initial.actionPickers, 0, `${mode}: reader row actions must contain only study tools, not a hidden marks picker`);
  assert.equal(initial.studyLaunchers, 1, `${mode}: reader verse row must retain one ellipsis study-tools launcher`);
  if (mode === "mobile") {
    assert(initial.studyLauncherVisible, `${mode}: ellipsis study-tools launcher is not touch-reachable`);
  }

  const number = page.locator(`${menuSelector} .verse-number`);
  await number.focus();
  await page.waitForFunction(
    (selector) => document.querySelector(selector)?.dataset.menuOpen === "true",
    menuSelector,
  );
  const added = await page.evaluate((selector) => {
    const menu = document.querySelector(selector);
    const favorite = [...(menu?.querySelectorAll(".tag-picker-option") || [])].find(
      (option) => /Favorite/u.test(option.textContent.trim()),
    );
    favorite?.click();
    return Boolean(favorite);
  }, menuSelector);
  assert(added, `${mode}: verse-number picker did not expose the Favorite mark`);
  await page.waitForFunction(
    (selector) => document.querySelector(selector)?.querySelector(".tag-badge")?.textContent.includes("Favorite"),
    rowSelector,
  );
  const afterAdd = await page.evaluate((selector) => {
    const row = document.querySelector(selector);
    return {
      duplicateTriggers: row?.querySelectorAll(".verse-study-marks-button").length || 0,
      numberMenus: row?.querySelectorAll(".verse-number-menu-wrap").length || 0,
      numberPickers: row?.querySelectorAll(".verse-number-menu-wrap .tag-picker-popover").length || 0,
      favoriteBadge: row?.querySelector(".tag-badge")?.textContent.trim() || "",
    };
  }, rowSelector);
  assert.deepEqual(
    { duplicateTriggers: afterAdd.duplicateTriggers, numberMenus: afterAdd.numberMenus, numberPickers: afterAdd.numberPickers },
    { duplicateTriggers: 0, numberMenus: 1, numberPickers: 1 },
    `${mode}: reader rerender introduced a duplicate verse Study Marks menu`,
  );
  assert.match(afterAdd.favoriteBadge, /Favorite/, `${mode}: verse-number mark did not rerender as an active badge`);

  await page.locator(`${menuSelector} .verse-number`).focus();
  await page.waitForFunction(
    (selector) => document.querySelector(selector)?.dataset.menuOpen === "true",
    menuSelector,
  );
  const removed = await page.evaluate((selector) => {
    const menu = document.querySelector(selector);
    const favorite = [...(menu?.querySelectorAll(".tag-picker-option") || [])].find(
      (option) => /Favorite/u.test(option.textContent.trim()),
    );
    favorite?.click();
    return Boolean(favorite);
  }, menuSelector);
  assert(removed, `${mode}: verse-number picker could not remove Favorite`);
  await page.waitForFunction(
    (selector) => !document.querySelector(selector)?.querySelector(".tag-badge"),
    rowSelector,
  );
}

function assertLanguageSpecificStrong(state, expectedSection, label) {
  const unexpectedSection = expectedSection === "hebrew" ? "greek" : "hebrew";
  assert.deepEqual(
    state.strongSectionControls.map((control) => control.section),
    [expectedSection],
    `${label}: opposite-language control must be absent from the DOM`,
  );
  const control = state.strongSectionControls[0];
  assert.equal(control.disabled, false, `${label}: rendered concordance control must become enabled when its section is present`);
  assert.equal(control.ariaDisabled, "false", `${label}: rendered concordance aria-disabled state is incorrect`);
  assert.equal(control.controlState, "enabled", `${label}: rendered concordance control state is incorrect`);
  assert.equal(control.unavailable, "false", `${label}: rendered concordance availability state is incorrect`);
  assert.match(control.title, /scroll to/i, `${label}: rendered concordance title is incorrect`);
  assert.match(control.ariaLabel || "", /scroll to/i, `${label}: rendered concordance accessible name is incorrect`);
  assert(state.strongSectionAnchors.includes(expectedSection), `${label}: matching concordance anchor is missing`);
  assert(!state.strongSectionAnchors.includes(unexpectedSection), `${label}: opposite-language concordance anchor must be absent`);
}

async function exerciseGreekStrong(page, baseUrl, mode, theme) {
  await page.mouse.move(0, 0);
  await page.goto(`${baseUrl}/#/read/bsb/john/1/1`, { waitUntil: "load" });
  await waitFor(page, () =>
    document.querySelector("#chapterTitle")?.textContent.includes("John 1") &&
    !document.body.textContent.includes("Loading data") &&
    document.querySelector("#detailTitle")?.textContent === "Details" &&
    document.querySelector("#detailToolSurface")?.hidden &&
    !document.querySelector("#detailWorkArea")?.inert,
  );
  await openStrongFromReader(page);
  await page.waitForFunction(
    () => {
      const control = document.querySelector("#detailContext [data-strong-section-control]");
      return Boolean(control && control.dataset.controlState !== "loading");
    },
  );
  const state = await contextState(page);
  assert.match(state.summary, /G\d+.*John 1:1|John 1:1.*G\d+/, `${mode}/${theme}: Greek summary must identify the selected token`);
  assertLanguageSpecificStrong(state, "greek", `${mode}/${theme}: Greek John word`);
  return state;
}

async function runScenario(browser, baseUrl, mode, theme) {
  const mobile = mode === "mobile";
  const context = await browser.newContext({
    viewport: VIEWPORTS[mode],
    deviceScaleFactor: mobile ? 3 : 1,
    isMobile: mobile,
    hasTouch: mobile,
  });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  let temporaryTagLabels = [];
  let temporaryTagsCleaned = false;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  try {
    await page.goto(`${baseUrl}/#/read/bsb/proverbs/1/1`, { waitUntil: "load" });
    await waitFor(page, () =>
      document.querySelector("#chapterTitle")?.textContent.includes("Proverbs 1") &&
      !document.body.textContent.includes("Loading data"),
    );
    await setTheme(page, theme);
    await exerciseReaderVerseMarks(page, mode);

    await click(page, ".verse-study-button");
    await waitFor(page, () => Boolean(document.querySelector("#detailContext .panel-context-navigation")));
    await click(
      page,
      "#detailContext [data-panel-scope='verse'] .verse-context-tab[data-visible-label='Language Study']",
    );
    await waitFor(page, () =>
      document.querySelector("#detailTitle")?.textContent === "Language Study" &&
      document.querySelectorAll("#detailContent .interlinear-token").length > 0,
    );
    const languageStudyState = await contextState(page);
    assertTruthfulCurrentState(
      languageStudyState,
      "interlinear",
      "language-study",
      `${mode}/${theme}: Language Study`,
    );
    assert(
      languageStudyState.transliteration?.text &&
        languageStudyState.transliteration.contrast >= 4.5,
      `${mode}/${theme}: Language Study transliteration has insufficient rendered contrast: ${JSON.stringify(languageStudyState.transliteration)}`,
    );
    assert(
      !languageStudyState.transliteration.usesMuted,
      `${mode}/${theme}: Language Study transliteration must not use the muted foreground treatment`,
    );
    await click(page, ".strong-token[data-strong-code]");
    await waitFor(page, () =>
      document.querySelector("#detailTitle")?.textContent === "Strong's" &&
      document.querySelector("#detailContext [data-panel-scope='word']"),
    );
    await page.waitForFunction(
      () => {
        const control = document.querySelector("#detailContext [data-strong-section-control]");
        return Boolean(control && control.dataset.controlState !== "loading");
      },
    );

    const wordState = await contextState(page);
    assertTruthfulCurrentState(wordState, "strongs", "strongs", `${mode}/${theme}: Strong's Word`);
    assert.equal(wordState.scopeOrder, "word verse", `${mode}: Word must lead the compact scope order`);
    assert.deepEqual(wordState.groupScopes, ["word", "verse"], `${mode}: contextual groups must be Word then Verse`);
    assert.deepEqual(wordState.staticScopes, [], `${mode}: Chapter and Book groups must be absent from the side panel`);
    assert.deepEqual(wordState.active, ["word:Word"], `${mode}: Strong's must mark Word as current`);
    assert.match(wordState.summary, /H\d+.*Proverbs 1:1|Proverbs 1:1.*H\d+/, `${mode}: summary must identify word and verse`);
    assert.equal(wordState.theme, theme, `${mode}: requested ${theme} theme was not applied`);
    assert(wordState.summaryOverflow <= 1, `${mode}/${theme}: selected-word summary is clipped`);
    assert(wordState.summaryUsesPrimary, `${mode}/${theme}: selected-word summary must use the rendered primary foreground`);
    assert(!wordState.summaryUsesMuted, `${mode}/${theme}: selected-word summary must not use the muted foreground`);
    assert(
      wordState.summaryColor?.contrast >= 4.5,
      `${mode}/${theme}: selected-word summary contrast is too low: ${JSON.stringify(wordState.summaryColor)}`,
    );
    assert(
      !["transparent", "rgba(0, 0, 0, 0)"].includes(wordState.wordActiveBackground),
      `${mode}/${theme}: active Word state is not visually distinct`,
    );
    assert(wordState.navOverflow <= 1, `${mode}: Word-first navigation has horizontal overflow`);
    assert(wordState.hasSummaryBoundary, `${mode}: selected-word summary boundary is missing`);
    assert(
      wordState.navHeight < (mobile || mode === "narrow" ? 240 : 190),
      `${mode}: contextual navigation is unexpectedly tall for its target-size mode (${wordState.navHeight}px)`,
    );
    assert(wordState.documentOverflow <= 1, `${mode}: document has horizontal overflow`);
    assertPanelPlacement(wordState, mode);
    assertLanguageSpecificStrong(wordState, "hebrew", `${mode}/${theme}: Hebrew Proverbs word`);
    await capturePanel(page, mode, theme, "word");

    const wordReactivation = await page.evaluate(() => {
      const button = document.querySelector("#detailContext [data-panel-scope='word'] .verse-context-tab[data-visible-label='Word']");
      const detail = document.querySelector("#detailContent .strong-detail");
      const overview = detail?.querySelector("[data-strong-section='word']");
      const before = {
        disabled: button?.disabled,
        lock: document.querySelector(".detail-pane")?.dataset.panelMode,
        token: document.querySelector("#detailContent .strong-code")?.textContent,
        detail,
        backDisabled: document.querySelector("#detailBack")?.disabled,
        readerToken: document.querySelector(".reader-context-word")?.dataset.strongCode,
      };
      button?.click();
      return {
        ...before,
        sameDetail: detail === document.querySelector("#detailContent .strong-detail"),
        sameToken: before.token === document.querySelector("#detailContent .strong-code")?.textContent,
        sameLock: before.lock === document.querySelector(".detail-pane")?.dataset.panelMode,
        sameHistoryState: before.backDisabled === document.querySelector("#detailBack")?.disabled,
        scrolled: overview?.dataset.strongSectionActive === "true",
      };
    });
    assert(!wordReactivation.disabled && wordReactivation.sameDetail && wordReactivation.sameToken && wordReactivation.sameLock && wordReactivation.sameHistoryState && wordReactivation.scrolled, `${mode}: active Word must scroll without replacing detail, changing context, lock, or history`);

    await click(page, "#detailBack");
    await waitFor(page, () => document.querySelector("#detailTitle")?.textContent === "Language Study");
    const backState = await page.evaluate(() => ({
      title: document.querySelector("#detailTitle")?.textContent,
      hasStrong: Boolean(document.querySelector("#detailContent .strong-detail")),
    }));
    assert.equal(backState.title, "Language Study", `${mode}: Back after current Word must return directly to the preceding view`);
    assert.equal(backState.hasStrong, false, `${mode}: current Word must not add a duplicate Strong's history entry`);
    await click(page, "#detailForward");
    await waitFor(page, () => document.querySelector("#detailTitle")?.textContent === "Strong's");
    const forwardState = await page.evaluate(() => ({
      token: document.querySelector("#detailContent .strong-code")?.textContent,
      lock: document.querySelector(".detail-pane")?.dataset.panelMode,
      wordControl: document.querySelector("#detailContext [data-panel-scope='word'] .verse-context-tab[data-visible-label='Word']")?.getAttribute("aria-current"),
      readerToken: document.querySelector(".reader-context-word")?.dataset.strongCode,
    }));
    assert.equal(forwardState.token, wordReactivation.token, `${mode}: Forward must restore the selected Strong's word`);
    assert.equal(forwardState.lock, wordReactivation.lock, `${mode}: Forward must restore the locked panel state`);
    assert.equal(forwardState.wordControl, "page", `${mode}: Forward must restore the active Word control`);
    assert.equal(forwardState.readerToken, wordReactivation.readerToken, `${mode}: Forward must restore the selected reader highlight`);

    const readerContextBeforeToolSwitch = await readerContextInvariantState(page);
    await page.locator("#detailContext [data-strong-section-control='hebrew']").click();
    let strongDeepScroll = await waitForStableDetailScroll(page);
    if (strongDeepScroll <= 0) {
      const assignedScroll = await page.locator("#detailContent").evaluate((node) => {
        const target = Math.min(240, Math.max(0, node.scrollHeight - node.clientHeight));
        node.scrollTop = target;
        return target;
      });
      assert(assignedScroll > 0, `${mode}: Strong's fixture has no independently scrollable Detail range`);
      strongDeepScroll = await waitForStableDetailScroll(page, { minimum: 1 });
    }
    await page.locator(
      "#detailContext [data-panel-scope='verse'] .verse-context-tab[data-visible-label='Language Study']",
    ).click();
    await waitFor(page, () =>
      document.querySelector("#detailTitle")?.textContent === "Language Study" &&
      document.querySelector("#detailContent")?.scrollTop === 0,
    );
    const languageFromWordState = await contextState(page);
    assertTruthfulCurrentState(
      languageFromWordState,
      "interlinear",
      "language-study",
      `${mode}/${theme}: Language Study from a scrolled Strong's entry`,
    );
    assert.equal(languageFromWordState.wordDisabled, false, `${mode}: Word must remain available in Language Study`);
    assert.deepEqual(
      await readerContextInvariantState(page),
      readerContextBeforeToolSwitch,
      `${mode}: Language Study changed canonical Reader context`,
    );

    await page.locator("#detailBack").click();
    await waitFor(page, () => document.querySelector("#detailTitle")?.textContent === "Strong's");
    await page.evaluate(async () => {
      await new Promise((resolveFrame) => window.requestAnimationFrame(() =>
        window.requestAnimationFrame(() => window.requestAnimationFrame(resolveFrame)),
      ));
    });
    const restoredStrongScroll = await page.locator("#detailContent").evaluate((node) => node.scrollTop);
    assert(
      Math.abs(restoredStrongScroll - strongDeepScroll) <= 1,
      `${mode}: Detail Back did not restore exact Strong's scroll (${strongDeepScroll} -> ${restoredStrongScroll})`,
    );
    assert.deepEqual(
      await readerContextInvariantState(page),
      readerContextBeforeToolSwitch,
      `${mode}: Detail Back changed canonical Reader context`,
    );
    await page.locator("#detailForward").click();
    await waitFor(page, () =>
      document.querySelector("#detailTitle")?.textContent === "Language Study" &&
      document.querySelector("#detailContent")?.scrollTop === 0,
    );
    await page.locator(
      "#detailContext [data-panel-scope='word'] .verse-context-tab[data-visible-label='Word']",
    ).click();
    await waitFor(page, () =>
      document.querySelector("#detailTitle")?.textContent === "Strong's" &&
      document.querySelector(".detail-pane")?.dataset.displayedView === "strongs" &&
      document.querySelector("#detailContent")?.scrollTop === 0,
    );
    const returnedWordState = await contextState(page);
    assertTruthfulCurrentState(returnedWordState, "strongs", "strongs", `${mode}/${theme}: Word return`);
    assert.deepEqual(
      await readerContextInvariantState(page),
      readerContextBeforeToolSwitch,
      `${mode}: Word return changed canonical Reader context`,
    );

    await page.locator(
      "#detailContext [data-panel-scope='verse'] .verse-context-tab[data-visible-label='Parallel']",
    ).click();
    await waitFor(page, () => document.querySelector("#detailTitle")?.textContent === "Parallel");
    const inheritedState = await contextState(page);
    assert.equal(inheritedState.scopeOrder, "word verse", `${mode}: Verse view must retain containing Word context`);
    assert.deepEqual(inheritedState.groupScopes, ["word", "verse"], `${mode}: inherited Word and Verse groups are out of order`);
    assert.deepEqual(inheritedState.active, ["verse:Parallel"], `${mode}: Parallel must be the sole current displayed view`);
    assertTruthfulCurrentState(inheritedState, "par", "parallel", `${mode}/${theme}: Parallel`);
    assert.equal(inheritedState.panelOccupant, "parallel", `${mode}: visible Parallel panel occupant must remain identifiable`);
    assert.equal(inheritedState.wordDisabled, false, `${mode}: Word must remain available from Parallel`);
    assert.deepEqual(inheritedState.verseScopeLabels, ["Verse"], `${mode}: Verse must render once as a scope label`);
    assert.equal(inheritedState.parallelActionCount, 1, `${mode}: Parallel must render exactly one actual action`);
    assertPanelPlacement(inheritedState, mode);
    await capturePanel(page, mode, theme, "inherited-verse");

    const inheritedReaderContext = await readerContextInvariantState(page);
    await page.locator(
      "#detailContext [data-panel-scope='verse'] .verse-context-tab[data-visible-label='References']",
    ).click();
    await waitFor(page, () => document.querySelector("#detailTitle")?.textContent === "Cross References");
    const inheritedReferencesState = await contextState(page);
    assertTruthfulCurrentState(inheritedReferencesState, "refs", "references", `${mode}/${theme}: inherited References`);
    assert.equal(inheritedReferencesState.wordDisabled, false, `${mode}: Word must remain available from References`);
    assert.deepEqual(
      await readerContextInvariantState(page),
      inheritedReaderContext,
      `${mode}: References changed canonical Reader context`,
    );

    await page.locator(
      "#detailContext [data-panel-scope='verse'] .verse-context-tab[data-visible-label='Commentary']",
    ).click();
    await waitFor(page, () =>
      document.querySelector("#detailTitle")?.textContent === "Commentary" &&
      document.querySelector("#detailContext [data-panel-action='commentary'][aria-current='page']"),
    );
    const inheritedCommentaryState = await contextState(page);
    assertTruthfulCurrentState(inheritedCommentaryState, "commentary", "commentary", `${mode}/${theme}: inherited Commentary`);
    assert.equal(inheritedCommentaryState.wordDisabled, false, `${mode}: Word must remain available from Commentary`);
    assert.deepEqual(
      await readerContextInvariantState(page),
      inheritedReaderContext,
      `${mode}: Commentary changed canonical Reader context`,
    );

    await click(page, "#showOutline");
    await waitFor(page, () => document.querySelector("#detailTitle")?.textContent === "Outline");
    await click(page, ".verse-study-button");
    await waitFor(page, () => document.querySelector("#detailTitle")?.textContent === "Cross References");
    const verseOnlyState = await contextState(page);
    assert.equal(verseOnlyState.scopeOrder, "verse", `${mode}: cleared context must return to Verse-only order`);
    assert.deepEqual(verseOnlyState.groupScopes, ["verse"], `${mode}: cleared context must not render a Word group`);
    assert.deepEqual(verseOnlyState.active, ["verse:References"], `${mode}: References must identify the displayed verse tool`);
    assertTruthfulCurrentState(verseOnlyState, "refs", "references", `${mode}/${theme}: verse-only References`);
    assert.deepEqual(verseOnlyState.verseScopeLabels, ["Verse"], `${mode}: Verse must remain a noninteractive scope label`);
    assert.equal(verseOnlyState.parallelActionCount, 1, `${mode}: verse scope must contain one Parallel action`);
    assert(verseOnlyState.navOverflow <= 1, `${mode}: Verse-only navigation has horizontal overflow`);
    assert(verseOnlyState.documentOverflow <= 1, `${mode}: cleared layout has horizontal overflow`);
    assertPanelPlacement(verseOnlyState, mode);
    await capturePanel(page, mode, theme, "verse-only");

    const verseReferenceContext = await readerContextInvariantState(page);
    const referenceControl = verseOnlyState.currentControls.find((control) => control.action === "refs");
    assert.equal(referenceControl?.disabled, true, `${mode}: current References may be disabled only as the truthful displayed view`);
    await click(page, "#detailBack");
    await waitFor(page, () => document.querySelector("#detailTitle")?.textContent === "Outline");
    await click(page, "#detailForward");
    await waitFor(page, () => document.querySelector("#detailTitle")?.textContent === "Cross References");
    const verseForwardState = await contextState(page);
    assertTruthfulCurrentState(verseForwardState, "refs", "references", `${mode}/${theme}: restored References`);
    assert.equal(verseForwardState.readerVerse, verseOnlyState.readerVerse, `${mode}: Forward must restore the selected verse`);
    assert.equal(verseForwardState.title, verseOnlyState.title, `${mode}: Forward must restore the same References panel`);
    assert.equal(verseForwardState.lock, verseOnlyState.lock, `${mode}: Forward must restore the locked panel state`);
    assert.equal(verseForwardState.panelOccupant, "references", `${mode}: Forward must restore the visible References occupant`);
    assert.deepEqual(
      await readerContextInvariantState(page),
      verseReferenceContext,
      `${mode}: Detail history changed the selected Reader verse or navigation state`,
    );

    temporaryTagLabels = Array.from(
      { length: TEMPORARY_TAG_COUNT },
      (_, index) => `Panel QA ${mode} ${theme} ${Date.now()} ${index + 1}`,
    );
    await createTemporaryTags(page, temporaryTagLabels);
    await openStrongFromReader(page);
    const sourceContainedTool = await exercisePanelStudyMarksSurface(
      page,
      "#detailContext [data-panel-scope='word'] .study-marks-trigger",
      `${mode}/${theme}: source-word Study Marks`,
      {
        activation: "click",
        expectedLabel: "selected source word in Proverbs 1:1",
        targetType: "source_token",
        temporaryLabels: temporaryTagLabels,
      },
    );
    const verseContainedTool = await exercisePanelStudyMarksSurface(
      page,
      "#detailContext [data-panel-scope='verse'] .study-marks-trigger",
      `${mode}/${theme}: verse Study Marks`,
      {
        activation: "Enter",
        expectedLabel: "verse Proverbs 1:1",
        expectedPreview: "These are the proverbs of Solomon son of David, king of Israel,",
        targetType: "verse",
        temporaryLabels: temporaryTagLabels,
      },
    );
    await removeTemporaryTags(page, temporaryTagLabels);
    temporaryTagsCleaned = true;
    const greekState = await exerciseGreekStrong(page, baseUrl, mode, theme);

    assert.deepEqual(pageErrors, [], `${mode}/${theme}: browser page errors were reported`);
    assert.deepEqual(consoleErrors, [], `${mode}/${theme}: browser console errors were reported`);

    return {
      mode,
      theme,
      viewport: VIEWPORTS[mode],
      panelHeaderGap: wordState.panelHeaderGap,
      detailHeaderTop: wordState.detailHeaderTop,
      wordOrder: wordState.scopeOrder,
      inheritedOrder: inheritedState.scopeOrder,
      sourceContainedTool,
      verseContainedTool,
      verseOnlyOrder: verseOnlyState.scopeOrder,
      greekOrder: greekState.scopeOrder,
    };
  } finally {
    if (temporaryTagLabels.length && !temporaryTagsCleaned) {
      try {
        await removeTemporaryTags(page, temporaryTagLabels);
      } catch {
        // The isolated browser context is discarded below; cleanup is best-effort after a failed assertion.
      }
    }
    await context.close();
  }
}

const { server, url } = await startAppServer();
const browser = await chromium.launch({
  executablePath: findEdgePath(),
  headless: true,
  args: ["--disable-gpu", "--disable-dev-shm-usage", "--disable-background-networking", "--no-first-run"],
});

try {
  const results = [];
  for (const mode of Object.keys(VIEWPORTS)) {
    for (const theme of THEMES) {
      results.push(await runScenario(browser, url, mode, theme));
    }
  }
  const report = { status: "ok", screenshots: Boolean(screenshotRoot), captureOnly, results };
  if (screenshotRoot) {
    await mkdir(screenshotRoot, { recursive: true });
    await writeFile(join(screenshotRoot, "panel-context-metrics.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
