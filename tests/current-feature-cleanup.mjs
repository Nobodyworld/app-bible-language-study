import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { styleHygiene } from "../app/tools/ui-hygiene.mjs";
import { PANEL_SCOPE_LABELS, panelToolsForScope } from "../app/src/panel-context-model.js";
import { WORD_INTERPRETATION_COPY, meaningChoiceSourceLabel } from "../app/src/study-copy.js";
import { duplicateScopedLabels } from "../app/src/ui-label-audit.js";
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

assert.equal(styleHygiene([{ name: "fixture.css", source: ".x { color: red; } .x { margin: 0; }" }])[0].kind, "duplicate-selector");
assert.equal(styleHygiene([{ name: "fixture.css", source: ".x { color: red; color: blue; }" }])[0].kind, "duplicate-property");
assert.deepEqual(styleHygiene([{ name: "fixture.css", source: '.x { color: red; } @media (max-width: 640px) { .x { color: blue; } } [data-theme="dark"] .x { color: white; }' }]), []);
assert.equal(styleHygiene([{ name: "fixture.css", source: '.x { content: "a;{}/*not a comment*/"; color: red; }' }]).length, 0);
const contextCss = read("app/styles-context.css");
assert.deepEqual(styleHygiene([{ name: "styles-context.css", source: contextCss }]), [], "context CSS must not regress into duplicate rules, importance or hidden labels");
for (const language of ["hebrew", "greek"]) {
  const tools = panelToolsForScope("word", { language });
  const labels = [PANEL_SCOPE_LABELS.word, ...tools.map((tool) => tool.shortLabel), WORD_INTERPRETATION_COPY.action];
  assert.deepEqual(duplicateScopedLabels(labels.map((label) => ({ scope: "word", label }))), []);
  assert.equal(tools[0].shortLabel, "Definition");
  assert.equal(tools.filter((tool) => tool.shortLabel === "Concordance").length, 1);
}
assert.deepEqual(duplicateScopedLabels(panelToolsForScope("verse").map((tool) => ({ scope: "verse", label: tool.shortLabel }))), []);
assert.equal(duplicateScopedLabels([{ scope: "word", label: "Word" }, { scope: "word", label: " word " }]).length, 1);
assert.deepEqual(duplicateScopedLabels([{ scope: "word", label: "Save" }, { scope: "verse", label: "Save" }]), []);
assert.equal(WORD_INTERPRETATION_COPY.action, "Interpretation");
assert.equal(WORD_INTERPRETATION_COPY.title, "Word interpretation");
assert.match(WORD_INTERPRETATION_COPY.boundary, /does not change the Bible text/);
assert.equal(meaningChoiceSourceLabel("lexicon"), "Lexicon definition");
const meaningSource = read("app/src/word-meaning.js");
assert.doesNotMatch(meaningSource, /personal meaning|add your own|custom meaning/i);
assert.match(meaningSource, /dataset\.meaningValue = choice\.value/);
assert.match(meaningSource, /value\.textContent = choice\.value/);
assert.match(meaningSource, /source\.textContent = meaningChoiceSourceLabel/);
const dataSource = read("app/src/views/user-data-view.js");
assert.doesNotMatch(dataSource, /app-settings-section|Personal meanings|Preserved legacy verse drafts|Study Mark assertions/);
assert.match(dataSource, /compactUserDataBackup\(createUserDataExport\(ctx\.state\)\)/);
assert.match(dataSource, /if \(profile\?\.isLab\) \{\s*if \(ctx\.isFeatureEnabled\?\.\("physical-pack-management"\)/);
assert.match(dataSource, /renderPackRecovery\(ctx\)/);
console.log("PASS: current-feature copy, scoped naming and CSS hygiene");
