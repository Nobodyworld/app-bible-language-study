import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Real WebDriver element clicks/keys provide hit testing and trusted input.
// Scripts below inspect state or construct bounded fixtures; they do not click.
async function element(client, selector) {
  return client.request("POST", `/session/${client.sessionId}/element`, {using:"css selector",value:selector});
}
async function activate(client, selector, key = null) {
  const node = await element(client, selector);
  const id = node["element-6066-11e4-a52e-4f735466cecf"];
  assert.ok(id, `${selector} must resolve through WebDriver`);
  await client.request("POST", `/session/${client.sessionId}/element/${id}/${key ? "value" : "click"}`, key ? {text:key,value:[key]} : {});
}
async function hover(client, selector) {
  await client.execute("document.querySelector(arguments[0]).scrollIntoView({block:'center',inline:'nearest'}); return true;",[selector]);
  const node=await element(client,selector);
  await client.request("POST",`/session/${client.sessionId}/actions`,{actions:[{type:"pointer",id:"polish-pointer",parameters:{pointerType:"mouse"},actions:[{type:"pointerMove",duration:100,origin:node,x:0,y:0}]}]});
}
async function route(client, hash, selector) {
  await client.execute("location.hash=arguments[0]; return true;",[hash]);
  await client.waitFor("return location.hash===arguments[0] && Boolean(document.querySelector(arguments[1]));",[hash,selector]);
}
export async function checkDesktopUiPolish(client, runRoot) {
  const screenshots=[];
  const shot=async name=>{const file=`ui-${name}.png`;await client.screenshot(path.join(runRoot,file));screenshots.push(file);};
  await route(client,"#/read/bsb/psalms/23/1",'.verse-row[data-verse="1"] .fn-marker');
  const mode=()=>client.execute("return document.documentElement.dataset.studyWorkspaceWidth;");
  for(let i=0;i<3 && await mode()!=="compact";i++) await activate(client,"#studyWorkspaceWidthCycle");
  const headers=[];
  for(const [expected,key,next] of [["compact",null,"standard"],["standard","\uE007","expanded"],["expanded"," ","compact"]]) {
    assert.equal(await mode(),expected);
    const geometry=await client.execute(`
      const pane=document.querySelector('.detail-pane').getBoundingClientRect();
      const nodes=['.detail-header h2','#detailModeStatus','#studyWorkspaceWidthCycle','#clearDetail','#hideStudyWorkspace'].map(s=>document.querySelector(s).getBoundingClientRect());
      return {width:pane.width, viewport:innerWidth, sameRow:Math.max(...nodes.map(r=>r.top))<Math.min(...nodes.map(r=>r.bottom)), contained:nodes.every(r=>r.left>=pane.left && r.right<=pane.right)};
    `);
    assert.ok(geometry.width>=320 && geometry.sameRow && geometry.contained,JSON.stringify(geometry));
    headers.push({mode:expected,...geometry}); await shot(`header-${expected}`);
    await activate(client,"#studyWorkspaceWidthCycle",key);
    await client.waitFor("return document.documentElement.dataset.studyWorkspaceWidth===arguments[0];",[next]);
  }
  // Native WebView2 zoom hotkeys are enabled by the existing app configuration.
  const beforeZoom=await client.execute("return {width:innerWidth,dpr:devicePixelRatio};");
  await client.request("POST",`/session/${client.sessionId}/actions`,{actions:[{type:"key",id:"polish-zoom",actions:[{type:"keyDown",value:"\uE009"},{type:"keyDown",value:"+"},{type:"keyUp",value:"+"},{type:"keyUp",value:"\uE009"}]}]});
  const afterZoom=await client.execute("return {width:innerWidth,dpr:devicePixelRatio};");
  const actualZoom=beforeZoom.width!==afterZoom.width || beforeZoom.dpr!==afterZoom.dpr;
  if(actualZoom) {
    assert.ok(await client.execute("return document.documentElement.scrollWidth<=innerWidth+1;"),"Native zoom must not introduce horizontal page overflow");
    await shot("zoom");
    await client.request("POST",`/session/${client.sessionId}/actions`,{actions:[{type:"key",id:"polish-zoom",actions:[{type:"keyDown",value:"\uE009"},{type:"keyDown",value:"0"},{type:"keyUp",value:"0"},{type:"keyUp",value:"\uE009"}]}]});
  }
  await route(client,"#/read/bsb/john/4/18",'.verse-row[data-verse="18"] .strong-token[data-strong-code="G227"]');
  await activate(client,'.verse-row[data-verse="18"] .strong-token[data-strong-code="G227"]');
  await client.waitFor("return document.querySelector('#detailContent .strong-code')?.textContent==='G227' && Boolean(document.querySelector('.word-origin-value .strong-inline-link[aria-label$=\"G1\"]')); ");
  assert.equal(await client.execute("return document.querySelector('.word-origin-value').querySelectorAll('button').length;"),2);
  assert.match(await client.execute("return document.querySelector('.word-origin-value').textContent;"),/a- \(as a negative particle\)/);
  await shot("g227-prefix");
  await activate(client,'.word-origin-value .strong-inline-link[aria-label$="G1"]',"\uE007");
  await client.waitFor("return document.querySelector('#detailContent .strong-code')?.textContent==='G1';");
  await route(client,"#/read/bsb/john/4/24",'.verse-row[data-verse="24"] .strong-token[data-strong-code="G4151"]');
  await activate(client,'.verse-row[data-verse="24"] .strong-token[data-strong-code="G4151"]');
  await client.waitFor("return Boolean(document.querySelector('#detailContent .concordance-text .strong-inline-link[aria-label$=\"G5590\"]'));");
  await hover(client,'#detailContent .concordance-text .strong-inline-link[aria-label$="G5590"]');
  await client.waitFor("const n=document.querySelector('#detailContent .concordance-text .strong-inline-link[aria-label$=\"G5590\"]'); const t=document.querySelector('.language-tooltip-layer:not([hidden])'); return n?.dataset.previewReady==='true' && t?.textContent===n.dataset.tooltip;");
  await shot("g4151-compare-preview");
  await activate(client,'#detailContent .concordance-text .strong-inline-link[aria-label$="G5590"]');
  await client.waitFor("return document.querySelector('#detailContent .strong-code')?.textContent==='G5590';");
  assert.equal(await client.execute("return location.hash;"),"#/read/bsb/john/4/24");
  await route(client,"#/read/bsb/mark/9/3",'.verse-row[data-verse="3"] .strong-token[data-strong-code="G3021"]');
  const wrapping=await client.execute(`
    const source=document.querySelector('.verse-row[data-verse="3"] .strong-token[data-strong-code="G3021"]');
    const style=getComputedStyle(source), canvas=document.createElement('canvas'), ctx=canvas.getContext('2d'); ctx.font=style.font;
    const text=source.textContent, full=ctx.measureText(text).width, longest=Math.max(...text.split(/\\s+/).map(w=>ctx.measureText(w).width));
    const fixture=document.createElement('div');fixture.id='native-wrap-fixture';fixture.className='verse-body';
    Object.assign(fixture.style,{position:'fixed',top:'180px',left:'30px',width:Math.floor((full+longest)/2)+'px',font:style.font,transitionProperty:'none',zIndex:'100',background:'var(--panel)'});
    const token=source.cloneNode(true);fixture.append(token);document.body.append(fixture);
    const range=document.createRange();range.selectNodeContents(token); const textRects=[...range.getClientRects()];const rects=[...token.getClientRects()];
    return {text,width:fixture.getBoundingClientRect().width,fragments:rects.length,padding:getComputedStyle(token).paddingInline,
      emptyFragments:rects.filter(r=>!textRects.some(t=>Math.min(r.bottom,t.bottom)>Math.max(r.top,t.top) && t.width>0)).length};
  `);
  assert.equal(wrapping.text,"bleach them.");assert.ok(wrapping.fragments>1);assert.equal(wrapping.emptyFragments,0);assert.equal(wrapping.padding,"0px");
  await shot("strong-wrap");await client.execute("document.querySelector('#native-wrap-fixture').remove(); return true;");
  await route(client,"#/read/bsb/psalms/23/1",'.verse-row[data-verse="1"] .fn-marker');
  await activate(client,'.verse-row[data-verse="1"] .fn-marker');
  const stateScript="return {route:location.hash,scroll:scrollY,chapter:document.querySelector('#chapterContent').textContent,mode:document.querySelector('#detailModeStatus').textContent,back:document.querySelector('#detailBack').disabled,forward:document.querySelector('#detailForward').disabled};";
  const opened=await client.execute(stateScript);
  await client.waitFor("return document.querySelector('.footnote-scripture-entry')?.dataset.status==='available';");
  const expected=JSON.parse(await readFile(new URL("../data/verses/bsb/revelation.json",import.meta.url),"utf8"));
  assert.equal(await client.execute("return document.querySelector('.footnote-scripture-passage bdi').textContent;"),expected.chapters[7][17]);
  assert.deepEqual(await client.execute(stateScript),opened);
  await shot("footnote-single");
  await activate(client,".footnote-scripture-refresh"," ");
  await client.waitFor("return document.querySelector('.footnote-scripture-entry')?.dataset.status==='available';");
  assert.deepEqual(await client.execute(stateScript),opened);
  await client.executeAsync(`
    const done=arguments[arguments.length-1];
    Promise.all([import('/src/views/reference-view.js'),import('/src/data-service.js?v=pr13-live-qa-20260711e')]).then(async([v,d])=>{
      const ctx={state:{translationId:'bsb',manifest:await d.loadManifest()},goToLocation(){throw Error('Unexpected navigation');}};
      v.createReferenceViews(ctx).showFootnote({marker:'a',text:'See Revelation 7:1–17.'},'Range fixture');done(true);
    }).catch(error=>done({error:error.message}));
  `);
  await client.waitFor("return Boolean(document.querySelector('.footnote-scripture-expanded > summary'));");
  await activate(client,".footnote-scripture-expanded > summary","\uE007");
  await client.waitFor("return document.querySelector('.footnote-scripture-expanded')?.open;");
  assert.equal(await client.execute("return document.querySelectorAll('.footnote-scripture-passage bdi').length;"),17);
  await shot("footnote-expanded");
  await activate(client,"#themeToggle"); await shot("footnote-theme-toggle");
  assert.deepEqual(await client.execute("return window.__desktopE2eErrors || [];"),[]);
  return {headers,wrapping,lexicalReferences:true,footnoteSingleAndExpanded:true,trustedPointerAndKeyboard:true,zoom:{before:beforeZoom,after:afterZoom,actualZoom},screenshots};
}
