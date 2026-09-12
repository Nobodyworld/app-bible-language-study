import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
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

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(stylesheetInventory(await loadedStyles()), null, 2));
}
