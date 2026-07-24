#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const cliArgs = process.argv.slice(2);
let baseUrl = cliArgs.find((argument) => !argument.startsWith("--")) || "";
const qaDevice =
  cliArgs.includes("--mobile") || process.env.OPENBIBLE_QA_DEVICE === "mobile" ? "mobile" : "desktop";
const customTagLabel = `QA Custom ${Date.now()}`;
const customTagEditedLabel = `${customTagLabel} Edited`;

function debugQa(message) {
  if (process.env.OPENBIBLE_QA_DEBUG === "1") {
    console.error(`[qa] ${message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
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

async function launchBrowser() {
  const edgePath = findEdgePath();
  debugQa(`Edge path: ${edgePath}`);
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
  const mobile = qaDevice === "mobile";
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 720 },
    deviceScaleFactor: mobile ? 3 : 1,
    isMobile: mobile,
    hasTouch: mobile,
    userAgent: mobile
      ? "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0 Mobile Safari/537.36 BibleAppQA"
      : undefined,
  });
  const playwrightPage = await context.newPage();
  const page = {
    async waitForDownload() {
      return playwrightPage.waitForEvent("download");
    },
    async press(selector, key) {
      await playwrightPage.locator(selector).press(key);
    },
    async tap(selector) {
      await playwrightPage.locator(selector).tap();
    },
    async send(method, params = {}) {
      if (method === "Page.enable" || method === "Runtime.enable") return {};
      if (method === "Page.navigate") {
        await playwrightPage.goto(params.url, { waitUntil: "load" });
        return {};
      }
      if (method === "Page.addScriptToEvaluateOnNewDocument") {
        await playwrightPage.addInitScript({ content: params.source });
        return {};
      }
      if (method === "Runtime.evaluate") {
        try {
          const value = await playwrightPage.evaluate((expression) => (0, eval)(expression), params.expression);
          return { result: { value } };
        } catch (error) {
          return { exceptionDetails: { text: error?.message || String(error) } };
        }
      }
      throw new Error(`Unsupported browser command: ${method}`);
    },
    async close() {
      await playwrightPage.close();
    },
  };
  return { page, browser };
}

async function navigate(page, url) {
  await page.send("Page.navigate", { url });
  await waitFor(page, "document.readyState === 'complete' && !document.body.textContent.includes('Loading data')", 30000);
}

async function evaluate(page, expression) {
  const result = await page.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Page evaluation failed");
  }
  return result.result.value;
}

async function waitFor(page, expression, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let value = false;
  while (Date.now() < deadline) {
    value = await evaluate(page, `(async () => Boolean(await (${expression})))()`);
    if (value) return true;
    await delay(150);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

function workspacePersistenceExpression(referenceKey, expectedDraft, expectedRendering) {
  return `new Promise((resolve) => {
    const readLocalWorkspace = () => {
      try {
        const raw = window.localStorage.getItem('bibleapp:translation-workspace:v1');
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    };
    const matches = (store) => {
      const renderings = store?.token_renderings?.[${JSON.stringify(referenceKey)}] || {};
      return store?.verse_drafts?.[${JSON.stringify(referenceKey)}]?.draft_text === ${JSON.stringify(expectedDraft)} &&
        Object.values(renderings).some((item) => item?.rendering === ${JSON.stringify(expectedRendering)});
    };
    if (!window.indexedDB) {
      resolve(matches(readLocalWorkspace()));
      return;
    }
    const request = window.indexedDB.open('bibleapp', 2);
    request.onerror = () => resolve(matches(readLocalWorkspace()));
    request.onblocked = () => resolve(matches(readLocalWorkspace()));
    request.onsuccess = () => {
      const db = request.result;
      try {
        const transaction = db.transaction('user_stores', 'readonly');
        const get = transaction.objectStore('user_stores').get('workspace');
        get.onsuccess = () => {
          const store = get.result?.value || readLocalWorkspace();
          db.close();
          resolve(matches(store));
        };
        get.onerror = () => {
          db.close();
          resolve(matches(readLocalWorkspace()));
        };
      } catch {
        db.close();
        resolve(matches(readLocalWorkspace()));
      }
    };
  })`;
}

function userDataInvariantExpression() {
  return `(async () => {
    const details = document.querySelector('.manual-json-panel');
    details?.dispatchEvent(new Event('toggle'));
    const stores = JSON.stringify(JSON.parse(document.querySelector('.export-textarea')?.value || '{}').stores || {});
    const localBackupCount = (() => {
      try {
        return JSON.parse(localStorage.getItem('bibleapp:import-backups:v1') || '{}').backups?.length || 0;
      } catch {
        return 0;
      }
    })();
    const indexedBackupCount = await new Promise((resolve) => {
      if (!window.indexedDB) return resolve(null);
      const request = indexedDB.open('bibleapp', 2);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
      request.onsuccess = () => {
        const db = request.result;
        try {
          const get = db.transaction('user_stores', 'readonly').objectStore('user_stores').get('importBackups');
          get.onsuccess = () => {
            const count = get.result?.value?.backups?.length || 0;
            db.close();
            resolve(count);
          };
          get.onerror = () => {
            db.close();
            resolve(null);
          };
        } catch {
          db.close();
          resolve(null);
        }
      };
    });
    const pane = document.querySelector('.detail-pane');
    const paneStyle = pane ? getComputedStyle(pane) : null;
    return {
      stores,
      backupCount: indexedBackupCount ?? localBackupCount,
      detailTitle: document.querySelector('#detailTitle')?.textContent.trim(),
      detailBackDisabled: Boolean(document.querySelector('#detailBack')?.disabled),
      detailForwardDisabled: Boolean(document.querySelector('#detailForward')?.disabled),
      panelVisibleClass: Boolean(pane?.classList.contains('visible')),
      panelDisplay: paneStyle?.display || '',
      panelVisibility: paneStyle?.visibility || '',
      route: location.href,
      readerContext: JSON.stringify([...document.querySelectorAll('.reader-context-word, .reader-context-verse')].map((node) => ({
        className: node.className,
        verse: node.dataset.verse || '',
        strongCode: node.dataset.strongCode || '',
        tokenIndex: node.dataset.tokenIndex || ''
      }))),
      readerLocation: JSON.stringify({
        title: document.querySelector('#chapterTitle')?.textContent.trim(),
        book: document.querySelector('#bookSelect')?.value,
        chapter: document.querySelector('#chapterSelect')?.value,
        translation: document.querySelector('#translationSelect')?.value
      })
    };
  })()`;
}

async function click(page, selector, timeoutMs = 10000) {
  await waitFor(page, `document.querySelector(${JSON.stringify(selector)})`, timeoutMs);
  await evaluate(
    page,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      el.scrollIntoView({ block: 'center' });
      el.click();
      return true;
    })()`,
  );
}

async function clickButtonByText(page, text, options = {}) {
  const scope = options.scope ? `document.querySelector(${JSON.stringify(options.scope)})` : "document";
  const index = options.index || 0;
  await waitFor(
    page,
    `(() => {
      const root = ${scope};
      if (!root) return false;
      return [...root.querySelectorAll('button')].filter((button) => button.textContent.trim() === ${JSON.stringify(text)}).length > ${index};
    })()`,
  );
  await evaluate(
    page,
    `(() => {
      const root = ${scope};
      const el = [...root.querySelectorAll('button')].filter((button) => button.textContent.trim() === ${JSON.stringify(text)})[${index}];
      el.scrollIntoView({ block: 'center' });
      el.click();
      return true;
    })()`,
  );
}

async function selectValue(page, selector, value) {
  await waitFor(page, `document.querySelector(${JSON.stringify(selector)})`);
  await evaluate(
    page,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`,
  );
}

async function getQaState(page) {
  return evaluate(
    page,
    `(() => ({
      title: document.querySelector('#chapterTitle')?.textContent.trim(),
      status: document.querySelector('#statusText')?.textContent.trim(),
      detailTitle: document.querySelector('#detailTitle')?.textContent.trim(),
      detailText: document.querySelector('#detailContent')?.textContent.trim(),
      bodyText: document.body.textContent,
      book: document.querySelector('#bookSelect')?.value,
      chapter: document.querySelector('#chapterSelect')?.value,
      translation: document.querySelector('#translationSelect')?.value,
      tagBadges: [...document.querySelectorAll('.tag-badge')].map((node) => node.textContent.trim()),
      consoleErrors: window.__qaErrors || []
    }))()`,
  );
}

async function installErrorCapture(page) {
  await evaluate(
    page,
    `(() => {
      window.__qaErrors = [];
      window.addEventListener('error', (event) => window.__qaErrors.push(event.message));
      window.addEventListener('unhandledrejection', (event) => window.__qaErrors.push(String(event.reason)));
      return true;
    })()`,
  );
}

async function runQa(page) {
  const checks = [];
  const pass = (name) => checks.push(name);

  await navigate(page, baseUrl);
  await installErrorCapture(page);
  await waitFor(page, "document.querySelector('#chapterTitle')?.textContent.includes('Psalms 23')");
  let state = await getQaState(page);
  assert(state.bodyText.includes("The LORD is my shepherd"), "Psalm 23:1 did not render");
  assert(!state.bodyText.includes("Data load failed"), "Data load failed on initial render");
  assert(
    (await evaluate(page, "document.querySelector('#translationSelect')?.options.length || 0")) >= 10,
    "translation options were not populated",
  );
  assert(
    await evaluate(
      page,
      `Boolean(
        document.querySelector('.chapter-actions #showOutline') &&
        document.querySelector('.chapter-actions #showInterlinear') &&
        !document.querySelector('.detail-tool-nav') &&
        document.querySelector('#bookPickerButton') &&
        document.querySelector('#chapterPickerButton')
      )`,
    ),
    "Outline and Language Study controls must live in the reader header",
  );
  await click(page, "#chapterPickerButton");
  await waitFor(page, "!document.querySelector('#chapterPickerPanel')?.hidden");
  const chapterPickerState = await evaluate(
    page,
    `(() => {
      const grid = document.querySelector('.chapter-picker-grid');
      const style = grid ? getComputedStyle(grid) : null;
      return {
        optionCount: grid?.querySelectorAll('.reader-picker-option').length || 0,
        columns: style?.gridTemplateColumns || ''
      };
    })()`,
  );
  assert(
    chapterPickerState.optionCount >= 100 && chapterPickerState.columns.split(" ").length > 1,
    `chapter picker should open as a grid, not a long native scroll: ${JSON.stringify(chapterPickerState)}`,
  );
  await clickButtonByText(page, "24", { scope: "#chapterPickerPanel" });
  await waitFor(page, "document.querySelector('#chapterTitle')?.textContent.includes('Psalms 24')");
  await click(page, "#chapterPickerButton");
  await clickButtonByText(page, "23", { scope: "#chapterPickerPanel" });
  await waitFor(page, "document.querySelector('#chapterTitle')?.textContent.includes('Psalms 23')");
  await click(page, "#bookPickerButton");
  await waitFor(page, "!document.querySelector('#bookPickerPanel')?.hidden");
  const bookPickerState = await evaluate(
    page,
    `(() => ({
      columns: document.querySelectorAll('.book-picker-column').length,
      headings: [...document.querySelectorAll('.book-picker-column h3')].map((node) => node.textContent.trim()),
      scrollableColumns: [...document.querySelectorAll('.book-picker-list')].filter((node) => node.scrollHeight > node.clientHeight).length
    }))()`,
  );
  assert(
    bookPickerState.columns === 2 &&
      bookPickerState.headings.includes("Old Testament") &&
      bookPickerState.headings.includes("New Testament") &&
      bookPickerState.scrollableColumns >= 1,
    `book picker should expose two scrollable testament columns: ${JSON.stringify(bookPickerState)}`,
  );
  await click(page, "#bookPickerButton");
  pass("initial Psalm 23 render");
  assert(
    await evaluate(
      page,
      "document.querySelectorAll('.strong-token').length > 0 && !document.querySelector('.strong-token[title]')",
    ),
    "reader Strong's tokens must not use native title tooltips alongside app tooltips",
  );
  pass("reader Strong's tooltip is app-controlled");

  const selectedReaderText = await evaluate(
    page,
    `(() => {
      const body = document.querySelector('.verse-row[data-verse="1"] .verse-body');
      const segment = [...body.querySelectorAll('[data-verse-char-start]')].find((node) => node.textContent.trim());
      const textNode = segment?.firstChild;
      if (!body || !segment || !textNode) return '';
      const text = textNode.textContent || '';
      const start = text.search(/\\S/);
      const end = text.length - (text.match(/\\s*$/)?.[0].length || 0);
      if (start < 0 || end <= start) return '';
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, end);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return text.slice(start, end);
    })()`,
  );
  assert(selectedReaderText, "reader text selection could not be created");
  await waitFor(
    page,
    "!document.querySelector('.selection-action-menu')?.hidden && document.querySelector('.selection-study-marks-button')",
  );
  assert(
    await evaluate(
      page,
      `(() => {
        const text = document.querySelector('.selection-action-menu')?.textContent || '';
        return Boolean(document.querySelector('.selection-study-marks-button'));
      })()`,
    ),
    "reader selection menu is missing Study Marks",
  );
  await click(page, ".selection-study-marks-button");
  await click(page, '.selection-action-menu .tag-picker-option[aria-label="Add Favorite tag"]');
  await waitFor(page, "document.querySelector('.reader-target-badges .target-tag-badge')");
  assert(
    await evaluate(page, "Boolean(document.querySelector('.tagged-text-span'))"),
    "favorited reader text span was not highlighted",
  );
  await click(page, ".reader-target-badges .target-tag-picker-trigger");
  await waitFor(
    page,
    "document.querySelector('.reader-target-badges .target-tag-picker-popover') && getComputedStyle(document.querySelector('.reader-target-badges .target-tag-picker-popover')).display === 'grid'",
  );
  assert(
    await evaluate(page, "document.querySelector('#detailTitle')?.textContent !== 'Tags'"),
    "reader target badge should open an inline tag popover instead of the side panel",
  );
  await click(page, '.reader-target-badges .tag-picker-option[aria-label="Add Positive tag"]');
  await waitFor(page, "document.querySelectorAll('.reader-target-badges .target-tag-badge').length === 2");
  const readerTagColorState = await evaluate(
    page,
    `(() => {
      const span = document.querySelector('.tagged-text-span');
      return {
        tagColor: span ? getComputedStyle(span).getPropertyValue('--tag-color').trim() : '',
        background: span ? getComputedStyle(span).backgroundColor : ''
      };
    })()`,
  );
  assert(
    readerTagColorState.tagColor === "#1f7a4d" && readerTagColorState.background !== "rgba(37, 99, 95, 0.11)",
    `reader text span should inherit the active tag color: ${JSON.stringify(readerTagColorState)}`,
  );
  await click(page, ".reader-target-badges .target-tag-picker-trigger");
  await waitFor(page, "document.querySelector('.reader-target-badges .tag-picker-option[aria-label=\"Remove Favorite tag\"]')");
  await click(page, '.reader-target-badges .tag-picker-option[aria-label="Remove Favorite tag"]');
  await waitFor(page, "document.querySelectorAll('.reader-target-badges .target-tag-badge').length === 1");
  await click(page, ".reader-target-badges .target-tag-picker-trigger");
  await waitFor(page, "document.querySelector('.reader-target-badges .tag-picker-option[aria-label=\"Remove Positive tag\"]')");
  await click(page, '.reader-target-badges .tag-picker-option[aria-label="Remove Positive tag"]');
  await waitFor(page, "!document.querySelector('.reader-target-badges')");
  pass("reader text-span favorite tags and badges");

  const partialWordSelection = await evaluate(
    page,
    `(() => {
      const body = document.querySelector('.verse-row[data-verse="1"] .verse-body');
      const segment = [...body.querySelectorAll('.strong-token')].find((node) => node.textContent.includes('shepherd'));
      const textNode = segment?.firstChild;
      const text = textNode?.textContent || '';
      const start = text.indexOf('shep');
      if (!body || !segment || !textNode || start < 0) return '';
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, start + 4);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return String(selection);
    })()`,
  );
  assert(partialWordSelection === "shep", `partial-word selection fixture failed: ${partialWordSelection}`);
  await waitFor(
    page,
    "!document.querySelector('.selection-action-menu')?.hidden && document.querySelector('.selection-study-marks-button')",
  );
  await click(page, ".selection-study-marks-button");
  await click(page, '.selection-action-menu .tag-picker-option[aria-label="Add Favorite tag"]');
  await waitFor(page, "document.querySelector('.reader-target-badges .target-tag-badge')");
  const partialWordTagState = await evaluate(
    page,
    `(() => ({
      taggedTexts: [...document.querySelectorAll('.tagged-text-span')].map((node) => node.textContent),
      verseText: document.querySelector('.verse-row[data-verse="1"] .verse-body')?.textContent || ''
    }))()`,
  );
  assert(
    partialWordTagState.taggedTexts.length === 1 && partialWordTagState.taggedTexts[0] === "shepherd",
    `partial-word tag did not expand to full word: ${JSON.stringify(partialWordTagState)}`,
  );
  assert(
    !partialWordTagState.verseText.includes("shep★Favoriteherd"),
    "partial-word tag badge split the selected word",
  );
  await click(page, ".reader-target-badges .target-tag-picker-trigger");
  await waitFor(page, "document.querySelector('.reader-target-badges .tag-picker-option[aria-label=\"Remove Favorite tag\"]')");
  await click(page, '.reader-target-badges .tag-picker-option[aria-label="Remove Favorite tag"]');
  await waitFor(page, "!document.querySelector('.reader-target-badges')");
  pass("partial-word text span expansion");

  assert(
    await evaluate(
      page,
      `Boolean(
        document.querySelector('#favoriteBook[aria-pressed="false"]') &&
        document.querySelector('#favoriteChapter[aria-pressed="false"]') &&
        document.querySelector('.verse-number-menu-wrap .verse-number') &&
        !document.querySelector('.verse-study-marks-button')
      )`,
    ),
    "book, chapter, and canonical verse-number Study Marks controls were not initialized",
  );
  assert(
    await evaluate(page, `document.querySelectorAll('.scope-mark-button').length === 2 && ![...document.querySelectorAll('button')].some((button) => /^(Book|Chapter) tags$/.test(button.textContent.trim()))`),
    "reader must expose exactly one consolidated Book control and one consolidated Chapter control",
  );
  await click(page, "#favoriteBook");
  await waitFor(page, "document.querySelector('#bookTagControl .tag-picker-option[aria-label=\"Add Favorite tag\"]')");
  await click(page, '#bookTagControl .tag-picker-option[aria-label="Add Favorite tag"]');
  await waitFor(page, "document.querySelector('#favoriteBook')?.getAttribute('aria-pressed') === 'true'");
  await click(page, "#favoriteChapter");
  await waitFor(page, "document.querySelector('#chapterTagControl .tag-picker-option[aria-label=\"Add Favorite tag\"]')");
  await click(page, '#chapterTagControl .tag-picker-option[aria-label="Add Favorite tag"]');
  await waitFor(page, "document.querySelector('#favoriteChapter')?.getAttribute('aria-pressed') === 'true'");
  await page.press("#favoriteBook", "Enter");
  await waitFor(page, "document.querySelector('#bookTagControl .tag-picker-option[aria-label=\"Add Inquiry tag\"]')");
  await click(page, '#bookTagControl .tag-picker-option[aria-label="Add Inquiry tag"]');
  await waitFor(page, "document.querySelector('#bookTagControl .target-tag-badge')?.textContent.includes('Inquiry')");
  await page.press("#favoriteChapter", " ");
  await waitFor(page, "document.querySelector('#chapterTagControl .tag-picker-option[aria-label=\"Add Inquiry tag\"]')");
  await click(page, '#chapterTagControl .tag-picker-option[aria-label="Add Inquiry tag"]');
  await waitFor(page, "document.querySelector('#chapterTagControl .target-tag-badge')?.textContent.includes('Inquiry')");
  const scopeFavoriteVisual = await evaluate(
    page,
    `(() => {
      const snapshot = (id, label) => {
        const button = document.querySelector(id);
        const trigger = button?.closest('.target-tag-picker-menu');
        const labelNode = button?.querySelector('.study-marks-trigger-label');
        const icon = button?.querySelector('.study-marks-icon use');
        const rect = button?.getBoundingClientRect();
        const header = document.querySelector('.chapter-heading')?.getBoundingClientRect();
        const activeBefore = button?.getAttribute('aria-pressed');
        const enter = (node) => node?.dispatchEvent(new (window.PointerEvent || Event)('pointerenter', { bubbles: true, pointerType: 'mouse' }));
        enter(labelNode);
        const labelHoverOpen = trigger?.dataset.menuOpen === 'true';
        document.body.dispatchEvent(new (window.PointerEvent || Event)('pointerdown', { bubbles: true, pointerType: 'mouse' }));
        enter(button?.querySelector('.study-marks-icon'));
        const iconHoverOpen = trigger?.dataset.menuOpen === 'true';
        document.body.dispatchEvent(new (window.PointerEvent || Event)('pointerdown', { bubbles: true, pointerType: 'mouse' }));
        const afterRect = button?.getBoundingClientRect();
        const afterHeader = document.querySelector('.chapter-heading')?.getBoundingClientRect();
        return {
          visibleLabel: labelNode?.textContent.trim() || '',
          iconHref: icon?.getAttribute('href') || '',
          count: button?.querySelector('.study-marks-count')?.textContent.trim() || '',
          ariaLabel: button?.getAttribute('aria-label') || '',
          targetLabel: label,
          activeBefore,
          activeAfter: button?.getAttribute('aria-pressed'),
          labelHoverOpen,
          iconHoverOpen,
          stableTrigger: Boolean(rect && afterRect && Math.abs(rect.left - afterRect.left) <= 1 && Math.abs(rect.top - afterRect.top) <= 1 && Math.abs(rect.width - afterRect.width) <= 1 && Math.abs(rect.height - afterRect.height) <= 1),
          stableHeader: Boolean(header && afterHeader && Math.abs(header.width - afterHeader.width) <= 1 && Math.abs(header.height - afterHeader.height) <= 1),
        };
      };
      const arrow = document.querySelector('#nextChapterFloat');
      const arrowStyle = arrow ? getComputedStyle(arrow.closest('.reader-floating-nav')) : null;
      return {
        book: snapshot('#favoriteBook', 'Book'),
        chapter: snapshot('#favoriteChapter', 'Chapter'),
        arrowTop: arrowStyle?.top || ''
      };
    })()`,
  );
  assert(
    [scopeFavoriteVisual.book, scopeFavoriteVisual.chapter].every((state) =>
      state.visibleLabel === state.targetLabel &&
      state.iconHref === '#study-marks-icon' &&
      state.count === '2' &&
      state.ariaLabel === `Study Marks for current ${state.targetLabel.toLowerCase()}` &&
      state.activeBefore === 'true' &&
      state.activeAfter === 'true' &&
      state.labelHoverOpen &&
      state.iconHoverOpen &&
      state.stableTrigger &&
      state.stableHeader,
    ),
    `Book and Chapter Study Marks must render real labels, shared icons, independent counts, hover menus, and stable header geometry: ${JSON.stringify(scopeFavoriteVisual)}`,
  );
  assert(scopeFavoriteVisual.arrowTop === "176px", `floating chapter arrows should start lower: ${JSON.stringify(scopeFavoriteVisual)}`);
  await click(page, "#nextChapter");
  await waitFor(
    page,
    "document.querySelector('#chapterTitle')?.textContent.includes('Psalms 24') && document.querySelector('#favoriteBook')?.getAttribute('aria-pressed') === 'true' && document.querySelector('#favoriteChapter')?.getAttribute('aria-pressed') === 'false'",
  );
  await click(page, "#prevChapter");
  await waitFor(
    page,
    "document.querySelector('#chapterTitle')?.textContent.includes('Psalms 23') && document.querySelector('#favoriteBook')?.getAttribute('aria-pressed') === 'true' && document.querySelector('#favoriteChapter')?.getAttribute('aria-pressed') === 'true'",
  );
  await evaluate(page, "document.querySelector('.verse-number')?.focus()");
  await waitFor(page, "document.querySelector('.verse-number-menu-wrap')?.dataset.menuOpen === 'true'");
  await evaluate(
    page,
    "[...document.querySelectorAll('.verse-number-menu-wrap .tag-picker-option')].find((option) => /Favorite/u.test(option.textContent.trim()))?.click()",
  );
  await waitFor(page, "document.querySelector('.verse-number-wrap .tag-badge')?.textContent.includes('Favorite')");
  await click(page, "#nextChapter");
  await waitFor(page, "document.querySelector('#chapterTitle')?.textContent.includes('Psalms 24')");
  await click(page, "#showTags");
  await waitFor(page, "document.querySelector('#detailContent')?.textContent.includes('Study Marks by Scripture')");
  const studyMarkHierarchyState = await evaluate(
    page,
    `(() => {
      const text = document.querySelector('#detailContent')?.textContent || '';
      const chapterItem = [...document.querySelectorAll('#detailContent .study-mark-item')].find((item) =>
        item.textContent.includes('Psalms 23') && item.textContent.includes('Chapter')
      );
      const open = [...(chapterItem?.querySelectorAll('button') || [])].find((button) => button.textContent.trim() === 'Open');
      open?.click();
      return {
        hasHierarchy: text.includes('Study Marks by Scripture'),
        hasBookTags: text.includes('Book tags'),
        hasChapterTags: text.includes('Book/chapter tags'),
        hasVerseTags: text.includes('Verse tags'),
        clickedOpen: Boolean(open)
      };
    })()`,
  );
  assert(
    studyMarkHierarchyState.hasHierarchy &&
      studyMarkHierarchyState.hasBookTags &&
      studyMarkHierarchyState.hasChapterTags &&
      studyMarkHierarchyState.hasVerseTags &&
      studyMarkHierarchyState.clickedOpen,
    `Study Marks hierarchy or Open action missing: ${JSON.stringify(studyMarkHierarchyState)}`,
  );
  await waitFor(page, "document.querySelector('#chapterTitle')?.textContent.includes('Psalms 23')");
  await click(page, "#showTags");
  await waitFor(page, "document.querySelector('#detailContent')?.textContent.includes('Favorites (3)')");
  await evaluate(
    page,
    `(() => {
      const button = [...document.querySelectorAll('#detailContent button')].find((node) =>
        node.textContent.trim() === 'Favorites (3)'
      );
      button?.click();
      return Boolean(button);
    })()`,
  );
  await waitFor(page, "document.querySelector('#detailTitle')?.textContent === 'Favorites'");
  assert(
    await evaluate(
      page,
      `(() => {
        const text = document.querySelector('#detailContent')?.textContent || '';
        return text.includes('Books (1)') && text.includes('Chapters (1)') && text.includes('Verses (1)');
      })()`,
    ),
    "Favorites panel did not group book, chapter, and verse targets",
  );
  await click(page, "#favoriteBook");
  await waitFor(page, "document.querySelector('#bookTagControl .tag-picker-option[aria-label=\"Remove Favorite tag\"]')");
  await click(page, '#bookTagControl .tag-picker-option[aria-label="Remove Favorite tag"]');
  await click(page, "#favoriteChapter");
  await waitFor(page, "document.querySelector('#chapterTagControl .tag-picker-option[aria-label=\"Remove Favorite tag\"]')");
  await click(page, '#chapterTagControl .tag-picker-option[aria-label="Remove Favorite tag"]');
  await evaluate(page, "document.querySelector('.verse-number')?.focus()");
  await waitFor(page, "document.querySelector('.verse-number-menu-wrap')?.dataset.menuOpen === 'true'");
  await evaluate(
    page,
    "[...document.querySelectorAll('.verse-number-menu-wrap .tag-picker-option')].find((option) => /Favorite/u.test(option.textContent.trim()))?.click()",
  );
  await waitFor(
    page,
    "document.querySelector('#favoriteBook')?.getAttribute('aria-pressed') === 'false' && document.querySelector('#favoriteChapter')?.getAttribute('aria-pressed') === 'false' && !document.querySelector('.verse-number-wrap .tag-badge') && !document.querySelector('.verse-study-marks-button')",
  );
  pass("book chapter verse favorites, scope tag controls, and scripture mark hierarchy");

  const initialTheme = await evaluate(page, "document.documentElement.getAttribute('data-theme')");
  await click(page, "#themeToggle");
  await waitFor(page, `document.documentElement.getAttribute('data-theme') !== ${JSON.stringify(initialTheme)}`);
  await click(page, "#themeToggle");
  await waitFor(page, `document.documentElement.getAttribute('data-theme') === ${JSON.stringify(initialTheme)}`);
  pass("theme toggle");

  await click(page, "#showOutline");
  await waitFor(page, "document.querySelector('#detailTitle')?.textContent === 'Outline'");
  await click(page, "#showSearch");
  await waitFor(page, "document.querySelector('#detailTitle')?.textContent === 'Search'");
  await click(page, "#detailBack");
  await waitFor(page, "document.querySelector('#detailTitle')?.textContent === 'Outline'");
  await click(page, "#detailForward");
  await waitFor(page, "document.querySelector('#detailTitle')?.textContent === 'Search'");
  pass("detail panel back and forward history");

  if (qaDevice === "mobile") {
    const mobileLayout = await evaluate(
      page,
      `(() => ({
        innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        coarsePointer: matchMedia('(pointer: coarse)').matches,
        touchPoints: navigator.maxTouchPoints,
        studyPanelLauncherVisible: (() => {
          const node = document.querySelector('#openStudyPanel');
          return Boolean(node && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0);
        })(),
        visibleControls: ['#bookPickerButton', '#chapterPickerButton', '#showSearch', '#showTags'].filter((selector) => {
          const node = document.querySelector(selector);
          return node && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0;
        }).length
      }))()`,
    );
    assert(mobileLayout.innerWidth <= 520, `mobile viewport width was not applied: ${mobileLayout.innerWidth}`);
    assert(mobileLayout.scrollWidth <= mobileLayout.innerWidth + 1, "mobile layout has horizontal overflow");
    assert(mobileLayout.coarsePointer || mobileLayout.touchPoints > 0, "touch emulation was not applied");
    assert(mobileLayout.visibleControls >= 4, "mobile reader controls are not visible");
    assert(mobileLayout.studyPanelLauncherVisible, "mobile layout cannot reveal the side-panel-only study tools");
    pass("mobile touch viewport");
  }

  const routeBase = baseUrl.split("#")[0];
  await navigate(page, `${routeBase}#/read/bsb/proverbs/1/1`);
  await waitFor(page, "document.querySelector('#chapterTitle')?.textContent.includes('Proverbs 1')");
  state = await getQaState(page);
  assert(state.book === "proverbs" && state.chapter === "1", "direct hash route did not load Proverbs 1");
  assert(state.bodyText.includes("These are the proverbs"), "direct hash route did not render Proverbs 1:1");
  pass("direct hash route");

  await navigate(page, baseUrl);
  await waitFor(page, "document.querySelector('#chapterTitle')?.textContent.includes('Psalms 23')");

  await selectValue(page, "#translationSelect", "ylt");
  await waitFor(page, "document.querySelector('#translationSelect')?.value === 'ylt' && document.querySelector('#statusText')?.textContent.includes('YLT')");
  state = await getQaState(page);
  assert(state.translation === "ylt", "translation did not switch to YLT");
  pass("translation switching");

  await selectValue(page, "#translationSelect", "bsb");
  await waitFor(page, "document.querySelector('#translationSelect')?.value === 'bsb' && document.querySelector('#statusText')?.textContent.includes('BSB')");
  const verseTagMenuState = await evaluate(
    page,
    `(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const event = (type, options = {}) => {
        const Ctor = window.PointerEvent && type.startsWith('pointer') ? PointerEvent : Event;
        return new Ctor(type, { bubbles: true, cancelable: true, ...options });
      };
      const menu = document.querySelector('.verse-number-menu-wrap');
      const popover = menu?.querySelector('.tag-picker-popover');
      const option = menu?.querySelector('.tag-picker-option');
      const state = () => ({
        display: popover ? getComputedStyle(popover).display : '',
        open: menu?.dataset.menuOpen || '',
        closed: menu?.dataset.menuClosed || '',
        activeInside: menu?.contains(document.activeElement) || false
      });
      if (!menu || !popover || !option) return { missing: true };
      menu.dispatchEvent(event('pointerenter', { pointerType: 'mouse' }));
      const opened = state();
      menu.dispatchEvent(event('pointerleave', { pointerType: 'mouse' }));
      await wait(80);
      const duringDelay = state();
      await wait(140);
      const afterDelay = state();
      menu.dispatchEvent(event('pointerenter', { pointerType: 'mouse' }));
      option.focus();
      const focused = state();
      document.body.dispatchEvent(event('pointerdown', { pointerType: 'mouse' }));
      const outsideClosed = state();
      menu.dispatchEvent(event('pointerenter', { pointerType: 'mouse' }));
      option.focus();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      const escapeClosed = state();
      const escapeFocusRestored = document.activeElement === menu.querySelector('.target-tag-picker-trigger, .tag-picker-trigger');
      return { opened, duringDelay, afterDelay, focused, outsideClosed, escapeClosed, escapeFocusRestored };
    })()`,
  );
  assert(
    !verseTagMenuState.missing &&
      verseTagMenuState.opened.display === "grid" &&
      verseTagMenuState.duringDelay.display === "grid" &&
      verseTagMenuState.afterDelay.closed === "true" &&
      verseTagMenuState.focused.display === "grid" &&
      verseTagMenuState.outsideClosed.closed === "true" &&
      verseTagMenuState.escapeClosed.closed === "true",
    `verse number tag popup timing failed: ${JSON.stringify(verseTagMenuState)}`,
  );
  pass("verse number tag popup timing");
  await click(page, ".verse-number");
  await waitFor(page, "document.querySelector('#detailTitle')?.textContent === 'Parallel'");
  await waitFor(page, "document.querySelector('.parallel-verse')?.textContent.includes('BSB - Berean Study Bible')", 15000);
  state = await getQaState(page);
  assert(
    state.detailText.includes("KJV - King James Version") && state.detailText.includes("The LORD is my shepherd"),
    "parallel verse panel missing expected translation text",
  );
  assert(await evaluate(page, `Boolean(document.querySelector("#detailContext [data-panel-scope='verse'] .study-marks-trigger"))`), "verse context Study Marks trigger is missing");
  const studyTrigger = "#detailContext [data-panel-scope='verse'] .study-marks-trigger";
  const secondStudyTrigger = "#favoriteBook";
  const activeSecondStudyTrigger = "#favoriteBook[aria-expanded='true']";
  const pickerMarksExpression = "[...document.querySelectorAll('.target-tag-picker-menu')].map((menu) => [...menu.querySelectorAll('.tag-picker-option[aria-pressed=\"true\"]')].map((option) => option.getAttribute('aria-label')).sort().join('|')).filter(Boolean).sort().join('||')";
  const marksBeforeDismissal = await evaluate(
    page,
    pickerMarksExpression,
  );
  await evaluate(page, `document.querySelector(${JSON.stringify(studyTrigger)})?.focus()`);
  await waitFor(page, `document.querySelector(${JSON.stringify(studyTrigger)})?.closest('.target-tag-picker-menu')?.dataset.menuOpen === 'true'`);
  await page.press(studyTrigger, "Escape");
  const keyboardStudyMarksDismissal = await evaluate(page, `({
    restored: document.activeElement === document.querySelector(${JSON.stringify(studyTrigger)}),
    closed: document.querySelector(${JSON.stringify(studyTrigger)})?.closest('.target-tag-picker-menu')?.dataset.menuOpen !== 'true',
    unchanged: ${pickerMarksExpression} === ${JSON.stringify(marksBeforeDismissal)}
  })`);
  assert(keyboardStudyMarksDismissal.closed && keyboardStudyMarksDismissal.restored && keyboardStudyMarksDismissal.unchanged, `keyboard-open Study Marks Escape must restore its trigger focus without mutation: ${JSON.stringify(keyboardStudyMarksDismissal)}`);
  const hoverStudyMarksDismissal = await evaluate(page, `(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const trigger = document.querySelector(${JSON.stringify(studyTrigger)});
    const menu = trigger?.closest('.target-tag-picker-menu');
    const outside = document.querySelector('#themeToggle');
    const Ctor = window.PointerEvent || Event;
    outside?.focus();
    menu?.dispatchEvent(new Ctor('pointerenter', { bubbles: true, cancelable: true, pointerType: 'mouse' }));
    await wait(0);
    return { opened: menu?.dataset.menuOpen === 'true', focusOutside: document.activeElement === outside };
  })()`);
  await page.press("#themeToggle", "Escape");
  const hoverEscapeState = await evaluate(page, `({
    closed: document.querySelector(${JSON.stringify(studyTrigger)})?.closest('.target-tag-picker-menu')?.dataset.menuOpen !== 'true',
    restored: document.activeElement === document.querySelector(${JSON.stringify(studyTrigger)})
  })`);
  assert(hoverStudyMarksDismissal.opened && hoverStudyMarksDismissal.focusOutside && hoverEscapeState.closed && hoverEscapeState.restored, `hover-open Study Marks Escape must restore its active trigger: ${JSON.stringify({ hoverStudyMarksDismissal, hoverEscapeState })}`);

  const outsideDismissal = await evaluate(page, `(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const trigger = document.querySelector(${JSON.stringify(studyTrigger)});
    const menu = trigger?.closest('.target-tag-picker-menu');
    const outside = document.querySelector('#themeToggle');
    const Ctor = window.PointerEvent || Event;
    trigger?.focus();
    menu?.dispatchEvent(new Ctor('pointerenter', { bubbles: true, cancelable: true, pointerType: 'mouse' }));
    await wait(0);
    const openedBeforeDismissal = menu?.dataset.menuOpen === 'true';
    outside?.dispatchEvent(new Ctor('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse' }));
    outside?.focus();
    return {
      openedBeforeDismissal,
      closed: menu?.dataset.menuOpen !== 'true',
      outsideRetainedFocus: document.activeElement === outside,
    };
  })()`);
  assert(outsideDismissal.openedBeforeDismissal && outsideDismissal.closed && outsideDismissal.outsideRetainedFocus, `outside pointer dismissal must not steal focus: ${JSON.stringify(outsideDismissal)}`);

  const menuSwitchState = await evaluate(page, `(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const firstTrigger = document.querySelector(${JSON.stringify(studyTrigger)});
    const firstMenu = firstTrigger?.closest('.target-tag-picker-menu');
    const secondTrigger = document.querySelector(${JSON.stringify(secondStudyTrigger)});
    const secondMenu = secondTrigger?.closest('.target-tag-picker-menu');
    const Ctor = window.PointerEvent || Event;
    firstTrigger?.focus();
    firstMenu?.dispatchEvent(new Ctor('pointerenter', { bubbles: true, cancelable: true, pointerType: 'mouse' }));
    await wait(0);
    const firstOpened = firstMenu?.dataset.menuOpen === 'true';
    secondTrigger?.dispatchEvent(new Ctor('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse' }));
    secondTrigger?.click();
    secondTrigger?.focus();
    return {
      firstOpened,
      firstClosed: firstMenu?.dataset.menuOpen !== 'true',
      secondOpened: secondMenu?.dataset.menuOpen === 'true',
      secondFocused: document.activeElement === secondTrigger,
    };
  })()`);
  assert(menuSwitchState.firstOpened && menuSwitchState.firstClosed && menuSwitchState.secondOpened && menuSwitchState.secondFocused, `opening picker B must close picker A without returning focus to A: ${JSON.stringify(menuSwitchState)}`);
  await page.press(activeSecondStudyTrigger, "Escape");
  const marksAfterDismissal = await evaluate(
    page,
    pickerMarksExpression,
  );
  assert(marksAfterDismissal === marksBeforeDismissal, "all Study Marks dismissal paths must leave tag assertions unchanged");
  if (qaDevice === "mobile") {
    const touchMarksBefore = await evaluate(
      page,
      `[...(document.querySelector(${JSON.stringify(studyTrigger)})?.closest('.target-tag-picker-menu')?.querySelectorAll('.tag-picker-option[aria-pressed=\"true\"]') || [])].map((option) => option.getAttribute('aria-label')).sort().join('|')`,
    );
    await page.tap("#openStudyPanel");
    await waitFor(page, "document.querySelector('.detail-pane')?.classList.contains('visible')");
    await page.tap(studyTrigger);
    await waitFor(page, `document.querySelector(${JSON.stringify(studyTrigger)})?.closest('.target-tag-picker-menu')?.dataset.menuOpen === 'true'`);
    await page.press(studyTrigger, "Escape");
    const touchStudyMarks = await evaluate(page, `({
      closed: document.querySelector(${JSON.stringify(studyTrigger)})?.closest('.target-tag-picker-menu')?.dataset.menuOpen !== 'true',
      unchanged: [...(document.querySelector(${JSON.stringify(studyTrigger)})?.closest('.target-tag-picker-menu')?.querySelectorAll('.tag-picker-option[aria-pressed=\"true\"]') || [])].map((option) => option.getAttribute('aria-label')).sort().join('|') === ${JSON.stringify(touchMarksBefore)}
    })`);
    assert(touchStudyMarks.closed && touchStudyMarks.unchanged, `touch Study Marks activation must open once without mutating marks: ${JSON.stringify(touchStudyMarks)}`);
  }
  const secondMarksBeforeClosedEscape = await evaluate(
    page,
    `[...(document.querySelector(${JSON.stringify(secondStudyTrigger)})?.closest('.target-tag-picker-menu')?.querySelectorAll('.tag-picker-option[aria-pressed="true"]') || [])].map((option) => option.getAttribute('aria-label')).sort().join('|')`,
  );
  await evaluate(page, "document.querySelector('#themeToggle')?.focus()");
  await page.press("#themeToggle", "Escape");
  const closedPickerEscape = await evaluate(
    page,
    `({
      focusUnchanged: document.activeElement === document.querySelector('#themeToggle'),
      marksUnchanged: [...(document.querySelector(${JSON.stringify(secondStudyTrigger)})?.closest('.target-tag-picker-menu')?.querySelectorAll('.tag-picker-option[aria-pressed="true"]') || [])].map((option) => option.getAttribute('aria-label')).sort().join('|') === ${JSON.stringify(secondMarksBeforeClosedEscape)}
    })`,
  );
  assert(closedPickerEscape.focusUnchanged && closedPickerEscape.marksUnchanged, `Escape with no active Study Marks picker must leave focus and marks unchanged: ${JSON.stringify(closedPickerEscape)}`);
  if (qaDevice !== "mobile") {
    const rerenderingStudyTrigger = "#favoriteBook";
    await evaluate(page, `(() => {
      const trigger = document.querySelector(${JSON.stringify(rerenderingStudyTrigger)});
      window.__staleReaderTagMenu = trigger?.closest('.target-tag-picker-menu');
      trigger?.focus();
    })()`);
    await waitFor(page, `document.querySelector(${JSON.stringify(rerenderingStudyTrigger)})?.closest('.target-tag-picker-menu')?.dataset.menuOpen === 'true'`);
    const initialReaderFavoriteAction = await evaluate(
      page,
      `document.querySelector(${JSON.stringify(rerenderingStudyTrigger)})?.closest('.target-tag-picker-menu')?.querySelector('.tag-picker-option[aria-label$="Favorite tag"]')?.getAttribute('aria-label') || ''`,
    );
    assert(/^Add |^Remove /u.test(initialReaderFavoriteAction), `rerendering Study Marks picker is missing Favorite: ${initialReaderFavoriteAction}`);
    const initialReaderFavoriteSelector = `${rerenderingStudyTrigger} ~ .target-tag-picker-popover .tag-picker-option[aria-label=${JSON.stringify(initialReaderFavoriteAction)}]`;
    await click(page, initialReaderFavoriteSelector);
    await waitFor(page, `window.__staleReaderTagMenu && !window.__staleReaderTagMenu.isConnected && document.querySelector(${JSON.stringify(rerenderingStudyTrigger)})`);
    await evaluate(page, "document.querySelector('#themeToggle')?.focus()");
    await page.press("#themeToggle", "Escape");
    const detachedMenuEscape = await evaluate(page, `({
      focusUnchanged: document.activeElement === document.querySelector('#themeToggle'),
      menuClosed: document.querySelector(${JSON.stringify(rerenderingStudyTrigger)})?.closest('.target-tag-picker-menu')?.dataset.menuOpen !== 'true'
    })`);
    assert(detachedMenuEscape.focusUnchanged && detachedMenuEscape.menuClosed, `Escape after a picker rerender must ignore its detached former menu: ${JSON.stringify(detachedMenuEscape)}`);
    const reverseReaderFavoriteAction = initialReaderFavoriteAction.startsWith("Add ")
      ? initialReaderFavoriteAction.replace("Add ", "Remove ")
      : initialReaderFavoriteAction.replace("Remove ", "Add ");
    const reverseReaderFavoriteSelector = `${rerenderingStudyTrigger} ~ .target-tag-picker-popover .tag-picker-option[aria-label=${JSON.stringify(reverseReaderFavoriteAction)}]`;
    await evaluate(page, `document.querySelector(${JSON.stringify(rerenderingStudyTrigger)})?.focus()`);
    await waitFor(page, `document.querySelector(${JSON.stringify(rerenderingStudyTrigger)})?.closest('.target-tag-picker-menu')?.dataset.menuOpen === 'true'`);
    await click(page, reverseReaderFavoriteSelector);
    await waitFor(page, `document.querySelector(${JSON.stringify(rerenderingStudyTrigger)})?.closest('.target-tag-picker-menu')?.dataset.menuOpen !== 'true'`);
    await evaluate(page, "document.querySelector('#themeToggle')?.focus()");
    await page.press("#themeToggle", "Escape");
    const marksAfterRerenderDismissal = await evaluate(page, pickerMarksExpression);
    assert(
      marksAfterRerenderDismissal === marksBeforeDismissal,
      `rerendered picker Escape coverage must restore the original tag assertions: ${JSON.stringify({ marksBeforeDismissal, marksAfterRerenderDismissal })}`,
    );
  }
  pass("verse context Study Marks trigger");
  pass("parallel translations by verse number");

  await click(page, ".fn-marker");
  await waitFor(page, "document.querySelector('#detailTitle')?.textContent === 'Footnote'");
  state = await getQaState(page);
  assert(state.detailText.includes("Footnote"), "footnote detail did not open");
  const footnoteThemeBefore = await evaluate(page, "document.documentElement.getAttribute('data-theme')");
  if (footnoteThemeBefore !== "light") {
    await click(page, "#themeToggle");
    await waitFor(page, "document.documentElement.getAttribute('data-theme') === 'light'");
  }
  await waitFor(page, "getComputedStyle(document.querySelector('.fn-marker')).color === 'rgb(35, 71, 251)'");
  const lightFootnoteStyle = await evaluate(
    page,
    `(() => {
      const marker = document.querySelector('.fn-marker');
      marker.blur();
      const style = getComputedStyle(marker);
      const textStyle = getComputedStyle(marker?.closest('.verse-line') || document.body);
      const detailMarker = document.querySelector('.footnote-detail-marker');
      const result = { borderTopWidth: style.borderTopWidth, backgroundColor: style.backgroundColor, color: style.color, textColor: textStyle.color, detailColor: getComputedStyle(detailMarker).color };
      marker.focus();
      result.focusColor = getComputedStyle(marker).color;
      result.focusOutline = getComputedStyle(marker).outlineStyle;
      marker.blur();
      return result;
    })()`,
  );
  await click(page, "#themeToggle");
  await waitFor(page, "document.documentElement.getAttribute('data-theme') === 'dark'");
  await waitFor(page, "getComputedStyle(document.querySelector('.fn-marker')).color === 'rgb(158, 175, 255)'");
  const darkFootnoteStyle = await evaluate(
    page,
    `(() => {
      const marker = document.querySelector('.fn-marker');
      marker.blur();
      const style = getComputedStyle(marker);
      const detailMarker = document.querySelector('.footnote-detail-marker');
      const result = { theme: document.documentElement.getAttribute('data-theme'), color: style.color, detailColor: getComputedStyle(detailMarker).color };
      marker.focus();
      result.focusColor = getComputedStyle(marker).color;
      result.focusOutline = getComputedStyle(marker).outlineStyle;
      marker.blur();
      return result;
    })()`,
  );
  if (footnoteThemeBefore !== "dark") {
    await click(page, "#themeToggle");
    await waitFor(page, `document.documentElement.getAttribute('data-theme') === ${JSON.stringify(footnoteThemeBefore)}`);
  }
  assert(lightFootnoteStyle.borderTopWidth === "0px", "footnote marker still has a visible box border");
  assert(
    lightFootnoteStyle.color !== lightFootnoteStyle.textColor,
    `footnote marker should be visually distinct from verse text: ${JSON.stringify(lightFootnoteStyle)}`,
  );
  assert(
    lightFootnoteStyle.color === "rgb(35, 71, 251)" &&
      lightFootnoteStyle.detailColor === "rgb(35, 71, 251)" &&
      lightFootnoteStyle.focusOutline === "solid",
    `light-theme footnote contrast regressed: ${JSON.stringify(lightFootnoteStyle)}`,
  );
  assert(
    darkFootnoteStyle.color === "rgb(158, 175, 255)" &&
      darkFootnoteStyle.detailColor === "rgb(158, 175, 255)" &&
      darkFootnoteStyle.focusOutline === "solid",
    `dark-theme footnote marker, detail, or focus contrast is incorrect: ${JSON.stringify(darkFootnoteStyle)}`,
  );
  pass("footnote popup");

  await click(page, ".verse-study-button");
  await waitFor(page, "document.querySelector('#detailTitle')?.textContent === 'Cross References'");
  await waitFor(page, "document.querySelector('.reference-meta')?.textContent.includes(' - ')", 15000);
  state = await getQaState(page);
  assert(state.detailText.includes("Psalm") || state.detailText.includes("John"), "cross-reference panel did not render");
  const crossrefState = await evaluate(
    page,
    `(() => {
      const passage = document.querySelector('.reference-passage');
      const style = getComputedStyle(passage);
      return {
        text: passage?.textContent.trim() || '',
        markerCount: passage?.querySelectorAll('.passage-verse-number').length || 0,
        overflowY: style.overflowY,
        maxHeight: style.maxHeight
      };
    })()`,
  );
  assert(crossrefState.markerCount > 0 && crossrefState.text.length > 20, "cross-reference passage preview did not include verse-numbered text");
  assert(crossrefState.overflowY === "auto", "cross-reference passage preview is not scrollable");
  const firstRef = await evaluate(
    page,
    `document.querySelector('#detailContent .link-button')?.textContent.trim() || ''`,
  );
  await click(page, "#detailContent .link-button");
  await waitFor(page, `document.querySelector('#chapterTitle')?.textContent.trim() !== 'Psalms 23' || ${JSON.stringify(firstRef)}.includes('Psalm 23')`);
  pass("cross-reference click-through");

  await selectValue(page, "#bookSelect", "proverbs");
  await waitFor(page, "document.querySelector('#chapterTitle')?.textContent.includes('Proverbs 1')");
  await click(page, ".verse-number");
  await waitFor(page, "document.querySelector('#detailTitle')?.textContent === 'Parallel'");
  await clickButtonByText(page, "Cmt", { index: 0 });
  await waitFor(page, "document.querySelector('#detailTitle')?.textContent === 'Commentary'");
  await waitFor(
    page,
    "document.querySelector('#detailContent')?.textContent.includes('Ellicott') || document.querySelector('#detailContent')?.textContent.includes('Pulpit')",
    15000,
  );
  state = await getQaState(page);
  assert(state.detailText.includes("Ellicott") || state.detailText.includes("Pulpit"), "commentary panel missing source entries");
  pass("commentary panel");

  const sanitizerResult = await evaluate(
    page,
    `(async () => {
      const { setSanitizedCommentaryHtml } = await import('/src/sanitize-commentary.js');
      const fixture = document.createElement('div');
      setSanitizedCommentaryHtml(
        fixture,
        '<p onclick="window.__unsafe = true">Safe <strong>text</strong><script>window.__unsafe = true</script>' +
          '<a href="javascript:alert(1)" onmouseover="window.__unsafe = true">unsafe</a>' +
          '<a href="http://example.test/insecure">insecure</a>' +
          '<a href="../../par/john/1-1.htm" class="bad" title="Reference">reference</a>' +
          '<span class="bld unknown">bold</span><svg onload="window.__unsafe = true"><circle /></svg></p>'
      );
      return {
        html: fixture.innerHTML,
        scripts: fixture.querySelectorAll('script,svg,iframe,object,embed,form').length,
        eventAttributes: fixture.querySelectorAll('[onclick],[onmouseover],[onload]').length,
        unsafeHref: fixture.querySelector('a[href^="javascript:"]')?.getAttribute('href') || null,
        insecureHref: fixture.querySelector('a[href^="http:"]')?.getAttribute('href') || null,
        safeHref: fixture.querySelector('a[href^="../../"]')?.getAttribute('href') || null,
        spanClass: fixture.querySelector('span')?.className || '',
        unsafeExecuted: Boolean(window.__unsafe)
      };
    })()`,
  );
  assert(sanitizerResult.scripts === 0, "commentary sanitizer retained active embedded content");
  assert(sanitizerResult.eventAttributes === 0, "commentary sanitizer retained event attributes");
  assert(
    !sanitizerResult.unsafeHref && !sanitizerResult.insecureHref && !sanitizerResult.unsafeExecuted,
    "commentary sanitizer retained an unsafe URL or executed markup",
  );
  assert(sanitizerResult.safeHref === "../../par/john/1-1.htm", "commentary sanitizer removed a safe internal link");
  assert(sanitizerResult.spanClass === "bld", "commentary sanitizer did not constrain presentation classes");
  pass("commentary hostile markup sanitization");

  const commentaryHasLink = await evaluate(page, "Boolean(document.querySelector('.commentary-body a'))");
  assert(commentaryHasLink, "commentary body has no internal links");
  await click(page, ".commentary-body a");
  await waitFor(page, "document.querySelector('#chapterTitle')?.textContent.includes('Proverbs 1')");
  pass("commentary internal link handling");

  await click(page, "#showOutline");
  await waitFor(page, "document.querySelector('#detailTitle')?.textContent === 'Outline'");
  state = await getQaState(page);
  assert(state.detailText.includes("The Beginning of Knowledge"), "outline panel missing expected item");
  const outlineThemeBefore = await evaluate(page, "document.documentElement.getAttribute('data-theme')");
  if (outlineThemeBefore !== "dark") await click(page, "#themeToggle");
  await waitFor(page, "document.documentElement.getAttribute('data-theme') === 'dark'");
  await click(page, "#detailContent .link-button");
  await waitFor(page, "document.querySelector('#chapterTitle')?.textContent.includes('Proverbs 1')");
  await waitFor(page, "Boolean(document.querySelector('.target-verse'))");
  await delay(300);
  const darkOutlineHighlight = await evaluate(
    page,
    `(() => {
      const node = document.querySelector('.target-verse');
      if (!node) return null;
      const style = getComputedStyle(node);
      return { background: style.backgroundColor, color: style.color };
    })()`,
  );
  assert(
    darkOutlineHighlight &&
      darkOutlineHighlight.background !== "rgb(238, 247, 245)" &&
      darkOutlineHighlight.color !== darkOutlineHighlight.background,
    `outline highlight is unreadable in dark mode: ${JSON.stringify(darkOutlineHighlight)}`,
  );
  if (outlineThemeBefore !== "dark") {
    await click(page, "#themeToggle");
    await waitFor(page, `document.documentElement.getAttribute('data-theme') === ${JSON.stringify(outlineThemeBefore)}`);
  }
  pass("outline navigation");

  await click(page, ".verse-study-button");
  await clickButtonByText(page, "Int", { index: 0 });
  await waitFor(page, "document.querySelector('#detailTitle')?.textContent === 'Language Study'");
  await waitFor(page, "document.querySelectorAll('#detailContent .interlinear-token').length > 0", 15000);
  state = await getQaState(page);
  assert(
    state.detailText.includes("H4912") &&
      state.detailText.includes("miš") &&
      state.detailText.includes("These are the proverbs"),
    "interlinear panel missing Proverbs 1:1 token data",
  );
  assert(
    !(await evaluate(page, "Boolean(document.querySelector('.verse-gematria-total'))")),
    "transliterated Hebrew tokens must not render a zero gematria summary",
  );
  await evaluate(
    page,
    `(() => {
      const pane = document.querySelector('#detailContent');
      pane.scrollTop = pane.scrollHeight;
      pane.dispatchEvent(new Event('scroll'));
      return true;
    })()`,
  );
  await waitFor(page, "Boolean(document.querySelector('.interlinear-verse-section[data-verse=\"2\"]'))", 15000);
  assert(
    await evaluate(
      page,
      "Boolean(document.querySelector('.interlinear-verse-section[data-verse=\"1\"]') && document.querySelector('.interlinear-verse-section[data-verse=\"2\"]'))",
    ),
    "lazy loading replaced the inspected verse instead of appending the next verse",
  );
  pass("interlinear verse lazy continuation");

  pass("interlinear panel");

  await click(page, ".interlinear-token .compact-link");
  await waitFor(page, "document.querySelector('#detailTitle')?.textContent === \"Strong's\"");
  await waitFor(page, "document.querySelector('#detailContent')?.textContent.includes('H4912')", 10000);
  await waitFor(page, "document.querySelector('#detailContent')?.textContent.includes('Hebrew word breakdown')", 15000);
  await waitFor(page, "document.querySelector('#detailContent')?.textContent.includes(\"Strong's Concordance\")", 15000);
  const themeBeforeHebrew = await evaluate(page, "document.documentElement.getAttribute('data-theme')");
  if (themeBeforeHebrew !== "dark") await click(page, "#themeToggle");
  await waitFor(page, "document.documentElement.getAttribute('data-theme') === 'dark'");
  const darkHebrewContrast = await evaluate(
    page,
    `(() => {
      const node = document.querySelector('.mark-study-word');
      const surface = node?.closest('.mark-study');
      if (!node || !surface) return null;
      const foregroundStyle = getComputedStyle(node);
      const backgroundStyle = getComputedStyle(surface);
      const renderings = document.querySelector('.translation-renderings');
      const renderingRow = document.querySelector('.translation-rendering-row');
      const markWord = document.querySelector('.mark-study-word');
      const markList = document.querySelector('.language-breakdown.hebrew .mark-list');
      const summaryHeading = document.querySelector('.strong-sticky-summary > h3');
      const rgb = (value) => (value.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
      const luminance = (values) => {
        const channels = values.map((value) => {
          const normalized = value / 255;
          return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
      };
      const foreground = luminance(rgb(foregroundStyle.color));
      const background = luminance(rgb(backgroundStyle.backgroundColor));
      return {
        color: foregroundStyle.color,
        background: backgroundStyle.backgroundColor,
        ratio: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
        renderingsBackground: renderings ? getComputedStyle(renderings).backgroundColor : '',
        renderingRowBackground: renderingRow ? getComputedStyle(renderingRow).backgroundColor : '',
        markWordAlignment: markWord ? getComputedStyle(markWord).textAlign : '',
        markListAlignment: markList ? getComputedStyle(markList).justifyContent : '',
        headingBorder: summaryHeading ? getComputedStyle(summaryHeading).borderBottomWidth : '',
        headingPaddingBottom: summaryHeading ? getComputedStyle(summaryHeading).paddingBottom : ''
      };
    })()`,
  );
  assert(darkHebrewContrast?.ratio >= 4.5, `dark Hebrew source contrast is too low: ${JSON.stringify(darkHebrewContrast)}`);
  assert(
    darkHebrewContrast?.renderingsBackground !== "rgb(255, 255, 255)" &&
      darkHebrewContrast?.renderingRowBackground !== "rgb(255, 255, 255)",
    `translation renderings retain a white dark-theme surface: ${JSON.stringify(darkHebrewContrast)}`,
  );
  assert(
    darkHebrewContrast?.markWordAlignment === "center" && darkHebrewContrast?.markListAlignment === "center",
    `Hebrew marks are not centered beneath their source word: ${JSON.stringify(darkHebrewContrast)}`,
  );
  assert(
    darkHebrewContrast?.headingBorder !== "0px" && Number.parseFloat(darkHebrewContrast?.headingPaddingBottom || "0") >= 8,
    `Strong's heading lacks visual separation: ${JSON.stringify(darkHebrewContrast)}`,
  );
  await click(page, ".hebrew-rtl-note");
  await waitFor(
    page,
    "document.querySelector('.hebrew-rtl-note')?.getAttribute('aria-expanded') === 'true' && !document.querySelector('.hebrew-rtl-explanation')?.hidden",
  );
  assert(
    (await evaluate(page, "document.querySelector('.hebrew-rtl-explanation')?.textContent || ''")).includes(
      "Begin with the character on the right",
    ),
    "Hebrew reading-direction control did not reveal its explanation",
  );
  await click(page, ".hebrew-rtl-note");
  await waitFor(
    page,
    "document.querySelector('.hebrew-rtl-note')?.getAttribute('aria-expanded') === 'false' && document.querySelector('.hebrew-rtl-explanation')?.hidden",
  );
  pass("Hebrew reading-direction explanation");
  if (themeBeforeHebrew !== "dark") {
    await click(page, "#themeToggle");
    await waitFor(page, `document.documentElement.getAttribute('data-theme') === ${JSON.stringify(themeBeforeHebrew)}`);
  }
  pass("dark Hebrew source contrast");
  state = await getQaState(page);
  assert(state.detailText.includes("Gematria total"), "Strong's hover missing Hebrew gematria breakdown");
  assert(state.detailText.includes("Hebrew marks / symbols"), "Strong's hover missing Hebrew marks section");
  assert(
    state.detailText.includes("Lexical summary") &&
      state.detailText.includes("KJV renderings") &&
      state.detailText.includes("Word origin"),
    "Strong's sidebar missing lexical summary rows",
  );
  const strongSidebar = await evaluate(
    page,
    `(() => ({
      anchorHrefs: [...document.querySelectorAll('#detailContent .strong-detail a[href]')].map((node) => node.getAttribute('href')),
      navButtons: [...document.querySelectorAll('.strong-nav .strong-inline-link')].map((node) => node.textContent.trim()),
      originButtons: [...document.querySelectorAll('.word-origin-value .strong-inline-link')].map((node) => node.textContent.trim()),
      lexicalText: document.querySelector('.lexical-summary')?.textContent || '',
      markText: document.querySelector('.mark-list')?.textContent || '',
      hebrewBreakdownOrder: [...document.querySelectorAll('.language-breakdown.hebrew > *')].map((node) => node.className || node.tagName),
      markListStyle: (() => {
        const node = document.querySelector('.language-breakdown.hebrew .mark-list');
        const style = node ? getComputedStyle(node) : null;
        return style ? { direction: style.direction, flexWrap: style.flexWrap, overflowX: style.overflowX } : null;
      })(),
      markGlyphs: [...document.querySelectorAll('.language-breakdown.hebrew .mark-glyph')].map((node) => node.textContent.trim()),
      concordanceText: document.querySelector('.lexicon-sections')?.textContent || '',
      childOrder: [...document.querySelectorAll('.strong-detail > *')].map((node) => node.className || node.tagName),
      highlight: document.querySelector('.reader-context-highlight') ? 'present' : ''
    }))()`,
  );
  assert(strongSidebar.anchorHrefs.length === 0, "Strong's sidebar should not render old-site anchors");
  assert(
    strongSidebar.navButtons.some((label) => label.includes("Previous H4911")) &&
      strongSidebar.navButtons.some((label) => label.includes("Next H4913")),
    "Strong's sidebar missing internal previous/next buttons",
  );
  assert(strongSidebar.originButtons.some((label) => label === "mashal"), "Strong's sidebar must emphasize the origin word instead of its number");
  await evaluate(
    page,
    `(() => {
      document.querySelector('.strong-origin-link')?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
      return true;
    })()`,
  );
  await waitFor(
    page,
    "document.querySelector('.strong-origin-link')?.dataset.tooltip?.includes('H4910') && !document.querySelector('.strong-origin-link')?.dataset.tooltip?.includes('Loading')",
    15000,
  );
  const originLinkState = await evaluate(
    page,
    `(() => {
      const link = document.querySelector('.strong-origin-link');
      return link ? { label: link.textContent.trim(), tooltip: link.dataset.tooltip, ariaLabel: link.getAttribute('aria-label') } : null;
    })()`,
  );
  assert(
    originLinkState?.label === "mashal" &&
      originLinkState.tooltip.includes("H4910") &&
      originLinkState.ariaLabel.includes("mashal"),
    `word-origin definition link is incomplete: ${JSON.stringify(originLinkState)}`,
  );
  assert(
    strongSidebar.lexicalText.includes("byword, like, parable, proverb") &&
      strongSidebar.lexicalText.includes("Apparently from mashal"),
    "Strong's sidebar missing KJV renderings or word origin text",
  );
  assert(
    ["qamats", "tsere", "hiriq"].some((label) => strongSidebar.markText.includes(label)),
    "Strong's sidebar missing visible Hebrew mark labels",
  );
  assert(
    strongSidebar.hebrewBreakdownOrder.indexOf("mark-study") < strongSidebar.hebrewBreakdownOrder.indexOf("letter-breakdown") &&
      strongSidebar.hebrewBreakdownOrder.indexOf("letter-breakdown") < strongSidebar.hebrewBreakdownOrder.indexOf("gematria-total"),
    `Hebrew marks must appear before letters and gematria: ${JSON.stringify(strongSidebar.hebrewBreakdownOrder)}`,
  );
  assert(
    strongSidebar.markListStyle?.direction === "rtl" &&
      strongSidebar.markListStyle?.flexWrap === "nowrap" &&
      strongSidebar.markGlyphs.length > 0 &&
      strongSidebar.markGlyphs.every((glyph) => !/[\u05d0-\u05ea]/u.test(glyph)),
    `Hebrew mark pills must stay RTL, single-line, and show symbols without letters: ${JSON.stringify(strongSidebar)}`,
  );
  assert(strongSidebar.concordanceText.includes("byword") || strongSidebar.concordanceText.includes("proverb"), "Strong's sidebar missing concordance data");
  assert(
    strongSidebar.childOrder[strongSidebar.childOrder.length - 1] === "translation-renderings",
    "Strong's translation renderings should appear at the bottom of the detail view",
  );
  pass("Strong's detail, internal navigation, concordance, and Hebrew breakdown");

  const historyHighlightFixture = await evaluate(
    page,
    `(() => {
      const tokens = [...document.querySelectorAll('.strong-token')].filter((node) => node.dataset.strongCode);
      if (tokens.length < 2) return null;
      const first = tokens[0];
      const second = tokens.find((node) => node.dataset.strongCode !== first.dataset.strongCode) || tokens[1];
      first.scrollIntoView({ block: 'center' });
      first.click();
      return {
        first: { code: first.dataset.strongCode, text: first.textContent.trim() },
        second: { code: second.dataset.strongCode, text: second.textContent.trim() },
      };
    })()`,
  );
  assert(historyHighlightFixture?.first?.code && historyHighlightFixture?.second?.code, "Strong's history highlight fixture could not find two tokens");
  await waitFor(page, `document.querySelector('#detailContent')?.textContent.includes(${JSON.stringify(historyHighlightFixture.first.code)})`);
  await evaluate(
    page,
    `(() => {
      const token = [...document.querySelectorAll('.strong-token')].find(
        (node) => node.dataset.strongCode === ${JSON.stringify(historyHighlightFixture.second.code)}
      );
      token?.scrollIntoView({ block: 'center' });
      token?.click();
      return true;
    })()`,
  );
  await waitFor(page, `document.querySelector('#detailContent')?.textContent.includes(${JSON.stringify(historyHighlightFixture.second.code)})`);
  await click(page, "#detailBack");
  await waitFor(page, `document.querySelector('#detailContent')?.textContent.includes(${JSON.stringify(historyHighlightFixture.first.code)})`);
  const backHighlight = await evaluate(
    page,
    `(() => ({
      code: document.querySelector('.reader-context-word')?.dataset.strongCode || '',
      text: document.querySelector('.reader-context-word')?.textContent.trim() || '',
      verseCount: document.querySelectorAll('.reader-context-verse').length
    }))()`,
  );
  assert(
    backHighlight.code === historyHighlightFixture.first.code && backHighlight.verseCount === 1,
    `detail Back did not restore matching reader highlight: ${JSON.stringify({ historyHighlightFixture, backHighlight })}`,
  );
  await click(page, "#detailForward");
  await waitFor(page, `document.querySelector('#detailContent')?.textContent.includes(${JSON.stringify(historyHighlightFixture.second.code)})`);
  const forwardHighlight = await evaluate(
    page,
    `(() => ({
      code: document.querySelector('.reader-context-word')?.dataset.strongCode || '',
      text: document.querySelector('.reader-context-word')?.textContent.trim() || '',
      verseCount: document.querySelectorAll('.reader-context-verse').length
    }))()`,
  );
  assert(
    forwardHighlight.code === historyHighlightFixture.second.code && forwardHighlight.verseCount === 1,
    `detail Forward did not restore matching reader highlight: ${JSON.stringify({ historyHighlightFixture, forwardHighlight })}`,
  );
  await click(page, "#clearDetail");
  await waitFor(page, "document.querySelector('#detailTitle')?.textContent === 'Details'");
  assert(
    await evaluate(page, "!document.querySelector('.reader-context-word') && !document.querySelector('.reader-context-verse')"),
    "Clear did not remove restored reader highlight",
  );
  pass("Strong's detail history restores reader highlight");

  await evaluate(
    page,
    `(() => {
      document.querySelector('#chapterContent')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      return true;
    })()`,
  );
  await waitFor(page, "document.querySelector('.detail-pane')?.dataset.hoverLocked === 'false'");
  const backgroundUnlockHover = await evaluate(
    page,
    `(() => {
      const token = [...document.querySelectorAll('.strong-token')].find((node) => {
        const code = node.dataset.strongCode || '';
        return code && code !== 'H4912';
      });
      if (!token) return null;
      const code = token.dataset.strongCode || '';
      token.scrollIntoView({ block: 'center' });
      const rect = token.getClientRects()[0] || token.getBoundingClientRect();
      return {
        code,
        text: token.textContent.trim(),
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        className: token.className,
        pointClassName: document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.className || ''
      };
    })()`,
  );
  assert(backgroundUnlockHover?.code, "No alternate Strong's token found for background-unlock regression");
  await evaluate(
    page,
    `(() => {
      const token = [...document.querySelectorAll('.strong-token')].find(
        (node) => node.dataset.strongCode === ${JSON.stringify(backgroundUnlockHover.code)}
      );
      token?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, view: window }));
      return true;
    })()`,
  );
  await delay(300);
  const unlockState = await evaluate(
    page,
    `(() => ({
      expectedCode: ${JSON.stringify(backgroundUnlockHover.code)},
      hoverLocked: document.querySelector('.detail-pane')?.dataset.hoverLocked,
      detailTitle: document.querySelector('#detailTitle')?.textContent || '',
      detailText: document.querySelector('#detailContent')?.textContent.slice(0, 500) || '',
      hasStrongTokenData: [...document.querySelectorAll('.strong-token')].some(
        (node) => node.dataset.strongCode === ${JSON.stringify(backgroundUnlockHover.code)} && Boolean(node.__bibleAppStrongToken)
      )
    }))()`,
  );
  assert(
    unlockState.detailTitle === "Strong's" && unlockState.detailText.includes(backgroundUnlockHover.code),
    `background click did not re-enable Strong's hover updates: ${JSON.stringify(unlockState)}`,
  );
  pass("background click unlocks pinned Strong's hover");

  await navigate(page, `${routeBase}#/read/bsb/john/1/1`);
  await waitFor(page, "document.querySelector('#chapterTitle')?.textContent.includes('John 1')");
  await click(page, ".verse-study-button");
  await clickButtonByText(page, "Int", { index: 0 });
  await waitFor(page, "document.querySelector('#detailTitle')?.textContent === 'Language Study'");
  await waitFor(page, "document.querySelectorAll('#detailContent .interlinear-token').length > 0", 15000);
  state = await getQaState(page);
  assert(state.detailText.includes("G1722") && state.detailText.includes("archē"), "Greek interlinear token data missing");
  assert(
    await evaluate(
      page,
      "document.querySelectorAll('.interlinear-token .token-tag-actions').length === document.querySelectorAll('.interlinear-token').length",
    ),
    "Interlinear source tokens are missing tag actions",
  );
  await click(page, ".interlinear-token .token-study-marks-button");
  await waitFor(
    page,
    "document.querySelector('.interlinear-token .study-marks-menu .target-tag-picker-popover') && getComputedStyle(document.querySelector('.interlinear-token .study-marks-menu .target-tag-picker-popover')).display === 'grid'",
  );
  assert(
    await evaluate(page, "document.querySelector('#detailTitle')?.textContent === 'Language Study'"),
    "interlinear token tag button should keep the tag picker local to the token card",
  );
  await click(page, '.interlinear-token .study-marks-menu .tag-picker-option[aria-label="Add Positive tag"]');
  await waitFor(page, "document.querySelector('.interlinear-token .token-target-badges .target-tag-badge')");
  await click(page, ".interlinear-token .token-target-badges .target-tag-picker-trigger");
  await waitFor(
    page,
    "document.querySelector('.interlinear-token .token-target-badges .tag-picker-option[aria-label=\"Remove Positive tag\"]')",
  );
  await click(page, '.interlinear-token .token-target-badges .tag-picker-option[aria-label="Remove Positive tag"]');
  await waitFor(page, "!document.querySelector('.interlinear-token .token-target-badges')");
  pass("Interlinear source-token Study Marks");
  pass("Greek interlinear token data");

  await navigate(page, `${routeBase}#/read/bsb/proverbs/1/1`);
  await waitFor(page, "document.querySelector('#chapterTitle')?.textContent.includes('Proverbs 1')");

  await click(page, ".verse-study-button");
  await click(page, "#detailContext [data-panel-scope='verse'] .study-marks-trigger");
  await click(page, "#detailContext [data-panel-scope='verse'] .tag-picker-manage");
  await waitFor(page, "document.querySelector('#detailTitle')?.textContent === 'Tags'");
  await click(page, "#detailContent .tag-editor-toggle");
  await waitFor(page, "document.querySelector('.tag-badge')?.textContent.includes('Positive')");
  await waitFor(page, "document.querySelector('.verse-number-wrap .tag-badge')?.textContent.includes('Positive')");
  await click(page, "#showTags");
  await waitFor(page, "document.querySelector('#detailContent')?.textContent.includes('Positive (1)')");
  pass("verse tags and tag index");

  await evaluate(
    page,
    `(() => {
      document.querySelector('.custom-tag-form input[name="label"]').value = ${JSON.stringify(customTagLabel)};
      document.querySelector('.custom-tag-form input[name="description"]').value = 'QA-created tag';
      document.querySelector('.custom-tag-form input[name="color"]').value = '#4f6f91';
      document.querySelector('.custom-tag-form input[name="icon"]').value = 'G';
      return true;
    })()`,
  );
  await click(page, ".custom-tag-form button[type='submit']");
  await waitFor(
    page,
    `document.querySelector('.custom-tag-edit-form input[name="edit-label"]')?.value === ${JSON.stringify(customTagLabel)}`,
  );
  await click(page, ".verse-study-button");
  await click(page, "#detailContext [data-panel-scope='verse'] .study-marks-trigger");
  await click(page, "#detailContext [data-panel-scope='verse'] .tag-picker-manage");
  await waitFor(page, `document.querySelector('#detailContent')?.textContent.includes(${JSON.stringify(customTagLabel)})`);
  await evaluate(
    page,
    `(() => {
      const label = [...document.querySelectorAll('.tag-editor .tag-editor-toggle')].find((node) =>
        node.textContent.includes(${JSON.stringify(customTagLabel)})
      );
      if (!label) return false;
      label.click();
      return true;
    })()`,
  );
  await waitFor(
    page,
    `[...document.querySelectorAll('.tag-badge')].some((node) => node.textContent.includes(${JSON.stringify(customTagLabel)}))`,
  );
  await click(page, "#showTags");
  await waitFor(page, `document.querySelector('#detailContent')?.textContent.includes(${JSON.stringify(`${customTagLabel} (1)`)})`);
  pass("custom tag creation and assignment");

  await evaluate(
    page,
    `(() => {
      const form = [...document.querySelectorAll('.custom-tag-edit-form')].find((node) =>
        node.querySelector('input[name="edit-label"]')?.value === ${JSON.stringify(customTagLabel)}
      );
      if (!form) return false;
      form.querySelector('input[name="edit-label"]').value = ${JSON.stringify(customTagEditedLabel)};
      form.querySelector('input[name="edit-description"]').value = 'QA edited tag';
      form.querySelector('input[name="edit-color"]').value = '#315f99';
      form.querySelector('input[name="edit-icon"]').value = 'E';
      return true;
    })()`,
  );
  await click(page, ".custom-tag-edit-form button[type='submit']");
  await waitFor(page, `document.querySelector('#detailContent')?.textContent.includes(${JSON.stringify(`${customTagEditedLabel} (1)`)})`);
  await click(page, ".custom-tag-edit-form .danger-button");
  await waitFor(page, "document.querySelector('.custom-tag-edit-form .danger-button')?.textContent.trim() === 'Confirm'");
  await click(page, ".custom-tag-edit-form .danger-button");
  await waitFor(
    page,
    `!document.querySelector('#detailContent')?.textContent.includes(${JSON.stringify(customTagEditedLabel)})`,
  );
  await waitFor(
    page,
    `![...document.querySelectorAll('.tag-badge')].some((node) => node.textContent.includes(${JSON.stringify(customTagEditedLabel)}))`,
  );
  pass("custom tag edit and delete");

  await click(page, "#showMyData");
  await waitFor(page, "document.querySelector('#detailTitle')?.textContent === 'My Data'");
  assert(
    await evaluate(page, "!document.querySelector('.advanced-diagnostics')?.open"),
    "Advanced diagnostics must be collapsed by default",
  );
  assert(
    await evaluate(page, "document.querySelector('.advanced-diagnostics .job-payload') === null"),
    "Raw diagnostic payloads must not render before expansion",
  );
  state = await getQaState(page);
  assert(
    state.detailText.includes("Personal meanings") && state.detailText.includes("Preserved legacy verse drafts"),
    "My Data summary missing Meaning or preserved legacy draft counts",
  );
  pass("My Data summary and collapsed diagnostics");

  const backupDownloadPromise = page.waitForDownload();
  await clickButtonByText(page, "Download backup");
  const backupDownload = await backupDownloadPromise;
  assert(
    /^bibleapp-user-data-\d{4}-\d{2}-\d{2}\.json$/.test(backupDownload.suggestedFilename()),
    "Downloaded backup must use the compatible Bible App JSON filename",
  );
  pass("My Data backup download");

  await click(page, "#showMyData");
  await click(page, "#detailBack");
  await waitFor(page, "document.querySelector('#detailTitle')?.textContent === 'Study Marks'");
  await click(page, "#detailForward");
  await waitFor(page, "document.querySelector('#detailTitle')?.textContent === 'My Data'");
  pass("My Data repeat activation and Back/Forward history");

  await click(page, ".maintenance-section .mini-button");
  await waitFor(page, "document.querySelector('.maintenance-status')?.textContent.includes('Personal study data was not changed')");
  pass("plain-language local maintenance");

  await click(page, ".advanced-diagnostics > summary");
  await waitFor(page, "document.querySelector('.advanced-diagnostics')?.open && document.querySelector('.advanced-diagnostics .job-payload')");
  state = await getQaState(page);
  assert(
    state.detailText.includes("tag-index-refresh") && state.detailText.includes('"action": "retired"'),
    "Advanced diagnostics did not preserve local job details",
  );
  pass("advanced local job diagnostics");

  await click(page, ".manual-json-panel > summary");
  await waitFor(page, "Boolean(document.querySelector('.export-textarea')?.value)");
  const userDataExport = await evaluate(
    page,
    `(() => {
      const value = document.querySelector('.export-textarea')?.value || '';
      const parsed = JSON.parse(value);
      return {
        text: value,
        kind: parsed.kind,
        hasTags: Boolean(parsed.stores?.tags),
        hasWorkspace: Boolean(parsed.stores?.workspace),
        tagJobTypes: (parsed.stores?.tags?.job_events || []).map((event) => event.type),
        workspaceJobTypes: (parsed.stores?.workspace?.job_events || []).map((event) => event.type),
        summaryText: document.querySelector('#detailContent')?.textContent || ''
      };
    })()`,
  );
  assert(userDataExport.kind === "bibleapp:user-data", "user-data export has wrong kind");
  assert(userDataExport.hasTags && userDataExport.hasWorkspace, "user-data export missing local stores");
  assert(
    userDataExport.summaryText.includes("Custom labels") && userDataExport.summaryText.includes("My study data"),
    "user-data summary missing expected counts",
  );
  assert(userDataExport.tagJobTypes.includes("tag-index-refresh"), "tag change did not queue tag-index-refresh job");
  await evaluate(page, "document.querySelector('.advanced-diagnostics').open = false");
  await click(page, ".paste-json-panel > summary");
  await evaluate(
    page,
    `(() => {
      const textarea = document.querySelector('.import-textarea');
      textarea.value = '{';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`,
  );
  await clickButtonByText(page, "Merge backup");
  await waitFor(page, "document.querySelector('.import-status')?.textContent.includes('not valid JSON')");
  await evaluate(
    page,
    `(() => {
      const textarea = document.querySelector('.import-textarea');
      textarea.value = ${JSON.stringify(userDataExport.text)};
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`,
  );
  await clickButtonByText(page, "Merge backup");
  await waitFor(page, "document.querySelector('.import-status')?.textContent.includes('Backup merged')");
  const beforeReplaceEscape = await evaluate(page, userDataInvariantExpression());
  await clickButtonByText(page, "Replace all local data");
  await waitFor(page, "!document.querySelector('.replace-confirmation')?.hidden");
  assert(
    await evaluate(page, "document.activeElement?.textContent.trim() === 'Cancel'"),
    "Replace confirmation must move focus to Cancel",
  );
  await page.press(".replace-confirmation .mini-button:not(.danger-button)", "Shift+Tab");
  assert(
    await evaluate(page, "document.activeElement === document.querySelector('.replace-confirmation .danger-button')"),
    "Shift+Tab must wrap focus from Cancel to the final Replace action",
  );
  await page.press(".replace-confirmation .danger-button", "Tab");
  assert(
    await evaluate(page, "document.activeElement?.textContent.trim() === 'Cancel'"),
    "Tab must wrap focus from the final Replace action to Cancel",
  );
  await page.press(".replace-confirmation .mini-button:not(.danger-button)", "Escape");
  await waitFor(page, "document.querySelector('.replace-confirmation')?.hidden");
  assert(
    await evaluate(page, "document.activeElement?.textContent.trim() === 'Replace all local data'"),
    "Escape must restore focus to the replace trigger",
  );
  const afterReplaceEscape = await evaluate(page, userDataInvariantExpression());
  assert(
    JSON.stringify(afterReplaceEscape) === JSON.stringify(beforeReplaceEscape),
    `Escape must leave My Data, route, panel, history, reader context, stores, and recovery backups unchanged: ${JSON.stringify({ beforeReplaceEscape, afterReplaceEscape })}`,
  );
  await page.press(".import-actions .danger-button", "Escape");
  if (qaDevice === "mobile") {
    await waitFor(page, "!document.querySelector('.detail-pane')?.classList.contains('visible')");
  } else {
    await waitFor(page, "document.querySelector('#detailTitle')?.textContent === 'Details'");
  }
  pass("Replace confirmation isolates real keyboard Escape and preserves Tab trapping");
  pass("ordinary Escape retains normal application behavior after confirmation closes");

  await click(page, "#showMyData");
  await waitFor(page, "document.querySelector('#detailTitle')?.textContent === 'My Data'");
  await click(page, ".manual-json-panel > summary");
  await click(page, ".paste-json-panel > summary");
  await evaluate(
    page,
    `(() => {
      const textarea = document.querySelector('.import-textarea');
      textarea.value = ${JSON.stringify(userDataExport.text)};
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`,
  );
  const beforeReplaceCancel = await evaluate(page, userDataInvariantExpression());
  await clickButtonByText(page, "Replace all local data");
  await clickButtonByText(page, "Cancel", { scope: ".replace-confirmation" });
  await waitFor(page, "document.querySelector('.replace-confirmation')?.hidden");
  assert(
    await evaluate(page, "document.activeElement?.textContent.trim() === 'Replace all local data'"),
    "Cancel must restore focus to the replace trigger",
  );
  const afterReplaceCancel = await evaluate(page, userDataInvariantExpression());
  assert(
    JSON.stringify(afterReplaceCancel) === JSON.stringify(beforeReplaceCancel),
    "Cancel must leave route, history, stores, and recovery backups unchanged",
  );
  pass("Replace confirmation Cancel behavior remains unchanged");

  await evaluate(
    page,
    `(() => {
      window.__importSideEffects = { localStorageWrites: 0, indexedDbWrites: 0, publications: 0 };
      const storageSetItem = Storage.prototype.setItem;
      const indexedDbPut = IDBObjectStore.prototype.put;
      const broadcastPostMessage = window.BroadcastChannel?.prototype.postMessage;
      Storage.prototype.setItem = function(...args) {
        window.__importSideEffects.localStorageWrites += 1;
        return storageSetItem.apply(this, args);
      };
      IDBObjectStore.prototype.put = function(...args) {
        window.__importSideEffects.indexedDbWrites += 1;
        return indexedDbPut.apply(this, args);
      };
      if (broadcastPostMessage) {
        BroadcastChannel.prototype.postMessage = function(...args) {
          window.__importSideEffects.publications += 1;
          return broadcastPostMessage.apply(this, args);
        };
      }
      window.__restoreImportSideEffectHooks = () => {
        Storage.prototype.setItem = storageSetItem;
        IDBObjectStore.prototype.put = indexedDbPut;
        if (broadcastPostMessage) BroadcastChannel.prototype.postMessage = broadcastPostMessage;
      };
      return true;
    })()`,
  );
  const beforeMalformedImports = await evaluate(page, userDataInvariantExpression());
  await evaluate(
    page,
    `(() => {
      const textarea = document.querySelector('.import-textarea');
      textarea.value = JSON.stringify({ kind: 'bibleapp:user-data', version: 3 });
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`,
  );
  await clickButtonByText(page, "Merge backup");
  await waitFor(page, "document.querySelector('.import-status')?.textContent.includes('Backup structure is invalid')");
  await evaluate(
    page,
    `(() => {
      const textarea = document.querySelector('.import-textarea');
      textarea.value = JSON.stringify({ kind: 'bibleapp:user-data', version: 3, stores: { workspace: [] } });
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`,
  );
  await clickButtonByText(page, "Replace all local data");
  await click(page, ".replace-confirmation .danger-button");
  await waitFor(page, "document.querySelector('.import-status')?.textContent.includes('workspace must be an object')");
  const afterMalformedImports = await evaluate(page, userDataInvariantExpression());
  const malformedSideEffects = await evaluate(
    page,
    `(() => {
      const result = { ...window.__importSideEffects };
      window.__restoreImportSideEffectHooks?.();
      return result;
    })()`,
  );
  assert(
    JSON.stringify(afterMalformedImports) === JSON.stringify(beforeMalformedImports),
    `Malformed merge and replace must leave route, history, stores, and recovery backups unchanged: ${JSON.stringify({ beforeMalformedImports, afterMalformedImports })}`,
  );
  assert(
    malformedSideEffects.localStorageWrites === 0 && malformedSideEffects.indexedDbWrites === 0 && malformedSideEffects.publications === 0,
    `Malformed imports must not write storage or publish changes: ${JSON.stringify(malformedSideEffects)}`,
  );
  pass("malformed merge and replace backups are atomic before persistence or publication");

  await evaluate(
    page,
    `(() => {
      const textarea = document.querySelector('.import-textarea');
      textarea.value = JSON.stringify({ kind: 'bibleapp:user-data', version: 3, stores: { workspace: {} } });
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`,
  );
  await clickButtonByText(page, "Merge backup");
  await waitFor(page, "document.querySelector('.import-status')?.textContent.includes('Backup merged')");
  pass("sparse legacy version-3 workspace backup remains compatible");

  await evaluate(
    page,
    `(() => {
      const textarea = document.querySelector('.import-textarea');
      textarea.value = ${JSON.stringify(userDataExport.text)};
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`,
  );
  await clickButtonByText(page, "Replace all local data");
  await click(page, ".replace-confirmation .danger-button");
  await waitFor(page, "document.querySelector('.import-status')?.textContent.includes('Recovery backup created')");
  pass("versioned backup merge, replace confirmation, and recovery backup");

  await click(page, "#homeButton");
  await waitFor(page, "document.querySelector('#chapterTitle')?.textContent === 'Bible App Home'");
  assert(
    await evaluate(
      page,
      `(() => {
        const labels = [...document.querySelectorAll('.home-action')].map((button) => button.textContent.trim());
        return labels.filter((label) => label === 'My Data').length === 1 && !labels.includes('Jobs') && !labels.includes('Data');
      })()`,
    ),
    "Home must expose one My Data action without Jobs or Data duplicates",
  );
  await clickButtonByText(page, "My Data", { scope: ".home-action-grid" });
  await waitFor(page, "document.querySelector('#detailTitle')?.textContent === 'My Data'");
  pass("home My Data action");

  await click(page, "#showSearch");
  await waitFor(page, "document.querySelector('#detailTitle')?.textContent === 'Search'");
  await evaluate(
    page,
    `(() => {
      const input = document.querySelector('.search-form input[name="query"]');
      input.value = 'wisdom';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`,
  );
  await click(page, ".search-form button[type='submit']");
  await waitFor(page, "document.querySelector('.search-result')?.textContent.includes('Proverbs 1:2')", 15000);
  state = await getQaState(page);
  assert(state.detailText.includes("wisdom"), "search results did not include expected query text");
  await click(page, "#detailContent .search-result .link-button");
  await waitFor(page, "location.hash.includes('/proverbs/1/2')");
  pass("book search and result navigation");

  await page.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      Object.defineProperty(window, "indexedDB", {
        configurable: true,
        value: { open() { return {}; } }
      });
    `,
  });
  await navigate(page, `${routeBase}?qa-storage-timeout=1#/read/bsb/john/4`);
  await waitFor(page, "document.querySelector('#chapterTitle')?.textContent.includes('John 4')");
  state = await getQaState(page);
  assert(state.status.includes("BSB"), "reader did not recover from a stalled IndexedDB open");
  pass("IndexedDB timeout fallback");

  state = await getQaState(page);
  assert(state.consoleErrors.length === 0, `page errors found: ${state.consoleErrors.join("; ")}`);
  return checks;
}

let browser;
let localServer;
let runError = null;
try {
  if (!baseUrl) {
    localServer = await startAppServer();
    baseUrl = localServer.url;
  }
  browser = await launchBrowser();
  const checks = await runQa(browser.page);
  console.log(
    JSON.stringify(
      {
        baseUrl,
        device: qaDevice,
        checks,
        checkCount: checks.length,
      },
      null,
      2,
    ),
  );
} catch (error) {
  runError = error;
} finally {
  if (browser?.page) await browser.page.close();
  if (browser?.browser) await browser.browser.close();
  if (localServer?.server) {
    await new Promise((resolveClose) => localServer.server.close(resolveClose));
  }
  if (runError) throw runError;
}
