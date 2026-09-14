#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { startStaticAppServer } from "../tools/serve-app.mjs";

// Isolated browser contexts and CSS viewport transitions. Actual browser-menu
// zoom is a separate acceptance gate; changing a viewport cannot prove it.
const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
assert(executablePath, "Microsoft Edge is required for the browser regressions");
const { server, url } = await startStaticAppServer({ port: 0 });
const browser = await chromium.launch({ executablePath, headless: true });
const results = [];
const section = (verse) => `.interlinear-verse-section:not(.interlinear-superscription-section)[data-verse="${verse}"]`;

async function settle(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function locked(page, label) {
  assert.equal(await page.locator('#detailTitle').textContent(), 'Language Study', `${label}: Language view was replaced`);
  assert.equal(await page.locator('#detailPane').getAttribute('data-panel-mode'), 'locked', `${label}: Language view unlocked`);
}
async function passiveInteractions(page, label, textSelector) {
  const content = await page.locator('#detailContent > :first-child').elementHandle();
  await page.locator(textSelector).first().click();
  await locked(page, `${label}/ordinary text`);
  await page.locator('#detailContent').hover();
  await page.mouse.wheel(0, 250);
  await settle(page);
  await locked(page, `${label}/scroll`);
  await page.mouse.move(0, 0);
  await locked(page, `${label}/pointer exit`);
  // Reader hover is relevant while the desktop Reader remains exposed.
  if (await page.evaluate(() => innerWidth > 768)) {
    await page.locator('.verse-row[data-verse="2"] .strong-token').first().hover();
    await page.waitForTimeout(450); // Allow the real hover-preview debounce to fire.
    await locked(page, `${label}/Reader hover`);
  }
  assert(await content.evaluate(node => node.isConnected && node === document.querySelector('#detailContent > :first-child')),
    `${label}: passive interaction rebuilt the Language content`);
  await content.dispose();
}
async function layout(page, label) {
  await settle(page);
  const state = await page.evaluate(() => {
    const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
    const pane = document.querySelector('#detailPane');
    const header = document.querySelector('.detail-header');
    const context = document.querySelector('#detailContext');
    const content = document.querySelector('#detailContent');
    return {
      width: innerWidth, height: innerHeight, pane: rect('#detailPane'), header: rect('.detail-header'),
      context: rect('#detailContext'), content: rect('#detailContent'),
      historyInHeader: !!header.querySelector('.detail-header-actions .detail-floating-nav'),
      historyRowsInBody: document.querySelectorAll('#detailWorkArea .detail-floating-nav').length,
      bodyGap: context.getBoundingClientRect().top - header.getBoundingClientRect().bottom,
      overflow: document.documentElement.scrollWidth - innerWidth,
      contentOverflow: content.scrollWidth - content.clientWidth,
      drawerOpen: pane.classList.contains('visible'), inert: pane.inert,
    };
  });
  assert(state.historyInHeader && state.historyRowsInBody === 0, `${label}: separate history row remains`);
  assert(Math.abs(state.bodyGap) <= 1, `${label}: spacer remains below the header: ${JSON.stringify(state)}`);
  assert(state.overflow <= 1 && state.contentOverflow <= 1, `${label}: horizontal overflow: ${JSON.stringify(state)}`);
  assert(state.pane.bottom <= state.height + 1 && state.pane.top >= -1, `${label}: pane clipped by viewport: ${JSON.stringify(state)}`);
  assert(state.content.height >= 72, `${label}: toolbar consumes usable content space: ${JSON.stringify(state)}`);
  if (state.width <= 768) assert(state.drawerOpen && !state.inert, `${label}: open Study was lost crossing into drawer width`);
  const last = page.locator('#detailContext button:not([disabled])').last();
  await page.locator('#clearDetail').focus();
  await last.focus();
  assert(await last.evaluate(node => {
    const r = node.getBoundingClientRect(), host = document.querySelector('#detailContext').getBoundingClientRect();
    return document.activeElement === node && r.top >= host.top - 1 && r.bottom <= host.bottom + 1;
  }), `${label}: last context action cannot be reached with the keyboard`);
  return { label, ...state };
}
async function capture(page, name) {
  if (!process.env.STUDY_FOLLOWUP_SCREENSHOT_DIR) return;
  mkdirSync(process.env.STUDY_FOLLOWUP_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(process.env.STUDY_FOLLOWUP_SCREENSHOT_DIR, `${name}.png`) });
}
async function stickyHeadings(page, label) {
  // Load the next real verse through the owned scroll region, then exercise
  // positions immediately before, during and after the heading handoff.
  await page.locator('#detailContent').evaluate(node => { node.scrollTop = node.scrollHeight; });
  await page.locator(section(2)).waitFor();
  const positions = [];
  for (const delta of [80, 16, 0, -20]) {
    await page.evaluate(({ selector, delta }) => {
      const content = document.querySelector('#detailContent');
      const target = document.querySelector(selector);
      content.scrollTop = 0; // Measure the heading before sticky positioning applies.
      content.scrollTop += target.getBoundingClientRect().top - content.getBoundingClientRect().top - delta;
    }, { selector: `${section(2)} .original-language-verse-reference`, delta });
    await settle(page);
    const state = await page.evaluate(({ first, next }) => {
      const content = document.querySelector('#detailContent').getBoundingClientRect();
      const a = document.querySelector(first).getBoundingClientRect();
      const b = document.querySelector(next).getBoundingClientRect();
      return { contentTop: content.top, firstTop: a.top, firstBottom: a.bottom, nextTop: b.top, nextBottom: b.bottom,
        firstSection: document.querySelector(first).parentElement.getBoundingClientRect().toJSON(),
        nextSection: document.querySelector(next).parentElement.getBoundingClientRect().toJSON() };
    }, { first: `${section(1)} .original-language-verse-reference`, next: `${section(2)} .original-language-verse-reference` });
    assert(state.firstBottom <= state.nextTop + 1, `${label}: verse headings overlap at handoff: ${JSON.stringify(state)}`);
    if (delta === 80) assert(Math.abs(state.firstTop - state.contentTop) <= 1, `${label}: heading is not directly below controls: ${JSON.stringify(state)}`);
    if (delta <= 0) assert(Math.abs(state.nextTop - state.contentTop) <= 1, `${label}: next heading did not take over: ${JSON.stringify(state)}`);
    positions.push(state);
  }
  await capture(page, `language-${label}-sticky-next-verse`);
  return positions;
}

try {
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`${url}/#/read/bsb/psalms/23`, { waitUntil: 'networkidle' });
    await page.locator('.strong-token').first().waitFor();
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    await page.locator('#showInterlinear').click();
    await page.locator('.interlinear-picker').waitFor();
    await locked(page, `${theme}/chapter entry`);
    await passiveInteractions(page, `${theme}/chapter entry`, '.interlinear-picker h3');
    await page.getByRole('button', { name: 'Inspect', exact: true }).first().click();
    await page.locator(`${section(1)} .original-language-word-card`).first().waitFor();
    await passiveInteractions(page, `${theme}/chapter Inspect`, '.original-language-study-intro');

    await page.locator('#clearDetail').click();
    assert.equal(await page.locator('#detailPane').getAttribute('data-panel-mode'), 'follow', 'Clear must release the Language lock');
    await page.locator('.verse-row[data-verse="1"] .strong-token').first().click();
    await page.locator('#detailContext button').filter({ hasText: /^Language$/ }).click();
    await page.locator(`${section(1)} .original-language-word-card`).first().waitFor();
    await passiveInteractions(page, `${theme}/context entry`, '.original-language-study-intro');
    const languageNode = await page.locator('#detailContent > :first-child').elementHandle();
    const route = await page.evaluate(() => location.hash);
    const frames = [];
    for (const mode of ['compact', 'standard']) {
      while (await page.locator('html').getAttribute('data-study-workspace-width') !== mode) await page.locator('#studyWorkspaceWidthCycle').click();
      frames.push(await layout(page, `${theme}/${mode}`));
    }
    for (const viewport of [{ width:1280,height:720 }, { width:852,height:414 }, { width:745,height:362 },
      { width:390,height:844 }, { width:1280,height:720 }]) {
      await page.setViewportSize(viewport);
      const frame = await layout(page, `${theme}/${viewport.width}x${viewport.height}`);
      await locked(page, frame.label);
      assert.equal(await page.evaluate(() => location.hash), route, 'Reflow changed the Reader route');
      assert(await languageNode.evaluate(node => node.isConnected), 'Reflow rebuilt the open Language view');
      frames.push(frame);
      if (viewport.width === 745) await capture(page, `language-${theme}-745x362-viewport`);
    }
    const sticky = await stickyHeadings(page, theme);
    await page.setViewportSize({ width:390, height:844 });
    frames.push(await layout(page, `${theme}/loaded-phrases-390`));
    sticky.push(...await stickyHeadings(page, `${theme}-narrow`));
    const phrases = await page.locator('.original-language-word-summary .token-english').evaluateAll(nodes => nodes.map(node => ({
      text: node.textContent.trim(), size: parseFloat(getComputedStyle(node).fontSize),
      weight: Number(getComputedStyle(node).fontWeight), overflow: node.scrollWidth - node.clientWidth,
      glossSize: parseFloat(getComputedStyle(node.parentElement.querySelector('.token-gloss') || node.parentElement).fontSize),
    })));
    assert(phrases.length > 4 && phrases.every(p => p.size >= 20 && p.size > p.glossSize && p.weight >= 700 && p.overflow <= 1),
      `${theme}: English phrases must be prominent without overflow: ${JSON.stringify(phrases)}`);
    await page.locator(`${section(2)} .original-language-word-card`).first().evaluate(node => {
      const content = document.querySelector('#detailContent');
      const heading = node.closest('section').querySelector('.original-language-verse-reference');
      content.scrollTop += node.getBoundingClientRect().top - content.getBoundingClientRect().top - heading.getBoundingClientRect().height - 8;
    });
    await settle(page);
    await capture(page, `language-${theme}-narrow-english-phrase`);
    await page.setViewportSize({ width:1280, height:720 });
    await settle(page);

    await page.locator('.detail-header-actions #detailBack').click();
    await page.waitForFunction(() => document.querySelector('#detailTitle').textContent !== 'Language Study');
    await page.locator('.detail-header-actions #detailForward').click();
    await locked(page, `${theme}/history restoration`);
    // Both available history buttons participate in the header's real Tab order.
    await page.locator('#studyWorkspaceWidthCycle').focus();
    const expectedOrder = await page.locator('.detail-header-actions button:not([disabled])').evaluateAll(nodes => nodes.map(node => node.id));
    const order = [];
    for (const id of expectedOrder) { await page.keyboard.press('Tab'); order.push(await page.evaluate(() => document.activeElement.id)); }
    assert.deepEqual(order, expectedOrder, 'Header history must preserve DOM/keyboard order');
    await page.locator('#detailContent .token-meta button').first().click();
    await page.waitForFunction(() => document.querySelector('#detailTitle').textContent === "Strong's");
    await page.locator('#clearDetail').click();
    await page.locator('#nextChapter').click();
    await page.waitForFunction(() => document.querySelector('#chapterTitle').textContent === 'Psalms 24');
    assert.deepEqual(errors, [], `${theme}: browser errors`);
    results.push({ theme, entryPoints:2, passiveLockChecks:12, frames, sticky, phrases:phrases.length, clearHistoryAndNavigation:true });
    await context.close();
  }
  console.log(JSON.stringify({ status:'ok', actualBrowserZoom:false, results }, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
