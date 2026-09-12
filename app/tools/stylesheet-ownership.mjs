import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

// Small CSS scanner for the project's plain CSS. Quotes, comments and function
// arguments are respected; conditional contexts stay attached to every rule.
export function splitCss(value, delimiter = ",") {
  const parts = [];
  let start = 0, depth = 0, quote = "";
  for (let i = 0; i < value.length; i += 1) {
    const c = value[i];
    if (quote) { if (c === "\\") i += 1; else if (c === quote) quote = ""; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "(" || c === "[") depth += 1;
    if (c === ")" || c === "]") depth -= 1;
    if (!depth && c === delimiter) { parts.push(value.slice(start, i).trim()); start = i + 1; }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

export function cssRules(source, contexts = [], offset = 0) {
  const rules = [];
  let start = 0, open = -1, depth = 0, quote = "", comment = false;
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    if (comment) { if (c === "*" && source[i + 1] === "/") { comment = false; i += 1; if (!depth) start = i + 1; } continue; }
    if (quote) { if (c === "\\") i += 1; else if (c === quote) quote = ""; continue; }
    if (c === "/" && source[i + 1] === "*") { comment = true; i += 1; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "{" && depth++ === 0) open = i;
    else if (c === "}" && --depth === 0) {
      const selector = source.slice(start, open).trim();
      const body = source.slice(open + 1, i);
      if (/^@(media|container|supports|layer)\b/.test(selector)) {
        rules.push(...cssRules(body, [...contexts, selector], offset + open + 1));
      } else if (!selector.startsWith("@")) {
        const declarations = splitCss(body.replace(/\/\*[\s\S]*?\*\//g, ""), ";").map(value => {
          const colon = value.indexOf(":");
          return { property:value.slice(0, colon).trim(), value:value.slice(colon + 1).trim() };
        });
        rules.push({ selector, selectors:splitCss(selector), contexts, body, declarations, start:offset + start, end:offset + i + 1 });
      }
      start = i + 1;
    } else if (c === ";" && !depth) start = i + 1;
  }
  if (depth || quote || comment) throw new Error("Unbalanced CSS source");
  return rules;
}

export async function loadedStyles(appRoot = new URL("../", import.meta.url)) {
  const index = await readFile(new URL("index.html", appRoot), "utf8");
  const names = [...index.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="\.\/([^"?]+)(?:\?[^"]*)?"/g)].map(match => match[1]);
  return Promise.all(names.map(async name => ({ name, source:await readFile(new URL(name, appRoot), "utf8") })));
}

export function stylesheetInventory(sheets) {
  const owners = new Map();
  const files = sheets.map(({ name, source }) => {
    const rules = cssRules(source);
    for (const rule of rules) for (const selector of rule.selectors) {
      const key = selector.replace(/\s+/g, " ");
      const entries = owners.get(key) || [];
      entries.push({ file:name, contexts:rule.contexts, properties:rule.declarations.map(d => d.property) });
      owners.set(key, entries);
    }
    return { name, rules:rules.length, important:rules.flatMap(r=>r.declarations).filter(d=>/!important\b/.test(d.value)).length };
  });
  const overlaps = [...owners].filter(([,entries])=>new Set(entries.map(e=>e.file)).size>1).map(([selector, entries])=>({selector,entries}));
  return { files, ruleCount:files.reduce((n,f)=>n+f.rules,0), importantCount:files.reduce((n,f)=>n+f.important,0), overlapCount:overlaps.length, overlaps };
}

export const STYLE_LOAD_ORDER = Object.freeze([
  "styles.css", "styles-polish.css", "styles-shell.css", "styles-workspace.css",
  "styles-reader.css", "styles-study.css", "styles-context.css",
]);

// Nested context controls own their own geometry, even inside a Reader/Study
// ancestor. Conditional variants belong in the same component file.
const COMPONENT_OWNERS = [
  ["styles-context.css", /\.(?:panel-context|verse-context|detail-context|detail-nav|detail-floating|word-meaning|scope-mark|study-marks-trigger)/],
  ["styles-workspace.css", /study-workspace-width|\.detail-header|\.detail-title-block|\.detail-mode-status/],
  ["styles-shell.css", /\.(?:app-shell|app-header|brand|home-button|theme-toggle|theme-option|theme-switch|header-status|reader-control|reader-picker|book-picker|chapter-picker|detail-pane\b|detail-content|detail-work-area)/],
  ["styles-reader.css", /\.(?:reader-pane|reader-nav|verse-(?:row|body|line|number|actions|text|content|study)|strong-token|reader-text-segment|fn-marker|reader-target-badges|reader-context|chapter-(?:title|heading|content|stepper|nav|toolbar|actions|info|tools)|action-group|toolbar-button)/],
  ["styles-study.css", /\.(?:translation-(?:alignment|token|rendering)|alignment-|workspace-map|study-(?:mark|data)-|manage-labels|storage-details|technical-details|language-breakdown|mark-(?:list|pill|glyph)|original-language-|interlinear-|transliteration-symbol)/],
];
const STRUCTURE = /^(?:display|position|inset(?:-.+)?|top|right|bottom|left|float|clear|z-index|(?:min-|max-)?(?:width|height|inline-size|block-size)|(?:grid|flex|align|justify|place|gap|row-gap|column-gap|padding|margin|overflow|container|contain|box-sizing|vertical-align)(?:-.+)?)$/;

export function ownershipViolations(sheets) {
  const violations = [];
  for (const sheet of sheets) for (const rule of cssRules(sheet.source)) {
    const structural = rule.declarations.filter(d => STRUCTURE.test(d.property));
    if (sheet.name === "styles-polish.css" && rule.declarations.some(d => !d.property.startsWith("--"))) {
      violations.push(`${sheet.name}: visual tokens only (${rule.selector})`);
    }
    if (!structural.length) continue;
    for (const selector of rule.selectors) {
      // Excluded classes do not establish ownership of a generic element rule.
      const target = selector.replace(/:not\([^)]*\)/g, "");
      const owner = COMPONENT_OWNERS.find(([, pattern]) => pattern.test(target))?.[0];
      if (owner && owner !== sheet.name) violations.push(`${sheet.name}: ${selector} structure belongs to ${owner} (${rule.contexts.join(" > ") || "base"})`);
    }
  }
  for (const overlap of stylesheetInventory(sheets).overlaps) {
    // Shared root selectors set disjoint token families. A property collision
    // there is still an error; no broad theme/responsive exception is allowed.
    const seen = new Map();
    for (const entry of overlap.entries) for (const property of entry.properties) {
      const previous = seen.get(property);
      if (previous && previous !== entry.file && (STRUCTURE.test(property) || property.startsWith("--"))) {
        violations.push(`${overlap.selector}: ${property} crosses ${previous} / ${entry.file}`);
      }
      seen.set(property, entry.file);
    }
  }
  return [...new Set(violations)];
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(stylesheetInventory(await loadedStyles()), null, 2));
}
