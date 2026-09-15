#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { startStaticAppServer } from "../tools/serve-app.mjs";
import { mapStrongChapterRanges } from "../src/strongs.js";
import { UI_ACTION_CONTRACTS } from "../src/ui-contracts.js";

const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
assert(executablePath, "An installed Edge is required");
const evidence = process.env.ANNOTATION_SCREENSHOT_DIR;
if (evidence) await mkdir(evidence, { recursive: true });
const verses = JSON.parse(await readFile(new URL("../data/verses/bsb/john.json", import.meta.url))).chapters["1"];
const strongs = JSON.parse(await readFile(new URL("../data/strongs/bsb/books/john.json", import.meta.url))).chapters["1"];
const mapped = mapStrongChapterRanges(verses, strongs)["1"];
const exactToken = mapped.find(range => range.token.token_index === 2);
assert(exactToken.end - exactToken.start > 5);
const key = "john:1:1";
const fixture = { version: 3, token_renderings: {}, red_letter_ranges: { [key]: [
  { start: 0, end: 20, text: verses["1"].slice(0, 20), legacy: "retained" },
  { start: exactToken.start + 2, end: exactToken.end - 2, classification: "pink", updated_at: "2026-01-02T00:00:00Z" },
  { start: 45, end: 50, classification: "black" },
] } };
const { server, url } = await startStaticAppServer({ port: 0 });
const browser = await chromium.launch({ executablePath, headless: true });
const results = [];
async function ready(page) {
  await page.waitForFunction(() => document.querySelector('.verse-row[data-verse="1"] .strong-token') && document.querySelector('#statusText')?.textContent.includes('data loaded'));
}
async function readerVisible(page) {
  if (page.viewportSize().width > 768) return;
  const hide = page.locator("#hideStudyWorkspace");
  if (await hide.isVisible()) await hide.click();
}
async function workspace(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open(document.documentElement.dataset.userStorageDatabase, 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const get = db.transaction("user_stores").objectStore("user_stores").get("workspace");
      get.onsuccess = () => { db.close(); resolve(get.result?.value || {}); };
      get.onerror = () => { db.close(); reject(get.error); };
    };
  }));
}
async function persisted(page, predicate) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const value = await workspace(page);
    if (predicate(value)) return value;
    await page.waitForTimeout(50);
  }
  assert.fail("Expected annotation was not persisted to IndexedDB");
}
async function snapshot(page) {
  return page.evaluate(() => ({
    route: location.hash, history: history.length, x: scrollX, y: scrollY,
    scroll: document.querySelector('#chapterContent').scrollTop,
    mode: document.querySelector('#detailPane').dataset.panelMode,
    title: document.querySelector('#detailTitle').textContent,
  }));
}
async function audit(page) {
  const failures = await page.evaluate(async (contracts) => {
    const issues = [];
    const { auditStudyControls, duplicateScopedLabels } = await import(new URL('./src/ui-label-audit.js', document.baseURI).href);
    const studyAudit = auditStudyControls();
    for (const [kind, findings] of Object.entries(studyAudit)) {
      if (findings.length) issues.push(`${kind}: ${JSON.stringify(findings)}`);
    }
    const shortcutLabels = [];
    [...document.querySelectorAll('.home-action-grid, .selection-action-menu')].forEach((scope, index) => {
      for (const node of scope.querySelectorAll('button[data-ui-action]')) {
        if (node.getClientRects().length && !node.closest('[hidden],[inert]')) shortcutLabels.push({ scope: index, label: node.textContent });
      }
    });
    if (duplicateScopedLabels(shortcutLabels).length) issues.push('duplicate shortcut labels');
    const ids = new Set();
    for (const node of document.querySelectorAll('[id]')) {
      if (ids.has(node.id)) issues.push(`duplicate ID ${node.id}`);
      ids.add(node.id);
    }
    for (const node of document.querySelectorAll('button[data-ui-action], [role="button"][data-ui-action]')) {
      if (!node.getClientRects().length || node.closest('[hidden],[inert]')) continue;
      const contract = contracts[node.dataset.uiAction];
      if (!contract) { issues.push(`unknown ${node.dataset.uiAction}`); continue; }
      const name = node.getAttribute('aria-label') || node.textContent.trim();
      const tip = node.dataset.uiTip || node.title;
      if (!node.classList.contains('ui-action-control')) issues.push(`missing presentation ${contract.id}`);
      if (!name.includes(contract.label) && !name.includes(contract.compactLabel)) issues.push(`name ${contract.id}: ${name}`);
      if (tip !== contract.tip && !node.disabled && node.dataset.unavailable !== 'true') issues.push(`tip ${contract.id}: ${tip}`);
    }
    if (document.documentElement.scrollWidth > innerWidth + 1) issues.push('page overflow');
    return issues;
  }, UI_ACTION_CONTRACTS);
  assert.deepEqual(failures, []);
}
async function selectRange(page, start, end, mouse = false) {
  const points = await page.evaluate(({ start, end, mouse }) => {
    const body = document.querySelector('.verse-row[data-verse="1"] .verse-body');
    const segments = [...body.querySelectorAll('[data-verse-char-start][data-verse-char-end]')];
    const endpoint = (position, isEnd) => {
      const segment = segments.find(n => isEnd ? +n.dataset.verseCharStart < position && +n.dataset.verseCharEnd >= position : +n.dataset.verseCharStart <= position && +n.dataset.verseCharEnd > position);
      const walker = document.createTreeWalker(segment, NodeFilter.SHOW_TEXT);
      let node, remaining = position - +segment.dataset.verseCharStart;
      while ((node = walker.nextNode())) {
        if (remaining <= node.length) return [node, remaining];
        remaining -= node.length;
      }
      throw new Error('selection endpoint missing');
    };
    const a = endpoint(start, false), b = endpoint(end, true);
    const range = document.createRange();
    range.setStart(...a); range.setEnd(...b);
    if (!mouse) {
      getSelection().removeAllRanges(); getSelection().addRange(range);
      body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    }
    const left = range.cloneRange(), right = range.cloneRange();
    left.collapse(true); right.collapse(false);
    const aRect = left.getBoundingClientRect(), bRect = right.getBoundingClientRect();
    return { a: { x: aRect.left + 4, y: aRect.top + aRect.height / 2 }, b: { x: bRect.right - 2, y: bRect.top + bRect.height / 2 } };
  }, { start, end, mouse });
  if (mouse) {
    await page.mouse.move(points.a.x, points.a.y); await page.mouse.down();
    await page.mouse.move(points.b.x, points.b.y, { steps: 10 });
    await page.mouse.up();
    assert(await page.locator('.selection-action-menu').isVisible(), 'mouse drag must open selection menu');
  }
  await page.locator('.selection-action-menu').waitFor({ state: 'visible' });
  await page.locator('.user-annotation-tooltip-layer').waitFor({ state: 'hidden' });
}
async function preview(page, marker, expected, interaction) {
  if (interaction === 'hover') await marker.hover();
  else if (interaction === 'focus') { await marker.focus(); await marker.press('Tab'); await page.keyboard.press('Shift+Tab'); }
  else await marker.tap();
  const tooltip = page.locator('.user-annotation-tooltip-layer');
  await tooltip.waitFor({ state: 'visible' });
  assert.match(await tooltip.innerText(), new RegExp(expected));
  assert.match(await tooltip.innerText(), /Original source:/);
  assert.match(await tooltip.innerText(), /Strong's G746/);
  assert.match(await tooltip.innerText(), /Your saved alternative wording/);
  const rect = await tooltip.boundingBox();
  const viewport = page.viewportSize();
  assert(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= viewport.width + 1 && rect.y + rect.height <= viewport.height + 1, 'preview must stay in viewport');
}
try {
  for (const profile of [
    { name: 'compact-light', width: 1365, height: 900, mode: 'compact', theme: 'light' },
    { name: 'standard-dark', width: 1365, height: 900, mode: 'standard', theme: 'dark' },
    { name: 'expanded-light', width: 1365, height: 900, mode: 'expanded', theme: 'light' },
    { name: 'narrow-touch-dark', width: 390, height: 844, mode: 'standard', theme: 'dark', touch: true },
  ]) {
    const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height }, hasTouch: Boolean(profile.touch), isMobile: Boolean(profile.touch), colorScheme: profile.theme, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', e => { if (['error', 'warning'].includes(e.type())) errors.push(e.text()); });
    await page.addInitScript((fixture) => {
      if (!localStorage.getItem('annotation-fixture-seeded')) {
        localStorage.setItem('bibleapp:translation-workspace:v1', JSON.stringify(fixture));
        localStorage.setItem('annotation-fixture-seeded', 'true');
      }
    }, fixture);
    await page.goto(`${url}/#/read/bsb/john/1`);
    await ready(page);
    assert.match(await page.title(), /Bible/);
    assert.equal(await page.locator('vite-error-overlay, nextjs-portal').count(), 0);
    if (await page.locator('html').getAttribute('data-theme') !== profile.theme) await page.locator('#themeToggle').click();
    const row = page.locator('.verse-row[data-verse="1"]');
    assert(await row.locator('.strong-token.speech-attribution').count() > 0);
    assert(await row.locator('.reader-text-segment.speech-attribution').count() > 0);
    assert(await row.locator('.strong-token[data-token-index="2"]').count() > 1, 'fixture must split the exact token');
    assert.deepEqual(await row.locator('.strong-token[data-token-index="2"]').evaluateAll(nodes => nodes.map(n => n.dataset.speechAttribution)), ['red', 'pink', 'red'], 'most-specific inner attribution wins on split fragments');
    const text = await row.locator('[data-verse-char-start]').allTextContents();
    assert.equal(text.join(''), verses['1'], 'range segmentation must not corrupt Scripture');
    assert.equal(await row.locator('.interpretation-marker').count(), 0);

    // Create with the existing editor; the Reader marker must appear immediately.
    await row.locator('.strong-token[data-token-index="2"]').first().click();
    await page.locator('#detailContext .word-meaning-trigger').waitFor();
    if (!profile.touch) {
      for (let n = 0; n < 3 && !(await page.locator('#studyWorkspaceWidthCycle').getAttribute('aria-label')).includes(`width: ${profile.mode[0].toUpperCase()}${profile.mode.slice(1)}.`); n++) await page.locator('#studyWorkspaceWidthCycle').click();
    }
    await page.locator('#detailContext .word-meaning-trigger').click();
    await page.getByRole('button', { name: 'Add alternative wording', exact: true }).click();
    await page.locator('.word-meaning-custom-input').fill('My beginning');
    await page.locator('.word-meaning-save').click();
    const marker = row.locator('.interpretation-marker');
    await marker.waitFor({ state: 'attached' });
    assert.equal(await marker.count(), 1, 'one exact source-token marker despite fragment splits');
    assert.equal(await page.locator('#detailContext .word-meaning-badge').count(), 1);
    await persisted(page, value => value.token_renderings?.[key]?.[2]?.rendering === 'My beginning');
    await readerVisible(page);
    const before = await snapshot(page);
    if (!profile.touch) assert.equal(before.mode, 'locked');
    await preview(page, marker, 'My beginning', profile.touch ? 'touch' : 'hover');
    if (!profile.touch) await preview(page, marker, 'My beginning', 'focus');
    assert.deepEqual(await snapshot(page), before, 'preview preserves route, scroll, history and Study lock');
    await audit(page);
    if (evidence) await page.screenshot({ path: resolve(evidence, `${profile.name}-preview.png`) });
    await page.keyboard.press('Escape');
    assert.deepEqual(await snapshot(page), before, 'dismissing the preview must not reset Study');
    await selectRange(page, exactToken.start + 2, exactToken.end - 2);
    assert.equal(await page.getByRole('combobox', { name: 'Speech attribution — private annotation' }).inputValue(), 'pink', 'an exact partial-word range imported from backup must remain editable');
    assert.equal(await page.locator('.selection-speech-attribution option[value="clear"]').evaluate(node => node.disabled), false, 'an imported partial-word range must remain clearable');
    await page.getByRole('combobox', { name: 'Speech attribution — private annotation' }).selectOption('gray');
    await persisted(page, value => value.red_letter_ranges[key].some(r => r.start === exactToken.start + 2 && r.end === exactToken.end - 2 && r.classification === 'gray'));
    await selectRange(page, exactToken.start + 2, exactToken.end - 2);
    await page.getByRole('combobox', { name: 'Speech attribution — private annotation' }).selectOption('pink');

    // Native select input is reachable with keyboard and touch. The first
    // desktop selection is a real mouse drag; subsequent exact offsets are
    // fixtures for repeatable overlap/clear assertions.
    const selected = { start: 3, end: 16 };
    for (const [index, classification] of ['red', 'pink', 'gray', 'black'].entries()) {
      await selectRange(page, selected.start, selected.end, index === 0 && !profile.touch);
      const choices = page.getByRole('combobox', { name: 'Speech attribution — private annotation' });
      if (index === 0) {
        const beforeDismiss = await snapshot(page);
        await choices.focus(); await choices.press('Escape');
        assert.equal(await page.locator('.selection-action-menu').isVisible(), false);
        assert.deepEqual(await snapshot(page), beforeDismiss, 'dismissing selected text actions preserves Study and Reader state');
        await selectRange(page, selected.start, selected.end);
      }
      if (evidence && index === 1) await page.screenshot({ path: resolve(evidence, `${profile.name}-selection.png`) });
      assert.match(await choices.locator(`option[value="${classification}"]`).innerText(), /Attributed|attributed/);
      const beforeApply = await snapshot(page);
      if (index === 0 && !profile.touch) { await choices.focus(); await choices.press('ArrowDown'); }
      else await choices.selectOption(classification);
      await persisted(page, value => value.red_letter_ranges?.[key]?.some(r => r.start === selected.start && r.end === selected.end && r.classification === classification));
      assert.deepEqual(await snapshot(page), beforeApply, 'apply/change must preserve Reader route, scroll, history and Study lock');
      assert.deepEqual(await row.locator('.strong-token[data-token-index="2"]').evaluateAll(nodes => nodes.map(n => n.dataset.speechAttribution)), [classification, 'pink', classification]);
      assert.equal(await marker.count(), 1);
      assert.equal(await row.locator('.strong-token[data-token-index="2"]').allTextContents().then(v => v.join('')), verses['1'].slice(exactToken.start, exactToken.end));
    }
    const stored = await workspace(page);
    assert.equal(stored.red_letter_ranges[key].filter(r => r.start === 3 && r.end === 16).length, 1);
    await selectRange(page, selected.start, selected.end);
    await page.getByRole('combobox', { name: 'Speech attribution — private annotation' }).selectOption('clear');
    await persisted(page, value => !value.red_letter_ranges[key].some(r => r.start === 3 && r.end === 16));
    assert(await row.locator('[data-speech-attribution="pink"]').count() > 0, 'clear exact range preserves nested annotation');
    await selectRange(page, exactToken.start + 2, exactToken.end - 2);
    await page.getByRole('combobox', { name: 'Speech attribution — private annotation' }).selectOption('clear');
    await persisted(page, value => !value.red_letter_ranges[key].some(r => r.start === exactToken.start + 2 && r.end === exactToken.end - 2));
    assert.equal(await row.locator('[data-speech-attribution="pink"]').count(), 0, 'clear removes an imported partial-word range');
    assert(await row.locator('[data-speech-attribution="red"]').count() > 0, 'clear preserves the covering legacy annotation');
    await page.reload(); await ready(page);
    assert.equal(await marker.count(), 1, 'marker survives IndexedDB reload');
    await page.locator('#showInterlinear').click();
    await page.getByRole('button', { name: 'Language Study for John 1:1', exact: true }).click();
    const card = page.locator('.interlinear-verse-section[data-verse="1"] .interlinear-token[data-token-index="2"]').first();
    await card.locator('.word-meaning-trigger').waitFor();
    assert.equal(await card.locator('.interpretation-marker').count(), 1, 'Language Study shares the exact saved record');
    await card.locator('.word-meaning-trigger').click();
    await page.getByRole('button', { name: 'Add alternative wording', exact: true }).click();
    await page.locator('.word-meaning-custom-input').fill('My updated beginning');
    await page.locator('.word-meaning-save').click();
    assert.match(await marker.getAttribute('aria-label'), /My updated beginning/);
    assert.equal(await marker.count(), 1);
    await card.locator('.word-meaning-trigger').click();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    assert.equal(await marker.count(), 0, 'delete removes Reader marker immediately');
    assert.equal(await card.locator('.interpretation-marker').count(), 0, 'delete removes Language marker immediately');
    await audit(page);
    await persisted(page, value => !value.token_renderings?.[key]?.[2]);
    await readerVisible(page);
    await page.locator('#homeButton').click();
    await page.locator('.home-action-grid').waitFor();
    await audit(page);
    assert.deepEqual(await page.locator('.home-action[data-ui-action]').allTextContents(), ['Search', 'Study Marks', 'My Data']);
    // Same browser context, distinct actual IndexedDB authorities for Stable/Lab.
    await page.goto(`${url}/?profile=lab#/read/bsb/john/1`); await ready(page);
    assert.equal(await page.locator('.speech-attribution').count(), 0);
    assert.deepEqual((await workspace(page)).red_letter_ranges, {});
    await page.goto(`${url}/#/read/bsb/john/1`); await ready(page);
    assert(await row.locator('.speech-attribution').count() > 0);
    assert.deepEqual(errors, [], `${profile.name}: browser health`);
    results.push(`${profile.name}: persistence, overlap, exact-token markers, previews, actions and geometry PASS`);
    await context.close();
  }
  console.log(JSON.stringify({ status: 'ok', results, zoom: 'Responsive viewports only; actual browser zoom is a separate rendered check.' }, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
