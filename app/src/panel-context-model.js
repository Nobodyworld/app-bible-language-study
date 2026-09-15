import { DETAIL_VIEW_IDS, normalizeDetailViewId, uiActionContract } from "./ui-contracts.js";
import { resolveStrongLanguage } from "./strong-section-lifecycle.js";

export const PANEL_SCOPE_ORDER = Object.freeze(["word", "verse", "chapter", "book", "global"]);

export const PANEL_SCOPE_LABELS = Object.freeze({
  word: "Word",
  verse: "Verse",
  chapter: "Chapter",
  book: "Book",
  global: "Settings",
});

function contractedTool(actionId, overrides = {}) {
  const contract = uiActionContract(actionId);
  return Object.freeze({
    actionId,
    shortLabel: contract?.compactLabel || contract?.label || actionId,
    label: contract?.label || actionId,
    tip: contract?.tip || "",
    ...overrides,
  });
}

export const PANEL_CONTEXT_TOOL_MATRIX = Object.freeze({
  word: Object.freeze([
    contractedTool("definition", { id: "strongs", scope: "word" }),
    Object.freeze({ id: "hebrew", shortLabel: "Concordance", label: "Hebrew concordance", scope: "word" }),
    Object.freeze({ id: "greek", shortLabel: "Concordance", label: "Greek concordance", scope: "word" }),
  ]),
  verse: Object.freeze([
    contractedTool("translations", { id: "par", scope: "verse" }),
    contractedTool("references", { id: "refs", scope: "verse" }),
    contractedTool("commentary", { id: "commentary", scope: "verse" }),
    contractedTool("language-study", { id: "interlinear", scope: "verse" }),
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
