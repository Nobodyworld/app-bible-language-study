import { DETAIL_VIEW_IDS, normalizeDetailViewId } from "./ui-contracts.js";
import { resolveStrongLanguage } from "./strong-section-lifecycle.js";

export const PANEL_SCOPE_ORDER = Object.freeze(["word", "verse", "chapter", "book", "global"]);

export const PANEL_SCOPE_LABELS = Object.freeze({
  word: "Word",
  verse: "Verse",
  chapter: "Chapter",
  book: "Book",
  global: "Settings",
});

export const PANEL_CONTEXT_TOOL_MATRIX = Object.freeze({
  word: Object.freeze([
    Object.freeze({ id: "strongs", shortLabel: "Word", label: "Word", scope: "word" }),
    Object.freeze({ id: "hebrew", shortLabel: "Hebrew", label: "Hebrew concordance", scope: "word" }),
    Object.freeze({ id: "greek", shortLabel: "Greek", label: "Greek concordance", scope: "word" }),
  ]),
  verse: Object.freeze([
    Object.freeze({ id: "par", shortLabel: "Par", label: "Parallel", scope: "verse" }),
    Object.freeze({ id: "refs", shortLabel: "Refs", label: "References", scope: "verse" }),
    Object.freeze({ id: "commentary", shortLabel: "Cmt", label: "Commentary", scope: "verse" }),
    Object.freeze({ id: "interlinear", shortLabel: "Int", label: "Language Study", scope: "verse" }),
  ]),
  chapter: Object.freeze([]),
  book: Object.freeze([]),
  global: Object.freeze([]),
});

export const PANEL_ACTION_VIEW_IDS = Object.freeze({
  commentary: DETAIL_VIEW_IDS.commentary,
  interlinear: DETAIL_VIEW_IDS.languageStudy,
  par: DETAIL_VIEW_IDS.parallel,
  refs: DETAIL_VIEW_IDS.references,
  strongs: DETAIL_VIEW_IDS.strongs,
});

export function isPanelActionCurrent(actionId, displayedViewId) {
  const expectedViewId = PANEL_ACTION_VIEW_IDS[String(actionId || "")] || "";
  return Boolean(expectedViewId) && expectedViewId === normalizeDetailViewId(displayedViewId);
}

export function panelScopeSequence({ word = false, verse = false, chapter = false, book = false, global = false } = {}) {
  const available = { word, verse, chapter, book, global };
  return PANEL_SCOPE_ORDER.filter((scope) => Boolean(available[scope]));
}

export function panelToolsForScope(scope, { language = null } = {}) {
  const tools = PANEL_CONTEXT_TOOL_MATRIX[scope] || Object.freeze([]);
  if (scope !== "word") return tools;
  return tools.filter((tool) => tool.id === "strongs" || tool.id === language);
}

export function panelToolsForWordContext(wordContext = null, options = {}) {
  const token = wordContext?.token || wordContext || null;
  const language = resolveStrongLanguage({
    token,
    strongMetadata: wordContext?.strongMetadata || wordContext?.entry || null,
    sourceMetadata: wordContext?.sourceMetadata || token?.source_metadata || token?.sourceMetadata || null,
    sources: options.sources,
    bookId: options.bookId,
    testament: options.testament,
  });
  return panelToolsForScope("word", { language });
}

function normalizedWordLabel(wordContext) {
  const token = wordContext?.token || wordContext || null;
  if (!token) return "";
  return [token.original, token.strong_code || token.strongCode].filter(Boolean).join(" · ");
}

export function panelContextSummary({ reference = "", wordContext = null } = {}) {
  const word = normalizedWordLabel(wordContext);
  if (word && reference) return `${word} · in ${reference}`;
  return word || String(reference || "");
}
