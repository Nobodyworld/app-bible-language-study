import { pathToFileURL } from "node:url";
import path from "node:path";
import { cssRules, loadedStyles } from "./stylesheet-ownership.mjs";

// Reuse the maintained CSS parser. Separate media/theme/supports contexts do
// not collide; splitting one selector across blocks in the same context does.
export function styleHygiene(sheets) {
  const findings = [];
  for (const { name, source } of sheets) {
    const seenSelectors = new Set();
    for (const rule of cssRules(source)) {
      const context = rule.contexts.map((value) => value.replace(/\s+/g, " ").trim()).join(" > ") || "base";
      const line = source.slice(0, rule.start).split("\n").length;
      for (const selector of rule.selectors) {
        const key = `${context}\n${selector.replace(/\s+/g, " ").trim()}`;
        if (seenSelectors.has(key)) findings.push({ file: name, line, context, selector, kind: "duplicate-selector" });
        seenSelectors.add(key);
      }
      const properties = new Set();
      for (const declaration of rule.declarations) {
        const property = declaration.property.startsWith("--") ? declaration.property : declaration.property.toLowerCase();
        if (properties.has(property)) findings.push({ file: name, line, context, selector: rule.selector, property, kind: "duplicate-property" });
        properties.add(property);
        if (/!important\b/i.test(declaration.value)) findings.push({ file: name, line, context, selector: rule.selector, property, kind: "important-declaration" });
        if (property === "font-size" && /^0(?:px|rem|em)?(?:\s|$)/i.test(declaration.value)) findings.push({ file: name, line, context, selector: rule.selector, kind: "hidden-label" });
        if (property === "content" && /attr\(data-visible-label\)/.test(declaration.value)) findings.push({ file: name, line, context, selector: rule.selector, kind: "css-action-label" });
      }
    }
  }
  return findings;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const report = args.includes("--report");
  const names = args.filter((arg) => arg !== "--report" && arg !== "--check");
  const sheets = await loadedStyles();
  const requested = names.length ? names : report ? sheets.map((sheet) => sheet.name) : ["styles-context.css"];
  const unknown = requested.filter((name) => !sheets.some((sheet) => sheet.name === name));
  if (unknown.length) throw new Error(`Not a loaded stylesheet: ${unknown.join(", ")}`);
  const selected = sheets.filter((sheet) => requested.includes(sheet.name));
  const findings = styleHygiene(selected);
  console.log(JSON.stringify({ mode: report ? "report" : "check", files: requested, findings }, null, 2));
  if (!report && findings.length) process.exitCode = 1;
}
