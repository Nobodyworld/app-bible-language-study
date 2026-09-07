#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dataRoot = join(appRoot, "data");

function readJson(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value)}\n`);
}

const wordMapRoot = join(dataRoot, "analysis", "word-map", "bsb");
const graphRoot = join(dataRoot, "analysis", "graph", "books");

let wordMapBooks = 0;
let graphBooks = 0;
const topEdges = new Map();

// Count word-map outputs
if (existsSync(wordMapRoot)) {
  const files = readdirSync(wordMapRoot);
  wordMapBooks = files.filter((f) => f.endsWith(".json")).length;
}

// Count graph outputs and aggregate top edges
if (existsSync(graphRoot)) {
  const files = readdirSync(graphRoot);
  const jsonFiles = files.filter((f) => f.endsWith(".json"));
  graphBooks = jsonFiles.length;
  
  for (const file of jsonFiles) {
    const graphBook = readJson(join(graphRoot, file));
    if (graphBook?.outbound_edges) {
      graphBook.outbound_edges.forEach((edge) => {
        const key = `${graphBook.book?.id || file.replace(/\.json$/, "")}->${edge.target_book_id}`;
        const currentCount = topEdges.get(key) || 0;
        topEdges.set(key, currentCount + (edge.count || 0));
      });
    }
  }
}

const aggregateManifest = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  generator: "tools/aggregate-analysis-manifest.mjs",
  note: "Aggregated metadata from all chunked analysis runs.",
  summary: {
    word_map_books: wordMapBooks,
    graph_books: graphBooks,
    total_edges: [...topEdges.values()].reduce((sum, count) => sum + count, 0),
  },
  top_edges: [...topEdges.entries()]
    .map(([key, count]) => {
      const [source_book_id, target_book_id] = key.split("->");
      return { source_book_id, target_book_id, count };
    })
    .sort((a, b) => b.count - a.count || a.source_book_id.localeCompare(b.source_book_id))
    .slice(0, 500),
  outputs: {
    word_map_root: `data/analysis/word-map/bsb`,
    graph_root: `data/analysis/graph/books`,
    word_map_books: wordMapBooks,
    graph_books: graphBooks,
  },
};

writeJson(join(dataRoot, "analysis", "manifest.json"), aggregateManifest);
console.log(JSON.stringify(aggregateManifest.summary, null, 2));
