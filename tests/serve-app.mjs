#!/usr/bin/env node

import { strict as assert } from "node:assert";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startStaticAppServer } from "../app/tools/serve-app.mjs";

async function closeServer(server) {
  await new Promise((resolveClose) => server.close(resolveClose));
}

async function rawRequest(url, { method = "GET", path = "/", headers = {} } = {}) {
  const target = new URL(url);
  return new Promise((resolveRequest, rejectRequest) => {
    const request = httpRequest(
      {
        host: target.hostname,
        port: target.port,
        method,
        path,
        headers,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolveRequest({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    request.on("error", rejectRequest);
    request.end();
  });
}

let assertions = 0;
function equal(actual, expected, message) {
  assert.equal(actual, expected, message);
  assertions += 1;
}
function ok(value, message) {
  assert.ok(value, message);
  assertions += 1;
}
function match(value, pattern, message) {
  assert.match(value, pattern, message);
  assertions += 1;
}

const development = await startStaticAppServer({ port: 0 });
try {
  const indexResponse = await fetch(`${development.url}/`);
  equal(indexResponse.status, 200);
  equal(indexResponse.headers.get("cache-control"), "no-store", "development mode must remain deterministic");
  match(indexResponse.headers.get("content-type") || "", /^text\/html/);
  equal(indexResponse.headers.get("x-content-type-options"), "nosniff");
  match(await indexResponse.text(), /Bible App Reader/);

  for (const path of ["/styles.css", "/styles-polish.css", "/app.js", "/src/reader-picker-flow.js", "/src/original-language-study-flow.js"]) {
    const response = await fetch(`${development.url}${path}?v=server-test`);
    equal(response.status, 200, `${path} should return 200`);
    equal(response.headers.get("cache-control"), "no-store", `${path} should remain no-store in development`);
    ok((await response.text()).length > 0, `${path} should return a non-empty body`);
  }

  const headResponse = await fetch(`${development.url}/styles.css`, { method: "HEAD" });
  equal(headResponse.status, 200);
  ok(Number(headResponse.headers.get("content-length")) > 0);
  equal(await headResponse.text(), "");

  const missingResponse = await fetch(`${development.url}/missing-file.js`);
  equal(missingResponse.status, 404);
} finally {
  await closeServer(development.server);
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "bibleapp-serve-test-"));
await writeFile(join(temporaryRoot, "index.html"), "<!doctype html><title>Publish fixture</title>", "utf8");
await writeFile(join(temporaryRoot, "asset.js"), "export const value = 'first';\n", "utf8");
const publish = await startStaticAppServer({ port: 0, root: temporaryRoot, mode: "publish" });

try {
  const first = await fetch(`${publish.url}/asset.js?cache=bust`);
  const firstBody = await first.text();
  const firstEtag = first.headers.get("etag");
  const firstModified = first.headers.get("last-modified");
  equal(first.status, 200);
  equal(first.headers.get("cache-control"), "no-cache");
  equal(first.headers.get("x-content-type-options"), "nosniff");
  match(first.headers.get("content-type") || "", /^text\/javascript/);
  equal(Number(first.headers.get("content-length")), Buffer.byteLength(firstBody));
  ok(Boolean(firstEtag), "publish GET should provide ETag");
  ok(Boolean(firstModified), "publish GET should provide Last-Modified");
  match(firstBody, /first/);

  const etagHit = await fetch(`${publish.url}/asset.js`, { headers: { "If-None-Match": firstEtag } });
  equal(etagHit.status, 304);
  equal(etagHit.headers.get("cache-control"), "no-cache");
  equal(etagHit.headers.get("etag"), firstEtag);
  equal(await etagHit.text(), "", "304 must not include a resource body");

  const modifiedHit = await fetch(`${publish.url}/asset.js`, { headers: { "If-Modified-Since": firstModified } });
  equal(modifiedHit.status, 304);
  equal(await modifiedHit.text(), "");

  const head = await fetch(`${publish.url}/asset.js`, { method: "HEAD" });
  equal(head.status, 200);
  equal(head.headers.get("etag"), firstEtag);
  equal(Number(head.headers.get("content-length")), Buffer.byteLength(firstBody));
  equal(await head.text(), "");

  const changedBody = "export const value = 'changed content';\n";
  await writeFile(join(temporaryRoot, "asset.js"), changedBody, "utf8");
  const changedTime = new Date(Date.now() + 2000);
  await utimes(join(temporaryRoot, "asset.js"), changedTime, changedTime);

  const staleEtag = await fetch(`${publish.url}/asset.js`, { headers: { "If-None-Match": firstEtag } });
  equal(staleEtag.status, 200, "changed bytes must defeat a stale ETag");
  ok(staleEtag.headers.get("etag") !== firstEtag, "changed bytes must change the ETag");
  equal(await staleEtag.text(), changedBody);

  const staleModified = await fetch(`${publish.url}/asset.js`, { headers: { "If-Modified-Since": firstModified } });
  equal(staleModified.status, 200, "changed modification time must defeat a stale Last-Modified validator");
  equal(await staleModified.text(), changedBody);

  const queryResponse = await fetch(`${publish.url}/asset.js?still=asset`);
  equal(queryResponse.status, 200, "query strings must not affect filesystem resolution");
  equal(await queryResponse.text(), changedBody);

  const missing = await fetch(`${publish.url}/missing.json`);
  equal(missing.status, 404);

  const traversal = await rawRequest(publish.url, { path: "/%2e%2e%2f%2e%2e%2fwindows%2fwin.ini" });
  equal(traversal.status, 403, "encoded path traversal must remain denied");

  const unsupported = await rawRequest(publish.url, { method: "POST", path: "/asset.js" });
  equal(unsupported.status, 405);
  equal(unsupported.headers.allow, "GET, HEAD");
} finally {
  await closeServer(publish.server);
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log(
  JSON.stringify(
    {
      status: "ok",
      assertions,
      development_cache_control: "no-store",
      publish_cache_control: "no-cache",
    },
    null,
    2,
  ),
);
