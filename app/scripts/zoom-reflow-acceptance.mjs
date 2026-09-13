import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";

// CSS viewport reflow coverage only. Browser zoom also changes rasterization;
// these cases do not claim a real 175%/200% browser zoom setting was exercised.
const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
  { width: 1097, height: 617 },
  { width: 960, height: 540 },
  { width: 769, height: 432 },
  { width: 768, height: 540 },
  { width: 720, height: 476 },
  { width: 390, height: 844 },
];

async function geometry(page) {
  return page.evaluate(() => {
    const rect = (node) => {
      const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    const pane = document.querySelector("#detailPane");
    const context = document.querySelector("#detailContext");
    const card = context.querySelector(".panel-context-navigation");
    const header = document.querySelector(".app-header");
    const detailHeader = document.querySelector(".detail-header");
    const floatingNav = document.querySelector(".detail-floating-nav");
    const contextStyle = getComputedStyle(context);
    const headerControls = [".brand", ".reader-controls", "#statusText", "#themeToggle"]
      .map((selector) => rect(header.querySelector(selector)));
    const contextRect = rect(context);
    const cardRect = rect(card);
    const horizontal = (child, parent) => child.left >= parent.left - 1 && child.right <= parent.right + 1;
    return {
      viewport: { width: innerWidth, height: innerHeight },
      finePointer: matchMedia("(hover: hover) and (pointer: fine)").matches,
      header: rect(header),
      headerControls,
      headerSingleRow: Math.max(...headerControls.map((box) => box.top)) < Math.min(...headerControls.map((box) => box.bottom)),
      headerNoOverlap: headerControls.slice(1).every((box, index) => box.left >= headerControls[index].right - 1),
      headerContained: headerControls.every((box) => horizontal(box, rect(header))),
      pane: rect(pane),
      detailHeader: rect(detailHeader),
      floatingNav: rect(floatingNav),
      context: contextRect,
      card: cardRect,
      cardFillsContext: Math.abs(cardRect.left - contextRect.left - parseFloat(contextStyle.paddingLeft)) <= 1 &&
        Math.abs(cardRect.width - (context.clientWidth - parseFloat(contextStyle.paddingLeft) - parseFloat(contextStyle.paddingRight))) <= 1,
      cardInsidePane: horizontal(cardRect, rect(pane)),
      contextInsidePane: horizontal(contextRect, rect(pane)) && contextRect.top >= rect(pane).top && contextRect.bottom <= rect(pane).bottom + 1,
      contextNoHorizontalOverflow: context.scrollWidth <= context.clientWidth + 1,
      contentHeight: document.querySelector("#detailContent").clientHeight,
      pageNoHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
      contextButtons: card.querySelectorAll("button").length,
    };
  });
}

export async function checkZoomReflow(browser, url) {
  const results = [];
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: VIEWPORTS[1] });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    try {
      await page.goto(`${url}/#/read/bsb/john/4/18`, { waitUntil: "load" });
      assert.equal(await page.title(), "Bible App Reader");
      await page.locator('.verse-row[data-verse="18"] .strong-token[data-strong-code="G227"]').first().click();
      await page.waitForFunction(() => document.querySelector("#detailContent .strong-code")?.textContent === "G227" &&
        Boolean(document.querySelector("#detailContext .panel-context-navigation")));
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      await page.evaluate(() => document.fonts.ready);
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        const desktop = viewport.width >= 769;
        if (!desktop && !(await page.locator("#detailPane").evaluate((node) => node.classList.contains("visible")))) {
          await page.locator("#openStudyPanel").click();
        }
        for (const mode of desktop ? ["compact", "standard", "expanded"] : ["drawer"]) {
          if (desktop) {
            for (let attempt = 0; attempt < 3; attempt += 1) {
              if (await page.evaluate(() => document.documentElement.dataset.studyWorkspaceWidth) === mode) break;
              await page.locator("#studyWorkspaceWidthCycle").click();
            }
            assert.equal(await page.evaluate(() => document.documentElement.dataset.studyWorkspaceWidth), mode);
          }
          // Wait for the existing resize observer and drawer transition to settle;
          // no DOM styles are overridden to manufacture the desired geometry.
          await page.waitForFunction(() => {
            const pane = document.querySelector("#detailPane").getBoundingClientRect();
            const header = document.querySelector(".app-header").getBoundingClientRect();
            return innerWidth < 769 ? pane.left >= -1 && pane.right <= innerWidth + 1 :
              Math.abs(parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--app-header-block-size")) - Math.ceil(header.height)) <= 1;
          });
          const state = await geometry(page);
          const label = `${theme}/${viewport.width}x${viewport.height}/${mode}`;
          const diagnostic = `${label}: ${JSON.stringify(state)}`;
          assert(state.pageNoHorizontalOverflow, `Page overflow: ${diagnostic}`);
          assert(state.contextButtons > 0, `Missing actual context controls: ${diagnostic}`);
          assert(state.cardFillsContext && state.cardInsidePane && state.contextInsidePane && state.contextNoHorizontalOverflow,
            `Context card must fill and remain inside the Study pane: ${diagnostic}`);
          assert(state.contentHeight >= 44, `Context must leave usable Study content space: ${diagnostic}`);
          if (desktop) {
            assert(state.header.height <= 88 && state.headerSingleRow && state.headerNoOverlap && state.headerContained,
              `Desktop header must remain a compact, nonoverlapping row: ${diagnostic}`);
          }
          const zoomedFinePointer = viewport.width >= 641 && viewport.width <= 768 && state.finePointer;
          if (zoomedFinePointer) {
            assert(state.header.height <= 118,
              `Fine-pointer narrow reflow must not let the Reader header dominate the viewport: ${diagnostic}`);
            assert(state.detailHeader.height <= 64 && state.floatingNav.height <= 40,
              `Fine-pointer narrow reflow must keep Study chrome compact: ${diagnostic}`);
            assert(state.context.height <= state.viewport.height * 0.34,
              `Fine-pointer narrow reflow must bound the WORD/VERSE context card: ${diagnostic}`);
          }
          // Keyboard focus must be able to reveal the final context action even
          // when a short viewport requires this bounded region to scroll.
          const last = page.locator("#detailContext button:not([disabled])").last();
          await last.focus();
          const reachable = await last.evaluate((node) => {
            const item = node.getBoundingClientRect();
            const host = document.querySelector("#detailContext").getBoundingClientRect();
            return document.activeElement === node && item.top >= host.top - 1 && item.bottom <= host.bottom + 1;
          });
          assert(reachable, `Final context action must be keyboard-reachable: ${label}`);
          if (process.env.BIBLEAPP_UI_EVIDENCE_DIR) {
            mkdirSync(process.env.BIBLEAPP_UI_EVIDENCE_DIR, { recursive: true });
            await page.screenshot({ path: path.join(process.env.BIBLEAPP_UI_EVIDENCE_DIR, `reflow-${theme}-${viewport.width}-${mode}.png`) });
          }
          results.push({ theme, ...viewport, mode, finePointer: state.finePointer, headerHeight: state.header.height, paneWidth: state.pane.width });
        }
      }
      assert.deepEqual(errors, [], `${theme}: reflow acceptance reported browser errors`);
    } finally {
      await page.close();
    }
  }
  return { actualBrowserZoom: false, cases: results };
}
