#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { startStaticAppServer } from "../tools/serve-app.mjs";

const executablePath = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find(existsSync);
assert(executablePath, "An installed Edge is required.");

const { server, url } = await startStaticAppServer({ port: 0 });
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--disable-gpu", "--disable-background-networking", "--no-first-run"],
});

async function ready(page, title) {
  await page.waitForFunction(
    (expectedTitle) =>
      document.querySelector("#chapterTitle")?.textContent.includes(expectedTitle) &&
      document.querySelector("#statusText")?.textContent.includes("data loaded"),
    title,
  );
}

async function openOutline(page) {
  await page.locator("#showOutline").click();
  await page.waitForFunction(
    () =>
      document.querySelector("#detailTitle")?.textContent === "Outline" &&
      document.querySelector(".detail-pane")?.dataset.displayedView === "outline",
  );
}

async function seedOutlineScroll(page) {
  return page.locator("#detailContent").evaluate((node) => {
    const maxScrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
    node.scrollTop = Math.min(maxScrollTop, Math.max(80, Math.floor(maxScrollTop * 0.3)));
    return { maxScrollTop, scrollTop: node.scrollTop };
  });
}

async function detailState(page) {
  return page.evaluate(() => {
    const pane = document.querySelector(".detail-pane");
    return {
      displayedView: pane?.dataset.displayedView || "",
      panelMode: pane?.dataset.panelMode || "",
      title: document.querySelector("#detailTitle")?.textContent || "",
      scrollTop: document.querySelector("#detailContent")?.scrollTop || 0,
      mobileVisible: Boolean(pane?.classList.contains("visible")),
      workspaceHidden: document.documentElement.dataset.studyWorkspaceHidden === "true",
    };
  });
}

async function assertReaderDestinationVisible(page, verse, label) {
  await page.waitForFunction(
    (targetVerse) => {
      const row = document.querySelector(`.verse-row[data-verse="${CSS.escape(String(targetVerse))}"]`);
      const header = document.querySelector(".app-header")?.getBoundingClientRect();
      const rect = row?.getBoundingClientRect();
      return Boolean(
        rect &&
          rect.bottom > (header?.bottom || 0) &&
          rect.top < window.innerHeight,
      );
    },
    String(verse),
  );
  const rect = await page.locator(`.verse-row[data-verse="${verse}"]`).boundingBox();
  assert(rect, `${label}: Reader destination verse is not rendered`);
}

async function clickOutlineReference(page, label) {
  await page.getByRole("button", { name: label, exact: true }).click();
}

async function navigateBookSelect(page, bookId) {
  await page.locator("#bookSelect").evaluate((node, nextBook) => {
    node.value = nextBook;
    node.dispatchEvent(new Event("change", { bubbles: true }));
  }, bookId);
}

async function runSideBySide() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto(`${url}/#/read/bsb/proverbs/1`);
  await ready(page, "Proverbs 1");
  await openOutline(page);

  const seeded = await seedOutlineScroll(page);
  assert(seeded.maxScrollTop > 0 && seeded.scrollTop > 0, "Desktop Outline fixture must be scrollable.");
  const before = await detailState(page);
  assert.equal(before.panelMode, "locked", "Opening Outline should establish a committed Study view.");

  await clickOutlineReference(page, "1:8–9:18");
  await page.waitForFunction(() => location.hash === "#/read/bsb/proverbs/1/8");
  await assertReaderDestinationVisible(page, 8, "Desktop same-chapter");
  let state = await detailState(page);
  assert.equal(state.title, "Outline", "Desktop same-chapter navigation cleared Outline.");
  assert.equal(state.displayedView, "outline", "Desktop same-chapter navigation lost Outline view identity.");
  assert.equal(state.panelMode, before.panelMode);
  assert.equal(state.mobileVisible, false);
  assert.equal(state.workspaceHidden, false);
  assert(Math.abs(state.scrollTop - seeded.scrollTop) <= 1, "Desktop same-chapter navigation reset Outline scroll.");

  await clickOutlineReference(page, "2:1–4:27");
  await ready(page, "Proverbs 2");
  await page.waitForFunction(() => location.hash === "#/read/bsb/proverbs/2/1");
  await assertReaderDestinationVisible(page, 1, "Desktop different-chapter");
  state = await detailState(page);
  assert.equal(state.title, "Outline", "Desktop different-chapter navigation cleared Outline.");
  assert.equal(state.displayedView, "outline", "Desktop different-chapter navigation lost Outline view identity.");
  assert.equal(state.panelMode, before.panelMode);
  assert.equal(state.workspaceHidden, false);
  assert(Math.abs(state.scrollTop - seeded.scrollTop) <= 1, "Desktop chapter navigation reset Outline scroll.");

  await navigateBookSelect(page, "genesis");
  await ready(page, "Genesis 1");
  state = await detailState(page);
  assert.equal(state.title, "Details", "Cross-book Reader navigation must not retain a stale Outline.");
  assert.equal(state.displayedView, "", "Cross-book Reader navigation retained the old Outline view identity.");

  assert.deepEqual(errors, [], `Desktop browser health: ${JSON.stringify(errors)}`);
  await context.close();
  return {
    sameChapter: "#/read/bsb/proverbs/1/8",
    differentChapter: "#/read/bsb/proverbs/2/1",
    crossBookReset: true,
    outlineScrollTop: seeded.scrollTop,
  };
}

async function runDrawer() {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto(`${url}/#/read/bsb/proverbs/1`);
  await ready(page, "Proverbs 1");
  await openOutline(page);
  await page.waitForFunction(() => document.querySelector(".detail-pane")?.classList.contains("visible"));

  const seeded = await seedOutlineScroll(page);
  assert(seeded.maxScrollTop > 0 && seeded.scrollTop > 0, "Drawer Outline fixture must be scrollable.");

  await clickOutlineReference(page, "1:8–9:18");
  await page.waitForFunction(
    () =>
      location.hash === "#/read/bsb/proverbs/1/8" &&
      !document.querySelector(".detail-pane")?.classList.contains("visible"),
  );
  await assertReaderDestinationVisible(page, 8, "Drawer same-chapter");
  let state = await detailState(page);
  assert.equal(state.title, "Outline", "Drawer same-chapter navigation lost preserved Outline.");
  assert.equal(state.displayedView, "outline", "Drawer same-chapter navigation lost Outline view identity.");
  assert.equal(state.mobileVisible, false);
  const focusAfterClose = await page.evaluate(() => ({
    id: document.activeElement?.id || "",
    insideStudy: Boolean(document.querySelector(".detail-pane")?.contains(document.activeElement)),
  }));
  assert.equal(focusAfterClose.insideStudy, false, "Closing the drawer left focus in the hidden Study surface.");
  assert(
    ["showOutline", "openStudyPanel"].includes(focusAfterClose.id),
    `Drawer close restored focus to an unexpected control: ${JSON.stringify(focusAfterClose)}`,
  );

  await page.locator("#openStudyPanel").click();
  await page.waitForFunction(() => document.querySelector(".detail-pane")?.classList.contains("visible"));
  state = await detailState(page);
  assert.equal(state.title, "Outline");
  assert.equal(state.displayedView, "outline");
  assert(Math.abs(state.scrollTop - seeded.scrollTop) <= 1, "Reopening Study did not restore the preserved Outline scroll.");

  await clickOutlineReference(page, "2:1–4:27");
  await ready(page, "Proverbs 2");
  await page.waitForFunction(
    () =>
      location.hash === "#/read/bsb/proverbs/2/1" &&
      !document.querySelector(".detail-pane")?.classList.contains("visible"),
  );
  await assertReaderDestinationVisible(page, 1, "Drawer different-chapter");
  state = await detailState(page);
  assert.equal(state.title, "Outline", "Drawer different-chapter navigation lost preserved Outline.");
  assert.equal(state.displayedView, "outline", "Drawer different-chapter navigation lost Outline view identity.");

  await page.locator("#openStudyPanel").click();
  await page.waitForFunction(() => document.querySelector(".detail-pane")?.classList.contains("visible"));
  state = await detailState(page);
  assert.equal(state.title, "Outline");
  assert.equal(state.displayedView, "outline");

  await navigateBookSelect(page, "genesis");
  await ready(page, "Genesis 1");
  await page.waitForFunction(() => !document.querySelector(".detail-pane")?.classList.contains("visible"));
  state = await detailState(page);
  assert.equal(state.title, "Details", "Cross-book drawer navigation retained stale Outline content.");
  assert.equal(state.displayedView, "");

  assert.deepEqual(errors, [], `Drawer browser health: ${JSON.stringify(errors)}`);
  await context.close();
  return {
    sameChapterClosed: true,
    differentChapterClosed: true,
    reopenedOutline: true,
    crossBookReset: true,
    outlineScrollTop: seeded.scrollTop,
  };
}

try {
  const sideBySide = await runSideBySide();
  const drawer = await runDrawer();
  console.log(JSON.stringify({ status: "ok", sideBySide, drawer }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
