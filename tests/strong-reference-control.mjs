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
];
const multiple = resolveStrongSeeSegments(
  "love.\nsee GREEK philos\nsee GREEK thumos\nsee GREEK agapao\nsee GREEK ethelo\nsee GREEK boulomai\nsee GREEK nous",
  refs,
);
assert.deepEqual(multiple.filter((segment) => segment.ref).map((segment) => segment.ref.strong_code), ["G5384", "G2372", "G25", "G2309", "G1014", "G3563"]);
assert.equal(multiple.map((segment) => segment.text + (segment.label || "")).join(""), "love.\nsee GREEK philos\nsee GREEK thumos\nsee GREEK agapao\nsee GREEK ethelo\nsee GREEK boulomai\nsee GREEK nous");

const crossLanguage = resolveStrongSeeSegments("see HEBREW tsbiyah", refs);
assert.equal(crossLanguage.find((segment) => segment.ref)?.ref.strong_code, "H6646");
assert.equal(crossLanguage.find((segment) => segment.ref)?.language, "hebrew");

const hebrewToGreek = resolveStrongSeeSegments("see GREEK agapao", refs);
assert.equal(hebrewToGreek.find((segment) => segment.ref)?.ref.strong_code, "G25");

const unresolved = resolveStrongSeeSegments("before\nsee GREEK unknown\nafter", refs);
assert.equal(unresolved.find((segment) => segment.label === "unknown")?.ref, null);
assert.equal(unresolved.map((segment) => segment.text + (segment.label || "")).join(""), "before\nsee GREEK unknown\nafter");

const compare = resolveStrongSeeSegments("mind. Compare psuche.", refs);
assert.equal(compare.find((segment) => segment.label === "psuche")?.ref?.strong_code, "G5590");
assert.equal(compare.map((segment) => segment.text + (segment.label || "")).join(""), "mind. Compare psuche.");

assert.equal(strongReferenceDisplayLabel({ strong_code: "G1", label: "a" }), "a-");
assert.equal(strongReferenceDisplayLabel({ strong_code: "G25", label: "agapao" }), "agapao");

console.log(JSON.stringify({ status: "ok", assertions: 12 }, null, 2));
