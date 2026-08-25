#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { startStaticAppServer } from "../tools/serve-app.mjs";

const WIDTH_STORAGE_KEY = "bibleapp:study-workspace-width:v1";
const WIDTH_MODES = Object.freeze(["compact", "standard", "expanded"]);
const SOURCE_TOKEN_TAGS = Object.freeze([
  "Command/Declaration",
  "Favorite",
  "Inquiry",
  "Negative",
  "Positive",
  "Text question",
]);
const VIEWPORTS = Object.freeze([
  Object.freeze({ name: "desktop-wide", width: 1440, height: 900 }),
  Object.freeze({ name: "desktop", width: 1280, height: 720 }),
  Object.freeze({ name: "desktop-compact", width: 1024, height: 768 }),
  Object.freeze({ name: "narrow-desktop", width: 820, height: 900 }),
  Object.freeze({ name: "mobile", width: 390, height: 844 }),
]);
const USER_STORAGE_KEYS = Object.freeze({
  assertions: "bibleapp:assertions:v1",
  importBackups: "bibleapp:import-backups:v1",
  packages: "bibleapp:packages:v1",
  polls: "bibleapp:polls:v1",
  tags: "bibleapp:verse-tags:v1",
  workspace: "bibleapp:translation-workspace:v1",
});

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

function attachHealthChecks(page, baseUrl, label) {
  const consoleErrors = [];
  const pageErrors = [];
  const requestFailures = [];
  const responseFailures = [];
  const appOrigin = new URL(baseUrl).origin;
  const isApplicationRequest = (url) => {
    try {
      const parsed = new URL(url);
      return parsed.origin === appOrigin && parsed.pathname !== "/favicon.ico";
    } catch {
      return false;
    }
  };

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (!isApplicationRequest(request.url())) return;
    requestFailures.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText || "failed"}`);
  });
  page.on("response", (response) => {
    if (!isApplicationRequest(response.url()) || response.status() < 400) return;
    responseFailures.push(`${response.status()} ${response.request().method()} ${response.url()}`);
  });

  return {
    assertHealthy() {
      assert.deepEqual(consoleErrors, [], `${label}: console errors were reported`);
      assert.deepEqual(pageErrors, [], `${label}: page errors were reported`);
      assert.deepEqual(requestFailures, [], `${label}: application requests failed`);
      assert.deepEqual(responseFailures, [], `${label}: application responses failed`);
    },
  };
}

async function waitForFrames(page, count = 2) {
  await page.evaluate(async (frameCount) => {
    for (let index = 0; index < frameCount; index += 1) {
      await new Promise((resolveFrame) => window.requestAnimationFrame(resolveFrame));
    }
  }, count);
}

async function waitForApp(page, titlePart = "Proverbs 1") {
  await page.waitForFunction(
    (expectedTitle) =>
      document.querySelector("#chapterTitle")?.textContent.includes(expectedTitle) &&
      !document.body.textContent.includes("Loading data") &&
      ["compact", "standard", "expanded"].includes(document.documentElement.dataset.studyWorkspaceWidth) &&
      document.querySelectorAll("[data-study-workspace-width-mode]").length === 3 &&
      Boolean(document.querySelector("#detailWorkArea")) &&
      Boolean(document.querySelector("#detailToolSurface")),
    titlePart,
  );
  await page.waitForLoadState("networkidle");
}

async function goToProverbs(page, baseUrl) {
  await page.goto(`${baseUrl}/#/read/bsb/proverbs/1/1`, { waitUntil: "load" });
  await waitForApp(page);
}

async function openLanguageStudy(page) {
  const verseRow = page.locator(".verse-row:has(.verse-study-button)").first();
  await verseRow.hover();
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".verse-study-button")).visibility === "visible");
  await page.locator(".verse-study-button").first().click();
  await page.waitForFunction(() => Boolean(document.querySelector("#detailContext .panel-context-navigation")));
  const language = page
    .locator("#detailContext .verse-context-tab[data-visible-label='Language']")
    .first();
  assert.equal(await language.count(), 1, "Language Study context control was not rendered");
  await language.click();
  await page.waitForFunction(() =>
    document.querySelector("#detailTitle")?.textContent === "Language Study" &&
    document.querySelectorAll("#detailContent .interlinear-token .word-meaning-control").length >= 2,
  );
}

async function openStrongFromLanguageStudy(page) {
  const strong = page.locator(".reader-pane .strong-token[data-strong-code]").first();
  await strong.scrollIntoViewIfNeeded();
  await strong.click();
  await page.waitForFunction(() =>
    document.querySelector("#detailTitle")?.textContent === "Strong's" &&
    Boolean(document.querySelector("#detailContent .strong-detail")) &&
    Boolean(document.querySelector(".reader-context-word")) &&
    document.querySelector(".detail-pane")?.dataset.panelMode === "locked",
  );
}

async function readUserDataSnapshot(page) {
  return page.evaluate(async ({ storageKeys }) => {
    const readLocal = (key) => {
      try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    };
    const localStores = Object.fromEntries(
      Object.entries(storageKeys).map(([name, key]) => [name, readLocal(key)]),
    );
    const readIndexedStores = () => new Promise((resolveStores) => {
      if (!window.indexedDB) {
        resolveStores({});
        return;
      }
      let request;
      try {
        request = window.indexedDB.open("bibleapp");
      } catch {
        resolveStores({});
        return;
      }
      request.onerror = () => resolveStores({});
      request.onblocked = () => resolveStores({});
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("user_stores")) {
          db.close();
          resolveStores({});
          return;
        }
        const names = Object.keys(storageKeys);
        const values = {};
        const transaction = db.transaction("user_stores", "readonly");
        const store = transaction.objectStore("user_stores");
        names.forEach((name) => {
          const get = store.get(name);
          get.onsuccess = () => {
            values[name] = get.result?.value || null;
          };
        });
        transaction.oncomplete = () => {
          db.close();
          resolveStores(values);
        };
        transaction.onerror = () => {
          db.close();
          resolveStores({});
        };
        transaction.onabort = () => {
          db.close();
          resolveStores({});
        };
      };
    });
    const indexedStores = await readIndexedStores();
    return {
      stores: Object.fromEntries(
        Object.keys(storageKeys).map((name) => [name, indexedStores[name] || localStores[name] || null]),
      ),
      localStores,
    };
  }, { storageKeys: USER_STORAGE_KEYS });
}

function activeTagAssertions(snapshot) {
  return Object.values(snapshot?.stores?.tags?.tag_assertions || {})
    .filter((record) => record?.active)
    .map((record) => ({
      tagId: String(record.tag_id || record.legacy_tag_id || "").replace(/^tag:/, ""),
      targetId: record.target_id || record.target?.target_id || "",
    }))
    .sort((first, second) => `${first.targetId}:${first.tagId}`.localeCompare(`${second.targetId}:${second.tagId}`));
}

function tokenRenderings(snapshot) {
  return Object.values(snapshot?.stores?.workspace?.token_renderings || {})
    .flatMap((verse) => Object.values(verse || {}))
    .filter(Boolean)
    .map((record) => ({ rendering: record.rendering, targetId: record.target_id }))
    .sort((first, second) => first.targetId.localeCompare(second.targetId));
}

async function waitForPersistedTag(page, targetId, expectedActive) {
  await page.waitForFunction(
    async ({ active, key, requestedTargetId }) => {
      const localFallback = () => {
        try {
          return JSON.parse(window.localStorage.getItem(key) || "null");
        } catch {
          return null;
        }
      };
      const tagStore = await new Promise((resolveStore) => {
        if (!window.indexedDB) {
          resolveStore(localFallback());
          return;
        }
        const request = window.indexedDB.open("bibleapp");
        request.onerror = () => resolveStore(localFallback());
        request.onblocked = () => resolveStore(localFallback());
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("user_stores")) {
            db.close();
            resolveStore(localFallback());
            return;
          }
          const get = db.transaction("user_stores", "readonly").objectStore("user_stores").get("tags");
          get.onsuccess = () => {
            const value = get.result?.value || localFallback();
            db.close();
            resolveStore(value);
          };
          get.onerror = () => {
            db.close();
            resolveStore(localFallback());
          };
        };
      });
      const isActive = Object.values(tagStore?.tag_assertions || {}).some(
        (record) =>
          record?.active &&
          ["favorite", "tag:favorite"].includes(record.tag_id || record.legacy_tag_id) &&
          (record.target_id || record.target?.target_id) === requestedTargetId,
      );
      return isActive === active;
    },
    { active: expectedActive, key: USER_STORAGE_KEYS.tags, requestedTargetId: targetId },
  );
}

async function waitForPersistedMeaning(page, targetId, expectedRendering) {
  await page.waitForFunction(
    async ({ key, rendering, requestedTargetId }) => {
      const localFallback = () => {
        try {
          return JSON.parse(window.localStorage.getItem(key) || "null");
        } catch {
          return null;
        }
      };
      const workspace = await new Promise((resolveStore) => {
        if (!window.indexedDB) {
          resolveStore(localFallback());
          return;
        }
        const request = window.indexedDB.open("bibleapp");
        request.onerror = () => resolveStore(localFallback());
        request.onblocked = () => resolveStore(localFallback());
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("user_stores")) {
            db.close();
            resolveStore(localFallback());
            return;
          }
          const get = db.transaction("user_stores", "readonly").objectStore("user_stores").get("workspace");
          get.onsuccess = () => {
            const value = get.result?.value || localFallback();
            db.close();
            resolveStore(value);
          };
          get.onerror = () => {
            db.close();
            resolveStore(localFallback());
          };
        };
      });
      const record = Object.values(workspace?.token_renderings || {})
        .flatMap((verse) => Object.values(verse || {}))
        .find((candidate) => candidate?.target_id === requestedTargetId);
      return rendering === null ? !record : record?.rendering === rendering;
    },
    { key: USER_STORAGE_KEYS.workspace, rendering: expectedRendering, requestedTargetId: targetId },
  );
}

async function widthState(page) {
  return page.evaluate(() => {
    const rect = (node) => {
      const bounds = node?.getBoundingClientRect();
      return bounds
        ? { bottom: bounds.bottom, height: bounds.height, left: bounds.left, right: bounds.right, top: bounds.top, width: bounds.width }
        : null;
    };
    const overflow = (node) => node ? Math.max(0, node.scrollWidth - node.clientWidth) : null;
    const root = document.documentElement;
    const shell = document.querySelector(".app-shell");
    const reader = document.querySelector(".reader-pane");
    const pane = document.querySelector(".detail-pane");
    const detail = document.querySelector("#detailContent");
    const controls = document.querySelector("#studyWorkspaceWidthControls");
    return {
      controlsVisible: controls ? getComputedStyle(controls).display !== "none" : false,
      cssInlineSize: getComputedStyle(root).getPropertyValue("--study-workspace-inline-size").trim(),
      detailOverflow: overflow(detail),
      detailOverflowY: detail ? getComputedStyle(detail).overflowY : "",
      documentOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
      minWidths: {
        pane: pane ? getComputedStyle(pane).minWidth : "",
        reader: reader ? getComputedStyle(reader).minWidth : "",
      },
      mode: root.dataset.studyWorkspaceWidth || "",
      overflowingElements: [...document.querySelectorAll("body *")]
        .filter((node) => {
          if (node.closest(".detail-pane:not(.visible)")) return false;
          const bounds = node.getBoundingClientRect();
          return getComputedStyle(node).display !== "none" && (bounds.left < -1 || bounds.right > window.innerWidth + 1);
        })
        .slice(0, 12)
        .map((node) => ({
          className: typeof node.className === "string" ? node.className : "",
          id: node.id || "",
          overflow: node.scrollWidth - node.clientWidth,
          tag: node.tagName,
          width: node.getBoundingClientRect().width,
        })),
      pane: rect(pane),
      paneOpen: Boolean(pane?.classList.contains("visible")),
      paneOverflow: overflow(pane),
      pressed: [...document.querySelectorAll("[data-study-workspace-width-mode]")]
        .filter((button) => button.getAttribute("aria-pressed") === "true")
        .map((button) => button.dataset.studyWorkspaceWidthMode),
      reader: rect(reader),
      shell: rect(shell),
      shellOverflow: overflow(shell),
      viewport: { height: window.innerHeight, width: window.innerWidth },
      widthControlArtwork: Object.fromEntries(["compact", "expanded"].map((mode) => {
        const button = document.querySelector(`[data-study-workspace-width-mode="${mode}"]`);
        const symbol = button?.querySelector(".study-workspace-width-symbol");
        const bounds = button?.getBoundingClientRect();
        const before = symbol ? getComputedStyle(symbol, "::before") : null;
        const after = symbol ? getComputedStyle(symbol, "::after") : null;
        return [mode, {
          buttonHeight: bounds?.height || 0,
          buttonWidth: bounds?.width || 0,
          before: before ? { height: before.height, width: before.width } : null,
          after: after ? { content: after.content, height: after.height, width: after.width } : null,
          symbolDisplay: symbol ? getComputedStyle(symbol).display : "",
        }];
      })),
      workAreaOverflow: overflow(document.querySelector("#detailWorkArea")),
    };
  });
}

function assertLayoutHealth(state, label, { mobile = false } = {}) {
  assert.equal(state.minWidths.reader, "0px", `${label}: reader-pane must retain min-width: 0`);
  assert.equal(state.minWidths.pane, "0px", `${label}: detail-pane must retain min-width: 0`);
  assert(state.documentOverflow <= 1, `${label}: document has horizontal overflow: ${JSON.stringify(state)}`);
  assert(state.shellOverflow <= 1, `${label}: app shell has horizontal overflow`);
  assert(state.paneOverflow <= 1, `${label}: detail pane has horizontal overflow`);
  assert(state.workAreaOverflow <= 1, `${label}: detail work area has horizontal overflow`);
  assert(state.detailOverflow <= 1, `${label}: detail content has horizontal overflow`);
  assert.equal(state.detailOverflowY, "auto", `${label}: detail content must own vertical overflow`);
  assert(state.pane && state.reader && state.shell, `${label}: layout geometry is incomplete`);
  assert(state.reader.left >= -1, `${label}: reader escapes the viewport`);
  assert.deepEqual(state.pressed, [state.mode], `${label}: exactly one width control must be active`);
  assert.equal(state.controlsVisible, !mobile, `${label}: desktop width controls have the wrong responsive visibility`);
  if (mobile) {
    assert(state.reader.width >= state.viewport.width - 2, `${label}: mobile reader is not full width`);
    if (state.paneOpen) assert(state.pane.right <= state.viewport.width + 1, `${label}: open mobile detail pane escapes the viewport`);
  } else {
    assert.deepEqual(
      state.widthControlArtwork.compact,
      {
        buttonHeight: 24,
        buttonWidth: 24,
        before: { height: "2px", width: "10px" },
        after: { content: "none", height: "auto", width: "auto" },
        symbolDisplay: "grid",
      },
      `${label}: Compact artwork is not geometrically centered in its 24px target`,
    );
    assert.deepEqual(
      state.widthControlArtwork.expanded,
      {
        buttonHeight: 24,
        buttonWidth: 24,
        before: { height: "2px", width: "10px" },
        after: { content: '\"\"', height: "10px", width: "2px" },
        symbolDisplay: "grid",
      },
      `${label}: Expanded artwork is not geometrically centered in its 24px target`,
    );
    assert(state.pane.right <= state.viewport.width + 1, `${label}: detail pane escapes the viewport`);
    assert(state.reader.width >= 340, `${label}: scripture column is not practical`);
    assert(state.pane.height <= state.viewport.height + 1, `${label}: sticky detail pane exceeds viewport height`);
  }
}

async function setWidthMode(page, mode, activation = "click") {
  assert(WIDTH_MODES.includes(mode), `Unsupported test width mode: ${mode}`);
  const button = page.locator(`[data-study-workspace-width-mode="${mode}"]`);
  await button.focus();
  if (activation === "space") await button.press("Space");
  else if (activation === "enter") await button.press("Enter");
  else await button.click();
  await page.waitForFunction(
    (expectedMode) =>
      document.documentElement.dataset.studyWorkspaceWidth === expectedMode &&
      document.querySelector(`[data-study-workspace-width-mode="${expectedMode}"]`)?.getAttribute("aria-pressed") === "true",
    mode,
  );
  await waitForFrames(page, 3);
  assert.equal(
    await page.evaluate((key) => window.localStorage.getItem(key), WIDTH_STORAGE_KEY),
    mode,
    `${mode}: width preference was not persisted in its isolated key`,
  );
  assert(
    await button.evaluate((node) => document.activeElement === node),
    `${mode}: keyboard-operable width control did not retain focus`,
  );
  return widthState(page);
}

async function prepareAnchorAndPanelScroll(page) {
  await page.evaluate(() => {
    const anchor = document.querySelector(".reader-context-word") ||
      document.querySelector(".reader-context-verse") ||
      [...document.querySelectorAll(".verse-row, .source-bearing-segment")].find((node) => {
        const rect = node.getBoundingClientRect();
        return rect.bottom > 80 && rect.top < window.innerHeight;
      });
    if (!anchor) throw new Error("Could not resolve a semantic reader anchor");
    window.__studyWorkspaceQaAnchor = anchor;
    window.__studyWorkspaceQaDetailNode = document.querySelector("#detailContent")?.firstElementChild;
    window.__studyWorkspaceQaReaderNode = document.querySelector("#chapterContent")?.firstElementChild;
    const bounds = anchor.getBoundingClientRect();
    window.scrollBy(0, bounds.top - 230);
    const detail = document.querySelector("#detailContent");
    if (detail) detail.scrollTop = Math.min(180, Math.max(0, detail.scrollHeight - detail.clientHeight));
  });
  await waitForFrames(page, 2);
}

async function anchorInvariantState(page) {
  return page.evaluate(() => {
    const anchor = window.__studyWorkspaceQaAnchor;
    const word = document.querySelector(".reader-context-word");
    const verse = word?.closest(".verse-row, .source-bearing-segment") || document.querySelector(".reader-context-verse");
    const activeStrongSection = document.querySelector("#detailContent [data-strong-section-active='true']")?.dataset.strongSection || "";
    return {
      activeStrongSection,
      anchorConnected: Boolean(anchor?.isConnected),
      anchorIdentity: anchor === document.querySelector(".reader-context-word") || anchor === document.querySelector(".reader-context-verse"),
      anchorTop: anchor?.getBoundingClientRect().top ?? null,
      backDisabled: document.querySelector("#detailBack")?.disabled,
      browserHistoryLength: window.history.length,
      detailIdentity: window.__studyWorkspaceQaDetailNode === document.querySelector("#detailContent")?.firstElementChild,
      detailScrollTop: document.querySelector("#detailContent")?.scrollTop || 0,
      detailTitle: document.querySelector("#detailTitle")?.textContent || "",
      forwardDisabled: document.querySelector("#detailForward")?.disabled,
      hash: window.location.hash,
      panelMode: document.querySelector(".detail-pane")?.dataset.panelMode || "",
      readerIdentity: window.__studyWorkspaceQaReaderNode === document.querySelector("#chapterContent")?.firstElementChild,
      selectedWord: word ? {
        interlinearKey: word.dataset.interlinearKey || "",
        strongCode: word.dataset.strongCode || "",
        tokenIndex: word.dataset.tokenIndex || "",
        text: word.textContent.trim(),
      } : null,
      selectedVerse: verse?.dataset.verse || "",
    };
  });
}

function assertAnchorInvariant(before, after, label) {
  assert(before.anchorConnected && after.anchorConnected, `${label}: semantic anchor disconnected`);
  assert(after.anchorIdentity, `${label}: active semantic anchor was reconstructed`);
  assert(Math.abs(after.anchorTop - before.anchorTop) <= 6, `${label}: reader anchor moved in the viewport: ${JSON.stringify({ before: before.anchorTop, after: after.anchorTop })}`);
  assert.deepEqual(after.selectedWord, before.selectedWord, `${label}: exact selected word changed`);
  assert.equal(after.selectedVerse, before.selectedVerse, `${label}: containing verse changed`);
  assert.equal(after.hash, before.hash, `${label}: reader route changed`);
  assert.equal(after.browserHistoryLength, before.browserHistoryLength, `${label}: browser history changed`);
  assert.equal(after.detailTitle, before.detailTitle, `${label}: detail view changed`);
  assert.equal(after.panelMode, before.panelMode, `${label}: follow/locked detail mode changed`);
  assert.equal(after.backDisabled, before.backDisabled, `${label}: Back state changed`);
  assert.equal(after.forwardDisabled, before.forwardDisabled, `${label}: Forward state changed`);
  assert.equal(after.activeStrongSection, before.activeStrongSection, `${label}: active Strong's section changed`);
  assert(after.detailIdentity, `${label}: active detail DOM was reconstructed`);
  assert(after.readerIdentity, `${label}: reader DOM was reconstructed`);
  assert(Math.abs(after.detailScrollTop - before.detailScrollTop) <= 4, `${label}: detail scroll location changed`);
}

async function exerciseIndependentScroll(page) {
  const detail = page.locator("#detailContent");
  const detailBox = await detail.boundingBox();
  assert(detailBox, "Independent scroll: detail content is not visible");
  const initial = await page.evaluate(() => {
    const node = document.querySelector("#detailContent");
    if (node) node.scrollTop = 0;
    return {
      detailMax: node ? node.scrollHeight - node.clientHeight : 0,
      pageY: window.scrollY,
    };
  });
  assert(initial.detailMax > 80, "Independent scroll: focused Strong's content is not vertically scrollable");
  await page.mouse.move(
    detailBox.x + detailBox.width - 6,
    detailBox.y + Math.min(180, detailBox.height / 2),
  );
  await page.mouse.wheel(0, Math.min(420, initial.detailMax - 20));
  await page.waitForFunction(() => document.querySelector("#detailContent")?.scrollTop > 0);
  const panelScrolled = await page.evaluate(() => ({
    detailScrollTop: document.querySelector("#detailContent")?.scrollTop || 0,
    pageY: window.scrollY,
  }));
  assert(Math.abs(panelScrolled.pageY - initial.pageY) <= 1, "Independent scroll: panel wheel moved the scripture document");

  const readerBox = await page.locator(".reader-pane").boundingBox();
  assert(readerBox, "Independent scroll: reader is not visible");
  const stickyBefore = await page.locator(".detail-pane").evaluate((node) => node.getBoundingClientRect().top);
  const viewport = page.viewportSize();
  await page.mouse.move(
    readerBox.x + Math.min(180, readerBox.width / 2),
    Math.min((viewport?.height || 720) - 30, readerBox.y + 260),
  );
  await page.mouse.wheel(0, 420);
  await page.waitForFunction((beforeY) => window.scrollY > beforeY, initial.pageY);
  const readerScrolled = await page.evaluate(() => ({
    detailScrollTop: document.querySelector("#detailContent")?.scrollTop || 0,
    pageY: window.scrollY,
    paneTop: document.querySelector(".detail-pane")?.getBoundingClientRect().top,
  }));
  assert.equal(readerScrolled.detailScrollTop, panelScrolled.detailScrollTop, "Independent scroll: scripture wheel reset panel scroll");
  await page.mouse.wheel(0, 180);
  await page.waitForFunction((beforeY) => window.scrollY > beforeY, readerScrolled.pageY);
  const stickyAfter = await page.locator(".detail-pane").evaluate((node) => node.getBoundingClientRect().top);
  assert(Math.abs(stickyAfter - readerScrolled.paneTop) <= 1, "Independent scroll: detail pane is not sticky while scripture scrolls");
  assert(stickyAfter <= stickyBefore + 1, "Independent scroll: sticky detail pane moved down while scripture scrolled");
}

function tokenSelectors(targetId) {
  const escaped = targetId.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const card = `#detailContent .interlinear-token:has(.word-meaning-control[data-target-id="${escaped}"])`;
  return {
    card,
    marks: `${card} .study-marks-trigger`,
    meaning: `${card} .word-meaning-trigger`,
    meaningRoot: `${card} .word-meaning-control[data-target-id="${escaped}"]`,
  };
}

async function firstTwoTokenTargets(page) {
  const targetIds = await page.locator("#detailContent .interlinear-token .word-meaning-control").evaluateAll((nodes) =>
    nodes.map((node) => node.dataset.targetId).filter(Boolean).slice(0, 2),
  );
  assert.equal(targetIds.length, 2, "Two canonical source-token Meaning targets were not rendered");
  assert.notEqual(targetIds[0], targetIds[1], "Adjacent source tokens must retain distinct canonical identities");
  return targetIds;
}

async function waitForToolOpen(page, contentSelector) {
  await page.waitForFunction(
    (selector) => {
      const surface = document.querySelector("#detailToolSurface");
      return Boolean(surface && !surface.hidden && surface.querySelector(selector));
    },
    contentSelector,
  );
  await waitForFrames(page, 2);
}

async function waitForToolClosed(page) {
  await page.waitForFunction(() => {
    const surface = document.querySelector("#detailToolSurface");
    const workArea = document.querySelector("#detailWorkArea");
    return Boolean(surface?.hidden && !workArea?.inert && workArea?.getAttribute("aria-hidden") !== "true");
  });
}

async function waitForFocus(page, selector) {
  await page.waitForFunction(
    (target) => document.activeElement === document.querySelector(target),
    selector,
  );
}

async function activateUnderlyingLifecycleControl(page, selector) {
  await page.evaluate((target) => {
    const workArea = document.querySelector("#detailWorkArea");
    if (workArea) {
      workArea.inert = false;
      workArea.removeAttribute("inert");
      workArea.removeAttribute("aria-hidden");
    }
    document.querySelector(target)?.click();
  }, selector);
}

async function toolSurfaceState(page) {
  return page.evaluate(() => {
    const rect = (node) => {
      const value = node?.getBoundingClientRect();
      return value ? { bottom: value.bottom, left: value.left, right: value.right, top: value.top } : null;
    };
    const pane = document.querySelector(".detail-pane");
    const surface = document.querySelector("#detailToolSurface");
    const workArea = document.querySelector("#detailWorkArea");
    const content = document.querySelector("#detailToolContent");
    return {
      activeInside: Boolean(surface?.contains(document.activeElement)),
      ariaLabelledBy: surface?.getAttribute("aria-labelledby") || "",
      closeLabel: document.querySelector("#detailToolClose")?.getAttribute("aria-label") || "",
      contentOverflow: content ? content.scrollWidth - content.clientWidth : null,
      hidden: surface?.hidden ?? true,
      inert: Boolean(workArea?.inert || workArea?.getAttribute("aria-hidden") === "true"),
      pane: rect(pane),
      role: surface?.getAttribute("role") || "",
      surface: rect(surface),
      title: document.querySelector("#detailToolTitle")?.textContent.trim() || "",
      workAreaScrollTop: document.querySelector("#detailContent")?.scrollTop || 0,
    };
  });
}

function assertContainedSurface(state, label, { requireFocus = true } = {}) {
  assert.equal(state.hidden, false, `${label}: contained tool is hidden`);
  assert.equal(state.role, "dialog", `${label}: contained tool must be a dialog`);
  assert.equal(state.ariaLabelledBy, "detailToolTitle", `${label}: contained tool lacks its title relationship`);
  assert.match(state.closeLabel, /close/i, `${label}: contained tool Close action has an inaccurate label`);
  assert(state.title, `${label}: contained tool title is empty`);
  assert(state.inert, `${label}: underlying detail work area remains interactive`);
  if (requireFocus) assert(state.activeInside, `${label}: focus did not move into the contained tool`);
  assert(state.pane && state.surface, `${label}: containment geometry is missing`);
  assert(
    state.surface.left >= state.pane.left - 1 &&
      state.surface.right <= state.pane.right + 1 &&
      state.surface.top >= state.pane.top - 1 &&
      state.surface.bottom <= state.pane.bottom + 1,
    `${label}: tool surface escaped the detail pane: ${JSON.stringify(state)}`,
  );
  assert(state.contentOverflow <= 1, `${label}: tool content has horizontal overflow`);
}

async function exerciseContainedSurfaceLockGuard(page) {
  const trigger = page.locator("#detailContext [data-panel-scope='word'] .study-marks-trigger").first();
  assert.equal(await trigger.count(), 1, "Locked exact-word context is missing its contained Study Marks trigger");
  await trigger.click();
  await waitForToolOpen(page, ".tag-picker-option");
  const before = await page.evaluate(() => {
    const word = document.querySelector(".reader-context-word");
    const verse = document.querySelector(".reader-context-verse");
    return {
      activeStrongSection: document.querySelector("#detailContent [data-strong-section-active='true']")?.dataset.strongSection || "",
      panelMode: document.querySelector(".detail-pane")?.dataset.panelMode || "",
      selectedVerse: verse?.dataset.verse || word?.closest(".verse-row")?.dataset.verse || "",
      selectedWord: word ? {
        interlinearKey: word.dataset.interlinearKey || "",
        strongCode: word.dataset.strongCode || "",
        text: word.textContent.trim(),
        tokenIndex: word.dataset.tokenIndex || "",
      } : null,
    };
  });
  assert.equal(before.panelMode, "locked", "Contained-surface lock guard fixture is not locked");
  assert(before.selectedWord, "Contained-surface lock guard fixture has no exact selected word");
  assert(before.activeStrongSection, "Contained-surface lock guard fixture has no active Strong's section");

  await page.evaluate(() => {
    const target = document.querySelector(".detail-tool-surface-header");
    const PointerCtor = window.PointerEvent || window.MouseEvent;
    target?.dispatchEvent(new PointerCtor("pointerdown", { bubbles: true, cancelable: true, pointerType: "mouse" }));
    target?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await waitForFrames(page, 2);
  const after = await page.evaluate(() => {
    const word = document.querySelector(".reader-context-word");
    const verse = document.querySelector(".reader-context-verse");
    return {
      activeStrongSection: document.querySelector("#detailContent [data-strong-section-active='true']")?.dataset.strongSection || "",
      panelMode: document.querySelector(".detail-pane")?.dataset.panelMode || "",
      selectedVerse: verse?.dataset.verse || word?.closest(".verse-row")?.dataset.verse || "",
      selectedWord: word ? {
        interlinearKey: word.dataset.interlinearKey || "",
        strongCode: word.dataset.strongCode || "",
        text: word.textContent.trim(),
        tokenIndex: word.dataset.tokenIndex || "",
      } : null,
      toolOpen: !document.querySelector("#detailToolSurface")?.hidden,
    };
  });
  assert.deepEqual(
    after,
    { ...before, toolOpen: true },
    "Clicking contained-tool chrome changed the Strong lock, selected reader context, or active section",
  );
  await page.keyboard.press("Escape");
  await waitForToolClosed(page);
}

async function exerciseStudyMarksAndMeaning(page) {
  const [firstTargetId, secondTargetId] = await firstTwoTokenTargets(page);
  const selectors = tokenSelectors(firstTargetId);
  const secondSelectors = tokenSelectors(secondTargetId);
  const initialData = await readUserDataSnapshot(page);
  const initialActiveTags = activeTagAssertions(initialData);
  const initialRenderings = tokenRenderings(initialData);

  await page.locator(selectors.marks).focus();
  await waitForFrames(page, 2);
  assert(
    await page.evaluate(() => document.querySelector("#detailToolSurface")?.hidden),
    "Study Marks opened merely because its detail-panel trigger received focus",
  );
  assert.equal(await page.locator(selectors.marks).getAttribute("aria-haspopup"), "dialog", "Study Marks must expose dialog popup semantics");
  assert.equal(await page.locator(selectors.marks).getAttribute("aria-expanded"), "false", "Closed Study Marks trigger reports expanded");

  await page.evaluate(() => {
    window.__studyWorkspaceQaWorkArea = document.querySelector("#detailWorkArea");
    window.__studyWorkspaceQaWorkAreaFirst = document.querySelector("#detailWorkArea")?.firstElementChild;
    window.__studyWorkspaceQaToolScroll = document.querySelector("#detailContent")?.scrollTop || 0;
  });
  await page.locator(selectors.marks).click();
  await waitForToolOpen(page, ".tag-picker-option");
  const marksOpen = await toolSurfaceState(page);
  assertContainedSurface(marksOpen, "Study Marks opening");
  assert.match(marksOpen.title, /study marks/i, "Study Marks tool title is inaccurate");
  assert.equal(await page.locator(selectors.marks).getAttribute("aria-expanded"), "true", "Open Study Marks trigger reports collapsed");
  const marksContent = await page.locator("#detailToolContent").evaluate((node) => ({
    labels: [...node.querySelectorAll(".tag-picker-option")]
      .map((button) => button.lastElementChild?.textContent.trim() || button.textContent.trim())
      .sort(),
    preview: node.querySelector(".target-tag-picker-preview")?.textContent.trim() || "",
    targetLabel: node.querySelector(".tag-picker-title")?.textContent.trim() || "",
  }));
  assert.deepEqual(marksContent.labels, SOURCE_TOKEN_TAGS, "Study Marks did not show every tag valid for a source token");
  assert.match(marksContent.targetLabel, /Proverbs 1:1/i, "Study Marks did not identify its exact target");
  assert(marksContent.preview, "Study Marks did not show the target preview");
  const openIdentity = await page.evaluate(() => ({
    sameArea: window.__studyWorkspaceQaWorkArea === document.querySelector("#detailWorkArea"),
    sameFirst: window.__studyWorkspaceQaWorkAreaFirst === document.querySelector("#detailWorkArea")?.firstElementChild,
    sameScroll: Math.abs(window.__studyWorkspaceQaToolScroll - (document.querySelector("#detailContent")?.scrollTop || 0)) <= 1,
  }));
  assert.deepEqual(openIdentity, { sameArea: true, sameFirst: true, sameScroll: true }, "Study Marks reflowed or rebuilt the underlying detail context");
  assert.deepEqual(await readUserDataSnapshot(page), initialData, "Opening Study Marks mutated user data");

  await page.keyboard.press("Escape");
  await waitForToolClosed(page);
  await waitForFocus(page, selectors.marks);
  assert(await page.locator(selectors.marks).evaluate((node) => document.activeElement === node), "Study Marks Escape did not restore trigger focus");
  assert.deepEqual(await readUserDataSnapshot(page), initialData, "Closing Study Marks with Escape mutated user data");

  await page.locator(selectors.marks).click();
  await waitForToolOpen(page, ".tag-picker-option");
  await page.locator("#detailToolClose").click();
  await waitForToolClosed(page);
  await waitForFocus(page, selectors.marks);
  assert(await page.locator(selectors.marks).evaluate((node) => document.activeElement === node), "Study Marks Close did not restore trigger focus");
  assert.deepEqual(await readUserDataSnapshot(page), initialData, "Closing Study Marks with Close mutated user data");

  await page.locator(selectors.marks).click();
  await waitForToolOpen(page, ".tag-picker-option");
  const favorite = page.locator('#detailToolContent .tag-picker-option[aria-label="Add Favorite tag"]');
  assert.equal(await favorite.count(), 1, "Study Marks Favorite toggle is missing");
  await favorite.click();
  await page.waitForFunction(() => document.querySelector('#detailToolContent .tag-picker-option[aria-label="Remove Favorite tag"]')?.getAttribute("aria-pressed") === "true");
  await waitForPersistedTag(page, firstTargetId, true);
  const afterFavorite = await readUserDataSnapshot(page);
  assert(
    activeTagAssertions(afterFavorite).some((record) => record.targetId === firstTargetId && record.tagId === "favorite"),
    "Study Marks Favorite did not persist to the exact source token",
  );
  assert(
    !activeTagAssertions(afterFavorite).some((record) => record.targetId === secondTargetId && record.tagId === "favorite"),
    "Study Marks Favorite leaked to an adjacent source token",
  );
  await page.locator('#detailToolContent .tag-picker-option[aria-label="Remove Favorite tag"]').click();
  await page.waitForFunction(() => document.querySelector('#detailToolContent .tag-picker-option[aria-label="Add Favorite tag"]')?.getAttribute("aria-pressed") === "false");
  await waitForPersistedTag(page, firstTargetId, false);
  assert.deepEqual(activeTagAssertions(await readUserDataSnapshot(page)), initialActiveTags, "Removing Favorite did not restore exact active-tag state");
  await page.keyboard.press("Escape");
  await waitForToolClosed(page);
  await waitForFocus(page, selectors.marks);
  assert(
    await page.locator(selectors.marks).evaluate((node) => document.activeElement === node),
    "Study Marks did not restore a stable target trigger after its mark controls updated",
  );

  const beforeReplacement = await readUserDataSnapshot(page);
  await page.locator(selectors.marks).click();
  await waitForToolOpen(page, ".tag-picker-option");
  await page.evaluate((meaningSelector) => {
    document.querySelector(meaningSelector)?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  }, selectors.meaning);
  await waitForToolOpen(page, ".word-meaning-other");
  const replacement = await page.evaluate(({ marksSelector, meaningSelector }) => ({
    marksExpanded: document.querySelector(marksSelector)?.getAttribute("aria-expanded"),
    meaningExpanded: document.querySelector(meaningSelector)?.getAttribute("aria-expanded"),
    oldToolPresent: Boolean(document.querySelector("#detailToolContent .tag-picker-option")),
    surfaceCount: document.querySelectorAll("#detailToolSurface:not([hidden])").length,
  }), { marksSelector: selectors.marks, meaningSelector: selectors.meaning });
  assert.deepEqual(
    replacement,
    { marksExpanded: "false", meaningExpanded: "true", oldToolPresent: false, surfaceCount: 1 },
    "Opening Meaning did not replace Study Marks as the sole contained overlay owner",
  );
  await page.keyboard.press("Escape");
  await waitForToolClosed(page);
  await waitForFocus(page, selectors.meaning);
  assert(await page.locator(selectors.meaning).evaluate((node) => document.activeElement === node), "Replacement Meaning Escape did not restore focus");
  assert(
    await page.evaluate(() =>
      document.querySelector("#detailToolSurface")?.hidden &&
      !document.querySelector("#detailToolContent")?.childElementCount,
    ),
    "Tool replacement left stale contained-overlay ownership or content",
  );
  assert.deepEqual(await readUserDataSnapshot(page), beforeReplacement, "Tool replacement or Escape mutated user data");

  await page.locator(selectors.meaning).focus();
  await page.locator(selectors.meaning).press("Enter");
  await waitForToolOpen(page, ".word-meaning-other");
  const meaningOpen = await toolSurfaceState(page);
  assertContainedSurface(meaningOpen, "Meaning opening");
  assert.match(meaningOpen.title, /meaning/i, "Meaning tool title is inaccurate");
  assert.equal(await page.locator(selectors.meaning).getAttribute("aria-haspopup"), "dialog", "Meaning popup semantics are inaccurate");
  assert.equal(await page.locator(selectors.meaning).getAttribute("aria-expanded"), "true", "Open Meaning trigger reports collapsed");
  const meaningPresentation = await page.locator("#detailToolContent .word-meaning-contained").evaluate((node) => ({
    position: getComputedStyle(node).position,
  }));
  assert.match(await page.locator(selectors.meaning).getAttribute("aria-label"), /Proverbs 1:1/i, "Meaning did not identify its exact source token");
  assert.equal(
    await page.locator("#detailToolSurface").getAttribute("data-target-id"),
    firstTargetId,
    "Meaning surface lost its canonical source-token identity",
  );
  assert.notEqual(meaningPresentation.position, "fixed", "Contained Meaning retained page-level fixed positioning");
  assert.deepEqual(await readUserDataSnapshot(page), beforeReplacement, "Opening Meaning mutated user data");
  await page.locator("#detailToolContent .word-meaning-other").click();
  await page.waitForFunction(() => document.activeElement?.classList.contains("word-meaning-custom-input"));
  await page.locator("#detailToolContent .word-meaning-custom-input").fill("Cancelled workspace QA meaning");
  await page.locator("#detailToolContent .word-meaning-cancel").click();
  await waitForToolClosed(page);
  await waitForFocus(page, selectors.meaning);
  assert(await page.locator(selectors.meaning).evaluate((node) => document.activeElement === node), "Meaning Cancel did not restore trigger focus");
  assert.deepEqual(await readUserDataSnapshot(page), beforeReplacement, "Meaning Cancel persisted a mutation");

  const savedMeaning = "Workspace QA exact meaning";
  await page.locator(selectors.meaning).click();
  await waitForToolOpen(page, ".word-meaning-other");
  await page.locator("#detailToolContent .word-meaning-other").click();
  await page.locator("#detailToolContent .word-meaning-custom-input").fill(savedMeaning);
  await page.locator("#detailToolContent .word-meaning-save").click();
  await waitForToolClosed(page);
  await page.waitForFunction(({ badgeText, rootSelector }) =>
    [...document.querySelectorAll(`${rootSelector} .word-meaning-badge`)].some((badge) => badge.textContent.trim() === badgeText),
  { badgeText: savedMeaning, rootSelector: selectors.meaningRoot });
  await waitForPersistedMeaning(page, firstTargetId, savedMeaning);
  await waitForFocus(page, selectors.meaning);
  const afterSave = await readUserDataSnapshot(page);
  assert.deepEqual(
    tokenRenderings(afterSave).filter((record) => record.targetId === firstTargetId),
    [{ rendering: savedMeaning, targetId: firstTargetId }],
    "Meaning Save did not write the exact canonical source token",
  );
  assert(
    !tokenRenderings(afterSave).some((record) => record.targetId === secondTargetId),
    "Meaning Save leaked to an adjacent source token",
  );
  assert(await page.locator(selectors.meaning).evaluate((node) => document.activeElement === node), "Meaning Save did not restore trigger focus");

  await page.locator(selectors.meaning).click();
  await waitForToolOpen(page, ".word-meaning-remove");
  await page.locator("#detailToolContent .word-meaning-remove").click();
  await waitForToolClosed(page);
  await page.waitForFunction((rootSelector) => !document.querySelector(`${rootSelector} .word-meaning-badge`), selectors.meaningRoot);
  await waitForPersistedMeaning(page, firstTargetId, null);
  assert.deepEqual(tokenRenderings(await readUserDataSnapshot(page)), initialRenderings, "Meaning Remove did not restore exact rendering state");

  assert.equal(await page.locator(secondSelectors.meaning).getAttribute("aria-expanded"), "false", "Adjacent Meaning trigger inherited overlay state");
  return { firstTargetId, selectors };
}

async function exerciseContainedToolLifecycle(page, selectors) {
  const beforeManage = await readUserDataSnapshot(page);
  await page.locator(selectors.marks).click();
  await waitForToolOpen(page, ".tag-picker-manage");
  await page.locator("#detailToolContent .tag-picker-manage").click();
  await page.waitForFunction(() => document.querySelector("#detailTitle")?.textContent === "Tags" && document.querySelector("#detailToolSurface")?.hidden);
  await waitForToolClosed(page);
  await page.waitForFunction(() => Boolean(document.activeElement?.closest("#detailContent .target-tag-editor")));
  assert.deepEqual(await readUserDataSnapshot(page), beforeManage, "Manage tags transition mutated user data without a toggle");
  await page.locator("#detailBack").click();
  await page.waitForFunction(() => document.querySelector("#detailTitle")?.textContent === "Language Study");

  await page.locator(selectors.marks).click();
  await waitForToolOpen(page, ".tag-picker-option");
  await activateUnderlyingLifecycleControl(page, "#detailForward");
  await page.waitForFunction(() => document.querySelector("#detailTitle")?.textContent === "Tags" && document.querySelector("#detailToolSurface")?.hidden);
  await waitForToolClosed(page);
  await activateUnderlyingLifecycleControl(page, "#detailBack");
  await page.waitForFunction(() => document.querySelector("#detailTitle")?.textContent === "Language Study");

  if (await page.locator("#detailBack").isDisabled()) {
    await page.locator("#showOutline").click();
    await page.waitForFunction(() => document.querySelector("#detailTitle")?.textContent === "Outline");
    await openLanguageStudy(page);
  }
  assert.equal(await page.locator("#detailBack").isDisabled(), false, "Back cleanup fixture did not create prior detail history");
  await page.locator(selectors.meaning).click();
  await waitForToolOpen(page, ".word-meaning-other");
  await activateUnderlyingLifecycleControl(page, "#detailBack");
  await waitForToolClosed(page);
  await page.waitForFunction(() => document.querySelector("#detailTitle")?.textContent !== "Language Study");
  assert.notEqual(await page.locator("#detailTitle").textContent(), "Language Study", "Back did not restore the preceding detail view");
  await page.locator("#detailForward").click();
  await page.waitForFunction(() => document.querySelector("#detailTitle")?.textContent === "Language Study");

  await page.locator(selectors.marks).click();
  await waitForToolOpen(page, ".tag-picker-option");
  await page.evaluate(() => {
    window.__studyWorkspaceQaOpenToolContent = document.querySelector("#detailToolContent")?.firstElementChild;
    window.__studyWorkspaceQaOpenToolWorkArea = document.querySelector("#detailWorkArea")?.firstElementChild;
  });
  await setWidthMode(page, "compact", "enter");
  const compactTool = await toolSurfaceState(page);
  assertContainedSurface(compactTool, "Width change with Study Marks open", { requireFocus: false });
  assert(
    await page.evaluate(() =>
      window.__studyWorkspaceQaOpenToolContent === document.querySelector("#detailToolContent")?.firstElementChild &&
      window.__studyWorkspaceQaOpenToolWorkArea === document.querySelector("#detailWorkArea")?.firstElementChild,
    ),
    "Width change reconstructed the open tool or underlying detail view",
  );
  await setWidthMode(page, "expanded", "space");
  assertContainedSurface(await toolSurfaceState(page), "Expanded width with Study Marks open", { requireFocus: false });
  await page.keyboard.press("Escape");
  await waitForToolClosed(page);
}

async function setTheme(page, theme) {
  await page.waitForFunction(() => ["light", "dark"].includes(document.documentElement.dataset.theme));
  if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) {
    await page.locator("#themeToggle").click();
  }
  await page.waitForFunction((expected) => document.documentElement.dataset.theme === expected, theme);
  await waitForFrames(page, 2);
}

async function exerciseStrongPolishForcedColors(page) {
  await page.emulateMedia({ forcedColors: "active" });
  await waitForFrames(page, 2);
  const state = await page.evaluate(() => {
    const sourceWord = document.querySelector(".strong-source-word");
    const hydratedWord = sourceWord?.querySelector(".language-word-hover, .language-letter-hover");
    const letter = sourceWord?.querySelector(".language-letter-hover");
    const rtlNote = document.querySelector(".hebrew-rtl-note");
    const rtlBadge = rtlNote ? getComputedStyle(rtlNote, "::before") : null;
    const linkProbe = document.createElement("span");
    linkProbe.style.setProperty("color", "LinkText", "important");
    linkProbe.style.setProperty("forced-color-adjust", "none");
    document.body.append(linkProbe);
    const linkColor = getComputedStyle(linkProbe).color;
    linkProbe.remove();
    const rgb = (value) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const luminance = (values) => {
      const channels = values.map((value) => {
        const normalized = value / 255;
        return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const badgeForeground = luminance(rgb(rtlBadge?.color || ""));
    const badgeBackground = luminance(rgb(rtlBadge?.backgroundColor || ""));
    return {
      forcedColors: window.matchMedia("(forced-colors: active)").matches,
      hydratedColor: hydratedWord ? getComputedStyle(hydratedWord).color : "",
      letterBorderStyle: letter ? getComputedStyle(letter).borderBottomStyle : "",
      linkColor,
      rtlBadge: rtlBadge ? {
        background: rtlBadge.backgroundColor,
        color: rtlBadge.color,
        forcedColorAdjust: rtlBadge.forcedColorAdjust,
        height: rtlBadge.height,
        width: rtlBadge.width,
      } : null,
      rtlBadgeContrast: (Math.max(badgeForeground, badgeBackground) + 0.05) /
        (Math.min(badgeForeground, badgeBackground) + 0.05),
      sourceColor: sourceWord ? getComputedStyle(sourceWord).color : "",
    };
  });
  assert(state.forcedColors, "Forced-colors emulation was not applied");
  assert(
    state.sourceColor === state.linkColor && state.hydratedColor === state.linkColor,
    `Forced colors did not preserve the Strong's source-word affordance: ${JSON.stringify(state)}`,
  );
  assert.equal(state.letterBorderStyle, "dotted", "Forced colors removed the source-letter dotted affordance");
  assert(
    state.rtlBadge?.height === "18px" && state.rtlBadge?.width === "18px" &&
      state.rtlBadge?.forcedColorAdjust === "none" && state.rtlBadge?.background !== "rgba(0, 0, 0, 0)" &&
      state.rtlBadgeContrast >= 4.5,
    `Forced colors made the Hebrew direction badge illegible: ${JSON.stringify(state)}`,
  );
  await page.emulateMedia({ forcedColors: "none" });
  await waitForFrames(page, 2);
}

async function exerciseResponsiveMatrix(page) {
  const results = [];
  for (const viewport of VIEWPORTS.filter((candidate) => candidate.name !== "mobile")) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await waitForFrames(page, 2);
    const widths = {};
    for (const [index, mode] of WIDTH_MODES.entries()) {
      widths[mode] = await setWidthMode(page, mode, index === 0 ? "enter" : index === 1 ? "space" : "click");
      assertLayoutHealth(widths[mode], `${viewport.name}/${mode}`);
    }
    assert(widths.compact.pane.width + 20 <= widths.standard.pane.width, `${viewport.name}: Compact and Standard are not visibly distinct`);
    assert(widths.standard.pane.width + 20 <= widths.expanded.pane.width, `${viewport.name}: Standard and Expanded are not visibly distinct`);
    if (viewport.name === "desktop-wide" || viewport.name === "desktop") {
      const share = widths.standard.pane.width / (widths.standard.reader.width + widths.standard.pane.width);
      assert(share >= 0.29 && share <= 0.39, `${viewport.name}: Standard is not approximately one-third: ${share}`);
    }
    results.push({
      name: viewport.name,
      widths: Object.fromEntries(WIDTH_MODES.map((mode) => [mode, Math.round(widths[mode].pane.width)])),
    });
  }

  await page.setViewportSize({ width: 1280, height: 720 });
  await setTheme(page, "dark");
  assertLayoutHealth(await widthState(page), "desktop/dark");
  await setTheme(page, "light");
  assertLayoutHealth(await widthState(page), "desktop/light");

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setWidthMode(page, "standard", "enter");
  const reducedMotion = await page.evaluate(() => {
    const seconds = (value) => String(value || "0s").split(",").map((part) => {
      const text = part.trim();
      return text.endsWith("ms") ? Number.parseFloat(text) / 1000 : Number.parseFloat(text);
    });
    return {
      matches: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      maxTransitionSeconds: Math.max(
        ...seconds(getComputedStyle(document.querySelector(".app-shell")).transitionDuration),
        ...seconds(getComputedStyle(document.querySelector(".detail-pane")).transitionDuration),
      ),
    };
  });
  assert(reducedMotion.matches, "Reduced-motion emulation was not applied");
  assert(reducedMotion.maxTransitionSeconds <= 0.02, `Width layout retained a long transition under reduced motion: ${JSON.stringify(reducedMotion)}`);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await setWidthMode(page, "expanded", "click");
  return results;
}

async function exerciseMobileDrawer(page, selectors) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => {
    const pane = document.querySelector(".detail-pane");
    if (!pane || pane.classList.contains("visible")) return true;
    return pane.getBoundingClientRect().left >= window.innerWidth - 0.1;
  });
  const mobileLayout = await widthState(page);
  assert.equal(mobileLayout.mode, "expanded", "Mobile responsive constraint replaced the stored desktop mode");
  assertLayoutHealth(mobileLayout, "mobile/expanded-stored", { mobile: true });
  await page.locator("#openStudyPanel").click();
  await page.waitForFunction(() => {
    const pane = document.querySelector(".detail-pane");
    return pane?.classList.contains("visible") && pane.getBoundingClientRect().left <= 1;
  });
  const drawer = await page.locator(".detail-pane").evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      height: rect.height,
      left: rect.left,
      position: getComputedStyle(node).position,
      top: rect.top,
      width: rect.width,
    };
  });
  assert.equal(drawer.position, "fixed", "Mobile study panel is not a fixed full-screen drawer");
  assert(drawer.left >= -1 && drawer.top >= -1 && drawer.width >= 389 && drawer.height >= 843, `Mobile study drawer is not full screen: ${JSON.stringify(drawer)}`);

  await page.locator(selectors.marks).click();
  await waitForToolOpen(page, ".tag-picker-option");
  assertContainedSurface(await toolSurfaceState(page), "Mobile Study Marks");
  await page.keyboard.press("Escape");
  await waitForToolClosed(page);
  assert(
    await page.evaluate(() => document.querySelector(".detail-pane")?.classList.contains("visible")),
    "Escape closed the mobile drawer instead of only the active contained tool",
  );
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => {
    const pane = document.querySelector(".detail-pane");
    return !pane?.classList.contains("visible") && pane?.getBoundingClientRect().left >= window.innerWidth - 0.1;
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await waitForFrames(page, 3);
  const restored = await widthState(page);
  assert.equal(restored.mode, "expanded", "Returning from mobile did not restore the stored desktop mode");
  assertLayoutHealth(restored, "desktop-restored-from-mobile");
  return { drawer: { height: Math.round(drawer.height), width: Math.round(drawer.width) }, name: "mobile" };
}

async function exerciseClearAndRouteCleanup(page, baseUrl) {
  await goToProverbs(page, baseUrl);
  await openLanguageStudy(page);
  const [targetId] = await firstTwoTokenTargets(page);
  let selectors = tokenSelectors(targetId);
  await page.locator(selectors.meaning).click();
  await waitForToolOpen(page, ".word-meaning-other");
  await page.locator("#clearDetail").click();
  await page.waitForFunction(() => {
    const snapshot = history.state?.bibleAppReaderNavigation;
    const index = snapshot?.navigationIndex || 0;
    const maxIndex = Math.max(index, snapshot?.navigationMaxIndex || 0);
    return document.querySelector("#detailToolSurface")?.hidden &&
      document.querySelector("#detailTitle")?.textContent === "Details" &&
      document.querySelector(".detail-pane")?.dataset.panelMode === "follow" &&
      document.querySelector("#detailBack")?.disabled === !(index > 0) &&
      document.querySelector("#detailForward")?.disabled === !(index < maxIndex);
  });
  await waitForToolClosed(page);

  await openLanguageStudy(page);
  [selectors] = (await firstTwoTokenTargets(page)).slice(0, 1).map(tokenSelectors);
  await page.locator(selectors.marks).click();
  await waitForToolOpen(page, ".tag-picker-option");
  await page.evaluate(() => {
    window.location.hash = "#/read/bsb/john/1/1";
  });
  await waitForApp(page, "John 1");
  await waitForToolClosed(page);
  assert.equal(await page.evaluate(() => window.location.hash), "#/read/bsb/john/1/1", "Route cleanup changed the requested route");
  assert(
    await page.evaluate(() => !document.querySelector("#detailToolContent")?.childElementCount),
    "Route cleanup left stale contained-tool content",
  );

  await goToProverbs(page, baseUrl);
  await openLanguageStudy(page);
  [selectors] = (await firstTwoTokenTargets(page)).slice(0, 1).map(tokenSelectors);
  await page.locator(selectors.meaning).click();
  await waitForToolOpen(page, ".word-meaning-other");
  await page.evaluate(() => {
    window.location.hash = "#/home";
  });
  await page.waitForFunction(() => (
    document.querySelector("#chapterTitle")?.textContent === "Bible App Home" &&
    document.querySelector("#detailToolSurface")?.hidden &&
    !document.querySelector("#detailWorkArea")?.inert &&
    document.querySelector("#detailWorkArea")?.getAttribute("aria-hidden") !== "true"
  ));
  await waitForToolClosed(page);
  assert.equal(await page.evaluate(() => window.location.hash), "#/home", "Home route cleanup changed the requested route");

  await goToProverbs(page, baseUrl);
  await openLanguageStudy(page);
  [selectors] = (await firstTwoTokenTargets(page)).slice(0, 1).map(tokenSelectors);
  await page.locator(selectors.marks).click();
  await waitForToolOpen(page, ".tag-picker-option");
  await page.locator(selectors.marks).evaluate((trigger) => trigger.remove());
  await page.waitForFunction(() => (
    document.querySelector("#detailToolSurface")?.hidden &&
    document.activeElement === document.querySelector("#clearDetail")
  ));
  await waitForToolClosed(page);
}

async function runStorageFallback(browser, baseUrl, { name, setup }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript(setup, WIDTH_STORAGE_KEY);
  const page = await context.newPage();
  const health = attachHealthChecks(page, baseUrl, name);
  try {
    await goToProverbs(page, baseUrl);
    const state = await widthState(page);
    assert.equal(state.mode, "standard", `${name}: invalid or unavailable storage did not fall back to Standard`);
    assert.deepEqual(state.pressed, ["standard"], `${name}: Standard control did not expose the fallback state`);
    assertLayoutHealth(state, name);
    health.assertHealthy();
  } finally {
    await context.close();
  }
}

async function runPrimaryScenario(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const health = attachHealthChecks(page, baseUrl, "primary study workspace");
  try {
    await goToProverbs(page, baseUrl);
    const defaultState = await widthState(page);
    assert.equal(defaultState.mode, "standard", "Missing width preference did not default to Standard");
    assert.deepEqual(defaultState.pressed, ["standard"], "Default Standard control is not active");
    assertLayoutHealth(defaultState, "desktop-wide/default-standard");

    const beforeWidthData = await readUserDataSnapshot(page);
    await openLanguageStudy(page);
    await openStrongFromLanguageStudy(page);
    await exerciseIndependentScroll(page);
    const strongSectionControl = page.locator("#detailContext [data-strong-section-control]").first();
    if (await strongSectionControl.count()) {
      await strongSectionControl.click();
      await page.waitForFunction(() => Boolean(document.querySelector("#detailContent [data-strong-section-active='true']")));
    }
    await exerciseContainedSurfaceLockGuard(page);
    await prepareAnchorAndPanelScroll(page);

    const widthResults = {};
    for (const [index, mode] of WIDTH_MODES.entries()) {
      const before = await anchorInvariantState(page);
      widthResults[mode] = await setWidthMode(page, mode, index === 0 ? "click" : index === 1 ? "space" : "enter");
      const after = await anchorInvariantState(page);
      assertAnchorInvariant(before, after, `Desktop ${mode} width change`);
      assertLayoutHealth(widthResults[mode], `desktop-wide/${mode}`);
    }
    assert(widthResults.compact.pane.width + 60 <= widthResults.standard.pane.width, "Desktop Compact is not materially narrower than Standard");
    assert(widthResults.standard.pane.width + 60 <= widthResults.expanded.pane.width, "Desktop Expanded is not materially wider than Standard");
    assert(widthResults.expanded.reader.width >= 600, "Desktop Expanded leaves scripture impractically narrow");
    assert.deepEqual(await readUserDataSnapshot(page), beforeWidthData, "Width changes mutated portable user data");
    await exerciseStrongPolishForcedColors(page);

    const routeBeforeReload = await page.evaluate(() => window.location.hash);
    await page.waitForLoadState("networkidle");
    await page.reload({ waitUntil: "load" });
    await waitForApp(page);
    assert.equal((await widthState(page)).mode, "expanded", "Expanded width did not persist across reload");
    assert.equal(await page.evaluate(() => window.location.hash), routeBeforeReload, "Width persistence reload changed the reader route");
    assert.deepEqual(await readUserDataSnapshot(page), beforeWidthData, "Reloading the width preference mutated portable user data");

    await openLanguageStudy(page);
    const { selectors } = await exerciseStudyMarksAndMeaning(page);
    await exerciseContainedToolLifecycle(page, selectors);
    const responsive = await exerciseResponsiveMatrix(page);
    const mobile = await exerciseMobileDrawer(page, selectors);
    await exerciseClearAndRouteCleanup(page, baseUrl);
    health.assertHealthy();
    return { mobile, responsive };
  } finally {
    await context.close();
  }
}

async function main() {
  const edgePath = findEdgePath();
  const { server, url } = await startStaticAppServer({ port: 0 });
  const browser = await chromium.launch({
    executablePath: edgePath,
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
    const primary = await runPrimaryScenario(browser, url);
    await runStorageFallback(browser, url, {
      name: "malformed width storage",
      setup: (key) => window.localStorage.setItem(key, "unsupported"),
    });
    await runStorageFallback(browser, url, {
      name: "throwing width storage",
      setup: (key) => {
        const nativeGetItem = Storage.prototype.getItem;
        const nativeSetItem = Storage.prototype.setItem;
        Storage.prototype.getItem = function getItem(requestedKey) {
          if (requestedKey === key) throw new Error("Study workspace QA storage read failure");
          return nativeGetItem.call(this, requestedKey);
        };
        Storage.prototype.setItem = function setItem(requestedKey, value) {
          if (requestedKey === key) throw new Error("Study workspace QA storage write failure");
          return nativeSetItem.call(this, requestedKey, value);
        };
      },
    });
    console.log(JSON.stringify({
      status: "ok",
      browser: { executablePath: edgePath, version: browser.version() },
      coverage: [
        "default-switch-persist-anchor-selection-history-lock-scroll",
        "contained-study-marks-and-meaning",
        "focus-escape-replacement-back-forward-clear-route",
        "light-dark-reduced-motion-overflow",
        "malformed-and-throwing-storage",
      ],
      viewportResults: [...primary.responsive, primary.mobile],
    }, null, 2));
  } finally {
    await browser.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

await main();
