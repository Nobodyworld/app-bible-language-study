import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { cssRules, loadedStyles, ownershipViolations, stylesheetInventory, STYLE_LOAD_ORDER } from "../app/tools/stylesheet-ownership.mjs";

const sheets = await loadedStyles();
assert.deepEqual(sheets.map(s => s.name), STYLE_LOAD_ORDER, "The shared frontend must load every owner in its documented order.");
assert.deepEqual((await readdir(new URL("../app/", import.meta.url))).filter(n => n.endsWith(".css")).sort(), [...STYLE_LOAD_ORDER].sort(), "No orphan or retired stylesheet may remain.");
assert.deepEqual(ownershipViolations(sheets), []);
const readerRules = cssRules(sheets.find(s => s.name === "styles-reader.css").source);
assert.ok(readerRules.some(r => r.selectors.includes(".toolbar-button.mobile-detail-launcher") && !r.contexts.length && r.declarations.some(d => d.property === "display" && d.value === "none")), "The mobile launcher must outrank generic toolbar display on desktop.");
assert.ok(readerRules.some(r => r.selectors.includes(".toolbar-button.mobile-detail-launcher") && r.contexts.includes("@media (max-width: 768px)") && r.declarations.some(d => d.property === "display" && d.value === "inline-flex")), "The same owner must expose the mobile launcher at its breakpoint.");
const staging = await readFile(new URL("../app/tools/prepare-desktop-frontend.mjs", import.meta.url), "utf8");
for (const name of STYLE_LOAD_ORDER) {
  assert.ok(staging.includes(`"app/${name}"`) && staging.includes(`"${name}"`), `${name} must be staged and required in native builds.`);
}
const nested = cssRules('@layer example { @supports (display: grid) { @media (width > 10px) { @container pane (width > 3px) { .detail-header:is(.a, .b), .detail-title-block { display: grid; content: "a,b;{}"; } } } } }');
assert.equal(nested.length, 1);
assert.equal(nested[0].selectors.length, 2);
assert.equal(nested[0].contexts.length, 4);
assert.equal(nested[0].declarations[1].value, '"a,b;{}"');
const commented = '.detail-header /* owner comment */ {display:grid;content:"/*literal*/";}';
assert.deepEqual(cssRules(commented)[0].selectors,[".detail-header"]);
assert.equal(cssRules(commented)[0].declarations[1].value,'"/*literal*/"');
assert.ok(ownershipViolations([{name:"unexpected.css",source:commented}]).length,"Inline comments must not hide structural ownership.");
for (const context of ["", "@media (max-width: 600px)", "@supports (display: grid)", "@layer example", "@container study-workspace (width > 10px)"]) {
  const rule = '.detail-header { display: block; }';
  const source = context ? `${context} { ${rule} }` : rule;
  const bad = [...sheets, {name:"unexpected.css", source}];
  assert.ok(ownershipViolations(bad).some(v => v.includes("styles-workspace.css")), `${context || "base"} must not bypass the owner.`);
}
assert.ok(ownershipViolations([{name:"a.css",source:'.new-component {display:grid;}'}, {name:"b.css",source:'@media (width > 3px) {.new-component {display:flex;}}'}]).length, "Unknown structural overlaps must fail too.");
assert.ok(ownershipViolations([{name:"styles-polish.css",source:'.new-component {color:red;}'}]).length, "Polish must stay token-only.");
assert.deepEqual(ownershipViolations([{name:"styles-workspace.css",source:'.detail-header {display:grid;} @media (max-width:600px) {.detail-header {display:flex;}}'}]), [], "Same-owner responsive variants are intentional.");
const inventory = stylesheetInventory(sheets);
console.log(JSON.stringify({status:"ok", files:inventory.files, rules:inventory.ruleCount, important:inventory.importantCount, crossFileSelectors:inventory.overlapCount, negativeControls:8}, null, 2));
