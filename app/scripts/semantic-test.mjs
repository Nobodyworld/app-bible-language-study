#!/usr/bin/env node

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = join(appRoot, "data");

const targetTypes = new Set([
  "book",
  "chapter",
  "verse",
  "verse_range",
  "text_span",
  "source_token",
  "source_token_span",
  "lexeme",
  "strongs_entry",
  "translation_rendering",
  "commentary_entry",
  "outline_item",
  "cross_reference",
  "interpretation_proposition",
  "tag_definition",
]);

const relationTypes = new Set([
  "broader_than",
  "narrower_than",
  "related_to",
  "opposite_of",
  "frequently_cooccurs_with",
  "incompatible_with",
  "derived_from",
  "translation_variant_of",
]);

async function readJson(relativePath) {
  return JSON.parse(await readFile(join(dataRoot, relativePath), "utf8"));
}

function fail(message, details = {}) {
  const error = new Error(message);
  error.details = details;
  throw error;
}

function assert(condition, message, details = {}) {
  if (!condition) fail(message, details);
}

function assertUnique(items, getId, label) {
  const seen = new Set();
  const duplicates = [];
  for (const item of items) {
    const id = getId(item);
    if (seen.has(id)) duplicates.push(id);
    seen.add(id);
  }
  assert(duplicates.length === 0, `${label} must have unique ids.`, { duplicates });
}

function validateDefinitions(payload) {
  assert(payload.schema_version === 1, "Tag definitions payload must use schema_version 1.");
  const definitions = payload.definitions || [];
  assert(definitions.length > 0, "Tag definitions payload must not be empty.");
  assertUnique(definitions, (item) => item.id, "Tag definitions");

  for (const definition of definitions) {
    assert(/^tag:/.test(definition.id), "Tag definition id must start with tag:.", { definition });
    assert(definition.schema_version === 1, "Tag definition must use schema_version 1.", { definition });
    assert(definition.namespace === "system", "Seed tag definitions must use system namespace.", { definition });
    assert(definition.label, "Tag definition must have a label.", { definition });
    assert(Array.isArray(definition.allowed_target_types) && definition.allowed_target_types.length, "Tag definition must list allowed target types.", {
      definition,
    });
    for (const type of definition.allowed_target_types) {
      assert(targetTypes.has(type), "Tag definition allowed_target_types contains unknown target type.", { definition: definition.id, type });
    }
    assert(["active", "draft", "deprecated", "retired"].includes(definition.status), "Tag definition has invalid status.", { definition });
    if (definition.status === "retired") {
      assert(definition.retired_at, "Retired tag definitions must record retired_at.", { definition });
      assert(
        definition.replacement_id === null || /^tag:/.test(definition.replacement_id || ""),
        "Retired tag definition replacement_id must be null or a tag id.",
        { definition },
      );
    }
  }

  const legacyIds = new Set(definitions.map((item) => item.legacy_id).filter(Boolean));
  ["positive_sentiment", "negative_sentiment", "command_declaration", "question"].forEach((legacyId) => {
    assert(legacyIds.has(legacyId), "Semantic tag definitions must map existing default tag ids.", { legacyId });
  });

  return definitions;
}

function validateRelations(payload, definitions) {
  assert(payload.schema_version === 1, "Tag relations payload must use schema_version 1.");
  const definitionIds = new Set(definitions.map((definition) => definition.id));
  const relations = payload.relations || [];
  assertUnique(relations, (item) => `${item.source_tag_id}:${item.relation}:${item.target_tag_id}`, "Tag relations");
  for (const relation of relations) {
    assert(definitionIds.has(relation.source_tag_id), "Tag relation source_tag_id does not resolve.", { relation });
    assert(definitionIds.has(relation.target_tag_id), "Tag relation target_tag_id does not resolve.", { relation });
    assert(relationTypes.has(relation.relation), "Tag relation type is invalid.", { relation });
    assert(relation.source_tag_id !== relation.target_tag_id, "Tag relation must not point to itself.", { relation });
    assert(["active", "draft", "deprecated"].includes(relation.status), "Tag relation has invalid status.", { relation });
  }
  return relations;
}

async function main() {
  const [manifest, definitionsPayload, relationsPayload] = await Promise.all([
    readJson("semantic/manifest.json"),
    readJson("semantic/tag-definitions.json"),
    readJson("semantic/tag-relations.json"),
  ]);

  assert(manifest.schema_version === 1, "Semantic manifest must use schema_version 1.");
  for (const path of Object.values(manifest.files || {})) {
    assert(existsSync(join(dataRoot, path)), "Semantic manifest references missing file.", { path });
  }

  const definitions = validateDefinitions(definitionsPayload);
  const relations = validateRelations(relationsPayload, definitions);

  assert(manifest.counts?.tag_definitions === definitions.length, "Semantic manifest tag definition count is stale.", {
    manifest: manifest.counts?.tag_definitions,
    actual: definitions.length,
  });
  assert(manifest.counts?.tag_relations === relations.length, "Semantic manifest tag relation count is stale.", {
    manifest: manifest.counts?.tag_relations,
    actual: relations.length,
  });

  console.log(
    JSON.stringify(
      {
        semanticManifest: manifest.counts,
        tagDefinitions: definitions.map((item) => item.id),
        tagRelations: relations.length,
        assertionBoundary: "tag definitions and relations only; historical user records are never packaged here",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.message);
  if (error.details) console.error(JSON.stringify(error.details, null, 2));
  process.exitCode = 1;
});
