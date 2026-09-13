#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, writeFile, mkdir, mkdtemp, readdir, stat, rm, symlink, unlink } from "node:fs/promises";
import { join, resolve, relative, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import {
  parseSweteText, generateSweteCorpus, reconcileSweteVerseMaps, assertSweteSourceToken,
} from "../app/tools/import-original-language-sources.mjs";
import { assertValidTextualComparisonRecord, sourceTokenIdentityKey } from "../app/src/textual-comparison-contracts.js";

// Invented letters/markers, not a quotation or extract from a Bible corpus.
// These synthetic fixture text bytes are dedicated to the public domain (CC0-1.0).
const synthetic = "1.1.1 α\n1.1.1 α\n1.1.1 •\n1.1.2 β\n1.1.3 γ\n1.1.4 δ\n1.1.5 ε\n1.1.6 ζ\n1.1.7 η\n1.1.8 θ\n1.1.9 ι\n1.1.10 κ\n1.1.11 λ\n1.1.1 μ\n1.prologue.0 20\n1.iva.1a1 ν\n1.ivb.35I ξ\n1.0.0 ο\n1.2.0 π\n1.2.1 ρ\u008d\n";
const psalms = "27.50.1 α\n27.50.2 β\n27.50.3 γ\n27.50.4 δ\n27.50.21 ε\n27.144.13a ζ\n";
const hash = value => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const fileIdentity = (path, book_id, raw) => ({ path, book_id, bytes: Buffer.byteLength(raw), sha256: hash(raw) });
const file = fileIdentity("data/01.Synthetic.txt", "1", synthetic);
const psFile = fileIdentity("data/27.Synthetic.txt", "27", psalms);
const parsed = parseSweteText(Buffer.from(synthetic), file);
assert.equal(parsed.tokens.length, 20);
assert.equal(parsed.units.length, 17);
assert.deepEqual(parsed.tokens.filter(t => t.source_reference === "1.1.1").map(t => t.token_index), [1, 2, 3, 4]);
assert.deepEqual(parsed.tokens.slice(0, 2).map(t => t.surface), ["α", "α"]);
assert.equal(parsed.tokens[13].segment_index, 2);
assert.equal(parsed.tokens[13].source_line, 14);
assert.equal(parsed.counts.recurring_blocks, 1);
assert.equal(parsed.counts.non_greek_tokens, 2);
assert.equal(parsed.counts.control_tokens, 1);
assert.deepEqual(parseSweteText(Buffer.from(synthetic.replaceAll("\n", "\r\n")), file), parsed);
assert.deepEqual(parseSweteText(Buffer.from(synthetic.trimEnd()), file), parsed);
assert.equal(parseSweteText(Buffer.from("1.1.1 α\u0301\n"), file).tokens[0].surface, "α\u0301");
for (const raw of ["", "\n", "1.1.1\n", "1.1.1 α β\n", "01.1.1 α\n", "1.01.1 α\n", "1.1.01 α\n", "1.unknown.1 α\n", "1.1.1 α\n\n", "\uFEFF1.1.1 α\n", "1.1.1\tα\n"]) {
  assert.throws(() => parseSweteText(Buffer.from(raw), file), /Malformed|Empty/);
}
assert.throws(() => parseSweteText(Buffer.from([0xff]), file), /UTF-8/);
assert.throws(() => parseSweteText(Buffer.from("2.1.1 α\n"), file), /book identity/);
assert.throws(() => parseSweteText(Buffer.from(synthetic), { ...file, path: "../escape" }), /relative logical path/);

const provenance = [{ source_id: "fixture:versification", revision: "synthetic-v1", authority: "versification" }];
const map = (id, source_references, canonical_references, map_type = "exact", review_status = "reviewed") => ({
  schema_version: 1, id, witness_id: "swete:lxx", source_versification: "swete:source-references",
  source_references, canonical_references, map_type, review_status, provenance,
});
const records = [
  map("exact", ["1.1.1"], ["fixture/1/1"]),
  map("split", ["1.1.2"], ["fixture/1/2", "fixture/1/3"], "split"),
  map("merged", ["1.1.3", "1.1.4"], ["fixture/1/4"], "merged"),
  map("source-only", ["1.1.5"], [], "source-only", "source-provided"),
  map("moved", ["1.1.6"], ["fixture/2/1"], "moved"),
  map("candidate", ["1.1.7"], ["fixture/2/2"], "exact", "generated-candidate"),
  map("uncertain", ["1.1.8"], ["fixture/2/3"], "uncertain"),
  map("unavailable", ["1.1.9"], [], "unavailable", "unreviewed"),
  map("canonical-only", [], ["fixture/2/4"], "canonical-only"),
  map("ps-title", ["27.50.1", "27.50.2", "27.50.3"], ["psalms/51/1"], "merged"),
  map("ps-body", ["27.50.4"], ["psalms/51/2"]),
  map("ps-end", ["27.50.21"], ["psalms/51/19"]),
];
const sourceRefs = [...parsed.units, ...parseSweteText(Buffer.from(psalms), psFile).units].map(u => u.source_reference);
const targetRefs = records.flatMap(r => r.canonical_references);
const coverage = reconcileSweteVerseMaps(sourceRefs, targetRefs, records, "synthetic-v1");
assert.equal(coverage.counts.mapped, 10);
assert.equal(coverage.counts.source_only, 1);
assert.equal(coverage.counts.unmapped, 12);
assert.equal(coverage.canonicalBySource.get("1.1.2"), null, "A split does not fabricate one token app position.");
assert.equal(coverage.canonicalBySource.get("1.1.7"), null, "A candidate is not promoted into a token app position.");
assert.equal(coverage.canonicalBySource.get("1.1.8"), null);
for (const ref of ["27.50.1", "27.50.2", "27.50.3"]) assert.equal(coverage.canonicalBySource.get(ref), "psalms/51/1");
assert.equal(coverage.canonicalBySource.get("27.144.13a"), null);
assert.equal(coverage.maps.find(m => m.source_references.includes("27.144.13a")).map_type, "unavailable");
assert.deepEqual(coverage.maps, reconcileSweteVerseMaps(sourceRefs, targetRefs, [...records].reverse(), "synthetic-v1").maps);
for (const [altered, pattern] of [
  [[...records, records[0]], /identity/],
  [[...records, { ...records[0], id: "collision" }], /source reference/],
  [[...records, map("target-collision", ["1.1.10"], ["fixture/1/1"])], /target/],
  [[...records, map("orphan", ["1.999.1"], [])], /cardinality/],
  [[...records, map("orphan", ["1.999.1"], [], "source-only")], /Orphan/],
  [[...records, map("invented", ["1.1.10"], ["fixture/999/1"])], /Unknown app/],
  [[{ ...records[0], map_type: "merged" }], /cardinality/],
  [[{ ...records[0], witness_id: "wrong" }], /witness/],
  [[{ ...records[0], lemma: "inferred" }], /unsupported/],
  [[{ ...records[0], provenance: [{ ...provenance[0], authority: "alignment" }] }], /authority/],
  [[{ ...records[0], id: "verse-map:swete:unavailable:1.1.10" }], /generated verse-map identity/],
]) assert.throws(() => reconcileSweteVerseMaps(sourceRefs, targetRefs, altered, "synthetic-v1"), pattern);
assert.throws(() => reconcileSweteVerseMaps([...sourceRefs, sourceRefs[0]], targetRefs, records, "v1"), /inventory identity/);
assert.throws(() => reconcileSweteVerseMaps(sourceRefs, [...targetRefs, targetRefs[0]], records, "v1"), /inventory identity/);

const root = await mkdtemp(join(tmpdir(), "bible-swete-import-test-"));
const sweteRoot = join(root, "source");
const appVersesRoot = join(root, "app");
const outputRoot = join(root, "output");
const provenancePath = join(root, "source.json");
const verseMapPath = join(root, "maps.json");
const destination = join(outputRoot, "sources/swete-lxx/text");
const options = { sweteRoot, appVersesRoot, outputRoot, provenancePath, verseMapPath };
const declaration = { schema_version: 1, profile: "synthetic", source_id: "fixture:swete", revision: "synthetic-v1", license_id: "CC0-1.0", attribution: "Synthetic public-domain test letters; no corpus extract.", files: [file, psFile], notices: [] };
try {
  await mkdir(join(sweteRoot, "data"), { recursive: true });
  await mkdir(appVersesRoot);
  await writeFile(join(sweteRoot, file.path), synthetic);
  await writeFile(join(sweteRoot, psFile.path), psalms);
  const app_files = [];
  for (const book_id of ["fixture", "psalms"]) {
    const chapters = {};
    for (const ref of targetRefs.filter(r => r.startsWith(`${book_id}/`))) {
      const [, chapter, verse] = ref.split("/");
      (chapters[chapter] ??= {})[verse] = "Synthetic app text";
    }
    const raw = JSON.stringify({ book: { id: book_id }, chapters });
    const path = `${book_id}.json`;
    await writeFile(join(appVersesRoot, path), raw);
    app_files.push(fileIdentity(path, book_id, raw));
  }
  const mapping = { schema_version: 1, source_revision: "synthetic-v1", app_witness_id: "openbible:wlc", app_files,
    authorities: [{ ...provenance[0], license_id: "CC0-1.0", attribution: "Synthetic reference metadata", source_url: "https://github.com/Nobodyworld/app-bible-language-study", sha256: hash("synthetic"), changes: "Invented fixtures only." }], records };
  await writeFile(provenancePath, JSON.stringify(declaration));
  await writeFile(verseMapPath, JSON.stringify(mapping));
  const absent = await generateSweteCorpus({ ...options, check: true });
  assert.equal(absent.mismatches, 7);
  await assert.rejects(stat(outputRoot), { code: "ENOENT" });
  const generated = await generateSweteCorpus(options);
  const checked = await generateSweteCorpus({ ...options, check: true });
  assert.equal(checked.mismatches, 0);
  assert.deepEqual(checked.identity, generated.identity);
  const regenerated = await generateSweteCorpus({ ...options, outputRoot: join(root, "repeat") });
  assert.deepEqual(regenerated.identity, generated.identity);
  for (const artifact of generated.identity.outputs) {
    const bytes = await readFile(join(outputRoot, artifact.path));
    assert.equal(bytes.length, artifact.bytes);
    assert.equal(hash(bytes), artifact.sha256);
  }
  assert.equal(generated.counts.tokens, 26);
  assert.equal(generated.counts.source_units, 23);
  assert.equal(generated.identity.sources[0].source.profile, "synthetic");
  assert.ok(!JSON.stringify(generated.identity).includes(root));
  assert.ok(!JSON.stringify(generated.identity).includes("parse_ms"));
  const witness = JSON.parse(await readFile(join(destination, "witness.json"), "utf8"));
  assertValidTextualComparisonRecord("textWitness", witness);
  assert.equal(witness.rights.license_id, "CC0-1.0");
  const tokenPath = join(destination, "tokens/1.jsonl");
  const original = await readFile(tokenPath);
  const tokens = original.toString().trimEnd().split("\n").map(JSON.parse);
  for (const token of tokens) {
    assertSweteSourceToken(token);
    assert.equal(token.lemma, null);
    assert.equal(token.morphology, null);
    assert.equal(token.transliteration, null);
    assert.deepEqual(token.external_ids, []);
  }
  assert.equal(new Set(tokens.map(sourceTokenIdentityKey)).size, tokens.length);
  assert.notEqual(tokens[0].id, tokens[1].id);
  for (const extra of [{ lemma: { id: "inferred", provenance } }, { morphology: { value: "N", scheme: "fake", provenance } },
    { alignment: [] }, { strong_code: "G1" }, { hebrew_token_ids: ["h1"] }, { external_ids: [{ system: "strongs", value: "G1", provenance }] }]) {
    assert.throws(() => assertSweteSourceToken({ ...tokens[0], ...extra }));
  }
  for (const damage of [Buffer.from("damaged"), Buffer.from(original.toString().replaceAll("\n", "\r\n")), Buffer.from([0xff])]) {
    await writeFile(tokenPath, damage);
    const before = await stat(tokenPath);
    const drift = await generateSweteCorpus({ ...options, check: true });
    assert.equal(drift.mismatches, 1);
    assert.match(drift.mismatch_details[0].action, /source identity/);
    assert.deepEqual(await readFile(tokenPath), damage);
    assert.equal((await stat(tokenPath)).mtimeMs, before.mtimeMs);
  }
  await writeFile(tokenPath, original);
  const extraPath = join(destination, "stale.json");
  await writeFile(extraPath, "retain");
  assert.equal((await generateSweteCorpus({ ...options, check: true })).mismatch_details[0].reason, "unexpected output");
  await assert.rejects(generateSweteCorpus(options), /Unexpected files/);
  assert.equal(await readFile(extraPath, "utf8"), "retain");
  await unlink(extraPath);
  await unlink(tokenPath);
  assert.equal((await generateSweteCorpus({ ...options, check: true })).mismatch_details[0].reason, "missing output");
  await assert.rejects(stat(tokenPath), { code: "ENOENT" });
  await writeFile(tokenPath, original);
  const failRoot = join(root, "no-writes");
  for (const changed of [
    { ...declaration, revision: "stale" }, { ...declaration, profile: "pinned" },
    { ...declaration, lemma: "inferred" }, { ...declaration, license_id: "MIT" },
    { ...declaration, files: [...declaration.files, file] },
    { ...declaration, files: [{ ...file, path: "Data/01.synthetic.txt" }, ...declaration.files] },
    { ...declaration, files: [{ ...file, path: "data/other.txt" }, ...declaration.files] },
    { ...declaration, files: [{ ...file, sha256: hash("wrong") }, psFile] },
    { ...declaration, files: [{ ...file, git_blob: "0".repeat(40) }, psFile] },
    { ...declaration, files: [{ ...file, sha256: undefined }, psFile] },
    { ...declaration, files: [{ ...file, path: "../escape.txt" }, psFile] },
  ]) {
    await writeFile(provenancePath, JSON.stringify(changed));
    await assert.rejects(generateSweteCorpus({ ...options, outputRoot: failRoot }));
    await assert.rejects(stat(failRoot), { code: "ENOENT" });
  }
  await writeFile(provenancePath, JSON.stringify(declaration));
  const malformed = "1.1.1 α β\n";
  await writeFile(join(sweteRoot, file.path), malformed);
  await writeFile(provenancePath, JSON.stringify({ ...declaration, files: [fileIdentity(file.path, file.book_id, malformed), psFile] }));
  await assert.rejects(generateSweteCorpus({ ...options, outputRoot: failRoot }), /Malformed Swete line/);
  await assert.rejects(stat(failRoot), { code: "ENOENT" });
  await writeFile(provenancePath, JSON.stringify(declaration));
  await writeFile(join(sweteRoot, file.path), "wrong bytes");
  await assert.rejects(generateSweteCorpus(options), /Source identity mismatch/);
  await unlink(join(sweteRoot, file.path));
  await assert.rejects(generateSweteCorpus(options), /Missing source input/);
  await writeFile(join(sweteRoot, file.path), synthetic);
  for (const changed of [{ ...mapping, source_revision: "stale" }, { ...mapping, authorities: [] },
    { ...mapping, alignment: [] }, { ...mapping, app_files: [...app_files, app_files[0]] },
    { ...mapping, app_files: [{ ...app_files[0], sha256: hash("stale") }] }]) {
    await writeFile(verseMapPath, JSON.stringify(changed));
    await assert.rejects(generateSweteCorpus({ ...options, outputRoot: failRoot }));
    await assert.rejects(stat(failRoot), { code: "ENOENT" });
  }
  await writeFile(verseMapPath, JSON.stringify(mapping));
  await assert.rejects(generateSweteCorpus({ ...options, provenancePath: join(root, "missing.json") }), /Missing or invalid/);
  await assert.rejects(generateSweteCorpus({ ...options, outputRoot: sweteRoot }), /overwrite a source input|overwrite source inputs/);
  const linkPath = join(outputRoot, "linked");
  await symlink(sweteRoot, linkPath, process.platform === "win32" ? "junction" : "dir");
  try { await assert.rejects(generateSweteCorpus({ ...options, outputRoot: linkPath }), /symbolic links or junctions/); }
  finally { await unlink(linkPath); }
  const command = resolve("app/tools/import-original-language-sources.mjs");
  const cliArgs = [command, "--swete-root", sweteRoot, "--output-root", outputRoot, "--provenance-path", provenancePath, "--verse-map-path", verseMapPath, "--app-verses-root", appVersesRoot, "--check"];
  assert.equal(spawnSync(process.execPath, cliArgs, { encoding: "utf8" }).status, 0);
  await writeFile(tokenPath, "CLI drift");
  assert.equal(spawnSync(process.execPath, cliArgs, { encoding: "utf8" }).status, 1);
  assert.equal(await readFile(tokenPath, "utf8"), "CLI drift");
  assert.equal(spawnSync(process.execPath, [command, "--swete-root", sweteRoot], { encoding: "utf8" }).status, 1);
  assert.equal(spawnSync(process.execPath, [...cliArgs, "--strongs-root", root], { encoding: "utf8" }).status, 1);
  console.log(JSON.stringify({ status: "PASS", fixture: { books: 2, source_units: 23, tokens: 26, mapped: 10, source_only: 1, unmapped: 12,
    generated_bytes: generated.measurements.generated_bytes, files: generated.measurements.generated_files },
    coverage: ["source-native labels, repeated surfaces and recurring blocks", "strict malformed and stale identity rejection before writes", "all verse-map types and Psalm superscriptions", "complete source-reference accounting", "candidates remain unreviewed", "deterministic manifests and per-file digests", "no-write missing/stale/unexpected output checks and CLI exit codes", "annotation/alignment rejection", "input/output alias and junction safety"] }, null, 2));
} finally {
  const rel = relative(resolve(tmpdir()), resolve(root));
  assert.ok(rel && !isAbsolute(rel) && !rel.startsWith("..") && rel.startsWith("bible-swete-import-test-"));
  await rm(root, { recursive: true });
}
