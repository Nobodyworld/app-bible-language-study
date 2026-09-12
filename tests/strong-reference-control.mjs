#!/usr/bin/env node

import assert from "node:assert/strict";
import { resolveStrongSeeSegments, strongReferenceDisplayLabel } from "../app/src/strong-reference-control.js";

const refs = [
  { label: "philos", language: "greek", strong_code: "G5384" },
  { label: "thumos", language: "greek", strong_code: "G2372" },
  { label: "agapao", language: "greek", strong_code: "G25" },
  { label: "ethelo", language: "greek", strong_code: "G2309" },
  { label: "boulomai", language: "greek", strong_code: "G1014" },
  { label: "nous", language: "greek", strong_code: "G3563" },
  { label: "tsbiyah", language: "hebrew", strong_code: "H6646" },
  { label: "psuchē", transliteration: "psuchē", language: "greek", strong_code: "G5590" },
  { label: "louo", language: "greek", strong_code: "G3068" },
  { label: "niptō", language: "greek", strong_code: "G3538" },
  { label: "a", language: "greek", strong_code: "G1" },
];
let assertions = 0;
function checkSegments(text, expectedCodes, references = refs) {
  const segments = resolveStrongSeeSegments(text, references);
  assert.deepEqual(segments.filter((segment) => segment.ref).map((segment) => segment.ref.strong_code), expectedCodes, text);
  assert.equal(segments.map((segment) => segment.text + (segment.label || "")).join(""), text, "Source wording, punctuation and whitespace must survive segmentation");
  assertions += 2;
  return segments;
}

checkSegments(
  "love.\nsee GREEK philos\nsee GREEK thumos\nsee GREEK agapao\nsee GREEK ethelo\nsee GREEK boulomai\nsee GREEK nous",
  ["G5384", "G2372", "G25", "G2309", "G1014", "G3563"],
);
const crossLanguage = checkSegments("see HEBREW tsbiyah", ["H6646"]);
assert.equal(crossLanguage.find((segment) => segment.ref)?.language, "hebrew");
assertions += 1;
checkSegments("see GREEK agapao", ["G25"]);
const unresolved = checkSegments("before\nsee GREEK unknown\nafter", []);
assert.equal(unresolved.find((segment) => segment.label === "unknown")?.ref, null);
assertions += 1;
checkSegments("see HEBREW philos", []);
checkSegments("see GREEK   philos.  \nafter", ["G5384"]);

checkSegments("mind. Compare psuche.", ["G5590"]);
checkSegments("Compare louo, nipto.", ["G3068", "G3538"]);
checkSegments("Compare louo, unknown, nipto.", ["G3068", "G3538"]);
checkSegments("Compare with louo and nipto.", ["G3068", "G3538"]);
checkSegments("Compare louo, psuche, and nipto.", ["G3068", "G5590", "G3538"]);
checkSegments("COMPARE PSUCHĒ, NIPTŌ.", ["G5590", "G3538"]);
checkSegments("Compare G5590, H6646.", ["G5590", "H6646"]);
checkSegments("Compare psuche. Compare nipto.\nsee GREEK louo", ["G5590", "G3538", "G3068"]);
checkSegments("Compare unknown. A psuche label in ordinary prose stays plain.", []);
checkSegments("Compare louo; nipto is mentioned outside the comparison list.", ["G3068"]);
checkSegments("Compare louo.\nnipto is mentioned on the next line.", ["G3068"]);
checkSegments("Compare louo but not nipto.", ["G3068"]);
checkSegments("Compare psuchex, xnipto.", []);
checkSegments("From a (as a negative particle) and lanthano; a true statement.", []);
checkSegments("a psuche and a nipto are plain prose, not explicit references.", []);
checkSegments("Compare psuche.", [], []);
checkSegments("Compare psuche.", [], null);
checkSegments("Compare psuche.", [], [{ label: "psuche", strong_code: "not-a-code" }]);
checkSegments("Compare psuche.", [], [
  { label: "psuchē", language: "greek", strong_code: "G5590" },
  { label: "psuche", language: "greek", strong_code: "G5591" },
]);
checkSegments("Compare psuche.", ["G5590"], [
  { label: "psuchē", language: "greek", strong_code: "G5590" },
  { label: "psuche", language: "greek", strong_code: "G5590" },
]);
checkSegments("Compare Beth-’Eden.", ["H1040"], [{ label: "Beth-'Eden", language: "hebrew", strong_code: "H1040" }]);
checkSegments("", []);
checkSegments("Compare ", []);
// Repeated calls must not inherit sticky/global regular-expression state.
checkSegments("Compare louo, nipto.", ["G3068", "G3538"]);

assert.equal(strongReferenceDisplayLabel({ strong_code: "G1", label: "a" }), "a");
assert.equal(strongReferenceDisplayLabel({ strong_code: "G25", label: "agapao" }), "agapao");
assert.equal(strongReferenceDisplayLabel({ strong_code: "G25", label: "a" }), "a");
assert.equal(strongReferenceDisplayLabel({ strong_code: "G1", label: "Alpha" }), "Alpha");
assertions += 4;

console.log(JSON.stringify({ status: "ok", assertions }, null, 2));
