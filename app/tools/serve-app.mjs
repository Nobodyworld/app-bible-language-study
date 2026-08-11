#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8000;
const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SERVE_MODES = new Set(["development", "publish"]);

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function resolvedPort(value) {
  const port = Number(value ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

function requestFilePath(root, requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl || "/", "http://127.0.0.1").pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = resolve(root, relativePath);
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) return null;
  return filePath;
}

function resolvedMode(value = "development") {
  const mode = String(value || "development").toLowerCase();
  if (!SERVE_MODES.has(mode)) throw new Error(`Invalid serve mode: ${value}`);
  return mode;
}

function entityTag(body) {
  return `"${createHash("sha256").update(body).digest("base64url")}"`;
}

function etagMatches(header, etag) {
  if (!header) return false;
  return String(header)
    .split(",")
    .map((value) => value.trim().replace(/^W\//, ""))
    .some((value) => value === "*" || value === etag);
}

function isNotModified(request, etag, modifiedAt) {
  const ifNoneMatch = request.headers["if-none-match"];
  if (ifNoneMatch) return etagMatches(ifNoneMatch, etag);
  const ifModifiedSince = request.headers["if-modified-since"];
  if (!ifModifiedSince) return false;
  const since = Date.parse(ifModifiedSince);
  if (!Number.isFinite(since)) return false;
  return Math.floor(modifiedAt.getTime() / 1000) <= Math.floor(since / 1000);
}

export function createStaticAppServer({ root = DEFAULT_ROOT, mode = "development" } = {}) {
  const resolvedRoot = resolve(root);
  const serveMode = resolvedMode(mode);
  const cacheControl = serveMode === "publish" ? "no-cache" : "no-store";
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" });
        response.end("Method not allowed");
        return;
      }

      const filePath = requestFilePath(resolvedRoot, request.url);
      if (!filePath) {
        response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Forbidden");
        return;
      }

      const [body, fileStats] = await Promise.all([readFile(filePath), stat(filePath)]);
      const etag = entityTag(body);
      const responseHeaders = {
        "Cache-Control": cacheControl,
        ETag: etag,
        "Last-Modified": fileStats.mtime.toUTCString(),
        "X-Content-Type-Options": "nosniff",
      };
      if (serveMode === "publish" && isNotModified(request, etag, fileStats.mtime)) {
        response.writeHead(304, responseHeaders);
        response.end();
        return;
      }
      response.writeHead(200, {
        ...responseHeaders,
        "Content-Length": body.length,
        "Content-Type": CONTENT_TYPES[extname(filePath).toLowerCase()] || "application/octet-stream",
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch (error) {
      const status = error?.code === "ENOENT" || error?.code === "EISDIR" ? 404 : 500;
      response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(status === 404 ? "Not found" : "Internal server error");
      if (status === 500) console.error(error);
    }
  });

  server.on("clientError", (_error, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });

  return server;
}

export async function startStaticAppServer({ host = DEFAULT_HOST, port = DEFAULT_PORT, root = DEFAULT_ROOT, mode = "development" } = {}) {
  const server = createStaticAppServer({ root, mode });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(resolvedPort(port), host, resolveListen);
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : resolvedPort(port);
  return { server, url: `http://${host}:${actualPort}` };
}

async function main() {
  const host = optionValue("--host") || process.env.HOST || DEFAULT_HOST;
  const port = optionValue("--port") || process.env.PORT || DEFAULT_PORT;
  const root = optionValue("--root") || DEFAULT_ROOT;
  const mode = optionValue("--mode") || (process.argv.includes("--publish") ? "publish" : "development");
  const { server, url } = await startStaticAppServer({ host, port, root, mode });

  console.log(`Bible App Reader available at ${url}`);
  console.log(`Serving ${resolve(root)}`);
  console.log(`Cache mode: ${resolvedMode(mode)}`);
  console.log("Press Ctrl+C to stop.");

  const shutdown = () => server.close(() => process.exit(0));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
