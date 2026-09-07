#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  CUSTOM_MEANING_MAX_LENGTH,
  buildWordMeaningChoiceModel,
  validateSourceTokenMeaningTarget,
} from "../app/src/word-meaning.js";
import { createSourceTokenTarget, createVerseTarget } from "../app/src/semantic-targets.js";
import {
  deleteTokenRendering,
  getTokenRendering,
  normalizeTokenRendering,
  setTokenRendering,
} from "../app/src/stores.js";

function createLocalStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

globalThis.window = {
  localStorage: createLocalStorage(),
  setTimeout,
  clearTimeout,
};

const priorityModel = buildWordMeaningChoiceModel({
  savedRendering: "Saved rendering",
  exactMappedEnglish: "Exact mapped English",
  english: "English token",
  gloss: "Gloss token",
  lexiconShortDefinition: "Lexicon definition",
  lexiconMeaning: "Fallback lexicon meaning",
});

assert.deepEqual(
  priorityModel.choices.map(({ value, source, current = false }) => ({ value, source, current })),
  [
    { value: "Saved rendering", source: "saved", current: true },
    { value: "Exact mapped English", source: "exact_bsb", current: false },
    { value: "English token", source: "english", current: false },
    { value: "Gloss token", source: "gloss", current: false },
    { value: "Lexicon definition", source: "lexicon", current: false },
  ],
  "meaning choices must retain deterministic source priority",
);
assert.equal(priorityModel.saved, "Saved rendering", "saved rendering must be exposed as the current meaning");
assert.deepEqual(
  priorityModel.quickChoices.map(({ value, source }) => ({ value, source })),
  [
    { value: "Exact mapped English", source: "exact_bsb" },
    { value: "English token", source: "english" },
    { value: "Gloss token", source: "gloss" },
    { value: "Lexicon definition", source: "lexicon" },
  ],
  "the saved rendering must not be offered again as a quick choice",
);
assert.equal(Object.keys(priorityModel).at(-1), "other", "Other must be the final model field");
assert.deepEqual(priorityModel.other, { value: "other", label: "Other", source: "custom" });

const dedupedModel = buildWordMeaningChoiceModel({
  savedRendering: "  Chosen meaning ",
  exactMappedEnglish: "chosen MEANING",
  english: "Good news",
  gloss: "GOOD NEWS",
  lexiconMeaning: "Announcement",
});
assert.deepEqual(
  dedupedModel.choices.map(({ value, source }) => ({ value, source })),
  [
    { value: "Chosen meaning", source: "saved" },
    { value: "Good news", source: "english" },
    { value: "Announcement", source: "lexicon" },
  ],
  "meaning choices must trim and dedupe case-insensitively while keeping the highest-priority source",
);
assert.equal(CUSTOM_MEANING_MAX_LENGTH, 180, "custom meanings must publish their documented length limit");

const canonicalTarget = validateSourceTokenMeaningTarget({
  target_type: "source_token",
  translation_id: "BSB",
  reference: { book_id: "JOHN", chapter: "3", verse_start: "16" },
  token: { token_index: "4", strong_code: "g2316", language: "Greek", original: "θεός" },
});
assert.deepEqual(canonicalTarget, {
  schema_version: 2,
  target_type: "source_token",
  target_id: "target:source_token:bsb:new:john:3:16:4",
  translation_id: "bsb",
  edition_id: "bsb",
  testament: "new",
  reference: { book_id: "john", chapter: 3, verse_start: 16, verse_end: 16 },
  token: { token_index: 4, strong_code: "G2316", language: "greek", original: "θεός" },
});
assert.equal(validateSourceTokenMeaningTarget(createVerseTarget("john:3:16")), null);

const normalizedRendering = normalizeTokenRendering({
  reference_key: "john:3:16",
  token_index: "4",
  rendering: "  God ",
  original: "θεός",
  strong_code: "g2316",
  language: "Greek",
});
assert.equal(normalizedRendering?.target_id, canonicalTarget.target_id);
assert.deepEqual(normalizedRendering?.target, canonicalTarget, "stored meanings must retain canonical source-token metadata");
assert.equal(normalizedRendering?.rendering, "God");

const state = {};
const firstToken = createSourceTokenTarget("john:3:16", {
  token_index: 4,
  strong_code: "G2316",
  original: "θεός",
  language: "greek",
});
const secondToken = createSourceTokenTarget("john:3:16", {
  token_index: 7,
  strong_code: "G2316",
  original: "θεός",
  language: "greek",
});

assert(firstToken && secondToken, "test targets must be valid source tokens");
assert.notEqual(firstToken.target_id, secondToken.target_id, "token index must be part of source-token identity");

setTokenRendering(state, firstToken, "God");
setTokenRendering(state, secondToken, "Deity");
assert.equal(getTokenRendering(state, firstToken)?.rendering, "God");
assert.equal(getTokenRendering(state, secondToken)?.rendering, "Deity");
assert.deepEqual(
  Object.keys(state.workspaceStore.token_renderings["john:3:16"]).sort(),
  ["4", "7"],
  "tokens with the same Strong's code and display text must remain distinct by exact index",
);

const jobsAfterChanges = state.workspaceStore.job_events;
assert.equal(jobsAfterChanges.length, 0, "changed renderings must not create jobs");
setTokenRendering(state, firstToken, "  God  ");
assert.equal(
  state.workspaceStore.job_events.length,
  jobsAfterChanges.length,
  "writing an unchanged normalized meaning must not enqueue jobs",
);


assert.equal(deleteTokenRendering(state, firstToken), true, "existing token meaning must be removable");
assert.equal(getTokenRendering(state, firstToken), null, "removed token meaning must not resolve as a ghost record");
assert.equal(getTokenRendering(state, secondToken)?.rendering, "Deity", "removing one token must not remove its same-Strong peer");
assert.deepEqual(Object.keys(state.workspaceStore.token_renderings["john:3:16"]), ["7"]);
const jobsAfterRemoval = state.workspaceStore.job_events.length;
assert.equal(jobsAfterRemoval, 0, "removing a meaning must not create jobs");
assert.equal(deleteTokenRendering(state, firstToken), false, "removing an absent meaning must be a no-op");
assert.equal(
  state.workspaceStore.job_events.length,
  jobsAfterRemoval,
  "a no-op removal must not enqueue jobs",
);

assert.equal(deleteTokenRendering(state, secondToken), true);
assert.equal(state.workspaceStore.token_renderings["john:3:16"], undefined, "empty rendering verse buckets must be removed");
assert.equal(getTokenRendering(state, secondToken), null);

console.log(
  JSON.stringify(
    {
      status: "ok",
      choice_count: priorityModel.choices.length,
      canonical_target: canonicalTarget.target_id,
      workspace_jobs_after_changes: jobsAfterChanges.length,
    },
    null,
    2,
  ),
);
