#!/usr/bin/env node

import assert from "node:assert/strict";
import { STORAGE_KEYS } from "../app/src/config.js";
import { PANEL_MODES } from "../app/src/ui-contracts.js";
import {
  STUDY_WORKSPACE_WIDTH_DEFAULT,
  STUDY_WORKSPACE_WIDTH_MODES,
  STUDY_WORKSPACE_WIDTH_SEQUENCE,
  STUDY_WORKSPACE_WIDTH_STORAGE_KEY,
  applyStudyWorkspaceWidth,
  initializeStudyWorkspaceWidth,
  nextStudyWorkspaceWidth,
  normalizeStudyWorkspaceWidth,
  readStudyWorkspaceWidth,
  writeStudyWorkspaceWidth,
} from "../app/src/study-workspace-width.js";

assert.deepEqual(Object.values(STUDY_WORKSPACE_WIDTH_MODES), ["compact", "standard", "expanded"]);
assert.deepEqual(STUDY_WORKSPACE_WIDTH_SEQUENCE, ["compact", "standard", "expanded"]);
assert.equal(STUDY_WORKSPACE_WIDTH_DEFAULT, "standard");
Object.values(STUDY_WORKSPACE_WIDTH_MODES).forEach((mode) => {
  assert.equal(normalizeStudyWorkspaceWidth(mode), mode);
});
assert.equal(nextStudyWorkspaceWidth("compact"), "standard");
assert.equal(nextStudyWorkspaceWidth("standard"), "expanded");
assert.equal(nextStudyWorkspaceWidth("expanded"), "compact");
assert.equal(nextStudyWorkspaceWidth("unsupported"), "expanded", "invalid state must normalize to Standard before cycling");

for (const malformed of [undefined, null, false, 0, "", "wide", " standard ", {}, []]) {
  assert.equal(
    normalizeStudyWorkspaceWidth(malformed),
    STUDY_WORKSPACE_WIDTH_DEFAULT,
    `${JSON.stringify(malformed)} must fall back to Standard`,
  );
}

function memoryStorage(initial = []) {
  const values = new Map(initial);
  return {
    values,
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

const storage = memoryStorage();
assert.equal(readStudyWorkspaceWidth(storage), "standard", "missing preference must use Standard");
assert.equal(writeStudyWorkspaceWidth("compact", storage), "compact");
assert.equal(storage.values.get(STUDY_WORKSPACE_WIDTH_STORAGE_KEY), "compact");
assert.equal(readStudyWorkspaceWidth(storage), "compact", "a valid preference must survive a reload read");
assert.equal(writeStudyWorkspaceWidth("expanded", storage), "expanded");
assert.equal(readStudyWorkspaceWidth(storage), "expanded");

storage.values.set(STUDY_WORKSPACE_WIDTH_STORAGE_KEY, "malformed");
assert.equal(readStudyWorkspaceWidth(storage), "standard", "unsupported stored values must use Standard");
storage.values.set(STUDY_WORKSPACE_WIDTH_STORAGE_KEY, '{"mode":"compact"}');
assert.equal(readStudyWorkspaceWidth(storage), "standard", "structured or malformed values are not width modes");

const throwingReadStorage = {
  getItem() {
    throw new Error("storage read blocked");
  },
};
assert.doesNotThrow(() => readStudyWorkspaceWidth(throwingReadStorage));
assert.equal(readStudyWorkspaceWidth(throwingReadStorage), "standard");

const throwingWriteStorage = {
  setItem() {
    throw new Error("storage write blocked");
  },
};
assert.doesNotThrow(() => writeStudyWorkspaceWidth("expanded", throwingWriteStorage));
assert.equal(writeStudyWorkspaceWidth("expanded", throwingWriteStorage), "expanded");
assert.equal(readStudyWorkspaceWidth(null), "standard", "unavailable storage must use Standard");

assert.equal(STUDY_WORKSPACE_WIDTH_STORAGE_KEY, "bibleapp:study-workspace-width:v1");
assert.equal(
  Object.values(STORAGE_KEYS).includes(STUDY_WORKSPACE_WIDTH_STORAGE_KEY),
  false,
  "the UI-only width preference must remain outside portable user-data storage",
);

assert.notStrictEqual(STUDY_WORKSPACE_WIDTH_MODES, PANEL_MODES);
assert.deepEqual(Object.values(PANEL_MODES), ["follow", "locked"]);
assert.deepEqual(
  Object.values(STUDY_WORKSPACE_WIDTH_MODES).filter((mode) => Object.values(PANEL_MODES).includes(mode)),
  [],
  "width modes must not overload follow/locked detail behavior",
);
assert.equal(normalizeStudyWorkspaceWidth(PANEL_MODES.follow), "standard");
assert.equal(normalizeStudyWorkspaceWidth(PANEL_MODES.locked), "standard");

function button(mode) {
  const attributes = new Map();
  return {
    dataset: { studyWorkspaceWidthMode: mode },
    attributes,
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
  };
}

const legacyControls = [button("compact"), button("standard"), button("expanded")];
const root = { dataset: {} };
assert.equal(applyStudyWorkspaceWidth(root, "expanded", legacyControls), "expanded");
assert.equal(root.dataset.studyWorkspaceWidth, "expanded");
assert.deepEqual(
  legacyControls.map((control) => control.attributes.get("aria-pressed")),
  ["false", "false", "true"],
  "legacy fixed-mode controls must still expose one active pressed state",
);

function cycleButton() {
  const attributes = new Map([
    ["data-study-workspace-width-cycle", ""],
    ["data-study-workspace-width-mode", "standard"],
    ["aria-pressed", "true"],
  ]);
  const dataset = {
    studyWorkspaceWidthCycle: "",
    studyWorkspaceWidthMode: "standard",
  };
  return {
    dataset,
    attributes,
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    hasAttribute(name) {
      return attributes.has(name);
    },
    removeAttribute(name) {
      attributes.delete(name);
      if (name === "aria-pressed") delete dataset.ariaPressed;
    },
    setAttribute(name, value) {
      const text = String(value);
      attributes.set(name, text);
      if (name === "data-study-workspace-width-mode") dataset.studyWorkspaceWidthMode = text;
      if (name === "data-study-workspace-width-current") dataset.studyWorkspaceWidthCurrent = text;
      if (name === "data-study-workspace-width-next") dataset.studyWorkspaceWidthNext = text;
    },
  };
}

const cycle = cycleButton();
assert.equal(applyStudyWorkspaceWidth(root, "expanded", [cycle]), "expanded");
assert.equal(root.dataset.studyWorkspaceWidth, "expanded");
assert.equal(cycle.dataset.studyWorkspaceWidthMode, "expanded");
assert.equal(cycle.dataset.studyWorkspaceWidthCurrent, "expanded");
assert.equal(cycle.dataset.studyWorkspaceWidthNext, "compact");
assert.equal(cycle.attributes.has("aria-pressed"), false, "the cycle button must not expose radio-style pressed state");
assert.equal(cycle.attributes.get("aria-label"), "Study workspace width: Expanded. Change to Compact.");
assert.equal(cycle.attributes.get("title"), "Study workspace width: Expanded (click for Compact)");

const initializedStorage = memoryStorage([[STUDY_WORKSPACE_WIDTH_STORAGE_KEY, "compact"]]);
assert.equal(initializeStudyWorkspaceWidth({ root, storage: initializedStorage, controls: [cycle] }), "compact");
assert.equal(root.dataset.studyWorkspaceWidth, "compact");
assert.equal(cycle.dataset.studyWorkspaceWidthCurrent, "compact");
assert.equal(cycle.dataset.studyWorkspaceWidthNext, "standard");
assert.equal(cycle.dataset.studyWorkspaceWidthMode, "compact");

console.log(
  JSON.stringify(
    {
      status: "ok",
      modes: Object.values(STUDY_WORKSPACE_WIDTH_MODES),
      sequence: STUDY_WORKSPACE_WIDTH_SEQUENCE,
      defaultMode: STUDY_WORKSPACE_WIDTH_DEFAULT,
      storageKey: STUDY_WORKSPACE_WIDTH_STORAGE_KEY,
      controlModel: "single-cycle",
    },
    null,
    2,
  ),
);
