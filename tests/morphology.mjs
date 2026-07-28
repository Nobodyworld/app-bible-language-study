#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  explainMorphology,
  resolveMorphologyTooltipBounds,
  resolveMorphologyTooltipPlacement,
} from "../app/src/morphology-tooltips.js";

const hebrew = explainMorphology("V-Qal-Prtcpl-msc:: 1cs", "hebrew");
assert.match(hebrew.title, /verb/i);
assert.equal(hebrew.partOfSpeech, "verb");
assert.match(hebrew.partOfSpeechDefinition, /action, occurrence, or state of being/i);
assert.match(hebrew.title, /Qal stem/i);
assert.match(hebrew.title, /participle/i);
assert.match(hebrew.title, /masculine singular construct/i);
assert.match(hebrew.title, /first person common singular/i);
assert.deepEqual(
  hebrew.rows.map((row) => row.code),
  ["V", "Qal", "Prtcpl", "msc", "1cs"],
);

const greekVerb = explainMorphology("V-PIA-1S", "greek");
assert.match(greekVerb.title, /verb/i);
assert.match(greekVerb.partOfSpeechDefinition, /action, occurrence, or state of being/i);
assert.match(greekVerb.title, /present/i);
assert.match(greekVerb.title, /indicative/i);
assert.match(greekVerb.title, /active/i);
assert.match(greekVerb.title, /first person singular/i);

const greekNoun = explainMorphology("N-NMS", "greek");
assert.match(greekNoun.title, /noun/i);
assert.match(greekNoun.partOfSpeechDefinition, /person, place, thing, or concept/i);
assert.match(greekNoun.title, /nominative/i);
assert.match(greekNoun.title, /masculine/i);
assert.match(greekNoun.title, /singular/i);

const panelBounds = resolveMorphologyTooltipBounds({
  panelRect: { left: 903, right: 1253, top: 76, bottom: 708 },
  viewportWidth: 1280,
  viewportHeight: 720,
});
assert.deepEqual(panelBounds, { left: 913, right: 1243, top: 86, bottom: 698 });

assert.deepEqual(
  resolveMorphologyTooltipBounds({
    panelRect: { left: -20, right: 200, top: -30, bottom: 900 },
    viewportWidth: 1280,
    viewportHeight: 720,
  }),
  { left: 10, right: 190, top: 10, bottom: 710 },
);

const viewportBounds = resolveMorphologyTooltipBounds({ viewportWidth: 1280, viewportHeight: 720 });
assert.deepEqual(viewportBounds, { left: 10, right: 1270, top: 10, bottom: 710 });

assert.deepEqual(
  resolveMorphologyTooltipPlacement({
    targetRect: { left: 1218, right: 1240, top: 340, bottom: 360, width: 22 },
    tooltipRect: { width: 330, height: 128 },
    bounds: panelBounds,
  }),
  { left: 913, top: 202 },
);

assert.deepEqual(
  resolveMorphologyTooltipPlacement({
    targetRect: { left: 913, right: 935, top: 340, bottom: 360, width: 22 },
    tooltipRect: { width: 330, height: 128 },
    bounds: panelBounds,
  }),
  { left: 913, top: 202 },
);

assert.deepEqual(
  resolveMorphologyTooltipPlacement({
    targetRect: { left: 1000, right: 1040, top: 300, bottom: 320, width: 40 },
    tooltipRect: { width: 260, height: 120 },
    bounds: panelBounds,
  }),
  { left: 913, top: 170 },
);

assert.deepEqual(
  resolveMorphologyTooltipPlacement({
    targetRect: { left: 1000, right: 1040, top: 100, bottom: 120, width: 40 },
    tooltipRect: { width: 260, height: 120 },
    bounds: panelBounds,
  }),
  { left: 913, top: 130 },
);

const mobileBounds = resolveMorphologyTooltipBounds({
  panelRect: { left: 0, right: 390, top: 64, bottom: 844 },
  viewportWidth: 390,
  viewportHeight: 844,
});
assert.deepEqual(mobileBounds, { left: 10, right: 380, top: 74, bottom: 834 });
assert.equal(mobileBounds.right - mobileBounds.left, 370);

const narrowBounds = resolveMorphologyTooltipBounds({
  panelRect: { left: 520, right: 820, top: 70, bottom: 900 },
  viewportWidth: 820,
  viewportHeight: 900,
});
assert.deepEqual(narrowBounds, { left: 530, right: 810, top: 80, bottom: 890 });
assert.equal(narrowBounds.right - narrowBounds.left, 280);

const widthConstrainedPlacement = resolveMorphologyTooltipPlacement({
  targetRect: { left: 780, right: 800, top: 400, bottom: 420, width: 20 },
  tooltipRect: { width: narrowBounds.right - narrowBounds.left, height: 140 },
  bounds: narrowBounds,
});
assert.deepEqual(widthConstrainedPlacement, { left: 530, top: 250 });
assert(widthConstrainedPlacement.left >= narrowBounds.left);
assert(widthConstrainedPlacement.left + 280 <= narrowBounds.right);

console.log(JSON.stringify({ status: "ok", assertions: 34 }, null, 2));
