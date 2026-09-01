import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const APP_ROOT = path.join(REPO_ROOT, "app");
const FRONTEND_DESTINATION = path.join(REPO_ROOT, ".desktop-dist");
const RESOURCE_DESTINATION = path.join(REPO_ROOT, ".desktop-resources");
const INVENTORY_NAME = "desktop-inventory.json";
const CHECK_ONLY = process.argv.includes("--check");

const ROOT_RUNTIME_FILES = new Set([
  "app/app.js",
  "app/index.html",
  "app/styles.css",
  "app/styles-context.css",
  "app/styles-polish.css",
  "app/styles-portrait.css",
]);
const APP_RUNTIME_PREFIXES = Object.freeze([
  "app/data/",
  "app/docs/",
  "app/schemas/",
  "app/src/",
]);
const LEGAL_FILES = new Map([
  ["LICENSE", "LICENSE"],
  ["NOTICE.md", "NOTICE.md"],
]);
const EXCLUDED_RUNTIME_PREFIXES = Object.freeze(["app/data/physical-pack-fixtures/"]);
const EXCLUDED_RUNTIME_FILES = new Set(["app/data/physical-pack-scenarios.json"]);
const REQUIRED_ASSETS = Object.freeze([
  "index.html",
  "app.js",
  "styles.css",
  "styles-context.css",
  "styles-polish.css",
  "styles-portrait.css",
  "src/platform/application-platform.js",
  "src/platform/tauri-bridge.js",
  "src/platform/tauri-platform.js",
  "data/manifest.json",
  "data/package-manifest.json",
  "data/distribution-manifest.json",
  "data/source-manifest.json",
  "data/text-editions.json",
  "schemas/distribution-manifest.schema.json",
  "LICENSE",
  "NOTICE.md",
]);
const DESKTOP_CSP = "connect-src 'self' ipc: http://ipc.localhost";

function fail(message) {
  throw new Error(`Desktop frontend preparation failed: ${message}`);
}

function slash(value) {
  return value.replaceAll("\\", "/");
}

function assertContained(root, candidate, label) {
  const relative = path.relative(root, candidate);
  if (!relative || relative === ".") return;
  if (relative.startsWith("..") || path.isAbsolute(relative)) fail(`${label} escapes its approved root.`);
}

function assertSafeRelative(value, label) {
  const normalized = slash(value);
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) fail(`${label} must be relative.`);
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) fail(`${label} contains an unsafe segment.`);
  return normalized;
}

function outputPathForTracked(trackedPath) {
  if (LEGAL_FILES.has(trackedPath)) return LEGAL_FILES.get(trackedPath);
  if (!trackedPath.startsWith("app/")) return null;
  if (EXCLUDED_RUNTIME_FILES.has(trackedPath) || EXCLUDED_RUNTIME_PREFIXES.some((prefix) => trackedPath.startsWith(prefix))) return null;
  if (!ROOT_RUNTIME_FILES.has(trackedPath) && !APP_RUNTIME_PREFIXES.some((prefix) => trackedPath.startsWith(prefix))) return null;
  return trackedPath.slice("app/".length);
}

async function trackedFiles() {
  const { stdout } = await execFileAsync("git", ["ls-files", "--stage", "-z", "--", "app", "LICENSE", "NOTICE.md"], {
    cwd: REPO_ROOT,
    encoding: "buffer",
    maxBuffer: 8 * 1024 * 1024,
  });
  const entries = stdout.toString("utf8").split("\0").filter(Boolean).map((entry) => {
    const separator = entry.indexOf("\t");
    if (separator < 0) fail("Git returned a malformed tracked-file entry.");
    const metadata = entry.slice(0, separator).split(" ");
    const trackedPath = assertSafeRelative(entry.slice(separator + 1), "tracked path");
    if (!new Set(["100644", "100755"]).has(metadata[0])) fail(`tracked runtime asset is not a regular file: ${trackedPath}`);
    return { trackedPath, outputPath: outputPathForTracked(trackedPath) };
  }).filter((entry) => entry.outputPath);
  entries.sort((left, right) => left.outputPath.localeCompare(right.outputPath));
  const duplicate = entries.find((entry, index) => index > 0 && entry.outputPath === entries[index - 1].outputPath);
  if (duplicate) fail(`duplicate staged path: ${duplicate.outputPath}`);
  return entries;
}

async function assertNoLinkInPath(candidate) {
  assertContained(REPO_ROOT, candidate, "runtime asset");
  let current = candidate;
  while (current !== REPO_ROOT) {
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink()) fail(`runtime asset traverses a symbolic link or junction: ${slash(path.relative(REPO_ROOT, current))}`);
    current = path.dirname(current);
  }
}

function desktopHtml(source) {
  const marker = "connect-src 'self'";
  if (source.split(marker).length - 1 !== 1) fail("browser index CSP no longer has the expected single connect-src directive.");
  const output = source.replace(marker, DESKTOP_CSP);
  if (output.includes("unsafe-eval") || output.includes("connect-src *")) fail("staged CSP is broader than the desktop contract permits.");
  return output;
}

async function expectedEntries() {
  const entries = [];
  for (const entry of await trackedFiles()) {
    const sourcePath = path.join(REPO_ROOT, entry.trackedPath);
    await assertNoLinkInPath(sourcePath);
    const stat = await fs.lstat(sourcePath);
    if (!stat.isFile()) fail(`tracked runtime asset is not a regular file: ${entry.trackedPath}`);
    let bytes = await fs.readFile(sourcePath);
    if (entry.trackedPath === "app/index.html") bytes = Buffer.from(desktopHtml(bytes.toString("utf8")), "utf8");
    entries.push({
      path: assertSafeRelative(entry.outputPath, "staged path"),
      placement: entry.outputPath.startsWith("data/") ? "resource" : "frontend",
      bytes,
      logicalBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  const present = new Set(entries.map((entry) => entry.path));
  for (const required of REQUIRED_ASSETS) if (!present.has(required)) fail(`required runtime asset is missing: ${required}`);

  const packageManifest = JSON.parse(await fs.readFile(path.join(APP_ROOT, "data/package-manifest.json"), "utf8"));
  for (const featurePack of packageManifest.feature_packs || []) {
    for (const requestedPath of featurePack.paths || []) {
      const stagedPrefix = assertSafeRelative(String(requestedPath), "package path");
      if (![...present].some((candidate) => candidate === stagedPrefix || candidate.startsWith(`${stagedPrefix}/`))) {
        fail(`package manifest requests an omitted asset path: ${requestedPath}`);
      }
    }
  }
  return entries;
}

function inventoryBytes(entries) {
  const inventory = {
    kind: "bibleapp:desktop-runtime-inventory",
    schemaVersion: 1,
    fileCount: entries.length,
    logicalBytes: entries.reduce((total, entry) => total + entry.logicalBytes, 0),
    csp: DESKTOP_CSP,
    frontendBytes: entries.filter((entry) => entry.placement === "frontend").reduce((total, entry) => total + entry.logicalBytes, 0),
    resourceBytes: entries.filter((entry) => entry.placement === "resource").reduce((total, entry) => total + entry.logicalBytes, 0),
    files: entries.map(({ path: filePath, placement, logicalBytes, sha256 }) => ({ path: filePath, placement, bytes: logicalBytes, sha256 })),
  };
  return Buffer.from(`${JSON.stringify(inventory, null, 2)}\n`, "utf8");
}

async function destinationFiles(destination) {
  const result = [];
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) fail(`staged output contains a symbolic link or junction: ${slash(path.relative(destination, candidate))}`);
      if (entry.isDirectory()) await visit(candidate);
      else if (entry.isFile()) result.push(slash(path.relative(destination, candidate)));
      else fail(`staged output contains a non-file entry: ${slash(path.relative(destination, candidate))}`);
    }
  }
  await visit(destination);
  return result.sort((left, right) => left.localeCompare(right));
}

async function verify(entries, inventory) {
  for (const [placement, destination] of [["frontend", FRONTEND_DESTINATION], ["resource", RESOURCE_DESTINATION]]) {
    const expected = new Map(entries.filter((entry) => entry.placement === placement).map((entry) => [entry.path, entry.bytes]));
    if (placement === "frontend") expected.set(INVENTORY_NAME, inventory);
    const actual = await destinationFiles(destination);
    const expectedPaths = [...expected.keys()].sort((left, right) => left.localeCompare(right));
    if (JSON.stringify(actual) !== JSON.stringify(expectedPaths)) {
      const unauthorized = actual.filter((item) => !expected.has(item));
      const missing = expectedPaths.filter((item) => !actual.includes(item));
      fail(`${placement} staged file set differs (missing: ${missing.join(", ") || "none"}; unauthorized: ${unauthorized.join(", ") || "none"}).`);
    }
    for (const [relative, bytes] of expected) {
      const actualBytes = await fs.readFile(path.join(destination, relative));
      if (!actualBytes.equals(bytes)) fail(`${placement} staged asset differs from deterministic source: ${relative}`);
    }
  }
}

async function prepare(entries, inventory) {
  for (const destination of [FRONTEND_DESTINATION, RESOURCE_DESTINATION]) {
    assertContained(REPO_ROOT, destination, "desktop destination");
    try {
      const existing = await fs.lstat(destination);
      if (existing.isSymbolicLink()) fail("desktop destination is a symbolic link or junction.");
      if (!existing.isDirectory()) fail("desktop destination exists but is not a directory.");
      await fs.rm(destination, { recursive: true });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await fs.mkdir(destination, { recursive: false });
  }
  for (const entry of entries) {
    const destination = entry.placement === "resource" ? RESOURCE_DESTINATION : FRONTEND_DESTINATION;
    const output = path.join(destination, entry.path);
    assertContained(destination, output, "staged asset");
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, entry.bytes, { flag: "wx" });
  }
  await fs.writeFile(path.join(FRONTEND_DESTINATION, INVENTORY_NAME), inventory, { flag: "wx" });
}

const entries = await expectedEntries();
const inventory = inventoryBytes(entries);
if (CHECK_ONLY) {
  for (const destination of [FRONTEND_DESTINATION, RESOURCE_DESTINATION]) {
    const stat = await fs.lstat(destination).catch(() => null);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) fail("a staged desktop destination is absent or unsafe; run desktop:prepare first.");
  }
} else {
  await prepare(entries, inventory);
}
await verify(entries, inventory);
const summary = JSON.parse(inventory.toString("utf8"));
console.log(`DESKTOP_FRONTEND ${CHECK_ONLY ? "CHECK" : "PREPARE"}=PASS files=${summary.fileCount} bytes=${summary.logicalBytes} frontendBytes=${summary.frontendBytes} resourceBytes=${summary.resourceBytes}`);
