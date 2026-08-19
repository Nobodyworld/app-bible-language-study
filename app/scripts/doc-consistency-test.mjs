#!/usr/bin/env node

import { execFile } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { canRunJob } from "../src/job-processor.js";

const execFileAsync = promisify(execFile);
const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = join(appRoot, "..");

const DOCUMENT_CLASSIFICATIONS = new Set([
  "maintained",
  "generated",
  "historical",
  "redundant",
  "unclear",
]);

const DOCUMENT_MODEL = Object.freeze([
  { path: ".github/PULL_REQUEST_TEMPLATE.md", classification: "maintained", roles: ["policy"] },
  { path: "CHANGELOG.md", classification: "maintained", roles: ["current-status", "release-history"] },
  { path: "CONTRIBUTING.md", classification: "maintained", roles: ["policy", "runtime-facing"] },
  { path: "LICENSE", classification: "maintained", roles: ["legal"] },
  { path: "NOTICE.md", classification: "maintained", roles: ["rights"] },
  {
    path: "PUBLIC_RELEASE_CHECKLIST.md",
    classification: "maintained",
    roles: ["current-policy", "current-status", "release"],
  },
  {
    path: "README.md",
    classification: "maintained",
    roles: ["current-product", "current-status", "runtime-facing"],
  },
  { path: "SECURITY.md", classification: "maintained", roles: ["current-policy", "security"] },
  { path: "app/README.md", classification: "maintained", roles: ["runtime-facing", "technical"] },
  {
    path: "app/docs/README.md",
    classification: "maintained",
    roles: ["current-product", "runtime-facing", "technical"],
  },
  {
    path: "app/docs/UI_FUNCTIONALITY_SCHEMA.md",
    classification: "maintained",
    roles: ["current-product", "runtime-facing", "ui-contract"],
  },
  {
    path: "docs/ARCHITECTURE.md",
    classification: "maintained",
    roles: ["current-product", "runtime-facing", "technical"],
  },
  {
    path: "docs/DATA_MODEL.md",
    classification: "maintained",
    roles: ["current-product", "runtime-facing", "data-model"],
  },
  {
    path: "docs/OPTIONAL_PACK_ARCHITECTURE.md",
    classification: "maintained",
    roles: ["technical", "data-model"],
  },
  {
    path: "docs/SECURITY_POSTURE.md",
    classification: "maintained",
    roles: ["current-policy", "current-status", "security"],
  },
  {
    path: "docs/SHOWCASE_SCREENSHOTS.md",
    classification: "maintained",
    roles: ["current-product", "screenshot-narrative"],
  },
  {
    path: "docs/images/SCREENSHOTS.md",
    classification: "generated",
    roles: ["screenshot-inventory"],
  },
  {
    path: "tests/TEST_INVENTORY.md",
    classification: "maintained",
    roles: ["runtime-facing", "test-inventory"],
  },
]);

function assert(condition, message, details = null) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function walkFiles(root, predicate, files = []) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(path, predicate, files);
    } else if (predicate(path)) {
      files.push(path);
    }
  }
  return files;
}

function rel(path) {
  return relative(workspaceRoot, path).replaceAll("\\", "/");
}

function absoluteDocumentPath(entry) {
  return join(workspaceRoot, ...entry.path.split("/"));
}

function normalizeProse(text) {
  return text.replace(/^\s*>\s?/gm, "").replace(/\s+/g, " ").trim();
}

function entriesWithRole(role) {
  return DOCUMENT_MODEL.filter(
    (entry) => entry.classification === "maintained" && entry.roles.includes(role),
  );
}

async function trackedDocumentationPaths() {
  const { stdout } = await execFileAsync(
    "git",
    [
      "-c",
      `safe.directory=${workspaceRoot.replaceAll("\\", "/")}`,
      "ls-files",
      "--",
      "*.md",
      "*.MD",
      "*.markdown",
      "*.MARKDOWN",
      "*.txt",
      "*.TXT",
      "*.rst",
      "*.RST",
      "*.adoc",
      "*.ADOC",
      "LICENSE",
      "NOTICE",
      "SECURITY",
      "CONTRIBUTING",
      "CHANGELOG",
      "README",
      "AUTHORS",
      "CONTRIBUTORS",
      "CODE_OF_CONDUCT",
      "COPYING",
      "COPYRIGHT",
      "PATENTS",
    ],
    { cwd: workspaceRoot, windowsHide: true },
  );
  return stdout
    .split(/\r?\n/)
    .map((path) => path.trim().replaceAll("\\", "/"))
    .filter(Boolean)
    .sort();
}

async function checkDocumentModel() {
  const invalid = DOCUMENT_MODEL.filter(
    (entry) =>
      !entry.path ||
      !DOCUMENT_CLASSIFICATIONS.has(entry.classification) ||
      !Array.isArray(entry.roles) ||
      entry.roles.length === 0,
  ).map((entry) => entry.path || "<missing path>");
  assert(!invalid.length, "Documentation model entries must have a valid classification and role.", invalid);

  const seen = new Set();
  const duplicates = [];
  for (const entry of DOCUMENT_MODEL) {
    if (seen.has(entry.path)) duplicates.push(entry.path);
    seen.add(entry.path);
  }
  assert(!duplicates.length, "Documentation model paths must be unique.", duplicates);

  const missing = [];
  for (const entry of DOCUMENT_MODEL) {
    if (!(await exists(absoluteDocumentPath(entry)))) missing.push(entry.path);
  }
  assert(!missing.length, "Every classified documentation path must exist.", missing);

  const tracked = await trackedDocumentationPaths();
  const declared = [...seen].sort();
  const unclassified = tracked.filter((path) => !seen.has(path));
  const untrackedDeclarations = declared.filter((path) => !tracked.includes(path));
  assert(!unclassified.length, "Every tracked prose documentation candidate must be classified.", unclassified);
  assert(
    !untrackedDeclarations.length,
    "Documentation model paths must remain tracked repository files.",
    untrackedDeclarations,
  );

  const screenshotInventory = DOCUMENT_MODEL.find(
    (entry) => entry.path === "docs/images/SCREENSHOTS.md",
  );
  assert(
    screenshotInventory?.classification === "generated",
    "The generated screenshot inventory must not be treated as maintained narrative documentation.",
  );

  return tracked;
}

async function checkNoAbsoluteWindowsPaths(entries) {
  const offenders = [];
  for (const entry of entries) {
    const text = await readFile(absoluteDocumentPath(entry), "utf8");
    if (/[A-Za-z]:\\/.test(text)) offenders.push(entry.path);
  }
  assert(!offenders.length, "Maintained docs must not contain absolute Windows paths.", offenders);
}

async function checkArchiveReferences(entries) {
  const offenders = [];
  for (const entry of entries) {
    const text = await readFile(absoluteDocumentPath(entry), "utf8");
    text.split(/\r?\n/).forEach((line, index) => {
      if (!/archive|archived/i.test(line)) return;
      if (
        /archive-only|historical|retained for traceability|must not fetch archive|not runtime|ignored from publishing|source archive|recovery backup/i.test(
          line,
        )
      )
        return;
      offenders.push(`${entry.path}:${index + 1}`);
    });
  }
  assert(!offenders.length, "Runtime-facing archive references must explain their context.", offenders);
}

async function checkExternalBibleLinks(entries) {
  const offenders = [];
  for (const entry of entries) {
    const text = await readFile(absoluteDocumentPath(entry), "utf8");
    const links = text.match(/https?:\/\/[^\s)>"']+/g) || [];
    links
      .filter((url) => !/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url))
      .filter((url) => !url.includes("json-schema.org"))
      .forEach((url) => offenders.push(`${entry.path} -> ${url}`));
  }
  assert(!offenders.length, "Runtime-facing docs must not depend on external Bible-study links.", offenders);
}

async function checkDocumentedCommands(entries) {
  const packageJson = await readJson(join(workspaceRoot, "package.json"));
  const packageScripts = new Set(Object.keys(packageJson.scripts || {}));
  const unknownScripts = [];
  const missingPaths = [];

  for (const entry of entries) {
    const text = await readFile(absoluteDocumentPath(entry), "utf8");
    text.split(/\r?\n/).forEach((line, index) => {
      for (const match of line.matchAll(/\bnpm\s+run\s+([A-Za-z0-9:_-]+)/g)) {
        if (!packageScripts.has(match[1])) {
          unknownScripts.push(`${entry.path}:${index + 1} -> npm run ${match[1]}`);
        }
      }
      for (const match of line.matchAll(/\b(?:node|python)\s+((?:\.{1,2}[\\/])[^\s`"'<>]+)/g)) {
        const commandPath = match[1].replace(/[),.;:]+$/, "");
        const resolved = join(workspaceRoot, commandPath.replaceAll("\\", "/"));
        const repositoryRelative = relative(workspaceRoot, resolved);
        missingPaths.push({ entry, line: index + 1, commandPath, resolved, repositoryRelative });
      }
    });
  }

  const missing = [];
  for (const ref of missingPaths) {
    if (
      ref.repositoryRelative.startsWith("..") ||
      isAbsolute(ref.repositoryRelative) ||
      !(await exists(ref.resolved))
    ) {
      missing.push(`${ref.entry.path}:${ref.line} -> ${ref.commandPath}`);
    }
  }
  assert(!unknownScripts.length, "Documented npm scripts must exist in package.json.", unknownScripts);
  assert(!missing.length, "Documented local command paths must exist.", missing);
}

async function checkCurrentDocumentContracts() {
  const texts = new Map();
  for (const entry of DOCUMENT_MODEL.filter((item) => item.classification === "maintained")) {
    texts.set(entry.path, normalizeProse(await readFile(absoluteDocumentPath(entry), "utf8")));
  }

  const contracts = [
    {
      path: "README.md",
      required: [
        /PUBLIC PREVIEW — ACTIVE DEVELOPMENT/,
        /Word\s*→\s*Verse/,
        /Chapter Language Study and Book Outline remain reader-header actions/i,
        /Favorite remains the canonical `favorite` assertion/i,
        /exact canonical source-token identity/i,
        /current, manually reviewed, accepted public-preview evidence/i,
        /product surface they show is Language Study/i,
      ],
      forbidden: [
        /undergoing a compact corrective redesign under issue #17/i,
        /issue #19.+active My Data/i,
        /Additional current captures/i,
        /historical visual evidence/i,
        /deferred to issue #33/i,
      ],
    },
    {
      path: "app/docs/README.md",
      required: [/reader/i, /Language Study/, /Study Marks/, /Meaning/, /My Data/],
    },
    {
      path: "app/docs/UI_FUNCTIONALITY_SCHEMA.md",
      required: [/Word\s*→\s*Verse/, /Meaning is a separate action/i, /bibleapp:user-data/, /Advanced diagnostics/],
      forbidden: [/Language Study control and Translation workspace require/i],
    },
    {
      path: "docs/ARCHITECTURE.md",
      required: [/Word\s*→\s*Verse/, /reader-header actions/i, /canonical `favorite` assertion/i, /exact canonical source-token identity/i],
      forbidden: [/Study views are rendered in the side panel for search[\s\S]*jobs, and user-data tools/i],
    },
    {
      path: "CHANGELOG.md",
      required: [/Unreleased — Public Preview/, /No stable `1\.0\.0` release or tag is implied or authorized/i],
    },
    {
      path: "PUBLIC_RELEASE_CHECKLIST.md",
      required: [
        /Separate Processing and Study Data user-facing surfaces are retired/i,
        /CodeQL Default Setup intentionally remains disabled/i,
        /explicit owner authorization/i,
      ],
    },
    {
      path: "docs/SHOWCASE_SCREENSHOTS.md",
      required: [
        /19 tracked PNG files/i,
        /current, manually reviewed, accepted public-preview evidence/i,
        /generated filename inventory/i,
        /Public descriptions use Language Study/i,
        /My study data counts reflect the seeded Meaning and Study Mark/i,
        /Light 390×844 Psalm 118:4 state with the full-screen Verse study drawer and Cross References controls open/i,
        /Dark 390×844 John 1:1 full-screen drawer with the populated My Data summary readable/i,
      ],
      forbidden: [
        /retained historical public-preview captures/i,
        /deferred/i,
        /issue #33/i,
        /Do not run `npm run screenshots:public`/i,
      ],
    },
    {
      path: "tests/TEST_INVENTORY.md",
      required: [/`package\.json` is the executable authority/i, /npm run test:static/, /npm run test:browser:mobile/, /npm run verify/],
    },
  ];

  const failures = [];
  for (const contract of contracts) {
    const text = texts.get(contract.path) || "";
    for (const pattern of contract.required || []) {
      if (!pattern.test(text)) failures.push(`${contract.path} missing ${pattern}`);
    }
    for (const pattern of contract.forbidden || []) {
      if (pattern.test(text)) failures.push(`${contract.path} contains obsolete ${pattern}`);
    }
  }
  assert(!failures.length, "Maintained current-product documents must preserve accepted contracts.", failures);
}

async function checkTransientPolicyState(entries) {
  const offenders = [];
  const transientPrState =
    /(?:PR #\d+[\s\S]{0,120}?\b(?:draft|blocked|hold)\b|\b(?:draft|blocked|hold)\b[\s\S]{0,120}?PR #\d+)/i;
  for (const entry of entries) {
    const text = await readFile(absoluteDocumentPath(entry), "utf8");
    if (transientPrState.test(normalizeProse(text))) offenders.push(entry.path);
  }
  assert(
    !offenders.length,
    "Maintained policy must not encode transient pull-request review state.",
    offenders,
  );
}

async function checkTestInventoryAliases() {
  const packageJson = await readJson(join(workspaceRoot, "package.json"));
  const inventory = await readFile(join(workspaceRoot, "tests", "TEST_INVENTORY.md"), "utf8");
  const aliases = Object.keys(packageJson.scripts || {}).filter(
    (name) =>
      name === "test" ||
      name.startsWith("test:") ||
      name === "verify" ||
      name === "audit" ||
      name.startsWith("audit:"),
  );
  const missing = aliases.filter((name) =>
    name === "test" ? !inventory.includes("`npm test`") : !inventory.includes(`npm run ${name}`),
  );
  assert(!missing.length, "Test inventory must document every maintained test and audit alias.", missing);
}

async function checkPackageManifest() {
  const manifest = await readJson(join(appRoot, "data", "package-manifest.json"));
  const featurePackIds = new Set((manifest.feature_packs || []).map((pack) => pack.id));
  const unknownRefs = [];

  (manifest.feature_packs || []).forEach((pack) => {
    (pack.dependencies || []).forEach((dependency) => {
      if (!featurePackIds.has(dependency)) unknownRefs.push(`feature_packs.${pack.id}.dependencies -> ${dependency}`);
    });
  });
  (manifest.packages || []).forEach((pkg) => {
    (pkg.feature_pack_ids || []).forEach((packId) => {
      if (!featurePackIds.has(packId)) unknownRefs.push(`packages.${pkg.id}.feature_pack_ids -> ${packId}`);
    });
  });
  const fullStudy = (manifest.packages || []).find(
    (pkg) => new Set(pkg.feature_pack_ids || []).size === featurePackIds.size,
  );
  assert(fullStudy, "Package manifest must include a package containing every declared feature pack.");
  assert(
    new Set(fullStudy.feature_pack_ids || []).size === featurePackIds.size,
    "Full-study package feature-pack count must match manifest feature_packs count.",
    { fullStudy: fullStudy.feature_pack_ids?.length || 0, featurePacks: featurePackIds.size },
  );
  assert(!unknownRefs.length, "Package manifest must not reference unknown feature pack ids.", unknownRefs);
}

async function checkDeclaredJobs() {
  const manifest = await readJson(join(appRoot, "data", "analysis", "manifest.json"));
  const missing = (manifest.planned_job_types || []).filter((jobType) => !canRunJob({ type: jobType, job_type: jobType }));
  assert(!missing.length, "Declared job types must have a processor or explicit simulation_only handling.", missing);
}

async function checkSchemaVersionFields() {
  const schemaRoot = join(appRoot, "schemas");
  if (!(await exists(schemaRoot))) return;
  const schemaFiles = await walkFiles(schemaRoot, (path) => extname(path) === ".json");
  const missing = [];
  for (const file of schemaFiles) {
    const schema = await readJson(file);
    const properties = schema.properties || {};
    const hasVersionField = ["schema_version", "content_version", "processor_version", "app_version", "package_version"].some(
      (field) => Object.prototype.hasOwnProperty.call(properties, field),
    );
    if (!hasVersionField) missing.push(rel(file));
  }
  assert(!missing.length, "Every schema must expose an explicit version field.", missing);
}

async function main() {
  const trackedDocumentation = await checkDocumentModel();
  const maintainedEntries = DOCUMENT_MODEL.filter((entry) => entry.classification === "maintained");

  await checkNoAbsoluteWindowsPaths(maintainedEntries);
  await checkArchiveReferences(entriesWithRole("runtime-facing"));
  await checkExternalBibleLinks(entriesWithRole("current-product"));
  await checkDocumentedCommands(maintainedEntries);
  await checkCurrentDocumentContracts();
  await checkTransientPolicyState(entriesWithRole("current-policy"));
  await checkTestInventoryAliases();
  await checkPackageManifest();
  await checkDeclaredJobs();
  await checkSchemaVersionFields();

  console.log(
    JSON.stringify(
      {
        checked_docs: maintainedEntries.length,
        checked_paths: maintainedEntries.map((entry) => entry.path),
        excluded_docs: DOCUMENT_MODEL.filter((entry) => entry.classification !== "maintained").map(
          ({ path, classification }) => ({ path, classification }),
        ),
        tracked_prose_candidates: trackedDocumentation.length,
        checks: [
          "classified_tracked_document_model",
          "absolute_windows_paths",
          "archive_reference_context",
          "external_runtime_links",
          "documented_npm_scripts_and_paths",
          "current_product_contracts",
          "transient_policy_state",
          "test_inventory_package_aliases",
          "manifest_feature_pack_refs",
          "declared_job_processors",
          "schema_version_fields",
        ],
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.message);
  if (error.details) console.error(JSON.stringify(error.details, null, 2));
  process.exit(1);
});
