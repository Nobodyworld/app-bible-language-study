// CI-only installed-artifact evidence. Never runs an installer or uninstaller.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SCHEMA = "bibleapp:desktop-uninstall-baseline/v1";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function snapshot(root) {
  const entries = [];
  async function visit(directory) {
    const stat = await fs.lstat(directory);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), "Retained directory is absent or unsafe");
    for (const item of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      assert.ok(!item.isSymbolicLink(), "Retained data must not traverse a link");
      if (item.isDirectory()) await visit(file);
      else {
        assert.ok(item.isFile(), "Retained data contains a non-file entry");
        const bytes = await fs.readFile(file);
        entries.push({ path: path.relative(root, file).split(path.sep).join("/"), bytes: bytes.length, sha256: digest(bytes) });
      }
    }
  }
  await visit(root);
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

export async function captureBaseline(roots, candidateSha) {
  assert.match(candidateSha, /^[0-9a-f]{40}$/);
  assert.deepEqual(Object.keys(roots).sort(), ["lab", "stable"]);
  const profiles = {};
  for (const [profile, root] of Object.entries(roots)) {
    // A fresh, nested fixture never overwrites a real logical study store.
    const fixtureRoot = path.join(root, `uninstall-acceptance-${candidateSha}`);
    await fs.mkdir(fixtureRoot, { recursive: true });
    for (const store of ["workspace", "importBackups"]) {
      const envelope = { schema_version: 1, profile_id: profile, store_id: store, value: { fixture: "uninstall preservation", candidate: candidateSha } };
      await fs.writeFile(path.join(fixtureRoot, `${store}.json`), `${JSON.stringify(envelope)}\n`, { flag: "wx" });
    }
    profiles[profile] = await snapshot(root);
    assert.ok(profiles[profile].length >= 2, "Preservation baseline must not be empty");
  }
  return { schema: SCHEMA, candidateSha, profiles };
}

export async function verifyBaseline(roots, baseline, candidateSha) {
  assert.equal(baseline.schema, SCHEMA);
  assert.equal(baseline.candidateSha, candidateSha, "Retention evidence belongs to a different candidate");
  for (const profile of ["stable", "lab"]) {
    assert.ok(Array.isArray(baseline.profiles?.[profile]) && baseline.profiles[profile].length >= 2, "Missing retention baseline");
    assert.deepEqual(await snapshot(roots[profile]), baseline.profiles[profile], `${profile} study/recovery data changed during uninstall`);
  }
  return { preservation: "PASS", profiles: ["stable", "lab"], study_and_recovery_bytes_unchanged: true };
}

export function hostedWindowsContext(env = process.env, platform = process.platform) {
  assert.equal(platform, "win32", "Installed-artifact preservation runs only on Windows CI");
  assert.equal(env.GITHUB_ACTIONS, "true", "Refusing owner-machine execution");
  assert.equal(env.RUNNER_ENVIRONMENT, "github-hosted", "Refusing non-disposable runner execution");
  assert.match(env.DESKTOP_CANDIDATE_SHA || "", /^[0-9a-f]{40}$/);
  assert.ok(env.APPDATA && env.RUNNER_TEMP, "Missing runner directories");
  const userData = path.join(env.APPDATA, "com.nobodyworld.bibleappreader", "user-data");
  return {
    roots: { stable: path.join(userData, "stable"), lab: path.join(userData, "lab") },
    report: path.join(env.RUNNER_TEMP, "bibleapp-uninstall-baseline.json"),
    sha: env.DESKTOP_CANDIDATE_SHA,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const mode = process.argv[2];
    assert.ok(["capture", "verify"].includes(mode), "Expected capture or verify mode");
    const { roots, report, sha } = hostedWindowsContext();
    if (mode === "capture") {
      await fs.writeFile(report, `${JSON.stringify(await captureBaseline(roots, sha))}\n`, { flag: "wx" });
      console.log("DESKTOP_UNINSTALL_BASELINE=PASS profiles=stable,lab");
    } else {
      const baseline = JSON.parse(await fs.readFile(report, "utf8"));
      console.log(JSON.stringify(await verifyBaseline(roots, baseline, sha)));
    }
  } catch (error) {
    console.error(`DESKTOP_UNINSTALL_PRESERVATION=FAIL ${error.message}`);
    process.exitCode = 1;
  }
}
