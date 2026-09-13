import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { startStaticAppServer } from "../tools/serve-app.mjs";

const read = name => JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url)));
const bsb = read("verses/bsb/revelation.json"), kjv = read("verses/kjv/revelation.json");
const hebrew = read("verses/wlc/genesis.json");
const evidence = process.env.BIBLEAPP_UI_EVIDENCE_DIR;
const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
assert.ok(executablePath, "Microsoft Edge is required.");
const {server,url} = await startStaticAppServer({port:0});
const browser = await chromium.launch({executablePath,headless:true,args:["--disable-gpu","--disable-background-networking","--no-first-run"]});
const errors=[];
async function ready(page) {
  await page.goto(`${url}/#/read/bsb/psalms/23/1`);
  await page.locator('.verse-row[data-verse="1"] .fn-marker').first().waitFor({state:"visible"});
}
async function snapshot(page) {
  return page.evaluate(() => ({route:location.hash, scroll:scrollY, chapter:document.querySelector("#chapterContent").textContent,
    active:[...document.querySelectorAll(".verse-row.active")].map(n=>n.dataset.verse), mode:document.querySelector("#detailModeStatus").textContent,
    back:document.querySelector("#detailBack").disabled, forward:document.querySelector("#detailForward").disabled}));
}
async function show(page, text) {
  // Synthetic footnote wording uses the real view, domain loader and datasets.
  // The actual Psalm 23:1 marker is exercised separately with pointer/keyboard.
  await page.evaluate(async text => {
    const {createReferenceViews} = await import("/src/views/reference-view.js");
    const {loadManifest} = await import("/src/data-service.js?v=pr13-live-qa-20260711e");
    const state={manifest:await loadManifest(), get translationId(){return document.querySelector("#translationSelect").value;}};
    const views=createReferenceViews({state, goToLocation(){throw new Error("Hydration must not navigate");}});
    views.showFootnote({marker:"a",text},"Test footnote");
  },text);
}
async function loaded(page, count=1) {
  await page.waitForFunction(count => document.querySelectorAll('.footnote-scripture-entry[data-status="available"]').length===count,count);
}
async function shot(page,name) {
  if(evidence){mkdirSync(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,`footnote-${name}.png`)});}
}
try {
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  page.on("pageerror",error=>errors.push(error.message));
  await ready(page);
  const before=await snapshot(page);
  await page.locator('.verse-row[data-verse="1"] .fn-marker').first().click();
  const opened=await snapshot(page);
  await loaded(page);
  assert.equal(await page.locator(".footnote-detail > p").innerText(),"See Revelation 7:17.");
  assert.equal(await page.locator(".footnote-scripture-passage bdi").innerText(),bsb.chapters[7][17]);
  assert.deepEqual(await snapshot(page),opened,"Hydration must preserve Reader and panel state.");
  assert.equal(opened.route,before.route);
  assert.equal(opened.chapter,before.chapter,"Loading Revelation must not replace active Psalms data.");
  assert.ok(Math.abs(opened.scroll-before.scroll)<2,"Opening a visible footnote must preserve Reader scroll.");
  await shot(page,"single-light");
  const text=page.locator(".footnote-scripture-passage bdi");
  await text.selectText();
  assert.equal(await page.evaluate(()=>getSelection().toString()),bsb.chapters[7][17],"Actual scripture remains selectable/copyable.");
  await page.getByRole("button",{name:"Read Revelation 7:17 in BSB",exact:true}).click();
  await page.waitForURL("**/#/read/bsb/revelation/7/17");
  await ready(page);
  const marker=page.locator('.verse-row[data-verse="1"] .fn-marker').first();
  await marker.focus(); await marker.press("Enter"); await loaded(page);
  await show(page,"See Revelation 7:15–17 and John 4:24."); await loaded(page,2);
  assert.deepEqual(await page.locator(".footnote-scripture-entry").first().locator("bdi").allTextContents(),[15,16,17].map(v=>bsb.chapters[7][v]));
  await show(page,"See Revelation 7:17."); await loaded(page);
  await show(page,"See John 4:24."); await loaded(page);
  await page.locator("#detailBack").click(); await loaded(page);
  assert.equal(await page.locator(".footnote-scripture-passage bdi").innerText(),bsb.chapters[7][17],"History restoration rehydrates the restored footnote.");
  const restored=await snapshot(page);
  await page.getByRole("button",{name:"Refresh scripture",exact:true}).click(); await loaded(page);
  assert.deepEqual(await snapshot(page),restored,"Refresh must not add history or change lock/follow.");
  assert.equal(restored.forward,false,"Refreshing must retain the forward history entry.");
  await show(page,"See Revelation 7:1–17."); await loaded(page);
  const summary=page.locator(".footnote-scripture-expanded > summary");
  assert.equal(await page.locator(".footnote-scripture-expanded").getAttribute("open"),null);
  await summary.focus(); await summary.press("Enter");
  await page.waitForFunction(()=>document.querySelector(".footnote-scripture-expanded")?.open);
  assert.equal(await page.locator(".footnote-scripture-passage bdi").count(),17,"Expansion must retain every verse.");
  assert.ok(await page.locator(".footnote-scripture-passage").evaluate(n=>n.clientHeight<=290 && n.scrollHeight>n.clientHeight));
  await shot(page,"range-expanded");
  await summary.press("Space");
  await page.waitForFunction(()=>!document.querySelector(".footnote-scripture-expanded")?.open);
  await show(page,"See Revelation 7:17–8:2."); await loaded(page);
  assert.deepEqual(await page.locator(".footnote-scripture-number").allTextContents(),["7:17 ","8:1 ","8:2 "]);
  await page.locator("#translationSelect").selectOption("kjv");
  await page.waitForFunction(()=>document.querySelector("#statusText").textContent.includes("KJV data loaded"));
  await show(page,"See Revelation 7:17."); await loaded(page);
  assert.equal(await page.locator(".footnote-scripture-passage bdi").innerText(),kjv.chapters[7][17]);
  assert.match(await page.locator(".footnote-scripture-version").innerText(),/KJV/);
  await page.getByRole("button",{name:"Refresh scripture",exact:true}).click(); await loaded(page);
  assert.equal(await page.locator(".footnote-scripture-passage bdi").innerText(),kjv.chapters[7][17]);
  await show(page,"See Revelation 7:17–18.");
  await page.locator('.footnote-scripture-entry[data-status="invalid"]').waitFor();
  assert.equal(await page.locator(".footnote-scripture-passage").count(),0);
  await show(page,"See the later chapter, or an unknown book 7:17.");
  assert.equal(await page.locator(".footnote-scripture").count(),0);
  await show(page,'<img src=x onerror="window.footnoteAttack=true"> See Revelation 7:17.'); await loaded(page);
  assert.equal(await page.locator(".footnote-detail img").count(),0);
  assert.equal(await page.evaluate(()=>window.footnoteAttack),undefined);

  // Delay both success and failure across a new panel selection and translation.
  for(const failure of [false,true]) for(const change of ["panel","translation"]){
    await ready(page);
    await page.evaluate(async()=>{(await import("/src/data-service.js?v=pr13-live-qa-20260711e")).invalidatePhysicalPackData();});
    let release, entered;
    const gate=new Promise(resolve=>{release=resolve;}), seen=new Promise(resolve=>{entered=resolve;});
    const pattern="**/data/verses/bsb/revelation.json";
    await page.route(pattern,async route=>{entered();await gate;await route.fulfill({status:failure?503:200,contentType:"application/json",body:JSON.stringify(failure?{}:bsb)});});
    await show(page,"See Revelation 7:17."); await seen;
    assert.equal(await page.locator('.footnote-scripture-entry[data-status="loading"]').count(),1);
    if(change==="panel") await page.getByRole("button",{name:/Clear/}).first().click();
    else {await page.locator("#translationSelect").selectOption("kjv");await page.waitForFunction(()=>document.querySelector("#statusText").textContent.includes("KJV data loaded"));}
    const after=await snapshot(page);
    release();
    await page.waitForResponse(response=>response.url().endsWith("/data/verses/bsb/revelation.json"));
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await page.locator(".footnote-scripture").count(),0,"A stale response must not reopen the old footnote.");
    assert.deepEqual(await snapshot(page),after);
    await page.unroute(pattern);
  }
  await ready(page);
  for(const status of [404,503]) {
    await page.evaluate(async()=>{(await import("/src/data-service.js?v=pr13-live-qa-20260711e")).invalidatePhysicalPackData();});
    await page.route("**/data/verses/bsb/revelation.json",route=>route.fulfill({status,body:"{}"}));
    await show(page,"See Revelation 7:17.");
    await page.locator(`.footnote-scripture-entry[data-status="${status===404?"unavailable":"error"}"]`).waitFor();
    assert.equal(await page.locator(".footnote-scripture-passage").count(),0);
    await page.unroute("**/data/verses/bsb/revelation.json");
    await page.getByRole("button",{name:"Refresh scripture",exact:true}).click(); await loaded(page);
  }
  // RTL direction uses the existing WLC dataset, without adding a Reader version.
  await page.evaluate(async book=>{
    const {createReferenceViews}=await import("/src/views/reference-view.js");
    const views=createReferenceViews({state:{translationId:"wlc",manifest:{books:[book.book],translations:[book.translation]}},goToLocation(){throw Error("Unexpected navigation");}});
    views.showFootnote({marker:"a",text:"See Genesis 1:1."},"Direction fixture");
  },hebrew);await loaded(page);
  assert.equal(await page.locator(".footnote-scripture-passage bdi").textContent(),hebrew.chapters[1][1]);
  assert.equal(await page.locator(".footnote-scripture-passage bdi").evaluate(n=>getComputedStyle(n).direction),"rtl");
  await page.close();
  const cases=[];
  for(const mobile of [false,true]) for(const theme of ["light","dark","forced-colors"]){
    const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1280,height:900},hasTouch:mobile,isMobile:mobile});
    page.on("pageerror",error=>errors.push(error.message));
    await page.emulateMedia({colorScheme:theme==="dark"?"dark":"light",forcedColors:theme==="forced-colors"?"active":"none",reducedMotion:"reduce"});
    await ready(page);
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme==="dark"?"dark":"light",theme);
    const note=page.locator('.verse-row[data-verse="1"] .fn-marker').first();
    if(mobile) await note.tap(); else await note.click();
    await loaded(page);
    const refresh=page.getByRole("button",{name:"Refresh scripture",exact:true});
    await refresh.focus(); await refresh.press("Space"); await loaded(page);
    assert.ok(await refresh.evaluate(n=>getComputedStyle(n).outlineStyle!=="none"));
    assert.ok(await page.locator(".footnote-scripture").evaluate(n=>n.scrollWidth<=n.clientWidth+1));
    await shot(page,`${mobile?"mobile":"desktop"}-${theme}`);
    cases.push({mobile,theme,touch:mobile});await page.close();
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({status:"ok",browser:browser.version(),cases,single:true,multiple:true,ranges:true,chapterSpanning:true,longContainment:true,translationSwitch:true,staleSuccessAndFailure:4,unavailableAndRetry:true,hostileInput:true,rtlFixture:true,readerAndPanelPreserved:true},null,2));
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
