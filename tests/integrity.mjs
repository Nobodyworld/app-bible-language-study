#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const sourceRoots = ["app", "tests", "tools"].map((dir) => join(repoRoot, dir));
const failures = [];
let javascriptFiles = 0;
let jsonFiles = 0;

function walk(path) {
  if (!existsSync(path)) return [];
  const info = statSync(path);
  if (info.isFile()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    walk(join(path, entry.name)),
  );
}

const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const sourceManifest = JSON.parse(readFileSync(join(repoRoot, "app/data/source-manifest.json"), "utf8"));
const generationAuthorities = {
  original_language: ["app/tools/import-original-language-sources.mjs", "sources:check"],
  search: ["app/tools/generate-search-indexes.mjs", "search:check"],
};
for (const [id, [tool, checkCommand]] of Object.entries(generationAuthorities)) {
  const authority = sourceManifest.generation_authorities?.[id];
  if (authority?.tool !== tool || authority?.check_command !== checkCommand
      || !packageJson.scripts?.[checkCommand]?.includes(`node ./${tool} --check`)) {
    failures.push(`Source generation authority ${id} must name ${tool} and the maintained no-write ${checkCommand} command.`);
  }
}
for (const [name, command] of Object.entries(packageJson.scripts || {})) {
  const matches = [...command.matchAll(/node\s+([^\s&]+)/g)];
  for (const match of matches) {
    const scriptPath = resolve(repoRoot, match[1]);
    if (!existsSync(scriptPath)) {
      failures.push(`npm script "${name}" references missing file: ${match[1]}`);
    }
  }
}

for (const file of sourceRoots.flatMap(walk)) {
  if (file.endsWith(".js") || file.endsWith(".mjs")) {
    javascriptFiles += 1;
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (result.status !== 0) {
      failures.push(`JavaScript syntax error in ${file}: ${result.stderr.trim()}`);
    }

    const source = readFileSync(file, "utf8");
    const importPattern = /(?:from\s+|import\s*\()\s*["'](\.[^"']+)["']/g;
    for (const match of source.matchAll(importPattern)) {
      const importedPath = resolve(file, "..", match[1].split(/[?#]/, 1)[0]);
      const candidates = [importedPath, `${importedPath}.js`, `${importedPath}.mjs`];
      if (!candidates.some((candidate) => existsSync(candidate))) {
        failures.push(`Unresolved relative import in ${file}: ${match[1]}`);
      }
    }
  }

  if (file.endsWith(".json")) {
    jsonFiles += 1;
    try {
      JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      failures.push(`Invalid JSON in ${file}: ${error.message}`);
    }
  }
}

console.log(
  JSON.stringify(
    {
      status: failures.length ? "fail" : "ok",
      javascript_files_checked: javascriptFiles,
      json_files_checked: jsonFiles,
      failures,
    },
    null,
    2,
  ),
);

if (failures.length) process.exit(1);
