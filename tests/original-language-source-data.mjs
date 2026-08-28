#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../app/data/manifest.json", import.meta.url), "utf8"));
const packageManifest = JSON.parse(await readFile(new URL("../app/data/package-manifest.json", import.meta.url), "utf8"));
const dataServiceSource = await readFile(new URL("../app/src/data-service.js", import.meta.url), "utf8");
const appSource = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
const indexSource = await readFile(new URL("../app/index.html", import.meta.url), "utf8");
const sourceById = new Map(manifest.original_language_sources.map((source) => [source.id, source]));

assert(/manifest\.json\?v=pr13-live-qa-20260711e/.test(dataServiceSource));
assert(/data-service\.js\?v=pr13-live-qa-20260711e/.test(appSource));
assert(/app\.js\?v=pr13-live-qa-20260711e/.test(indexSource));

for (const id of ["wlc", "wlco", "nestle", "tr94"]) {
  assert(sourceById.has(id), `Missing ${id} source registration.`);
}
assert.equal(sourceById.get("wlc").variant, "pointed");
assert.equal(sourceById.get("wlco").variant, "consonants-only");
assert.equal(sourceById.get("nestle").testament_scope, "new");
assert.equal(sourceById.get("tr94").testament_scope, "new");
assert.equal(manifest.translations.length, 10, "Original-language sources must not become reader translations.");

const expectedSourcePacks = new Map([
  ["source-wlc", { path: "data/verses/wlc", files: 39 }],
  ["source-wlco", { path: "data/verses/wlco", files: 39 }],
  ["source-nestle-1904", { path: "data/verses/nestle", files: 27 }],
  ["source-tr94", { path: "data/verses/tr94", files: 27 }],
]);
const sourcePacks = packageManifest.feature_packs.filter((pack) => expectedSourcePacks.has(pack.id));
assert.equal(sourcePacks.length, 4, "Package inventory must declare four source-specific non-reader packs.");
for (const pack of sourcePacks) {
  const expected = expectedSourcePacks.get(pack.id);
  assert.deepEqual(pack.paths, [expected.path], `${pack.id} must own only its source corpus path.`);
  assert.equal(pack.files, expected.files, `${pack.id} source file count is stale.`);
  assert(pack.gzip_bytes > 0 && pack.sha256?.startsWith("sha256:") && pack.largest_shard?.path.startsWith(expected.path), `${pack.id} metrics are incomplete.`);
}
assert.equal(sourcePacks.reduce((total, pack) => total + pack.files, 0), 132);
assert.equal(sourcePacks.reduce((total, pack) => total + pack.bytes, 0), 12043738);
const readerPackage = packageManifest.packages.find((item) => item.id === "reader-texts");
assert(
  [...expectedSourcePacks.keys()].every((id) => readerPackage?.feature_pack_ids.includes(id)),
  "Aggregate reader-data package must include every original-language source pack.",
);

const [wlc, wlco, nestle, tr94] = await Promise.all(
  ["wlc", "wlco", "nestle", "tr94"].map((id) =>
    readFile(new URL(`../app/data/verses/${id}/${id === "wlc" || id === "wlco" ? "psalms" : "john"}.json`, import.meta.url), "utf8").then(JSON.parse),
  ),
);
assert.equal(wlc.chapters["23"]["1"], "מִזְמֹ֥ור לְדָוִ֑ד יְהוָ֥ה רֹ֝עִ֗י לֹ֣א אֶחְסָֽר׃");
assert.equal(wlco.chapters["23"]["1"], "מזמור לדוד יהוה רעי לא אחסר׃");
assert(/[\u0370-\u03ff\u1f00-\u1fff]/u.test(nestle.chapters["1"]["1"]));
assert(/[\u0370-\u03ff\u1f00-\u1fff]/u.test(tr94.chapters["1"]["1"]));

const fixtureFetch = async (path) => {
  const match = String(path).match(/verses\/(wlc|wlco|nestle|tr94)\/(psalms|john|missing)\.json/);
  if (!match || match[2] === "missing" || (match[2] === "psalms" && ["nestle", "tr94"].includes(match[1]))) {
    return { ok: false, json: async () => ({}) };
  }
  const book = match[2] === "psalms" ? (match[1] === "wlc" ? wlc : wlco) : match[1] === "nestle" ? nestle : tr94;
  return { ok: true, json: async () => book };
};

const { configureDataAdapter, loadOriginalSourceTexts } = await import("../app/src/data-service.js");
configureDataAdapter({ fetchResponse: fixtureFetch });
const hebrew = await loadOriginalSourceTexts({ manifest, bookId: "psalms", chapter: 23 }, "hebrew", 1);
const greek = await loadOriginalSourceTexts({ manifest, bookId: "john", chapter: 1 }, "greek", 1);
const absentGreek = await loadOriginalSourceTexts({ manifest, bookId: "psalms", chapter: 23 }, "greek", 1);
assert.deepEqual(hebrew.map((source) => source.id), ["wlc", "wlco"]);
assert.deepEqual(hebrew.map((source) => source.label), ["Westminster Leningrad Codex", "WLC — Consonants Only"]);
assert.deepEqual(greek.map((source) => source.id), ["nestle", "tr94"]);
assert.equal(greek[0].label, "Nestle Greek New Testament 1904");
assert.equal(greek[1].label, "Scrivener’s Textus Receptus 1894");
assert.deepEqual(absentGreek, []);

console.log(JSON.stringify({ status: "ok", assertions: 37 }, null, 2));
