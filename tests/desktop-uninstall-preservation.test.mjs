import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { captureBaseline, verifyBaseline, hostedWindowsContext } from "./desktop-uninstall-preservation.mjs";

const sha = "a".repeat(40);
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(tmpdir(), "bibleapp-uninstall-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true })); // Only this test's owned directory.
  const roots = { stable: path.join(root, "stable"), lab: path.join(root, "lab") };
  const baseline = await captureBaseline(roots, sha);
  return { roots, baseline };
}

test("preserved profiles and recovery fixtures pass", async (t) => {
  const { roots, baseline } = await fixture(t);
  assert.equal((await verifyBaseline(roots, baseline, sha)).preservation, "PASS");
});

for (const profile of ["stable", "lab"]) {
  for (const store of ["workspace", "importBackups"]) {
    test(`missing ${profile}/${store} fails even when the profile directory remains`, async (t) => {
      const { roots, baseline } = await fixture(t);
      await fs.unlink(path.join(roots[profile], `uninstall-acceptance-${sha}`, `${store}.json`));
      assert.equal((await fs.stat(roots[profile])).isDirectory(), true);
      await assert.rejects(verifyBaseline(roots, baseline, sha), /changed during uninstall/);
    });
  }
}

test("same-length corruption fails SHA verification", async (t) => {
  const { roots, baseline } = await fixture(t);
  const file = path.join(roots.stable, `uninstall-acceptance-${sha}`, "workspace.json");
  const data = await fs.readFile(file);
  data[0] = data[0] ^ 1;
  await fs.writeFile(file, data);
  await assert.rejects(verifyBaseline(roots, baseline, sha), /changed during uninstall/);
});

test("capture includes existing study files rather than only synthetic sentinels", async (t) => {
  const root = await fs.mkdtemp(path.join(tmpdir(), "bibleapp-uninstall-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const roots = { stable: path.join(root, "stable"), lab: path.join(root, "lab") };
  await fs.mkdir(roots.stable);
  await fs.writeFile(path.join(roots.stable, "tags.json"), "existing-study-data");
  const baseline = await captureBaseline(roots, sha);
  await fs.unlink(path.join(roots.stable, "tags.json"));
  await assert.rejects(verifyBaseline(roots, baseline, sha), /changed during uninstall/);
});

test("missing profile, empty baseline, and wrong candidate cannot pass", async (t) => {
  const { roots, baseline } = await fixture(t);
  await assert.rejects(verifyBaseline(roots, baseline, "b".repeat(40)), /different candidate/);
  await assert.rejects(verifyBaseline(roots, { ...baseline, profiles: { stable: [], lab: [] } }, sha), /Missing retention baseline/);
  await fs.rename(roots.lab, `${roots.lab}-moved`);
  await assert.rejects(verifyBaseline(roots, baseline, sha), /ENOENT/);
});

test("capture cannot overwrite its prior fixture", async (t) => {
  const { roots } = await fixture(t);
  await assert.rejects(captureBaseline(roots, sha), /EEXIST/);
});

test("CLI guard rejects owner machines and self-hosted runners", () => {
  const env = { GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", DESKTOP_CANDIDATE_SHA: sha, APPDATA: "app-data", RUNNER_TEMP: "runner-temp" };
  assert.throws(() => hostedWindowsContext({}, "win32"), /owner-machine/);
  assert.throws(() => hostedWindowsContext({ ...env, RUNNER_ENVIRONMENT: "self-hosted" }, "win32"), /non-disposable/);
  assert.throws(() => hostedWindowsContext(env, "linux"), /Windows CI/);
  assert.equal(hostedWindowsContext(env, "win32").sha, sha);
});
