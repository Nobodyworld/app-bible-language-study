#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

async function readText(path) {
  return readFile(new URL(path, root), "utf8");
}

function normalizeProse(text) {
  return text.replace(/^\s*>\s?/gm, "").replace(/\s+/g, " ").trim();
}

const [
  readme,
  changelog,
  notice,
  releaseChecklist,
  securityPolicy,
  securityPosture,
  sourceManifestText,
  packageManifestText,
  appManifestText,
] = await Promise.all([
  readText("README.md"),
  readText("CHANGELOG.md"),
  readText("NOTICE.md"),
  readText("PUBLIC_RELEASE_CHECKLIST.md"),
  readText("SECURITY.md"),
  readText("docs/SECURITY_POSTURE.md"),
  readText("app/data/source-manifest.json"),
  readText("app/data/package-manifest.json"),
  readText("app/data/manifest.json"),
]);

const sourceManifest = JSON.parse(sourceManifestText);
const packageManifest = JSON.parse(packageManifestText);
const appManifest = JSON.parse(appManifestText);
const readmeProse = normalizeProse(readme);
const releaseChecklistProse = normalizeProse(releaseChecklist);
const securityPolicyProse = normalizeProse(securityPolicy);
const securityPostureProse = normalizeProse(securityPosture);
const changelogProse = normalizeProse(changelog);

assert.match(
  readme,
  /PUBLIC PREVIEW — ACTIVE DEVELOPMENT/,
  "README must expose the exact public-preview status",
);
assert.match(
  readme,
  /Word\s*→\s*Verse/,
  "README must identify the compact contextual side-panel order",
);
assert.match(
  readmeProse,
  /Chapter Language Study and Book Outline remain reader-header actions/i,
  "README must preserve reader-header ownership for Chapter Language Study and Book Outline",
);
assert.match(
  readmeProse,
  /Favorite remains the canonical `favorite` assertion/i,
  "README must preserve Favorite's canonical assertion identity",
);
assert.match(
  readmeProse,
  /Personal Meaning is separate from Study Marks and applies only to exact canonical source-token identity/i,
  "README must preserve exact-token Meaning as separate from Study Marks",
);
assert.match(
  readmeProse,
  /My study data[\s\S]*Backup and restore[\s\S]*App settings[\s\S]*Advanced diagnostics/i,
  "README must list the accepted My Data sections",
);
assert.match(
  readmeProse,
  /does not promise a production release or stable API/i,
  "README must disclaim production-release and stable-API promises",
);
assert.match(
  readme,
  /Application code, tests, scripts, schemas, and tooling are MIT-licensed/i,
  "README must scope MIT licensing to application code and tooling",
);
assert.match(
  readme,
  /Bundled Bible and study data retains its own source rights and notices/i,
  "README must keep bundled-data rights distinct from the MIT code license",
);
assert.match(readme, /\[NOTICE\.md\]\(NOTICE\.md\)/, "README must link to NOTICE.md");
assert.match(
  readme,
  /app\/data\/source-manifest\.json/,
  "README must link to the bundled-data source manifest",
);

assert.match(
  notice,
  /Public repository visibility does not relicense bundled third-party data/i,
  "NOTICE must reject blanket relicensing through publication",
);
assert.match(
  notice,
  /app\/data\/source-manifest\.json/,
  "NOTICE must direct redistributors to the source manifest",
);
for (const retainedNotice of [
  "The Berean Bible (www.Berean.Bible) Berean Study Bible (BSB) © 2016, 2020 by Bible Hub and Berean.Bible. Used by Permission. All rights Reserved. Free downloads and licensing available.",
  "Text courtesy of BibleProtector.com. Section Headings Courtesy Berean Study Bible.",
  "This text of God's Word has been dedicated to the public domain. Free resources and databases are available at BereanBible.com.",
]) {
  assert.ok(notice.includes(retainedNotice), `NOTICE must retain source wording: ${retainedNotice}`);
}

assert.equal(sourceManifest.schema_version, 1, "source manifest schema must remain version 1");
assert.equal(
  sourceManifest.source_package?.classification,
  "OPENBIBLE_CONFIRMED",
  "reviewed source-package classification must remain intact",
);
assert.ok(sourceManifest.source_package?.archive_sha256, "source archive provenance hash is required");
assert.ok(Array.isArray(sourceManifest.exceptions) && sourceManifest.exceptions.length > 0, "source exceptions are required");
assert.ok(
  Array.isArray(sourceManifest.transformations) && sourceManifest.transformations.length > 0,
  "source transformations are required",
);
const sourceIds = new Set((sourceManifest.original_language_sources || []).map((source) => source.id));
for (const sourceId of ["wlc", "wlco", "nestle", "tr94"]) {
  assert.ok(sourceIds.has(sourceId), `source manifest must retain ${sourceId}`);
}

assert.equal(
  packageManifest.distribution,
  "source-notices-retained",
  "package inventory must retain its source-notice distribution classification",
);
assert.equal(
  packageManifest.source_manifest,
  "data/source-manifest.json",
  "package inventory must point to the source manifest",
);
assert.equal(
  appManifest.source_manifest,
  "data/source-manifest.json",
  "application manifest must point to the source manifest",
);
for (const [name, text] of [
  ["app/data/package-manifest.json", packageManifestText],
  ["app/data/manifest.json", appManifestText],
]) {
  assert.doesNotMatch(
    text,
    /"(?:license|rights|distribution)"\s*:\s*"(?:MIT|CC0|public domain)"/i,
    `${name} must not assign one blanket MIT, CC0, or public-domain label to the bundled package`,
  );
}

for (const heading of [
  "Phase A — Public Preview Visibility",
  "Phase B — Product Stabilization",
  "Phase C — Documentation and Artifact Reconciliation",
  "Phase D — Final Candidate Evidence",
  "Phase E — Final Rights, Security, Metadata, and Clean-Checkout Gate",
]) {
  assert.ok(releaseChecklist.includes(heading), `release checklist must include ${heading}`);
}
assert.match(
  releaseChecklistProse,
  /Public-preview visibility[\s\S]*does not authorize a release or tag/i,
  "release checklist must separate public visibility from release authorization",
);
assert.match(
  releaseChecklistProse,
  /Create a release or tag only[\s\S]*owner separately authorizes it/i,
  "release checklist must require explicit owner authorization for a release or tag",
);
assert.match(
  securityPolicyProse,
  /supported public-preview baseline is the current `main` branch/i,
  "security policy must identify the current main public-preview baseline",
);
assert.match(
  securityPolicyProse,
  /private vulnerability reporting/i,
  "security policy must retain the private reporting path",
);
assert.match(
  securityPolicyProse,
  /CodeQL Default Setup is intentionally disabled/i,
  "security policy must preserve the intentional CodeQL-disabled decision",
);
assert.match(securityPolicyProse, /Issue #5 records/i, "security policy must identify issue #5 as live evidence");
assert.match(
  securityPostureProse,
  /CodeQL Default Setup is intentionally disabled/i,
  "security posture must preserve the intentional CodeQL-disabled decision",
);
assert.match(
  securityPostureProse,
  /Issue #5 is the system of record/i,
  "security posture must identify issue #5 as the live control-state authority",
);
assert.match(
  securityPostureProse,
  /Public visibility does not create a production release, stable API promise, or release tag/i,
  "security posture must keep public visibility separate from release and API promises",
);
assert.match(
  changelogProse,
  /Unreleased — Public Preview/,
  "changelog must describe the current state as unreleased public preview",
);
assert.match(
  changelogProse,
  /No stable `1\.0\.0` release or tag is implied or authorized/i,
  "package version metadata must not imply an authorized stable release or tag",
);

for (const [name, text] of [
  ["PUBLIC_RELEASE_CHECKLIST.md", releaseChecklist],
  ["SECURITY.md", securityPolicy],
  ["docs/SECURITY_POSTURE.md", securityPosture],
]) {
  assert.doesNotMatch(
    text,
    /(?:PR #\d+[\s\S]{0,120}?\b(?:draft|blocked|hold)\b|\b(?:draft|blocked|hold)\b[\s\S]{0,120}?PR #\d+)/i,
    `${name} must not encode transient pull-request review state as current policy`,
  );
}

console.log(
  JSON.stringify(
    {
      status: "ok",
      preview_status: "PUBLIC PREVIEW — ACTIVE DEVELOPMENT",
      original_language_sources: [...sourceIds].sort(),
      retained_notice_count: 3,
      activation_phases: 5,
      release_authorization: "explicit owner authorization required",
    },
    null,
    2,
  ),
);
