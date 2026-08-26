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
const qaEvidence = {};

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
  const browserHealth = {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    errorResponses: [],
  };
  playwrightPage.on("console", (message) => {
    if (message.type() === "error") browserHealth.consoleErrors.push(message.text());
  });
  playwrightPage.on("pageerror", (error) => browserHealth.pageErrors.push(error?.message || String(error)));
  playwrightPage.on("requestfailed", (request) => {
    browserHealth.failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText || "failed"}`);
  });
  playwrightPage.on("response", (response) => {
    if (response.status() < 400) return;
    const url = new URL(response.url());
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      browserHealth.errorResponses.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });
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
    async clickPointer(selector) {
      await playwrightPage.locator(selector).click();
    },
    async movePointer(x, y) {
      await playwrightPage.mouse.move(x, y);
    },
    async emulateMedia(options) {
      await playwrightPage.emulateMedia(options);
    },
    async delayNextRequest(urlPattern, delayMs) {
      await playwrightPage.route(
        urlPattern,
        async (route) => {
          await delay(delayMs);
          await route.continue();
        },
        { times: 1 },
      );
    },
    async setViewportSize(viewport) {
      await playwrightPage.setViewportSize(viewport);
    },
    async browserHealth() {
      return structuredClone(browserHealth);
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

async function waitForStableReaderGeometry(
  page,
  { label = "Reader geometry", timeoutMs = 5000, threshold = 0.25, stableSamples = 3 } = {},
) {
  return evaluate(
    page,
    `(async () => {
      const label = ${JSON.stringify(label)};
      const timeoutMs = ${JSON.stringify(timeoutMs)};
      const threshold = ${JSON.stringify(threshold)};
      const requiredStableSamples = ${JSON.stringify(stableSamples)};
      const numericKeys = [
        'chapterContentTop',
        'chapterAreaBottom',
        'chapterAreaHeight',
        'readerPaneWidth',
        'viewportWidth',
        'viewportHeight'
      ];
      const readGeometry = () => {
        const chapterContent = document.querySelector('#chapterContent')?.getBoundingClientRect();
        const chapterArea = document.querySelector('.chapter-title')?.getBoundingClientRect();
        const readerPane = document.querySelector('.reader-pane')?.getBoundingClientRect();
        return {
          chapterContentTop: chapterContent?.top ?? null,
          chapterAreaBottom: chapterArea?.bottom ?? null,
          chapterAreaHeight: chapterArea?.height ?? null,
          readerPaneWidth: readerPane?.width ?? null,
          viewportWidth: innerWidth,
          viewportHeight: innerHeight,
          workspaceMode: document.documentElement.dataset.studyWorkspaceWidth || ''
        };
      };
      const isFiniteGeometry = (sample) =>
        numericKeys.every((key) => Number.isFinite(sample[key])) && Boolean(sample.workspaceMode);
      const samplesMatch = (previous, current) =>
        previous.workspaceMode === current.workspaceMode &&
        numericKeys.every((key) => Math.abs(current[key] - previous[key]) <= threshold);
      const startedAt = performance.now();
      const recentSamples = [];
      let previous = null;
      let consecutiveStableSamples = 0;
      let sampleCount = 0;

      while (performance.now() - startedAt <= timeoutMs) {
        await new Promise(requestAnimationFrame);
        const current = readGeometry();
        sampleCount += 1;
        recentSamples.push(current);
        if (recentSamples.length > 12) recentSamples.shift();

        if (!isFiniteGeometry(current)) {
          consecutiveStableSamples = 0;
        } else if (previous && isFiniteGeometry(previous) && samplesMatch(previous, current)) {
          consecutiveStableSamples += 1;
        } else {
          consecutiveStableSamples = 1;
        }

        if (consecutiveStableSamples >= requiredStableSamples) {
          return {
            ...current,
            sampleCount,
            consecutiveStableSamples,
            threshold,
            elapsedMs: performance.now() - startedAt
          };
        }
        previous = current;
      }

      throw new Error(
        'Timed out waiting for stable ' + label + ': ' + JSON.stringify({
          timeoutMs,
          threshold,
          requiredStableSamples,
          sampleCount,
          recentSamples
        })
      );
    })()`,
  );
}

async function waitForStablePickerContext(
  page,
  { label = "picker context", timeoutMs = 5000, stableSamples = 3 } = {},
) {
  return evaluate(
    page,
    `(async () => {
      const label = ${JSON.stringify(label)};
      const timeoutMs = ${JSON.stringify(timeoutMs)};
      const requiredStableSamples = ${JSON.stringify(stableSamples)};
      const readContext = () => {
        const context = window.__readerTopPickerContext?.() || '';
        let parsed = null;
        try {
          parsed = JSON.parse(context);
        } catch {
          parsed = null;
        }
        return {
          context,
          parsed,
          viewport: { width: innerWidth, height: innerHeight },
          workspaceMode: document.documentElement.dataset.studyWorkspaceWidth || ''
        };
      };
      const isValidContext = (sample) => {
        const value = sample.parsed;
        return Boolean(
          sample.context && sample.workspaceMode && value &&
          typeof value.route === 'string' &&
          Array.isArray(value.values) && value.values.length === 3 &&
          Number.isFinite(value.pageScroll) &&
          Number.isFinite(value.chapterScroll) &&
          Number.isFinite(value.detailScroll) &&
          typeof value.detailTitle === 'string' &&
          typeof value.backDisabled === 'boolean' &&
          typeof value.forwardDisabled === 'boolean' &&
          Array.isArray(value.context)
        );
      };
      const startedAt = performance.now();
      const recentSamples = [];
      let previous = null;
      let consecutiveStableSamples = 0;
      let sampleCount = 0;

      while (performance.now() - startedAt <= timeoutMs) {
        await new Promise(requestAnimationFrame);
        const current = readContext();
        sampleCount += 1;
        recentSamples.push(current);
        if (recentSamples.length > 12) recentSamples.shift();

        if (!isValidContext(current)) {
          consecutiveStableSamples = 0;
        } else if (previous && isValidContext(previous) && previous.context === current.context) {
          consecutiveStableSamples += 1;
        } else {
          consecutiveStableSamples = 1;
        }

        if (consecutiveStableSamples >= requiredStableSamples) {
          return {
            ...current,
            sampleCount,
            consecutiveStableSamples,
            elapsedMs: performance.now() - startedAt,
            recentSamples
          };
        }
        previous = current;
      }

      throw new Error(
        'Timed out waiting for stable ' + label + ': ' + JSON.stringify({
          timeoutMs,
          requiredStableSamples,
          sampleCount,
          recentSamples
        })
      );
    })()`,
  );
}

function pickerContextDifferences(expected, actual) {
  const expectedContext = JSON.parse(expected);
  const actualContext = JSON.parse(actual);
  const fields = [
    "route",
    "values",
    "pageScroll",
    "chapterScroll",
    "detailScroll",
    "detailTitle",
    "backDisabled",
    "forwardDisabled",
    "context",
  ];
  return Object.fromEntries(
    fields
      .filter((field) => JSON.stringify(expectedContext[field]) !== JSON.stringify(actualContext[field]))
      .map((field) => [field, { expected: expectedContext[field], actual: actualContext[field] }]),
  );
}

async function studyMarksFocusDiagnostics(page, triggerSelector) {
  return evaluate(
    page,
    `(() => {
      const trigger = document.querySelector(${JSON.stringify(triggerSelector)});
      const menu = trigger?.closest('.target-tag-picker-menu');
      const style = trigger ? getComputedStyle(trigger) : null;
      const rect = trigger?.getBoundingClientRect();
      const identify = (node) => node ? {
        tag: node.tagName?.toLowerCase() || '',
        id: node.id || '',
        classes: typeof node.className === 'string' ? node.className : '',
      } : null;
      return {
        trigger: {
          present: Boolean(trigger),
          isConnected: trigger?.isConnected ?? false,
          disabled: trigger?.disabled ?? null,
          tabIndex: trigger?.tabIndex ?? null,
          display: style?.display || '',
          visibility: style?.visibility || '',
          opacity: style?.opacity || '',
          width: rect?.width || 0,
          height: rect?.height || 0,
          ariaExpanded: trigger?.getAttribute('aria-expanded') ?? null,
        },
        activeElement: identify(document.activeElement),
        menu: {
          identity: identify(menu),
          isConnected: menu?.isConnected ?? false,
          menuOpen: menu?.dataset.menuOpen ?? null,
          restoringFocus: menu?.dataset.restoringFocus ?? null,
        },
        staleMenuConnected: window.__staleReaderTagMenu?.isConnected ?? null,
        openMenus: [...document.querySelectorAll('.target-tag-picker-menu[data-menu-open="true"]')].map(identify),
        route: location.href,
        theme: document.documentElement.getAttribute('data-theme'),
        detailTitle: document.querySelector('#detailTitle')?.textContent.trim() || '',
        consoleErrors: window.__qaErrors || [],
      };
    })()`,
  );
}

async function waitForStudyMarksMenuOpen(page, triggerSelector, timeoutMs = 10000) {
  try {
    return await waitFor(
      page,
      `document.querySelector(${JSON.stringify(triggerSelector)})?.closest('.target-tag-picker-menu')?.dataset.menuOpen === 'true'`,
      timeoutMs,
    );
  } catch (error) {
    let diagnostics;
    try {
      diagnostics = await studyMarksFocusDiagnostics(page, triggerSelector);
    } catch (diagnosticError) {
      diagnostics = { captureError: diagnosticError?.message || String(diagnosticError) };
    }
    throw new Error(`${error.message}; Study Marks focus diagnostics: ${JSON.stringify(diagnostics)}`, { cause: error });
  }
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
  const readerTopContract = await evaluate(
    page,
    `(() => {
      const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect();
      const visibleSelects = [...document.querySelectorAll('.reader-controls select')]
        .filter((node) => {
          const style = getComputedStyle(node);
          const bounds = node.getBoundingClientRect();
          return !node.hidden && style.display !== 'none' && bounds.width > 0 && bounds.height > 0;
        })
        .map((node) => node.id);
      const targetSelectors = [
        '#homeButton', '#themeToggle', '#translationSelect', '#bookPickerButton', '#chapterPickerButton',
        '#prevChapter', '#nextChapter', '#showSearch', '#openStudyPanel', '#showInterlinear',
        '#showOutline', '#showTags', '#showMyData'
      ];
      const targets = Object.fromEntries(targetSelectors.map((selector) => {
        const bounds = rect(selector);
        return [selector, bounds ? { width: bounds.width, height: bounds.height, top: bounds.top } : null];
      }));
      const header = rect('.app-header');
      const firstScripture = document.querySelector('#chapterContent')?.firstElementChild?.getBoundingClientRect();
      const navTops = ['#translationSelect', '#bookPickerButton', '#chapterPickerButton']
        .map((selector) => rect(selector)?.top)
        .filter((value) => Number.isFinite(value));
      return {
        header: header ? { top: header.top, height: header.height } : null,
        firstScriptureTop: firstScripture?.top ?? null,
        visibleSelects,
        hiddenBookSelect: document.querySelector('#bookSelect')?.hidden === true &&
          document.querySelector('#bookSelect')?.getAttribute('aria-hidden') === 'true' &&
          document.querySelector('#bookSelect')?.tabIndex === -1,
        hiddenChapterSelect: document.querySelector('#chapterSelect')?.hidden === true &&
          document.querySelector('#chapterSelect')?.getAttribute('aria-hidden') === 'true' &&
          document.querySelector('#chapterSelect')?.tabIndex === -1,
        bookName: document.querySelector('#bookPickerButton')?.getAttribute('aria-label') || '',
        chapterName: document.querySelector('#chapterPickerButton')?.getAttribute('aria-label') || '',
        liveStatusCount: document.querySelectorAll('#statusText[role="status"][aria-live]').length,
        compactStatus: {
          text: document.querySelector('#compactStatusText')?.textContent.trim() || '',
          hidden: Boolean(document.querySelector('#compactStatusText')?.hidden),
          ariaHidden: document.querySelector('#compactStatusText')?.getAttribute('aria-hidden')
        },
        navTopSpread: navTops.length ? Math.max(...navTops) - Math.min(...navTops) : null,
        targets,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth
      };
    })()`,
  );
  assert(
    JSON.stringify(readerTopContract.visibleSelects) === JSON.stringify(["translationSelect"]) &&
      readerTopContract.hiddenBookSelect &&
      readerTopContract.hiddenChapterSelect,
    `only Translation may remain an exposed native selector: ${JSON.stringify(readerTopContract)}`,
  );
  assert(
    readerTopContract.bookName === "Book: Psalms" && readerTopContract.chapterName === "Chapter: 23",
    `visible picker names must include purpose and value: ${JSON.stringify(readerTopContract)}`,
  );
  assert(
    readerTopContract.liveStatusCount === 1 &&
      readerTopContract.compactStatus.text === "Loaded" &&
      !readerTopContract.compactStatus.hidden &&
      readerTopContract.compactStatus.ariaHidden === "true",
    `loaded state must keep one live region and one non-live compact mirror: ${JSON.stringify(readerTopContract)}`,
  );
  if (qaDevice === "mobile") {
    const undersizedTargets = Object.entries(readerTopContract.targets)
      .filter(([, bounds]) => !bounds || bounds.height < 43.5)
      .map(([selector]) => selector);
    assert(readerTopContract.header?.height <= 150, `mobile app header is too tall: ${JSON.stringify(readerTopContract)}`);
    assert(readerTopContract.firstScriptureTop <= 400.5, `mobile scripture begins too low: ${JSON.stringify(readerTopContract)}`);
    assert(readerTopContract.navTopSpread <= 1, `mobile reader navigation is not one aligned row: ${JSON.stringify(readerTopContract)}`);
    assert(
      undersizedTargets.length === 0,
      `mobile reader controls must retain 44px targets: ${JSON.stringify({ undersizedTargets, targets: readerTopContract.targets })}`,
    );
    assert(readerTopContract.scrollWidth <= readerTopContract.clientWidth + 1, "mobile top area has horizontal overflow");
  }

  const measureChapterIntro = () => evaluate(
    page,
    `(() => {
      const rect = (selector) => {
        const bounds = document.querySelector(selector)?.getBoundingClientRect();
        return bounds ? { top: bounds.top, bottom: bounds.bottom, width: bounds.width, height: bounds.height } : null;
      };
      const isVisible = (node) => {
        if (!node) return false;
        const bounds = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return bounds.width > 0 && bounds.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const toolSelectors = [
        '#showSearch', '#openStudyPanel', '#showInterlinear', '#showOutline', '#showTags', '#showMyData'
      ];
      const targetSelectors = [
        '#favoriteBook', '#favoriteChapter', '#prevChapter', '#nextChapter', ...toolSelectors
      ];
      const targets = Object.fromEntries(targetSelectors.map((selector) => [selector, rect(selector)]));
      const visibleTools = toolSelectors.map((selector) => document.querySelector(selector)).filter(isVisible);
      const rowTops = [];
      for (const node of visibleTools) {
        const top = node.getBoundingClientRect().top;
        if (!rowTops.some((value) => Math.abs(value - top) <= 1)) rowTops.push(top);
      }
      const rowCounts = rowTops.map((top) => visibleTools.filter(
        (node) => Math.abs(node.getBoundingClientRect().top - top) <= 1
      ).length);
      const labels = visibleTools.map((node) => {
        const label = node.querySelector('span:not(.toolbar-icon)');
        return {
          id: node.id,
          text: label?.textContent.trim() || '',
          visible: isVisible(label) && label.getBoundingClientRect().width > 1,
          clipped: node.scrollWidth > node.clientWidth + 1,
        };
      });
      const presentation = [...document.querySelectorAll('#chapterContent > .presentation-block')].map((node) => ({
        className: node.className,
        text: node.firstChild?.textContent?.trim() || '',
        crossReferences: node.querySelectorAll('.cross-links .reference-hover').length,
      }));
      const chapter = rect('.chapter-title');
      const content = rect('#chapterContent');
      const firstContent = rect('#chapterContent > :first-child');
      const firstVerse = rect('#chapterContent .verse-row');
      return {
        viewport: { width: innerWidth, height: innerHeight },
        workspaceMode: document.documentElement.dataset.studyWorkspaceWidth,
        readerWidth: rect('.reader-pane')?.width || 0,
        headerHeight: rect('.app-header')?.height || 0,
        chapterHeight: chapter?.height || 0,
        titleHeight: rect('.chapter-heading-title')?.height || 0,
        navigationHeight: rect('.chapter-stepper')?.height || 0,
        actionHeight: rect('.chapter-actions')?.height || 0,
        actionRows: rowTops.length,
        actionRowCounts: rowCounts,
        scriptureTop: content?.top ?? null,
        firstContentTop: firstContent?.top ?? null,
        firstVerseTop: firstVerse?.top ?? null,
        targets,
        labels,
        presentation,
        redLetterCount: document.querySelectorAll('#chapterContent .red-letter, #chapterContent .verse-line.red, #chapterContent .verse-line.red_letter').length,
        chapterPosition: getComputedStyle(document.querySelector('.chapter-title')).position,
        horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      };
    })()`,
  );

  const measureReaderTargets = () => evaluate(
    page,
    `(() => {
      const round = (value) => Math.round(value * 1000) / 1000;
      const rect = (node) => {
        if (!node) return null;
        const bounds = node.getBoundingClientRect();
        return { left: round(bounds.left), right: round(bounds.right), top: round(bounds.top), bottom: round(bounds.bottom), width: round(bounds.width), height: round(bounds.height) };
      };
      const pseudoRect = (node, pseudo) => {
        if (!node) return null;
        const bounds = node.getBoundingClientRect();
        const style = getComputedStyle(node, pseudo);
        const width = Number.parseFloat(style.width);
        const height = Number.parseFloat(style.height);
        if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
        const left = bounds.left + (bounds.width - width) / 2;
        const top = bounds.top + (bounds.height - height) / 2;
        return { left: round(left), right: round(left + width), top: round(top), bottom: round(top + height), width: round(width), height: round(height) };
      };
      const ownsPoint = (node, x, y) => {
        const hit = document.elementFromPoint(x, y);
        return hit === node || node?.contains?.(hit) || hit?.closest?.('.fn-marker, .reference-hover') === node;
      };
      const hitMap = (node, bounds) => {
        if (!node || !bounds) return [];
        const inset = 2;
        const xs = [bounds.left + inset, bounds.left + bounds.width / 2, bounds.right - inset];
        const ys = [bounds.top + inset, bounds.top + bounds.height / 2, bounds.bottom - inset];
        return ys.flatMap((y) => xs.map((x) => ({ x: round(x), y: round(y), owned: ownsPoint(node, x, y) })));
      };
      const precedingWordOwnership = (marker) => {
        const sibling = marker?.previousSibling;
        if (!sibling) return null;
        let bounds = null;
        if (sibling.nodeType === Node.TEXT_NODE && sibling.data) {
          const match = sibling.data.match(/\\S+\\s*$/u);
          if (match) {
            const range = document.createRange();
            const start = Math.max(0, sibling.data.length - match[0].length);
            range.setStart(sibling, start);
            range.setEnd(sibling, sibling.data.length);
            bounds = range.getBoundingClientRect();
          }
        } else if (sibling.nodeType === Node.ELEMENT_NODE) {
          bounds = sibling.getBoundingClientRect();
        }
        if (!bounds || !bounds.width || !bounds.height) return null;
        const x = bounds.left + bounds.width * 0.35;
        const y = bounds.top + bounds.height / 2;
        return { x: round(x), y: round(y), capturedByMarker: ownsPoint(marker, x, y) };
      };
      const focusState = (node, pseudo = null) => {
        if (!node) return null;
        const previous = document.activeElement;
        node.focus({ preventScroll: true });
        const style = getComputedStyle(node, pseudo);
        const result = { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineColor: style.outlineColor, outlineOffset: style.outlineOffset };
        node.blur();
        if (previous instanceof HTMLElement && previous !== document.body) previous.focus({ preventScroll: true });
        return result;
      };
      const footnote = document.querySelector('.fn-marker');
      const reference = document.querySelector('.presentation-block .cross-links .reference-hover');
      const numbers = [...document.querySelectorAll('.verse-number')];
      const numberSamples = {};
      for (const digits of [1, 2, 3]) {
        const number = numbers.find((node) => node.textContent.trim().length === digits);
        numberSamples[digits] = number ? { text: number.textContent.trim(), rect: rect(number) } : null;
      }
      const previousArrow = document.querySelector('#prevChapterFloat');
      const nextArrow = document.querySelector('#nextChapterFloat');
      const verseBodies = [...document.querySelectorAll('.verse-body')];
      const bodyLeft = verseBodies.length ? Math.min(...verseBodies.map((node) => node.getBoundingClientRect().left)) : null;
      const bodyRight = verseBodies.length ? Math.max(...verseBodies.map((node) => node.getBoundingClientRect().right)) : null;
      const previousRect = previousArrow?.getBoundingClientRect();
      const nextRect = nextArrow?.getBoundingClientRect();
      const footnoteTarget = pseudoRect(footnote, '::before');
      const referenceTarget = pseudoRect(reference, '::before');
      const firstVerse = document.querySelector('.verse-row')?.getBoundingClientRect();
      return {
        viewport: { width: innerWidth, height: innerHeight, coarse: matchMedia('(pointer: coarse)').matches, hoverNone: matchMedia('(hover: none)').matches, touchPoints: navigator.maxTouchPoints },
        chapter: document.querySelector('#chapterTitle')?.textContent.trim() || '',
        firstVerseTop: firstVerse ? round(firstVerse.top) : null,
        footnote: footnote ? { visual: rect(footnote), target: footnoteTarget, hitMap: hitMap(footnote, footnoteTarget), precedingWord: precedingWordOwnership(footnote), focus: focusState(footnote, '::before') } : null,
        numberSamples,
        numberFocus: focusState(numbers[0]),
        reference: reference ? { visual: rect(reference), target: referenceTarget, hitMap: hitMap(reference, referenceTarget), focus: focusState(reference, '::before') } : null,
        arrows: {
          previous: rect(previousArrow),
          next: rect(nextArrow),
          previousIntrusion: previousRect && bodyLeft !== null ? round(Math.max(0, previousRect.right - bodyLeft)) : null,
          nextIntrusion: nextRect && bodyRight !== null ? round(Math.max(0, bodyRight - nextRect.left)) : null,
          previousHitMap: hitMap(previousArrow, rect(previousArrow)),
          nextHitMap: hitMap(nextArrow, rect(nextArrow)),
          previousFocus: focusState(previousArrow, '::before'),
          nextFocus: focusState(nextArrow, '::before'),
        },
        verseGridColumns: getComputedStyle(document.querySelector('.verse-row')).gridTemplateColumns,
        chapterContentScrollHeight: document.querySelector('#chapterContent')?.scrollHeight || 0,
        documentScrollHeight: document.documentElement.scrollHeight,
        horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
        footnoteCount: document.querySelectorAll('.fn-marker').length,
        verseCount: numbers.length,
      };
    })()`,
  );

  const assertReaderTargets = (measurement, label) => {
    const touch = measurement.viewport.coarse || measurement.viewport.hoverNone || measurement.viewport.touchPoints > 0;
    const footnoteMinimum = touch ? 43.5 : 27.5;
    const numberWidthMinimum = touch ? 39.5 : 31.5;
    const numberHeightMinimum = touch ? 43.5 : 35.5;
    const referenceHeightMinimum = touch ? 43.5 : 35.5;
    assert(
      measurement.footnote?.target.width >= footnoteMinimum && measurement.footnote?.target.height >= footnoteMinimum &&
        measurement.footnote.hitMap.every((sample) => sample.owned) && measurement.footnote.precedingWord?.capturedByMarker === false,
      `${label} footnote target or adjacent-word ownership failed: ${JSON.stringify(measurement.footnote)}`,
    );
    const visibleNumberSamples = Object.values(measurement.numberSamples).filter(Boolean);
    assert(
      visibleNumberSamples.length > 0 && visibleNumberSamples.every((sample) => sample.rect.width >= numberWidthMinimum && sample.rect.height >= numberHeightMinimum),
      `${label} verse-number target dimensions failed: ${JSON.stringify(measurement.numberSamples)}`,
    );
    assert(
      measurement.reference?.target.height >= referenceHeightMinimum && measurement.reference.hitMap.every((sample) => sample.owned),
      `${label} cross-reference target failed: ${JSON.stringify(measurement.reference)}`,
    );
    assert(
      measurement.arrows.previous.width >= 39.5 && measurement.arrows.next.width >= 39.5 &&
        measurement.arrows.previousIntrusion <= 0.5 && measurement.arrows.nextIntrusion <= 0.5 &&
        measurement.arrows.previousHitMap.every((sample) => sample.owned) && measurement.arrows.nextHitMap.every((sample) => sample.owned),
      `${label} floating chapter-arrow target or scripture intrusion failed: ${JSON.stringify(measurement.arrows)}`,
    );
    assert(
      measurement.footnote.focus.outlineStyle === 'solid' && measurement.numberFocus.outlineStyle === 'solid' &&
        measurement.reference.focus.outlineStyle === 'solid' && measurement.arrows.previousFocus.outlineStyle === 'solid' &&
        measurement.horizontalOverflow === 0,
      `${label} target focus visibility or containment failed: ${JSON.stringify(measurement)}`,
    );
    if (measurement.viewport.width <= 390) {
      assert(measurement.firstVerseTop <= 480.5, `${label} moved the first Psalm 23 verse too low: ${measurement.firstVerseTop}`);
    }
  };

  let chapterIntroContract = await measureChapterIntro();
  qaEvidence.chapterIntro = { initial: chapterIntroContract };
  const readerTargetProfiles = [];
  assert(
    chapterIntroContract.presentation.some((block) => block.className.includes('section_heading') && block.text === 'The LORD Is My Shepherd' && block.crossReferences === 2) &&
      chapterIntroContract.presentation.some((block) => block.className.includes('psalm_superscription') && block.text === 'A Psalm of David.') &&
      chapterIntroContract.chapterPosition === 'static' && chapterIntroContract.horizontalOverflow === 0,
    `Psalm 23 chapter presentation and non-sticky containment failed: ${JSON.stringify(chapterIntroContract)}`,
  );

  const expectedChapterFocusOrder = [
    'favoriteBook', 'favoriteChapter', 'prevChapter', 'nextChapter', 'showSearch',
    ...(qaDevice === 'mobile' ? ['openStudyPanel'] : []),
    'showInterlinear', 'showOutline', 'showTags', 'showMyData',
  ];
  await evaluate(page, "document.querySelector('#themeToggle').focus({ preventScroll: true })");
  const observedChapterFocusOrder = [];
  const chapterFocusVisibility = [];
  let previousFocusSelector = '#themeToggle';
  for (const expectedId of expectedChapterFocusOrder) {
    await page.press(previousFocusSelector, 'Tab');
    const focusState = await evaluate(
      page,
      `(() => {
        const node = document.activeElement;
        const style = getComputedStyle(node);
        return { id: node?.id || '', focusVisible: node?.matches(':focus-visible') || false, outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
      })()`,
    );
    observedChapterFocusOrder.push(focusState.id);
    chapterFocusVisibility.push(focusState);
    previousFocusSelector = `#${expectedId}`;
  }
  assert(
    JSON.stringify(observedChapterFocusOrder) === JSON.stringify(expectedChapterFocusOrder) &&
      chapterFocusVisibility.every((state) => state.focusVisible && state.outlineStyle !== 'none' && parseFloat(state.outlineWidth) >= 2),
    `Chapter keyboard order or visible focus failed: ${JSON.stringify({ expectedChapterFocusOrder, observedChapterFocusOrder, chapterFocusVisibility })}`,
  );

  const scopeMenuMarksBefore = await evaluate(page, `JSON.stringify({
    book: document.querySelector('#favoriteBook')?.getAttribute('aria-pressed'),
    chapter: document.querySelector('#favoriteChapter')?.getAttribute('aria-pressed')
  })`);
  await evaluate(page, "document.querySelector('#favoriteBook').focus({ preventScroll: true })");
  await delay(30);
  const closedScopeMenu = await evaluate(page, `(() => {
    const trigger = document.querySelector('#favoriteBook');
    const menu = trigger.closest('.target-tag-picker-menu');
    return {
      open: menu.dataset.menuOpen === 'true',
      display: getComputedStyle(menu.querySelector('.target-tag-picker-popover')).display,
      active: document.activeElement?.id || ''
    };
  })()`);
  await page.press('#favoriteBook', 'Tab');
  const closedScopeTabTarget = await evaluate(page, "document.activeElement?.id || ''");
  assert(
    !closedScopeMenu.open && closedScopeMenu.display === 'none' && closedScopeMenu.active === 'favoriteBook' && closedScopeTabTarget === 'favoriteChapter',
    `Closed Book menu must stay out of the top-level Tab sequence: ${JSON.stringify({ closedScopeMenu, closedScopeTabTarget })}`,
  );

  await page.clickPointer('#favoriteBook');
  await waitForStudyMarksMenuOpen(page, '#favoriteBook');
  const pointerScopeMenu = await evaluate(page, `({
    open: document.querySelector('#favoriteBook')?.closest('.target-tag-picker-menu')?.dataset.menuOpen === 'true',
    expanded: document.querySelector('#favoriteBook')?.getAttribute('aria-expanded')
  })`);
  await page.press('#favoriteBook', 'Escape');
  await waitFor(page, "document.querySelector('#favoriteBook')?.closest('.target-tag-picker-menu')?.dataset.menuOpen !== 'true'");
  await page.movePointer(1, 1);
  assert(pointerScopeMenu.open && pointerScopeMenu.expanded === 'true', `Pointer click must keep the Book menu open: ${JSON.stringify(pointerScopeMenu)}`);

  await evaluate(page, "document.querySelector('#favoriteBook').focus({ preventScroll: true })");
  await page.press('#favoriteBook', 'Enter');
  await waitForStudyMarksMenuOpen(page, '#favoriteBook');
  await page.press('#favoriteBook', 'Tab');
  const enterScopeMenu = await evaluate(page, `(() => {
    const menu = document.querySelector('#favoriteBook')?.closest('.target-tag-picker-menu');
    return { open: menu?.dataset.menuOpen === 'true', focusedInside: menu?.querySelector('.target-tag-picker-popover')?.contains(document.activeElement) || false };
  })()`);
  await page.press('.target-tag-picker-menu[data-menu-open="true"] .tag-picker-option[aria-label$="Favorite tag"]', 'Escape');
  await waitFor(page, "document.querySelector('#favoriteBook')?.closest('.target-tag-picker-menu')?.dataset.menuOpen !== 'true'");
  const enterEscapeFocus = await evaluate(page, "document.activeElement?.id || ''");

  await evaluate(page, "document.querySelector('#favoriteChapter').focus({ preventScroll: true })");
  await page.press('#favoriteChapter', ' ');
  await waitForStudyMarksMenuOpen(page, '#favoriteChapter');
  const spaceScopeMenu = await evaluate(page, "document.querySelector('#favoriteChapter')?.getAttribute('aria-expanded') === 'true'");
  await page.press('#favoriteChapter', 'Escape');
  await waitFor(page, "document.querySelector('#favoriteChapter')?.closest('.target-tag-picker-menu')?.dataset.menuOpen !== 'true'");
  const spaceEscapeFocus = await evaluate(page, "document.activeElement?.id || ''");

  let touchScopeMenu = null;
  if (qaDevice === 'mobile') {
    await page.tap('#favoriteChapter');
    await waitForStudyMarksMenuOpen(page, '#favoriteChapter');
    touchScopeMenu = await evaluate(page, `(() => {
      const menu = document.querySelector('#favoriteChapter')?.closest('.target-tag-picker-menu');
      const popover = menu?.querySelector('.target-tag-picker-popover');
      return {
        open: menu?.dataset.menuOpen === 'true',
        display: popover ? getComputedStyle(popover).display : '',
        focusableOptions: [...(popover?.querySelectorAll('button') || [])].filter((node) => node.tabIndex >= 0).length
      };
    })()`);
    await page.press('#favoriteChapter', 'Escape');
    await waitFor(page, "document.querySelector('#favoriteChapter')?.closest('.target-tag-picker-menu')?.dataset.menuOpen !== 'true'");
  }
  const scopeMenuMarksAfter = await evaluate(page, `JSON.stringify({
    book: document.querySelector('#favoriteBook')?.getAttribute('aria-pressed'),
    chapter: document.querySelector('#favoriteChapter')?.getAttribute('aria-pressed')
  })`);
  assert(
    enterScopeMenu.open && enterScopeMenu.focusedInside && enterEscapeFocus === 'favoriteBook' &&
      spaceScopeMenu && spaceEscapeFocus === 'favoriteChapter' &&
      (!touchScopeMenu || (touchScopeMenu.open && touchScopeMenu.display !== 'none' && touchScopeMenu.focusableOptions > 0)) &&
      scopeMenuMarksAfter === scopeMenuMarksBefore,
    `Book and Chapter menu activation, Tab, Escape, touch, or non-mutation failed: ${JSON.stringify({ enterScopeMenu, enterEscapeFocus, spaceScopeMenu, spaceEscapeFocus, touchScopeMenu, scopeMenuMarksBefore, scopeMenuMarksAfter })}`,
  );
  qaEvidence.chapterIntro.scopeMenuLifecycle = {
    closedScopeMenu, closedScopeTabTarget, pointerScopeMenu, enterScopeMenu, enterEscapeFocus,
    spaceScopeMenu, spaceEscapeFocus, touchScopeMenu, marksUnchanged: scopeMenuMarksAfter === scopeMenuMarksBefore,
  };
  pass('Book and Chapter menu pointer, keyboard, touch, and Escape lifecycle');

  if (qaDevice === "mobile") {
    const mobileReaderTargets = await measureReaderTargets();
    assertReaderTargets(mobileReaderTargets, "390x844 touch/mobile");
    readerTargetProfiles.push({ name: "390x844 touch/mobile", measurement: mobileReaderTargets });
    const requiredMobileTargets = Object.entries(chapterIntroContract.targets).filter(([, bounds]) => bounds);
    assert(
      requiredMobileTargets.every(([, bounds]) => bounds.width >= 43.5 && bounds.height >= 43.5) &&
        chapterIntroContract.chapterHeight <= 200.5 &&
        chapterIntroContract.actionHeight <= 92.5 &&
        chapterIntroContract.actionRows === 2 &&
        JSON.stringify(chapterIntroContract.actionRowCounts) === JSON.stringify([4, 2]) &&
        chapterIntroContract.firstVerseTop <= 480.5 &&
        chapterIntroContract.labels.every((label) => label.visible && !label.clipped),
      `Mobile chapter targets, 4+2 actions, geometry, or labels failed: ${JSON.stringify(chapterIntroContract)}`,
    );

    const chapterIntroRouteBase = baseUrl.split('#')[0];
    const representativeChapters = [];
    for (const fixture of [
      { hash: '#/read/bsb/genesis/1', title: 'Genesis 1', kind: 'prose' },
      { hash: '#/read/bsb/john/10', title: 'John 10', kind: 'gospel' },
    ]) {
      await navigate(page, `${chapterIntroRouteBase}${fixture.hash}`);
      await waitFor(page, `document.querySelector('#chapterTitle')?.textContent === ${JSON.stringify(fixture.title)}`);
      const measurement = await measureChapterIntro();
      representativeChapters.push({ ...fixture, measurement });
      assert(
        measurement.firstVerseTop > measurement.scriptureTop &&
          measurement.horizontalOverflow === 0 &&
          !measurement.presentation.some((block) => block.className.includes('psalm_superscription')),
        `Representative ${fixture.kind} chapter spacing failed: ${JSON.stringify(measurement)}`,
      );
      if (fixture.kind === 'gospel') {
        assert(
          measurement.presentation.some((block) => block.className.includes('section_heading')) && measurement.redLetterCount > 0,
          `Gospel presentation or red-letter rendering failed: ${JSON.stringify(measurement)}`,
        );
      }
    }
    qaEvidence.chapterIntro.representativeChapters = representativeChapters;
    await navigate(page, `${chapterIntroRouteBase}#/read/bsb/psalms/23`);
    await waitFor(page, "document.querySelector('#chapterTitle')?.textContent === 'Psalms 23'");
    pass("mobile chapter intro targets, spacing, and representative content");
  } else {
    const labelProfiles = [
      { name: '1440 standard', width: 1440, height: 900, mode: 'standard', labelsVisible: true },
      { name: '1440 expanded', width: 1440, height: 900, mode: 'expanded', labelsVisible: false },
      { name: '1280 standard', width: 1280, height: 720, mode: 'standard', labelsVisible: false },
      { name: '1200 compact', width: 1200, height: 900, mode: 'compact', labelsVisible: true },
      { name: '1200 standard', width: 1200, height: 900, mode: 'standard', labelsVisible: false },
      { name: '960 standard', width: 960, height: 1200, mode: 'standard', labelsVisible: true },
      { name: '960 expanded', width: 960, height: 1200, mode: 'expanded', labelsVisible: false },
      { name: '820 standard', width: 820, height: 900, mode: 'standard', labelsVisible: false },
      { name: '390 desktop', width: 390, height: 844, mode: 'standard', labelsVisible: true },
    ];
    const labelEvidence = [];
    for (const profile of labelProfiles) {
      await page.setViewportSize({ width: profile.width, height: profile.height });
      await evaluate(page, `document.documentElement.dataset.studyWorkspaceWidth = ${JSON.stringify(profile.mode)}`);
      const settledGeometry = await waitForStableReaderGeometry(page, { label: profile.name });
      const measurement = await measureChapterIntro();
      labelEvidence.push({ ...profile, settledGeometry, measurement });
      if (["1440 standard", "1280 standard", "960 standard", "820 standard", "390 desktop"].includes(profile.name)) {
        await delay(180);
        const readerTargets = await measureReaderTargets();
        assertReaderTargets(readerTargets, profile.name);
        readerTargetProfiles.push({ name: profile.name, measurement: readerTargets });
      }
      assert(
        measurement.labels.every((label) => label.visible === profile.labelsVisible && !label.clipped) &&
          measurement.actionRows === (profile.width <= 640 ? 2 : 1) &&
          measurement.horizontalOverflow === 0,
        `Reader-pane label threshold, action rows, or containment failed for ${profile.name}: ${JSON.stringify(measurement)}`,
      );
      if (profile.width <= 640) {
        assert(
          measurement.chapterHeight <= 200.5 && measurement.firstVerseTop <= 480.5 &&
            JSON.stringify(measurement.actionRowCounts) === JSON.stringify([4, 2]),
          `Desktop-width mobile chapter geometry failed: ${JSON.stringify(measurement)}`,
        );
      }
    }
    qaEvidence.chapterIntro.labelThreshold = labelEvidence;
    await page.setViewportSize({ width: 1280, height: 720 });
    await evaluate(page, "document.documentElement.dataset.studyWorkspaceWidth = 'standard'");
    qaEvidence.chapterIntro.toolContextResetGeometry = await waitForStableReaderGeometry(page, {
      label: '1280 standard tool-context reset',
    });
    pass("reader-pane action-label thresholds and mobile-width geometry");
  }

  const readerTargetRouteBase = baseUrl.split('#')[0];
  const readerTargetChapters = [];
  for (const fixture of [
    { hash: '#/read/bsb/romans/8', title: 'Romans 8', minimumFootnotes: 5 },
    { hash: '#/read/bsb/psalms/119', title: 'Psalms 119', numberDigits: [1, 2, 3] },
  ]) {
    await navigate(page, `${readerTargetRouteBase}${fixture.hash}`);
    await waitFor(page, `document.querySelector('#chapterTitle')?.textContent === ${JSON.stringify(fixture.title)}`);
    const measurement = await measureReaderTargets();
    if (fixture.minimumFootnotes) {
      assert(measurement.footnoteCount >= fixture.minimumFootnotes, `${fixture.title} no longer provides the several-footnote baseline: ${JSON.stringify(measurement)}`);
    }
    if (fixture.numberDigits) {
      assert(
        fixture.numberDigits.every((digits) => measurement.numberSamples[digits]),
        `${fixture.title} must retain one-, two-, and three-digit target evidence: ${JSON.stringify(measurement.numberSamples)}`,
      );
      const touch = measurement.viewport.coarse || measurement.viewport.hoverNone || measurement.viewport.touchPoints > 0;
      assert(
        Object.values(measurement.numberSamples).every((sample) => sample.rect.width >= (touch ? 39.5 : 31.5) && sample.rect.height >= (touch ? 43.5 : 35.5)),
        `${fixture.title} dense verse-number target dimensions failed: ${JSON.stringify(measurement.numberSamples)}`,
      );
    }
    readerTargetChapters.push({ ...fixture, measurement });
  }
  await navigate(page, `${readerTargetRouteBase}#/read/bsb/psalms/23`);
  await waitFor(page, "document.querySelector('#chapterTitle')?.textContent === 'Psalms 23'");
  qaEvidence.readerTargets = { profiles: readerTargetProfiles, chapters: readerTargetChapters };
  pass("inline reader target geometry, hit testing, dense chapter coverage, and floating-arrow gutters");

  const visibleChapterTools = [
    { selector: '#showSearch', accessibleName: 'Search this book', detailTitle: 'Search' },
    ...(qaDevice === 'mobile'
      ? [{ selector: '#openStudyPanel', accessibleName: 'Study panel', detailState: 'visible locked study panel' }]
      : []),
    { selector: '#showInterlinear', accessibleName: 'Language Study', detailTitle: 'Language Study' },
    { selector: '#showOutline', accessibleName: 'Book outline', detailTitle: 'Outline' },
    { selector: '#showTags', accessibleName: 'Study Marks', detailTitle: 'Study Marks' },
    { selector: '#showMyData', accessibleName: 'My Data', detailTitle: 'My Data' },
  ];
  const toolContextBaselineGeometry = await waitForStableReaderGeometry(page, {
    label: 'chapter-tool baseline',
  });
  const toolContextBefore = await evaluate(
    page,
    `(() => ({ route: location.href, scrollY }))()`,
  );
  toolContextBefore.geometry = toolContextBaselineGeometry;
  qaEvidence.chapterIntro.toolContextBaseline = toolContextBefore;
  const toolContextEvidence = [];
  for (const { selector, accessibleName: expectedName, detailTitle, detailState } of visibleChapterTools) {
    const accessibleName = await evaluate(
      page,
      `(() => {
        const node = document.querySelector(${JSON.stringify(selector)});
        return node?.getAttribute('aria-label') || node?.querySelector('span:not(.toolbar-icon)')?.textContent.trim() || node?.textContent.trim() || '';
      })()`,
    );
    await evaluate(page, `document.querySelector(${JSON.stringify(selector)}).click()`);
    if (detailTitle) {
      await waitFor(
        page,
        `document.querySelector('#detailTitle')?.textContent.trim() === ${JSON.stringify(detailTitle)}`,
      );
    } else {
      await waitFor(
        page,
        "document.querySelector('.detail-pane')?.classList.contains('visible') && document.querySelector('.detail-pane')?.dataset.hoverLocked === 'true'",
      );
    }
    const settledGeometry = await waitForStableReaderGeometry(page, {
      label: `${selector} chapter-tool result`,
    });
    const after = await evaluate(
      page,
      `(() => ({
        route: location.href,
        scrollY,
        detailTitle: document.querySelector('#detailTitle')?.textContent.trim() || '',
        detailVisible: document.querySelector('.detail-pane')?.classList.contains('visible') || false,
        detailHoverLocked: document.querySelector('.detail-pane')?.dataset.hoverLocked || ''
      }))()`,
    );
    after.geometry = settledGeometry;
    const reachedExpectedDetail = detailTitle
      ? after.detailTitle === detailTitle
      : detailState === 'visible locked study panel' && after.detailVisible && after.detailHoverLocked === 'true';
    toolContextEvidence.push({ selector, accessibleName, expectedDetail: detailTitle || detailState, after });
    assert(
      accessibleName === expectedName && after.route === toolContextBefore.route && after.scrollY === toolContextBefore.scrollY &&
        reachedExpectedDetail &&
        Math.abs(after.geometry.chapterContentTop - toolContextBefore.geometry.chapterContentTop) <= 1,
      `Chapter tool semantics, destination, or reader context changed for ${selector}: ${JSON.stringify({ toolContextBefore, accessibleName, expectedName, expectedDetail: detailTitle || detailState, after })}`,
    );
  }
  qaEvidence.chapterIntro.toolContext = toolContextEvidence;
  pass("chapter tools preserve route, scroll, stable geometry, accessible names, and Detail destinations");

  if (qaDevice !== 'mobile') {
    const chapterIntroRouteBase = baseUrl.split('#')[0];
    await navigate(page, `${chapterIntroRouteBase}#/read/bsb/psalms/1`);
    await waitFor(page, "document.querySelector('#chapterTitle')?.textContent === 'Psalms 1'");
    const firstBoundary = await evaluate(page, `({ previous: document.querySelector('#prevChapter')?.disabled, next: document.querySelector('#nextChapter')?.disabled })`);
    await navigate(page, `${chapterIntroRouteBase}#/read/bsb/psalms/150`);
    await waitFor(page, "document.querySelector('#chapterTitle')?.textContent === 'Psalms 150'");
    const lastBoundary = await evaluate(page, `({ previous: document.querySelector('#prevChapter')?.disabled, next: document.querySelector('#nextChapter')?.disabled })`);
    assert(
      firstBoundary.previous === true && firstBoundary.next === false && lastBoundary.previous === false && lastBoundary.next === true,
      `Previous and Next chapter boundary states failed: ${JSON.stringify({ firstBoundary, lastBoundary })}`,
    );
    await navigate(page, `${chapterIntroRouteBase}#/read/bsb/psalms/23`);
    await waitFor(page, "document.querySelector('#chapterTitle')?.textContent === 'Psalms 23'");
    pass("chapter navigation boundaries");
  }
  pass("chapter keyboard order and focus visibility");
  const stickyHeaderState = await evaluate(
    page,
    `(() => {
      const before = scrollY;
      window.scrollTo(0, Math.min(240, document.documentElement.scrollHeight - innerHeight));
      const top = document.querySelector('.app-header')?.getBoundingClientRect().top;
      window.scrollTo(0, before);
      return { top };
    })()`,
  );
  assert(Math.abs(stickyHeaderState.top) <= 1, `reader header must remain sticky: ${JSON.stringify(stickyHeaderState)}`);
  const statusMatrix = await evaluate(
    page,
    `(async () => {
      const domModuleUrl = new URL('./src/dom.js?v=pr13-live-qa-20260711e', document.baseURI).href;
      const { setStatus } = await import(domModuleUrl);
      const status = document.querySelector('#statusText');
      const compact = document.querySelector('#compactStatusText');
      const originalText = status.textContent;
      const snapshot = (name) => {
        const bounds = status.getBoundingClientRect();
        return {
          name,
          width: bounds.width,
          height: bounds.height,
          right: bounds.right,
          text: status.textContent,
          state: status.dataset.statusState,
          compactText: compact.textContent.trim(),
          compactHidden: compact.hidden,
          compactAriaHidden: compact.getAttribute('aria-hidden'),
          liveRegionCount: document.querySelectorAll('[role="status"][aria-live]').length,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          headerHeight: document.querySelector('.app-header')?.getBoundingClientRect().height || 0,
          viewportWidth: innerWidth
        };
      };
      const cases = [
        ['loaded', 'BSB data loaded'],
        ['loading', 'Loading book data...'],
        ['failed', 'Data load failed'],
        ['warning', 'BSB data loaded with warning: optional data unavailable'],
        ['message', 'Home']
      ];
      const results = [];
      for (const [name, message] of cases) {
        setStatus(message);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        results.push(snapshot(name));
      }
      setStatus(originalText);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { results, restored: snapshot('restored') };
    })()`,
  );
  qaEvidence.statusMatrix = statusMatrix;
  const expectedStatusStates = {
    loaded: "loaded",
    loading: "loading",
    failed: "error",
    warning: "error",
    message: "message",
  };
  assert(
    statusMatrix.results.every((result) =>
      result.state === expectedStatusStates[result.name] &&
      result.liveRegionCount === 1 &&
      result.compactAriaHidden === "true" &&
      result.compactHidden === (result.name !== "loaded") &&
      result.compactText === (result.name === "loaded" ? "Loaded" : "") &&
      (result.name === "loaded" || (result.width > 1 && result.height > 1)) &&
      result.right <= result.viewportWidth + 0.5 &&
      result.scrollWidth <= result.clientWidth + 1,
    ) &&
      statusMatrix.restored.state === "loaded" &&
      !statusMatrix.restored.compactHidden &&
      Math.abs(statusMatrix.restored.headerHeight - readerTopContract.header.height) <= 1,
    `setStatus classification, announcement, containment, and restoration failed: ${JSON.stringify(statusMatrix)}`,
  );
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "none" });
  const reducedMotionTopState = await evaluate(
    page,
    `(() => {
      const button = document.querySelector('#bookPickerButton');
      const bounds = button.getBoundingClientRect();
      return {
        matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
        transitionDuration: getComputedStyle(button).transitionDuration,
        width: bounds.width,
        height: bounds.height
      };
    })()`,
  );
  assert(
    reducedMotionTopState.matches && reducedMotionTopState.width > 0 && reducedMotionTopState.height >= 36 &&
      reducedMotionTopState.transitionDuration.split(",").every((value) => parseFloat(value) <= 0.01),
    `reduced-motion reader controls must remain operable without material transitions: ${JSON.stringify(reducedMotionTopState)}`,
  );
  await page.emulateMedia({ reducedMotion: "no-preference", forcedColors: "active" });
  const forcedColorsTopState = await evaluate(
    page,
    `(() => {
      const selectors = ['#translationSelect', '#bookPickerButton', '#chapterPickerButton', '#themeToggle'];
      const inlineFocus = (selector, pseudo = null) => {
        const node = document.querySelector(selector);
        node?.focus({ preventScroll: true });
        const style = node ? getComputedStyle(node, pseudo) : null;
        const result = style ? { selector, pseudo, outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineColor: style.outlineColor } : null;
        node?.blur();
        return result;
      };
      return {
        matches: matchMedia('(forced-colors: active)').matches,
        controls: selectors.map((selector) => {
          const node = document.querySelector(selector);
          const bounds = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return { selector, width: bounds.width, height: bounds.height, borderStyle: style.borderTopStyle, color: style.color };
        }),
        inlineTargets: [
          inlineFocus('.fn-marker', '::before'),
          inlineFocus('.verse-number'),
          inlineFocus('.presentation-block .cross-links .reference-hover', '::before'),
          inlineFocus('#prevChapterFloat', '::before')
        ]
      };
    })()`,
  );
  assert(
    forcedColorsTopState.matches && forcedColorsTopState.controls.every(
      (control) => control.width > 0 && control.height >= 36 && control.borderStyle !== "none" && control.color,
    ) && forcedColorsTopState.inlineTargets.every((target) => target?.outlineStyle === 'solid' && parseFloat(target.outlineWidth) >= 3),
    `forced-colors reader controls must remain visible and operable: ${JSON.stringify(forcedColorsTopState)}`,
  );
  await page.emulateMedia({ reducedMotion: "no-preference", forcedColors: "none" });
  pass("reduced motion and forced colors reader top area");
  pass("compact reader header semantics, status, targets, and sticky geometry");
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
  await page.delayNextRequest("**/data/verses/bsb/proverbs.json", 450);
  await clickButtonByText(page, "Proverbs", { scope: "#bookPickerPanel" });
  await delay(120);
  const delayedBookHandoff = await evaluate(
    page,
    `(() => ({
      route: location.hash,
      chapterExpanded: document.querySelector('#chapterPickerButton')?.getAttribute('aria-expanded'),
      chapter: document.querySelector('#chapterSelect')?.value,
      focused: document.activeElement === document.querySelector('#chapterPickerButton')
    }))()`,
  );
  assert(
    delayedBookHandoff.chapterExpanded === "false" && !delayedBookHandoff.focused,
    `Chapter opened before delayed Book navigation completed: ${JSON.stringify(delayedBookHandoff)}`,
  );
  await waitFor(
    page,
    `(() => {
      const active = document.querySelector('#chapterPickerPanel .reader-picker-option.active');
      return location.hash === '#/read/bsb/proverbs/1' &&
        document.querySelector('#bookSelect')?.value === 'proverbs' &&
        document.querySelector('#chapterSelect')?.value === '1' &&
        document.querySelector('#bookPickerButton')?.getAttribute('aria-label') === 'Book: Proverbs' &&
        document.querySelector('#chapterPickerButton')?.getAttribute('aria-label') === 'Chapter: 1' &&
        active?.textContent.trim() === '1' && active?.getAttribute('aria-pressed') === 'true' &&
        document.querySelector('#chapterPickerButton')?.getAttribute('aria-expanded') === 'true' &&
        document.activeElement === document.querySelector('#chapterPickerButton') &&
        document.querySelector('#chapterTitle')?.textContent === 'Proverbs 1' &&
        Boolean(document.querySelector('#chapterContent .verse-row[data-verse="1"]'));
    })()`,
  );
  const bookToChapterState = await evaluate(
    page,
    `(() => ({
      book: document.querySelector('#bookSelect')?.value,
      chapter: document.querySelector('#chapterSelect')?.value,
      bookName: document.querySelector('#bookPickerButton')?.getAttribute('aria-label'),
      chapterName: document.querySelector('#chapterPickerButton')?.getAttribute('aria-label'),
      activeChapter: document.querySelector('#chapterPickerPanel .reader-picker-option.active')?.textContent.trim(),
      activePressed: document.querySelector('#chapterPickerPanel .reader-picker-option.active')?.getAttribute('aria-pressed'),
      expanded: document.querySelector('#chapterPickerButton')?.getAttribute('aria-expanded'),
      focused: document.activeElement === document.querySelector('#chapterPickerButton'),
      title: document.querySelector('#chapterTitle')?.textContent,
      renderedVerseOne: Boolean(document.querySelector('#chapterContent .verse-row[data-verse="1"]'))
    }))()`,
  );
  assert(
    bookToChapterState.book === "proverbs" && bookToChapterState.chapter === "1" &&
      bookToChapterState.bookName === "Book: Proverbs" &&
      bookToChapterState.chapterName === "Chapter: 1" &&
      bookToChapterState.activeChapter === "1" &&
      bookToChapterState.activePressed === "true" &&
      bookToChapterState.expanded === "true" &&
      bookToChapterState.focused &&
      bookToChapterState.title === "Proverbs 1" &&
      bookToChapterState.renderedVerseOne,
    `Book selection must hand off to the synchronized Chapter picker: ${JSON.stringify(bookToChapterState)}`,
  );
  await page.press("#chapterPickerButton", "Escape");
  await click(page, "#bookPickerButton");
  await clickButtonByText(page, "Psalms", { scope: "#bookPickerPanel" });
  await waitFor(
    page,
    "document.querySelector('#bookSelect')?.value === 'psalms' && document.querySelector('#chapterPickerButton')?.getAttribute('aria-expanded') === 'true'",
  );
  await clickButtonByText(page, "23", { scope: "#chapterPickerPanel" });
  await waitFor(page, "document.querySelector('#chapterTitle')?.textContent.includes('Psalms 23')");
  await click(page, ".strong-token");
  await waitFor(page, "document.querySelector('#detailTitle')?.textContent === \"Strong's\"");
  await evaluate(page, "[...document.querySelectorAll('.strong-token')][1]?.click()");
  await waitFor(page, "document.querySelector('#detailBack')?.disabled === false");
  await evaluate(
    page,
    `(() => {
      window.scrollTo(0, Math.min(240, document.documentElement.scrollHeight - innerHeight));
      const chapter = document.querySelector('#chapterContent');
      const detail = document.querySelector('#detailContent');
      if (chapter) chapter.scrollTop = Math.min(80, chapter.scrollHeight - chapter.clientHeight);
      if (detail) detail.scrollTop = Math.min(60, detail.scrollHeight - detail.clientHeight);
      const snapshot = () => JSON.stringify({
        route: location.href,
        values: [document.querySelector('#translationSelect')?.value, document.querySelector('#bookSelect')?.value, document.querySelector('#chapterSelect')?.value],
        pageScroll: scrollY,
        chapterScroll: chapter?.scrollTop || 0,
        detailScroll: detail?.scrollTop || 0,
        detailTitle: document.querySelector('#detailTitle')?.textContent.trim() || '',
        backDisabled: Boolean(document.querySelector('#detailBack')?.disabled),
        forwardDisabled: Boolean(document.querySelector('#detailForward')?.disabled),
        context: [...document.querySelectorAll('.reader-context-word, .reader-context-verse')].map((node) => [node.className, node.dataset.verse || '', node.dataset.strongCode || '', node.dataset.tokenIndex || ''])
      });
      window.__readerTopPickerContext = snapshot;
      return true;
    })()`,
  );
  const measurePicker = (kind) =>
    evaluate(
      page,
      `(() => {
        const panel = document.querySelector('#${kind}PickerPanel');
        const active = panel?.querySelector('.reader-picker-option.active');
        const scroller = active?.closest('.book-picker-list, .chapter-picker-grid') || panel;
        const panelRect = panel?.getBoundingClientRect();
        const activeRect = active?.getBoundingClientRect();
        const scrollerRect = scroller?.getBoundingClientRect();
        const columnTarget = ${JSON.stringify(kind)} === 'book'
          ? panel
          : panel?.querySelector('.chapter-picker-grid');
        const gridTemplateColumns = columnTarget ? getComputedStyle(columnTarget).gridTemplateColumns : '';
        return {
          width: panelRect?.width || 0,
          inlineWidth: panel?.style.width || '',
          left: panelRect?.left || 0,
          right: panelRect?.right || 0,
          viewportWidth: innerWidth,
          columns: gridTemplateColumns.split(' ').filter(Boolean).length,
          gridTemplateColumns,
          activeVisible: Boolean(
            activeRect && scrollerRect &&
            activeRect.top >= scrollerRect.top - .5 &&
            activeRect.bottom <= scrollerRect.bottom + .5
          ),
          context: window.__readerTopPickerContext()
        };
      })()`,
    );
  if (qaDevice !== "mobile") {
    const openPicker = async (kind) => {
      await evaluate(page, `document.querySelector('#${kind}PickerButton').click()`);
      await waitFor(page, `document.querySelector('#${kind}PickerPanel')?.hidden === false`);
      await delay(450);
    };
    const closePicker = async (kind) => {
      await page.press(`#${kind}PickerButton`, "Escape");
      await waitFor(page, `document.querySelector('#${kind}PickerPanel')?.hidden === true`);
    };

    const contextBeforeWideReset = await evaluate(page, "window.__readerTopPickerContext()");
    await page.setViewportSize({ width: 1280, height: 720 });
    await evaluate(page, "document.documentElement.dataset.studyWorkspaceWidth = 'standard'");
    const contextAfterWideReset = await evaluate(page, "window.__readerTopPickerContext()");
    const bookWideBaselineGeometry = await waitForStableReaderGeometry(page, { label: 'Book picker wide baseline' });
    const contextAfterWideGeometry = await evaluate(page, "window.__readerTopPickerContext()");
    const bookWideBaselineStability = await waitForStablePickerContext(page, { label: 'Book picker wide baseline context' });
    const contextBeforeResize = bookWideBaselineStability.context;

    await openPicker("book");
    const bookWideBeforeStability = await waitForStablePickerContext(page, { label: 'Book picker wide-before context' });
    const bookWideBefore = await measurePicker("book");
    await page.setViewportSize({ width: 390, height: 844 });
    const bookNarrowGeometry = await waitForStableReaderGeometry(page, { label: 'Book picker narrow resize' });
    const bookNarrowStability = await waitForStablePickerContext(page, { label: 'Book picker narrow context' });
    const bookNarrow = await measurePicker("book");
    await page.setViewportSize({ width: 1280, height: 720 });
    const bookWideAfterGeometry = await waitForStableReaderGeometry(page, { label: 'Book picker wide restoration' });
    const bookWideAfterStability = await waitForStablePickerContext(page, { label: 'Book picker wide-after context' });
    const bookWideAfter = await measurePicker("book");
    await closePicker("book");
    await openPicker("book");
    const bookWideReopenedStability = await waitForStablePickerContext(page, { label: 'Book picker reopened-wide context' });
    const bookWideReopened = await measurePicker("book");
    await closePicker("book");
    const bookContextDifferences = Object.fromEntries(
      Object.entries({ bookWideBefore, bookNarrow, bookWideAfter, bookWideReopened })
        .map(([name, state]) => [name, pickerContextDifferences(contextBeforeResize, state.context)]),
    );
    const bookMaximumContextDivergence = Math.max(
      0,
      ...Object.values(bookContextDifferences).map((differences) => Object.keys(differences).length),
    );
    const bookFailureDiagnostics = {
      runtimeVersion: process.version,
      contextBeforeWideReset,
      contextAfterWideReset,
      contextAfterWideGeometry,
      contextBeforeResize,
      bookWideBefore,
      bookNarrow,
      bookWideAfter,
      bookWideReopened,
      geometry: {
        wideBaseline: bookWideBaselineGeometry,
        narrow: bookNarrowGeometry,
        wideAfter: bookWideAfterGeometry,
      },
      stability: {
        wideBaseline: bookWideBaselineStability,
        wideBefore: bookWideBeforeStability,
        narrow: bookNarrowStability,
        wideAfter: bookWideAfterStability,
        wideReopened: bookWideReopenedStability,
      },
      contextDifferences: bookContextDifferences,
      maximumContextDivergence: bookMaximumContextDivergence,
      viewport: bookWideBaselineStability.viewport,
      workspaceMode: bookWideBaselineStability.workspaceMode,
    };
    assert(
      bookWideBefore.width >= 500 && bookWideBefore.columns === 2 &&
        bookNarrow.width <= 370.5 && bookNarrow.columns === 1 &&
        bookNarrow.left >= 8 && bookNarrow.right <= bookNarrow.viewportWidth - 8 &&
        bookWideAfter.width >= bookWideBefore.width - 1 && bookWideAfter.columns === 2 &&
        bookWideAfter.width > bookNarrow.width + 100 &&
        bookWideReopened.width >= bookWideBefore.width - 1 && bookWideReopened.columns === 2 &&
        [bookWideBefore, bookNarrow, bookWideAfter, bookWideReopened].every(
          (state) => state.activeVisible && state.context === contextBeforeResize,
        ),
      `Book picker natural width must recover across one live wide-narrow-wide page: ${JSON.stringify(bookFailureDiagnostics)}`,
    );

    await openPicker("chapter");
    const chapterWideBeforeStability = await waitForStablePickerContext(page, { label: 'Chapter picker wide-before context' });
    const chapterWideBefore = await measurePicker("chapter");
    await page.setViewportSize({ width: 390, height: 844 });
    const chapterNarrowGeometry = await waitForStableReaderGeometry(page, { label: 'Chapter picker narrow resize' });
    const chapterNarrowStability = await waitForStablePickerContext(page, { label: 'Chapter picker narrow context' });
    const chapterNarrow = await measurePicker("chapter");
    await page.setViewportSize({ width: 1280, height: 720 });
    const chapterWideAfterGeometry = await waitForStableReaderGeometry(page, { label: 'Chapter picker wide restoration' });
    const chapterWideAfterStability = await waitForStablePickerContext(page, { label: 'Chapter picker wide-after context' });
    const chapterWideAfter = await measurePicker("chapter");
    await closePicker("chapter");
    await openPicker("chapter");
    const chapterWideReopenedStability = await waitForStablePickerContext(page, { label: 'Chapter picker reopened-wide context' });
    const chapterWideReopened = await measurePicker("chapter");
    await closePicker("chapter");
    const chapterContextDifferences = Object.fromEntries(
      Object.entries({ chapterWideBefore, chapterNarrow, chapterWideAfter, chapterWideReopened })
        .map(([name, state]) => [name, pickerContextDifferences(contextBeforeResize, state.context)]),
    );
    const chapterMaximumContextDivergence = Math.max(
      0,
      ...Object.values(chapterContextDifferences).map((differences) => Object.keys(differences).length),
    );
    const chapterFailureDiagnostics = {
      runtimeVersion: process.version,
      contextBeforeResize,
      chapterWideBefore,
      chapterNarrow,
      chapterWideAfter,
      chapterWideReopened,
      geometry: {
        narrow: chapterNarrowGeometry,
        wideAfter: chapterWideAfterGeometry,
      },
      stability: {
        wideBefore: chapterWideBeforeStability,
        narrow: chapterNarrowStability,
        wideAfter: chapterWideAfterStability,
        wideReopened: chapterWideReopenedStability,
      },
      contextDifferences: chapterContextDifferences,
      maximumContextDivergence: chapterMaximumContextDivergence,
      viewport: chapterWideBeforeStability.viewport,
      workspaceMode: chapterWideBeforeStability.workspaceMode,
    };
    assert(
      chapterWideBefore.width > 0 && chapterNarrow.width > 0 &&
        chapterNarrow.left >= 8 && chapterNarrow.right <= chapterNarrow.viewportWidth - 8 &&
        Math.abs(chapterWideAfter.width - chapterWideBefore.width) <= 1 &&
        Math.abs(chapterWideReopened.width - chapterWideBefore.width) <= 1 &&
        [chapterWideBefore, chapterNarrow, chapterWideAfter, chapterWideReopened].every(
          (state) => state.activeVisible && state.context === contextBeforeResize,
        ),
      `Chapter picker natural width must recover across one live wide-narrow-wide page: ${JSON.stringify(chapterFailureDiagnostics)}`,
    );
    qaEvidence.readerPickerResize = {
      runtimeVersion: process.version,
      contextBeforeWideReset,
      contextAfterWideReset,
      contextAfterWideGeometry,
      contextBeforeResize,
      book: {
        wideBefore: bookWideBefore,
        narrow: bookNarrow,
        wideAfter: bookWideAfter,
        wideReopened: bookWideReopened,
        geometry: bookFailureDiagnostics.geometry,
        stability: bookFailureDiagnostics.stability,
        contextDifferences: bookContextDifferences,
        maximumContextDivergence: bookMaximumContextDivergence,
      },
      chapter: {
        wideBefore: chapterWideBefore,
        narrow: chapterNarrow,
        wideAfter: chapterWideAfter,
        wideReopened: chapterWideReopened,
        geometry: chapterFailureDiagnostics.geometry,
        stability: chapterFailureDiagnostics.stability,
        contextDifferences: chapterContextDifferences,
        maximumContextDivergence: chapterMaximumContextDivergence,
      },
    };
    pass("live wide-narrow-wide picker natural-width restoration");
  }
  for (const kind of ["book", "chapter"]) {
    const buttonSelector = `#${kind}PickerButton`;
    const panelSelector = `#${kind}PickerPanel`;
    await evaluate(
      page,
      `(() => {
        const button = document.querySelector(${JSON.stringify(buttonSelector)});
        button.focus({ preventScroll: true });
        return true;
      })()`,
    );
    const pickerContextBeforeOpen = await evaluate(page, "window.__readerTopPickerContext()");
    await evaluate(page, `document.querySelector(${JSON.stringify(buttonSelector)}).click()`);
    await waitFor(page, `document.querySelector(${JSON.stringify(panelSelector)})?.hidden === false`);
    await delay(250);
    const openPickerState = await evaluate(
      page,
      `(() => {
        const panel = document.querySelector(${JSON.stringify(panelSelector)});
        const active = panel?.querySelector('.reader-picker-option.active');
        const scroller = active?.closest('.book-picker-list, .chapter-picker-grid') || panel;
        const panelRect = panel?.getBoundingClientRect();
        const activeRect = active?.getBoundingClientRect();
        const scrollerRect = scroller?.getBoundingClientRect();
        return {
          positioned: panel?.dataset.positioned,
          panel: panelRect && { left: panelRect.left, top: panelRect.top, right: panelRect.right, bottom: panelRect.bottom },
          viewport: { width: innerWidth, height: innerHeight },
          activeVisible: Boolean(activeRect && scrollerRect && activeRect.top >= scrollerRect.top - .5 && activeRect.bottom <= scrollerRect.bottom + .5),
          context: window.__readerTopPickerContext()
        };
      })()`,
    );
    assert(
      openPickerState.positioned === "true" &&
        openPickerState.panel.left >= 8 && openPickerState.panel.top >= 8 &&
        openPickerState.panel.right <= openPickerState.viewport.width - 8 &&
        openPickerState.panel.bottom <= openPickerState.viewport.height - 8 &&
        openPickerState.activeVisible,
      `${kind} picker must be viewport-bounded with its active option visible: ${JSON.stringify(openPickerState)}`,
    );
    assert(
      openPickerState.context === pickerContextBeforeOpen,
      `${kind} picker mutated reader context while opening: ${JSON.stringify({ before: pickerContextBeforeOpen, after: openPickerState.context })}`,
    );
    await page.press(buttonSelector, "Escape");
    const closedPickerState = await evaluate(
      page,
      `({
        expanded: document.querySelector(${JSON.stringify(buttonSelector)})?.getAttribute('aria-expanded'),
        focused: document.activeElement === document.querySelector(${JSON.stringify(buttonSelector)}),
        context: window.__readerTopPickerContext()
      })`,
    );
    assert(
      closedPickerState.expanded === "false" && closedPickerState.focused && closedPickerState.context === pickerContextBeforeOpen,
      `${kind} picker Escape must restore focus without mutating reader context: ${JSON.stringify(closedPickerState)}`,
    );
  }
  pass("stable viewport-bounded reader pickers and Book-to-Chapter flow");
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
  const pickerMarksExpression = `JSON.stringify({
    book: document.querySelector('#favoriteBook')?.getAttribute('aria-pressed') || '',
    chapter: document.querySelector('#favoriteChapter')?.getAttribute('aria-pressed') || '',
    verseBadges: [...document.querySelectorAll('.verse-number-wrap .tag-badge')].map((node) => node.textContent.trim()).sort(),
    readerBadges: [...document.querySelectorAll('.reader-target-badges .target-tag-badge')].map((node) => node.textContent.trim()).sort(),
    taggedText: [...document.querySelectorAll('.tagged-text-span')].map((node) => node.textContent.trim()).sort()
  })`;
  const marksBeforeDismissal = await evaluate(
    page,
    pickerMarksExpression,
  );
  await evaluate(page, `document.querySelector(${JSON.stringify(studyTrigger)})?.focus()`);
  assert(
    await evaluate(page, `document.querySelector('#detailToolSurface')?.hidden === true && document.querySelector(${JSON.stringify(studyTrigger)})?.getAttribute('aria-expanded') === 'false'`),
    "focusing the side-panel Study Marks trigger must not open its contained tool",
  );
  await page.press(studyTrigger, "Enter");
  await waitFor(page, "document.querySelector('#detailToolSurface')?.dataset.toolKind === 'study-marks' && document.querySelector('#detailToolSurface')?.hidden === false");
  const containedStudyMarksState = await evaluate(page, `(() => {
    const pane = document.querySelector('.detail-pane');
    const surface = document.querySelector('#detailToolSurface');
    const workArea = document.querySelector('#detailWorkArea');
    const paneRect = pane?.getBoundingClientRect();
    const surfaceRect = surface?.getBoundingClientRect();
    return {
      ariaExpanded: document.querySelector(${JSON.stringify(studyTrigger)})?.getAttribute('aria-expanded'),
      ariaHidden: surface?.getAttribute('aria-hidden'),
      title: document.querySelector('#detailToolTitle')?.textContent.trim() || '',
      target: surface?.dataset.toolTargetId || '',
      detailTitle: document.querySelector('#detailTitle')?.textContent.trim() || '',
      inert: Boolean(workArea?.inert || workArea?.hasAttribute('inert')),
      workAreaHidden: workArea?.getAttribute('aria-hidden'),
      focusedInside: Boolean(surface?.contains(document.activeElement)),
      hasFavorite: Boolean(surface?.querySelector('.tag-picker-option[aria-label$="Favorite tag"]')),
      hasManage: Boolean(surface?.querySelector('.tag-picker-manage')),
      contained: Boolean(
        paneRect && surfaceRect &&
        surfaceRect.left >= paneRect.left - 1 && surfaceRect.right <= paneRect.right + 1 &&
        surfaceRect.top >= paneRect.top - 1 && surfaceRect.bottom <= paneRect.bottom + 1
      )
    };
  })()`);
  assert(
    containedStudyMarksState.ariaExpanded === "true" &&
      containedStudyMarksState.ariaHidden === "false" &&
      containedStudyMarksState.title === "Study Marks" &&
      containedStudyMarksState.target &&
      containedStudyMarksState.detailTitle === "Parallel" &&
      containedStudyMarksState.inert &&
      containedStudyMarksState.workAreaHidden === "true" &&
      containedStudyMarksState.focusedInside &&
      containedStudyMarksState.hasFavorite &&
      containedStudyMarksState.hasManage &&
      containedStudyMarksState.contained,
    `side-panel Study Marks must use the inert, bounded contained tool surface: ${JSON.stringify(containedStudyMarksState)}`,
  );
  await page.press('#detailToolSurface .tag-picker-option[aria-label$="Favorite tag"]', "Escape");
  await waitFor(page, "document.querySelector('#detailToolSurface')?.hidden === true");
  await waitFor(page, `document.activeElement === document.querySelector(${JSON.stringify(studyTrigger)})`);
  const keyboardStudyMarksDismissal = await evaluate(page, `({
    restored: document.activeElement === document.querySelector(${JSON.stringify(studyTrigger)}),
    closed: document.querySelector('#detailToolSurface')?.hidden === true && document.querySelector(${JSON.stringify(studyTrigger)})?.getAttribute('aria-expanded') === 'false',
    interactive: !document.querySelector('#detailWorkArea')?.hasAttribute('inert') && document.querySelector('#detailWorkArea')?.getAttribute('aria-hidden') !== 'true',
    unchanged: ${pickerMarksExpression} === ${JSON.stringify(marksBeforeDismissal)}
  })`);
  assert(keyboardStudyMarksDismissal.closed && keyboardStudyMarksDismissal.restored && keyboardStudyMarksDismissal.interactive && keyboardStudyMarksDismissal.unchanged, `keyboard-open Study Marks Escape must restore its trigger and work area without mutation: ${JSON.stringify(keyboardStudyMarksDismissal)}`);

  await click(page, studyTrigger);
  await waitFor(page, "document.querySelector('#detailToolSurface')?.dataset.toolKind === 'study-marks'");
  await click(page, "#detailToolClose");
  await waitFor(page, "document.querySelector('#detailToolSurface')?.hidden === true");
  await waitFor(page, `document.activeElement === document.querySelector(${JSON.stringify(studyTrigger)})`);
  assert(
    await evaluate(page, `${pickerMarksExpression} === ${JSON.stringify(marksBeforeDismissal)}`),
    "closing the contained Study Marks surface must not mutate tag assertions",
  );

  await click(page, studyTrigger);
  await waitFor(page, "document.querySelector('#detailToolSurface')?.dataset.toolKind === 'study-marks'");
  await click(page, secondStudyTrigger);
  await evaluate(page, `document.querySelector(${JSON.stringify(secondStudyTrigger)})?.focus()`);
  await waitForStudyMarksMenuOpen(page, secondStudyTrigger);
  const menuSwitchState = await evaluate(page, `({
    firstClosed: document.querySelector('#detailToolSurface')?.hidden === true,
    firstCollapsed: document.querySelector(${JSON.stringify(studyTrigger)})?.getAttribute('aria-expanded') === 'false',
    secondOpened: document.querySelector(${JSON.stringify(secondStudyTrigger)})?.closest('.target-tag-picker-menu')?.dataset.menuOpen === 'true',
    secondFocused: document.activeElement === document.querySelector(${JSON.stringify(secondStudyTrigger)})
  })`);
  assert(menuSwitchState.firstClosed && menuSwitchState.firstCollapsed && menuSwitchState.secondOpened && menuSwitchState.secondFocused, `opening reader picker B must replace contained tool A without returning focus to A: ${JSON.stringify(menuSwitchState)}`);
  await page.press(activeSecondStudyTrigger, "Escape");
  await waitFor(page, `document.querySelector(${JSON.stringify(secondStudyTrigger)})?.closest('.target-tag-picker-menu')?.dataset.restoringFocus !== 'true'`);
  const marksAfterDismissal = await evaluate(
    page,
    pickerMarksExpression,
  );
  assert(marksAfterDismissal === marksBeforeDismissal, "all Study Marks dismissal paths must leave tag assertions unchanged");
  const secondMarksBeforeClosedEscape = await evaluate(
    page,
    pickerMarksExpression,
  );
  await evaluate(page, "document.querySelector('#themeToggle')?.focus()");
  await page.press("#themeToggle", "Escape");
  const closedPickerEscape = await evaluate(
    page,
    `({
      focusUnchanged: document.activeElement === document.querySelector('#themeToggle'),
      marksUnchanged: ${pickerMarksExpression} === ${JSON.stringify(secondMarksBeforeClosedEscape)}
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
    await page.press(rerenderingStudyTrigger, "Enter");
    await waitForStudyMarksMenuOpen(page, rerenderingStudyTrigger);
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
    await page.press(rerenderingStudyTrigger, "Enter");
    await waitForStudyMarksMenuOpen(page, rerenderingStudyTrigger);
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
      result.focusOutline = getComputedStyle(marker, '::before').outlineStyle;
      result.focusTargetWidth = getComputedStyle(marker, '::before').width;
      result.focusTargetHeight = getComputedStyle(marker, '::before').height;
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
      result.focusOutline = getComputedStyle(marker, '::before').outlineStyle;
      result.focusTargetWidth = getComputedStyle(marker, '::before').width;
      result.focusTargetHeight = getComputedStyle(marker, '::before').height;
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
      const sourceWord = document.querySelector('.strong-source-word');
      const hydratedSourceWord = sourceWord?.querySelector('.language-word-hover, .language-letter-hover');
      const rtlNote = document.querySelector('.hebrew-rtl-note');
      const rtlNoteBounds = rtlNote?.getBoundingClientRect();
      const rtlNoteBadge = rtlNote ? getComputedStyle(rtlNote, '::before') : null;
      const accentProbe = document.createElement('span');
      accentProbe.style.setProperty('color', 'var(--accent-dark)', 'important');
      document.body.append(accentProbe);
      const accentColor = getComputedStyle(accentProbe).color;
      accentProbe.remove();
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
        headingPaddingBottom: summaryHeading ? getComputedStyle(summaryHeading).paddingBottom : '',
        accentColor,
        sourceWordColor: sourceWord ? getComputedStyle(sourceWord).color : '',
        hydratedSourceWordColor: hydratedSourceWord ? getComputedStyle(hydratedSourceWord).color : '',
        rtlNoteTarget: rtlNoteBounds ? { height: rtlNoteBounds.height, width: rtlNoteBounds.width } : null,
        rtlNoteBadge: rtlNoteBadge ? {
          content: rtlNoteBadge.content,
          display: rtlNoteBadge.display,
          height: rtlNoteBadge.height,
          width: rtlNoteBadge.width
        } : null
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
  assert(
    darkHebrewContrast?.rtlNoteTarget?.height === 24 && darkHebrewContrast?.rtlNoteTarget?.width === 24,
    `Hebrew direction help target changed size: ${JSON.stringify(darkHebrewContrast)}`,
  );
  assert(
    darkHebrewContrast?.rtlNoteBadge?.content === '"!"' &&
      darkHebrewContrast?.rtlNoteBadge?.display === "grid" &&
      darkHebrewContrast?.rtlNoteBadge?.height === "18px" &&
      darkHebrewContrast?.rtlNoteBadge?.width === "18px",
    `Hebrew direction help badge is not compact and centered: ${JSON.stringify(darkHebrewContrast)}`,
  );
  assert(
    darkHebrewContrast?.sourceWordColor === darkHebrewContrast?.accentColor &&
      darkHebrewContrast?.hydratedSourceWordColor === darkHebrewContrast?.accentColor,
    `Hydrated Hebrew source word lost its accent color: ${JSON.stringify(darkHebrewContrast)}`,
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
    "document.querySelector('#detailToolSurface')?.dataset.toolKind === 'study-marks' && document.querySelector('#detailToolSurface')?.hidden === false",
  );
  assert(
    await evaluate(page, `(() => {
      const surface = document.querySelector('#detailToolSurface');
      const pane = document.querySelector('.detail-pane');
      const workArea = document.querySelector('#detailWorkArea');
      const surfaceRect = surface?.getBoundingClientRect();
      const paneRect = pane?.getBoundingClientRect();
      return document.querySelector('#detailTitle')?.textContent === 'Language Study' &&
        Boolean(workArea?.inert || workArea?.hasAttribute('inert')) &&
        surface?.contains(document.activeElement) &&
        surfaceRect.left >= paneRect.left - 1 && surfaceRect.right <= paneRect.right + 1;
    })()`),
    "interlinear token Study Marks should keep Language Study intact under the contained panel tool",
  );
  await click(page, '#detailToolSurface .tag-picker-option[aria-label="Add Positive tag"]');
  await waitFor(page, "document.querySelector('.interlinear-token .token-target-badges .target-tag-badge')");
  await click(page, "#detailToolClose");
  await waitFor(page, "document.querySelector('#detailToolSurface')?.hidden === true");
  await click(page, ".interlinear-token .token-target-badges .target-tag-picker-trigger");
  await waitFor(
    page,
    "document.querySelector('.interlinear-token .token-target-badges .tag-picker-option[aria-label=\"Remove Positive tag\"]')",
  );
  await click(page, '.interlinear-token .token-target-badges .tag-picker-option[aria-label="Remove Positive tag"]');
  await waitFor(page, "!document.querySelector('.interlinear-token .token-target-badges')");
  pass("Interlinear source-token Study Marks");
  pass("Greek interlinear token data");
  await click(page, '.interlinear-token[data-strong-code^="G"] .link-button');
  await waitFor(page, "document.querySelector('#detailTitle')?.textContent === \"Strong's\" && Boolean(document.querySelector('.strong-source-word .language-word-hover, .strong-source-word .language-letter-hover'))", 15000);
  const greekSourceAccent = await evaluate(
    page,
    `(() => {
      const sourceWord = document.querySelector('.strong-source-word');
      const hydratedSourceWord = sourceWord?.querySelector('.language-word-hover, .language-letter-hover');
      const accentProbe = document.createElement('span');
      accentProbe.style.setProperty('color', 'var(--accent-dark)', 'important');
      document.body.append(accentProbe);
      const accentColor = getComputedStyle(accentProbe).color;
      accentProbe.remove();
      return {
        accentColor,
        sourceWordColor: sourceWord ? getComputedStyle(sourceWord).color : '',
        hydratedSourceWordColor: hydratedSourceWord ? getComputedStyle(hydratedSourceWord).color : ''
      };
    })()`,
  );
  assert(
    greekSourceAccent?.sourceWordColor === greekSourceAccent?.accentColor &&
      greekSourceAccent?.hydratedSourceWordColor === greekSourceAccent?.accentColor,
    `Hydrated Greek source word lost its accent color: ${JSON.stringify(greekSourceAccent)}`,
  );
  pass("Greek Strong's source accent");

  await navigate(page, `${routeBase}#/read/bsb/proverbs/1/1`);
  await waitFor(page, "document.querySelector('#chapterTitle')?.textContent.includes('Proverbs 1')");

  await click(page, ".verse-study-button");
  await click(page, "#detailContext [data-panel-scope='verse'] .study-marks-trigger");
  await waitFor(page, "document.querySelector('#detailToolSurface')?.dataset.toolKind === 'study-marks'");
  await click(page, "#detailToolSurface .tag-picker-manage");
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
  await waitFor(page, "document.querySelector('#detailToolSurface')?.dataset.toolKind === 'study-marks'");
  await click(page, "#detailToolSurface .tag-picker-manage");
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
  const finalBrowserHealth = await page.browserHealth();
  assert(
    finalBrowserHealth.consoleErrors.length === 0 &&
      finalBrowserHealth.pageErrors.length === 0 &&
      finalBrowserHealth.failedRequests.length === 0 &&
      finalBrowserHealth.errorResponses.length === 0,
    `browser health failures found: ${JSON.stringify(finalBrowserHealth)}`,
  );
  const finalLoadingState = await evaluate(
    page,
    `(() => ({
      status: document.querySelector('#statusText')?.textContent.trim() || '',
      busy: [...document.querySelectorAll('[aria-busy="true"]')]
        .filter((node) => !node.hidden && getComputedStyle(node).display !== 'none').length
    }))()`,
  );
  assert(
    !/loading/i.test(finalLoadingState.status) && finalLoadingState.busy === 0,
    `browser left a stale loading state: ${JSON.stringify(finalLoadingState)}`,
  );
  pass("console, page, request, and loading-state health");
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
        evidence: qaEvidence,
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
