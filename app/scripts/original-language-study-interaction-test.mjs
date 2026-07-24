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

function assertDeepEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}\nactual: ${JSON.stringify(actual)}\nexpected: ${JSON.stringify(expected)}`);
  }
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

async function click(page, selector) {
  await page.evaluate((targetSelector) => {
    const target = document.querySelector(targetSelector);
    if (!target) throw new Error(`Target not found: ${targetSelector}`);
    target.scrollIntoView({ block: "center", inline: "nearest" });
    target.click();
  }, selector);
}

async function clickButtonByText(page, text) {
  await page.evaluate((label) => {
    const target = [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === label);
    if (!target) throw new Error(`Button not found: ${label}`);
    target.scrollIntoView({ block: "center", inline: "nearest" });
    target.click();
  }, text);
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
    await page.goto(`${url}/#/read/bsb/philemon/1/1`, { waitUntil: "load" });
    await waitFor(page, () => Boolean(document.querySelector("#chapterTitle")?.textContent.includes("Philemon 1")));
    const philemonSpacing = await page.evaluate(() => {
      const ordinary = [...document.querySelectorAll(".verse-row .verse-line.reg")];
      const verseOne = document.querySelector(".verse-row[data-verse='1']");
      const heights = ordinary.slice(0, 8).map((line) => Number(line.getBoundingClientRect().height.toFixed(2)));
      return {
        verseOneLines: verseOne?.querySelectorAll(".verse-line.reg").length || 0,
        ordinaryLineCounts: [...document.querySelectorAll(".verse-row")].slice(0, 8).map((row) => row.querySelectorAll(".verse-line.reg").length),
        heights,
        headingGap: document.querySelector(".presentation-block.section_heading")?.getBoundingClientRect().height || 0,
      };
    });
    assert(
      philemonSpacing.verseOneLines === 1 && philemonSpacing.ordinaryLineCounts.every((count) => count === 1) && philemonSpacing.headingGap > 0,
      `Philemon ordinary prose retained archive wrap spacing or lost intentional headings: ${JSON.stringify(philemonSpacing)}`,
    );
    await page.goto(url, { waitUntil: "load" });
    await waitFor(page, () => document.readyState === "complete" && !document.body.textContent.includes("Loading data"));
    await waitFor(page, () => Boolean(document.querySelector("#chapterTitle")?.textContent.includes("Psalms 23")));
    await waitFor(page, () => document.querySelectorAll(".strong-token").length > 0);

    await click(page, ".strong-token");
    await waitFor(page, () => document.querySelector("#detailTitle")?.textContent === "Strong's");
    await waitFor(page, () => Boolean(document.querySelector(".strong-overview-translit[data-transliteration-convention]")));
    const strongTransliteration = await page.evaluate(() => {
      const node = document.querySelector(".strong-overview-translit");
      return {
        text: node?.textContent.trim() || "",
        convention: node?.dataset.transliterationConvention || "",
        description: node?.getAttribute("aria-description") || "",
        symbols: [...(node?.querySelectorAll(".transliteration-symbol") || [])].map((symbol) => ({
          text: symbol.textContent,
          tabIndex: symbol.tabIndex,
          label: symbol.getAttribute("aria-label") || "",
        })),
      };
    });
    assert(
      strongTransliteration.text &&
        strongTransliteration.convention === "bundled-strongs-interlinear" &&
        strongTransliteration.description.includes("separate from phonetic spelling") &&
        strongTransliteration.description.includes("not exact pronunciation") &&
        strongTransliteration.symbols.every((symbol) => symbol.tabIndex === 0 && !symbol.label.includes("not exact pronunciation")),
      `Strong's transliteration guidance is incomplete: ${JSON.stringify(strongTransliteration)}`,
    );
    await waitFor(page, () => [...document.querySelectorAll("button")].some((button) => button.textContent.trim() === "Int"));
    await clickButtonByText(page, "Int");
    await waitFor(page, () => document.querySelector("#detailTitle")?.textContent === "Language Study");
    await waitFor(page, () => Boolean(document.querySelector(".interlinear-verse-section[data-original-language-study='true']")));
    await waitFor(page, () => Boolean(document.querySelector(".original-language-word-origin")));

    const studyState = await page.evaluate(() => {
      const verseSection = document.querySelector(".interlinear-verse-section:not(.interlinear-superscription-section)");
      const firstCard = verseSection?.querySelector(".original-language-word-card");
      const summary = firstCard?.querySelector(":scope > .original-language-word-summary");
      const source = firstCard?.querySelector(":scope > .original-language-word-source");
      return {
        intro: Boolean(document.querySelector(".original-language-study-intro")),
        sourceCard: Boolean(document.querySelector(".original-language-source-card")),
        sourceTexts: [...verseSection.querySelectorAll(".original-language-source-card .source-text")].map((node) => ({
          text: node.textContent.trim(),
          direction: node.dir,
          language: node.lang,
          label: node.previousElementSibling?.textContent.trim() || "",
        })),
        sourceHeading: verseSection.querySelector(".original-language-source-card > .original-language-section-label")?.textContent.trim() || "",
        transliterationLabel: verseSection.querySelector(".original-language-transliteration-row .reference-label")?.textContent.trim() || "",
        transliteration: verseSection.querySelector(".original-language-transliteration")?.textContent.trim() || "",
        transliterationDescription: verseSection.querySelector(".original-language-transliteration")?.getAttribute("aria-description") || "",
        transliterationSymbols: [...verseSection.querySelectorAll(".original-language-transliteration .transliteration-symbol")].map((symbol) => ({
          text: symbol.textContent,
          tabIndex: symbol.tabIndex,
          label: symbol.getAttribute("aria-label") || "",
        })),
        wordCards: document.querySelectorAll(".original-language-word-card").length,
        summaryBeforeSource: Boolean(summary && source && summary.compareDocumentPosition(source) & Node.DOCUMENT_POSITION_FOLLOWING),
        originalInsideSource: Boolean(source?.querySelector(".token-original")),
        meaningInsideSummary: Boolean(summary?.querySelector(".token-english")),
        wordOrigin: verseSection.querySelector(".original-language-word-origin")?.textContent.trim() || "",
        superscription: (() => {
          const section = document.querySelector(".interlinear-superscription-section[data-segment-id]");
          return section ? {
            english: section.querySelector(".original-language-superscription-english")?.textContent.trim(),
            tokenIndexes: [...section.querySelectorAll(".original-language-word-card")].map((card) => card.dataset.tokenIndex),
            sourceTexts: [...section.querySelectorAll(".source-text")].map((node) => node.textContent.trim()),
          } : null;
        })(),
        bodyTokenIndexes: [...verseSection.querySelectorAll(".original-language-word-card")].map((card) => card.dataset.tokenIndex),
        editorialStrongCount: document.querySelectorAll(".presentation-block.section_heading .strong-token").length,
      };
    });

    assert(studyState.intro, `original-language study introduction missing: ${JSON.stringify(studyState)}`);
    assert(studyState.sourceCard, `full source verse card missing: ${JSON.stringify(studyState)}`);
    assert(
      studyState.sourceHeading === "Original Hebrew" &&
        studyState.sourceTexts.length === 2 &&
        studyState.sourceTexts.every((source) => /[\u0590-\u05ff]/u.test(source.text) && source.direction === "rtl" && source.language === "he") &&
        studyState.sourceTexts.some((source) => source.label === "Westminster Leningrad Codex") &&
        studyState.sourceTexts.some((source) => source.label === "WLC — Consonants Only"),
      `actual labeled Hebrew source rows are missing or misdirected: ${JSON.stringify(studyState)}`,
    );
    assertDeepEqual(
      Object.fromEntries(studyState.sourceTexts.map((source) => [source.label, source.text])),
      {
        "Westminster Leningrad Codex": "יְהוָ֥ה רֹ֝עִ֗י לֹ֣א אֶחְסָֽר׃",
        "WLC — Consonants Only": "יהוה רעי לא אחסר׃",
      },
      `rendered Hebrew source text must match the generated corpus exactly: ${JSON.stringify(studyState)}`,
    );
    assert(
      studyState.transliterationLabel === "Transliteration" &&
        studyState.transliteration &&
        !/[\u0590-\u05ff]/u.test(studyState.transliteration),
      `Hebrew transliteration is missing or mislabeled: ${JSON.stringify(studyState)}`,
    );
    assert(
      studyState.transliterationDescription.includes("Bundled interlinear transliteration") &&
        studyState.transliterationDescription.includes("not exact pronunciation") &&
        studyState.transliterationSymbols.some((symbol) => symbol.text === "ō") &&
        studyState.transliterationSymbols.some((symbol) => symbol.text === "·") &&
        studyState.transliterationSymbols.every((symbol) => symbol.tabIndex === 0 && !symbol.label.includes("not exact pronunciation")),
      `study transliteration symbols lack keyboard-accessible explanations: ${JSON.stringify(studyState)}`,
    );
    const touchTooltip = await page.evaluate(() => {
      const symbol = [...document.querySelectorAll(".interlinear-verse-section:not(.interlinear-superscription-section) .transliteration-symbol")]
        .find((node) => node.textContent === "ō");
      symbol?.click();
      const layer = document.querySelector(".language-tooltip-layer");
      return { visible: Boolean(layer && !layer.hidden), text: layer?.textContent || "" };
    });
    assert(touchTooltip.visible && /long o vowel/i.test(touchTooltip.text), `touch transliteration help did not open: ${JSON.stringify(touchTooltip)}`);
    assert(studyState.wordCards > 0, `word study cards missing: ${JSON.stringify(studyState)}`);
    assert(
      studyState.superscription?.english === "A Psalm of David." &&
        JSON.stringify(studyState.superscription.tokenIndexes) === JSON.stringify(["1", "2"]) &&
        studyState.superscription.sourceTexts.length === 2 &&
        !studyState.bodyTokenIndexes.includes("1") && !studyState.bodyTokenIndexes.includes("2") &&
        studyState.editorialStrongCount === 0,
      `canonical superscription mapping or editorial exclusion failed: ${JSON.stringify(studyState)}`,
    );
    assert(studyState.wordOrigin.includes("Word origin"), `word origin details missing: ${JSON.stringify(studyState)}`);
    assert(
      studyState.summaryBeforeSource && studyState.originalInsideSource && studyState.meaningInsideSummary,
      `word study card structure is incomplete: ${JSON.stringify(studyState)}`,
    );

    const layoutState = await page.evaluate(() => {
      const cards = [...document.querySelectorAll(".interlinear-verse-section:not(.interlinear-superscription-section) .original-language-word-card")];
      return {
        widths: cards.slice(0, 4).map((card) => ({
          card: card.getBoundingClientRect().width,
          summary: card.querySelector(":scope > .original-language-word-summary")?.getBoundingClientRect().width || 0,
          source: card.querySelector(":scope > .original-language-word-source")?.getBoundingClientRect().width || 0,
        })),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    assert(
      layoutState.widths.length >= 2 && layoutState.widths.every(({ card, summary, source }) => Math.abs(card - summary) <= 2 && Math.abs(card - source) <= 2) && layoutState.overflow <= 1,
      `short and long Language Study sections must fill their card without horizontal overflow: ${JSON.stringify(layoutState)}`,
    );

    const related = page.locator(".interlinear-verse-section:not(.interlinear-superscription-section) .original-language-related-link").first();
    assert(await related.count(), "Hebrew related Strong's control is missing");
    const historyBeforePreview = await page.evaluate(() => ({ title: document.querySelector("#detailTitle")?.textContent, back: document.querySelector("#detailBack")?.disabled }));
    await related.focus();
    await waitFor(page, () => document.querySelector(".interlinear-verse-section:not(.interlinear-superscription-section) .original-language-related-link")?.dataset.previewReady === "true");
    await related.hover();
    const tooltipContainment = await page.evaluate(() => {
      const tooltip = document.querySelector(".language-tooltip-layer:not([hidden])");
      const panel = document.querySelector(".detail-pane");
      if (!tooltip || !panel) return null;
      const tip = tooltip.getBoundingClientRect();
      const bounds = panel.getBoundingClientRect();
      return { left: tip.left >= bounds.left, right: tip.right <= bounds.right, top: tip.top >= Math.max(0, bounds.top), bottom: tip.bottom <= Math.min(innerHeight, bounds.bottom) };
    });
    assert(tooltipContainment && Object.values(tooltipContainment).every(Boolean), `related-entry tooltip escaped the detail panel: ${JSON.stringify(tooltipContainment)}`);
    const previewState = await related.evaluate((node) => ({ tooltip: node.dataset.tooltip, label: node.getAttribute("aria-label") }));
    const historyAfterPreview = await page.evaluate(() => ({ title: document.querySelector("#detailTitle")?.textContent, back: document.querySelector("#detailBack")?.disabled }));
    assert(previewState.tooltip.includes("Hebrew") && /H\d+/.test(previewState.tooltip) && previewState.label.startsWith("Open Strong's"), `Hebrew related preview is incomplete: ${JSON.stringify(previewState)}`);
    assertDeepEqual(historyAfterPreview, historyBeforePreview, "previewing a related entry must not mutate panel history");
    await related.click();
    await waitFor(page, () => document.querySelector("#detailTitle")?.textContent === "Strong's");
    await page.locator("#detailBack").click();
    await waitFor(page, () => document.querySelector("#detailTitle")?.textContent === "Language Study" && Boolean(document.querySelector(".original-language-study-intro")));

    await page.evaluate(() => {
      const pane = document.querySelector("#detailContent");
      pane.scrollTop = pane.scrollHeight;
      pane.dispatchEvent(new Event("scroll"));
    });
    await waitFor(
      page,
      () => Boolean(document.querySelector(".interlinear-verse-section[data-verse='2'][data-original-language-study='true']")),
      15000,
    );
    assert(
      await page.evaluate(() => document.querySelectorAll(".interlinear-verse-section[data-original-language-study='true']").length >= 2),
      "lazy-loaded interlinear verses were not enhanced as original-language study cards",
    );
    assert(
      await page.evaluate(
        () =>
          document.querySelectorAll(".interlinear-verse-section[data-verse='1']:not(.interlinear-superscription-section) .original-language-source-card").length === 1 &&
          document.querySelectorAll(".interlinear-verse-section[data-verse='1']:not(.interlinear-superscription-section) .original-language-transliteration-row").length === 1 &&
          document.querySelectorAll(".interlinear-superscription-section[data-segment-id] .original-language-source-card").length === 1,
      ),
      "source or transliteration cards were duplicated during lazy enhancement",
    );

    await page.goto(`${url}/#/read/bsb/john/1/1`, { waitUntil: "load" });
    await waitFor(page, () => Boolean(document.querySelector("#chapterTitle")?.textContent.includes("John 1")));
    await waitFor(page, () => document.querySelectorAll(".strong-token").length > 0);
    await click(page, ".strong-token");
    await waitFor(page, () => document.querySelector("#detailTitle")?.textContent === "Strong's");
    await clickButtonByText(page, "Int");
    await waitFor(page, () => Boolean(document.querySelector(".interlinear-verse-section[data-original-language-study='true']")));
    const greekState = await page.evaluate(() => ({
      heading: document.querySelector(".original-language-source-card > .original-language-section-label")?.textContent.trim() || "",
      sources: [...document.querySelectorAll(".original-language-source-card .source-text")].map((node) => ({
        text: node.textContent.trim(),
        direction: node.dir,
        language: node.lang,
        label: node.previousElementSibling?.textContent.trim() || "",
      })),
      transliterationLabel: document.querySelector(".original-language-transliteration-row .reference-label")?.textContent.trim() || "",
    }));
    assert(
      greekState.heading === "Original Greek" &&
        greekState.sources.length === 2 &&
        greekState.sources.every((source) => /[\u0370-\u03ff\u1f00-\u1fff]/u.test(source.text) && source.direction === "ltr" && source.language === "grc") &&
        greekState.sources.some((source) => source.label === "Nestle Greek New Testament 1904") &&
        greekState.sources.some((source) => source.label === "Scrivener’s Textus Receptus 1894") &&
        greekState.transliterationLabel === "Transliteration",
      `actual labeled Greek source rows are missing or misdirected: ${JSON.stringify(greekState)}`,
    );
    assertDeepEqual(
      Object.fromEntries(greekState.sources.map((source) => [source.label, source.text])),
      {
        "Nestle Greek New Testament 1904": "Ἐν ἀρχῇ ἦν ὁ Λόγος, καὶ ὁ Λόγος ἦν πρὸς τὸν Θεόν, καὶ Θεὸς ἦν ὁ Λόγος.",
        "Scrivener’s Textus Receptus 1894": "Ἐν ἀρχῇ ἦν ὁ λόγος, καὶ ὁ λόγος ἦν πρὸς τὸν Θεόν, καὶ Θεὸς ἦν ὁ λόγος.",
      },
      `rendered Greek source text must match the generated corpus exactly: ${JSON.stringify(greekState)}`,
    );

    await waitFor(page, () => Boolean(document.querySelector(".original-language-related-link")));
    const greekRelated = page.locator(".original-language-related-link").first();
    assert(await greekRelated.count(), "Greek related Strong's control is missing");
    await greekRelated.focus();
    await waitFor(page, () => document.querySelector(".original-language-related-link")?.dataset.previewReady === "true");
    assert((await greekRelated.getAttribute("data-tooltip")).includes("Greek"), "Greek related preview must identify its language");

    console.log(JSON.stringify({ status: "ok", assertions: 23 }, null, 2));
  } finally {
    await browser.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

await main();
