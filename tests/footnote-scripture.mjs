import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extractScriptureReferences } from "../app/src/references.js";
import { configureDataAdapter, invalidatePhysicalPackData, resolveScripturePassage } from "../app/src/data-service.js";

const read = path => readFile(new URL(`../app/data/${path}`, import.meta.url), "utf8").then(JSON.parse);
const manifest = await read("manifest.json");
const books = Object.fromEntries(await Promise.all(["bsb", "kjv"].map(async t => [t, await read(`verses/${t}/revelation.json`)])));
const note = (await read("footnotes/bsb/psalms.json")).chapters[23][1][0];
assert.equal(note.text, "See Revelation 7:17.");
const parse = text => extractScriptureReferences(text, manifest.books);
const single = parse(note.text);
assert.equal(single.length, 1);
assert.deepEqual(single[0].reference, {book_id:"revelation", chapter:7, verse_start:17, chapter_end:7, verse_end:17});
assert.equal(parse("Rev. 7:15–17; Psalm 23:1. Revelation 7:15–17.").length, 2, "Aliases and duplicates use canonical identity.");
assert.equal(parse("See John or maybe the last chapter; unknown 7:17; revelationx 7:17.").length, 0);
assert.equal(extractScriptureReferences("Rev 7:17", [...manifest.books,{id:"ambiguous", name:"Rev"}]).length, 0);
for (const text of ["Rev 7:17-", "Rev 7:17,18", "Rev 7:17:18"]) assert.equal(parse(text)[0].unsupported, true, text);
let requests = [];
function adapter(response) {
  invalidatePhysicalPackData();
  configureDataAdapter({fetchResponse:async path => {requests.push(path); return response(path);}});
}
adapter(path => {
  const id = path.split("/")[3];
  return {ok:true,json:async()=>books[id]};
});
const first = resolveScripturePassage("bsb",single[0].reference);
assert.equal(first, resolveScripturePassage("bsb",single[0].reference), "Identical in-flight passage requests are shared.");
assert.equal((await first).verses[0].text, books.bsb.chapters[7][17]);
const range = await resolveScripturePassage("bsb",parse("Revelation 7:15–17")[0].reference);
assert.deepEqual(range.verses.map(v=>v.text), [15,16,17].map(v=>books.bsb.chapters[7][v]));
assert.equal(requests.length, 1, "Different passages in one book reuse the existing book cache, with independent range results.");
const kjv = await resolveScripturePassage("kjv",single[0].reference);
assert.equal(kjv.verses[0].text, books.kjv.chapters[7][17]);
assert.notEqual(kjv.verses[0].text, (await first).verses[0].text);
const spanning = await resolveScripturePassage("bsb",parse("Revelation 7:17–8:2")[0].reference);
assert.deepEqual(spanning.verses.map(v=>`${v.chapter}:${v.verse}`), ["7:17","8:1","8:2"]);
for (const label of ["Revelation 7:17–18", "Revelation 7:18", "Revelation 0:1", "Revelation 7:0", "Revelation 99:1", "Revelation 7:17–15", "Revelation 8:2–7:17"]) {
  assert.equal((await resolveScripturePassage("bsb",parse(label)[0].reference)).status,"invalid",label);
}
assert.equal((await resolveScripturePassage("../bsb",single[0].reference)).status,"invalid");
requests=[];
adapter(()=>({ok:false,status:404}));
assert.equal((await resolveScripturePassage("kjv",single[0].reference)).status,"unavailable");
assert.ok(requests.every(p=>p.includes("/kjv/")),"Unavailable data must not trigger another translation.");
adapter(()=>({ok:false,status:503}));
assert.equal((await resolveScripturePassage("bsb",single[0].reference)).status,"error");
adapter(()=>({ok:true,json:async()=>books.kjv}));
assert.equal((await resolveScripturePassage("bsb",single[0].reference)).status,"unavailable","Wrong-version payloads cannot be displayed.");
const partial=structuredClone(books.bsb); delete partial.chapters[7][16];
adapter(()=>({ok:true,json:async()=>partial}));
assert.equal((await resolveScripturePassage("bsb",parse("Rev 7:15–17")[0].reference)).status,"unavailable","A missing middle verse cannot be silently omitted.");
adapter(()=>({ok:true,json:async()=>books.bsb}));
assert.equal((await resolveScripturePassage("bsb",single[0].reference)).status,"available","Failures are recoverable after data becomes available.");
console.log(JSON.stringify({status:"ok",fixtures:"repository BSB/KJV Revelation and BSB Psalm 23 footnote", single:true,ranges:true,chapterSpanning:true,translationIsolation:true,noFallback:true,invalidBoundaries:true,inFlightIdentity:true}));
