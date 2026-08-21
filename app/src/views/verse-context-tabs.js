import { studyUnavailableLabel } from "../study-empty-state.js";
import { CONTROL_STATES, resolveControlState } from "../ui-contracts.js";
import {
  PANEL_SCOPE_LABELS,
  panelContextSummary,
  panelScopeSequence,
  panelToolsForScope,
  panelToolsForWordContext,
} from "../panel-context-model.js";
import { resolveInterlinearVerseTokens } from "../strongs.js?v=pr13-live-qa-20260711e";
import { createSourceTokenTarget, createVerseTarget } from "../semantic-targets.js?v=pr13-live-qa-20260711e";
import { strongSectionControlState } from "../strong-section-lifecycle.js?v=pr13-live-qa-20260711e";
import { fetchLexiconEntry, fetchVerseBook, fetchWordMapBook } from "../data-service.js?v=pr13-live-qa-20260711e";

function getVerseText(ctx, verse) {
  return ctx.state.verseBook?.chapters?.[ctx.state.chapter]?.[verse] || "";
}

async function exactMappedBsbMeaning(ctx, token, verse) {
  const [wordMapBook, bsbBook] = await Promise.all([
    fetchWordMapBook("bsb", ctx.state.bookId),
    fetchVerseBook("bsb", ctx.state.bookId),
  ]);
  const text = bsbBook?.chapters?.[ctx.state.chapter]?.[verse] || "";
  const tokenIndex = Number(token?.token_index);
  const row = (wordMapBook?.chapters?.[ctx.state.chapter]?.[verse] || [])
    .find((item) => Number(item?.[1]) === tokenIndex);
  if (!row) return "";
  return String(text.slice(Number(row[2] || 0), Number(row[3] || row[2] || 0))).replace(/\s+/g, " ").trim();
}

function getCrossRecord(ctx, verse) {
  if (!ctx.canUseCapability?.("crossrefs")) return null;
  return ctx.state.crossrefs?.verses?.[`${ctx.state.chapter}:${verse}`] || null;
}

function hasInterlinear(ctx, verse) {
  if (!ctx.canUseCapability?.("interlinear")) return false;
  return Boolean(
    resolveInterlinearVerseTokens({
      rawInterlinearByVerse: ctx.state.interlinear?.chapters?.[ctx.state.chapter],
      rawStrongByVerse: ctx.state.strongs?.chapters?.[ctx.state.chapter],
      chapterVerses: ctx.state.verseBook?.chapters?.[ctx.state.chapter],
      targetVerse: verse,
      reference: { bookId: ctx.state.bookId, chapter: ctx.state.chapter },
    }).length,
  );
}

function datasetMayLoad(ctx, key) {
  if (ctx.readerDatasetCanLoad?.(key) !== true) return false;
  const status = ctx.readerDatasetState?.(key)?.status;
  return status === "idle" || status === "loading" || status === "error";
}

function resolveWordContext(ctx, explicitContext, verse) {
  return explicitContext?.token ? explicitContext : ctx.getActiveWordContext?.(verse) || null;
}

function createScopeGroup(scope) {
  const group = document.createElement("section");
  group.className = "panel-context-group";
  group.dataset.panelScope = scope;
  group.setAttribute("aria-label", `${PANEL_SCOPE_LABELS[scope]} scope`);

  const controls = document.createElement("div");
  controls.className = "panel-context-controls";
  group.append(controls);
  return { group, controls };
}

function wordHighlightOptions(wordContext, verse) {
  const token = wordContext?.token;
  if (!token) return { verse, commit: true };
  return {
    verse,
    word: {
      tokenIndex: token.token_index,
      strongCode: token.strong_code,
      language: token.language,
      original: token.original,
    },
    commit: true,
  };
}

function actionForTool(ctx, tool, reference, verse, active, wordContext) {
  if (tool.id === "verse") {
    const isWholeVerseContext = !wordContext?.token;
    return {
      ...tool,
      current: isWholeVerseContext,
      reactivatableCurrent: isWholeVerseContext,
      skipReaderHighlight: isWholeVerseContext,
      capabilityAvailable: true,
      dataAvailable: Boolean(getVerseText(ctx, verse)),
      run: isWholeVerseContext
        ? () => {}
        : () => {
            ctx.clearActiveWordContext?.();
            return ctx.detailViews.showParallelVerse(reference, verse, getVerseText(ctx, verse), {
              history: "replace",
              lock: true,
              verse,
            });
          },
    };
  }

  if (tool.id === "strongs") {
    const hasCanonicalWord = Boolean(wordContext?.token);
    return {
      ...tool,
      current: hasCanonicalWord,
      reactivatableCurrent: active === "strongs" && hasCanonicalWord,
      capabilityAvailable: ctx.canUseCapability?.("strongs-overlay") === true,
      dataAvailable: Boolean(wordContext?.token),
      unavailableKey: "strongs",
      dataUnavailableMessage: `Word detail is not available for ${reference}.`,
      run: () => ctx.detailViews.scrollStrongSection?.("word"),
    };
  }

  if (tool.id === "hebrew" || tool.id === "greek") {
    const section = tool.id;
    return {
      ...tool,
      current: false,
      capabilityAvailable: ctx.canUseCapability?.("strongs-overlay") === true,
      dataAvailable: wordContext?.sectionAvailability?.[section] === "present",
      unavailableKey: "strongs",
      dataUnavailableMessage: `${tool.label} is not available for this selected word.`,
      run: () => ctx.detailViews.scrollStrongSection?.(section),
    };
  }

  if (tool.id === "par") {
    return {
      ...tool,
      current: false,
      capabilityAvailable: true,
      dataAvailable: Boolean(getVerseText(ctx, verse)),
      run: () =>
        void ctx.detailViews.showParallelVerse(reference, verse, getVerseText(ctx, verse), {
          history: "replace",
          lock: true,
          verse,
        }),
    };
  }

  if (tool.id === "refs") {
    return {
      ...tool,
      current: false,
      capabilityAvailable: ctx.canUseCapability?.("crossrefs") === true,
      dataAvailable: Boolean(getCrossRecord(ctx, verse)) || datasetMayLoad(ctx, "crossrefs"),
      unavailableKey: "crossrefs",
      dataUnavailableMessage: `Cross-reference data is not available for ${reference}.`,
      run: () =>
        ctx.detailViews.showCrossrefs(reference, getCrossRecord(ctx, verse), {
          history: "replace",
          lock: true,
          verse,
        }),
    };
  }

  if (tool.id === "commentary") {
    return {
      ...tool,
      current: false,
      capabilityAvailable: ctx.canUseCapability?.("commentary") === true,
      dataAvailable: true,
      unavailableKey: "commentary",
      run: () => void ctx.detailViews.showCommentary(reference, verse, { history: "replace", lock: true }),
    };
  }

  if (tool.id === "interlinear") {
    return {
      ...tool,
      current: false,
      capabilityAvailable: ctx.canUseCapability?.("interlinear") === true,
      dataAvailable: hasInterlinear(ctx, verse) || datasetMayLoad(ctx, "interlinear"),
      unavailableKey: "interlinear",
      dataUnavailableMessage: `Language Study data is not available for ${reference}.`,
      run: () => void ctx.detailViews.showInterlinearVerse(reference, verse, { history: "replace", lock: true }),
    };
  }

  return {
    ...tool,
    current: false,
    capabilityAvailable: true,
    dataAvailable: Boolean(getVerseText(ctx, verse)),
    run: () =>
      ctx.detailViews.showTagEditor(reference, verse, getVerseText(ctx, verse), {
        history: "replace",
        lock: true,
      }),
  };
}

function appendActionButton(ctx, controls, action, reference, verse, wordContext) {
  const control = resolveControlState({
    capabilityAvailable: action.capabilityAvailable !== false,
    dataAvailable: action.dataAvailable !== false,
  });
  const scopeLabel = PANEL_SCOPE_LABELS[action.scope];
  const button = document.createElement("button");
  button.type = "button";
  button.className = action.current ? "verse-context-tab active" : "verse-context-tab";
  button.textContent = action.shortLabel;
  button.dataset.visibleLabel = action.label;
  button.dataset.panelScope = action.scope;
  button.dataset.panelAction = action.id;
  button.dataset.controlState = control.state;
  button.dataset.unavailable = control.disabled ? "true" : "false";
  const reactivatableCurrent = action.current && action.reactivatableCurrent === true;
  button.disabled = control.disabled || (action.current && !reactivatableCurrent);
  button.setAttribute("aria-pressed", action.current ? "true" : "false");
  if (action.current) button.setAttribute("aria-current", "page");

  if (control.state === CONTROL_STATES.capabilityUnavailable && action.unavailableKey) {
    const unavailableMessage = studyUnavailableLabel(action.unavailableKey);
    button.title = unavailableMessage;
    button.setAttribute("aria-label", `${scopeLabel} scope, ${action.label}: ${unavailableMessage}`);
    button.setAttribute("aria-disabled", "true");
  } else if (control.state === CONTROL_STATES.dataUnavailable) {
    const unavailableMessage = action.dataUnavailableMessage || `Data is not available for ${reference}.`;
    button.title = unavailableMessage;
    button.setAttribute("aria-label", `${scopeLabel} scope, ${action.label}: ${unavailableMessage}`);
    button.setAttribute("aria-disabled", "true");
  } else if (action.current) {
    button.title = `Current ${scopeLabel.toLowerCase()} view: ${action.label}`;
    button.setAttribute("aria-label", `${scopeLabel} scope, current view: ${action.label} for ${reference}`);
  } else {
    button.title = `${scopeLabel} scope: ${action.label}`;
    button.setAttribute("aria-label", `${scopeLabel} scope, ${action.label} for ${reference}`);
  }

  if (action.run && (!action.current || reactivatableCurrent)) {
    button.addEventListener("click", () => {
      if (!action.skipReaderHighlight) {
        ctx.highlightReaderContext?.(
          action.scope === "word" ? wordHighlightOptions(wordContext, verse) : { verse, commit: true },
        );
      }
      action.run();
    });
  }
  controls.append(button);
  return button;
}

function syncStrongSectionControl(button, section, availability, reference) {
  if (!button) return;
  const state = strongSectionControlState(section, availability, reference);
  button.disabled = state.disabled;
  button.setAttribute("aria-disabled", state.ariaDisabled);
  button.dataset.controlState = state.controlState;
  button.dataset.unavailable = state.unavailable;
  button.title = state.title;
  button.setAttribute("aria-label", state.ariaLabel);
}

export function createVerseContextTabs(ctx, reference, verse, active, strongsContext = null) {
  const wordContext = resolveWordContext(ctx, strongsContext, verse);
  const hasWord = Boolean(wordContext?.token);
  const scopeOrder = panelScopeSequence({ word: hasWord, verse: true });

  const tabs = document.createElement("nav");
  tabs.className = "verse-context-tabs panel-context-navigation";
  tabs.dataset.scopeOrder = scopeOrder.join(" ");
  tabs.dataset.panelOccupant = active || "unknown";
  tabs.setAttribute("aria-label", `Contextual study tools for ${reference}`);

  const summary = document.createElement("div");
  summary.className = "panel-context-summary";
  summary.textContent = panelContextSummary({ reference, wordContext });
  tabs.append(summary);

  const groups = document.createElement("div");
  groups.className = "panel-context-groups";

  scopeOrder
    .filter((scope) => scope === "word" || scope === "verse")
    .forEach((scope) => {
      const { group, controls } = createScopeGroup(scope);
      const tools =
        scope === "word"
          ? panelToolsForWordContext(wordContext, {
              bookId: ctx.state.bookId,
              sources: ctx.state.manifest?.original_language_sources,
            })
          : panelToolsForScope(scope);
      const appendTool = (tool) => {
        const button = appendActionButton(
          ctx,
          controls,
          actionForTool(ctx, tool, reference, verse, active, wordContext),
          reference,
          verse,
          wordContext,
        );
        if (tool.id === "hebrew" || tool.id === "greek") {
          button.dataset.strongSectionControl = tool.id;
        }
        return button;
      };
      const [scopeTool, ...relatedTools] = tools;
      if (scopeTool) appendTool(scopeTool);

      if (scope === "word" && hasWord) {
        const sourceTarget = createSourceTokenTarget(
          { translation_id: ctx.state.translationId, book_id: ctx.state.bookId, chapter: ctx.state.chapter, verse },
          wordContext.token,
          ctx.state.translationId,
        );
        if (sourceTarget) {
          const marks = ctx.detailViews.renderStudyMarksTrigger(sourceTarget, {
            align: "right",
            boundary: "detail-pane",
            label: `selected source word in ${reference}`,
            onChange: () => {
              ctx.renderChapter();
              ctx.syncFavoriteButtons?.();
            },
          });
          marks.dataset.panelAction = "study-marks";
          controls.append(marks);
          relatedTools.forEach(appendTool);

          const meaning = ctx.detailViews.renderWordMeaningControl({
            target: sourceTarget,
            token: wordContext.token,
            presentation: "detail-pane",
            label: `selected source word in ${reference}`,
            loadExactMappedEnglish: () => exactMappedBsbMeaning(ctx, wordContext.token, verse),
            loadLexicon: wordContext.token.strong_code
              ? () => fetchLexiconEntry(wordContext.token.strong_code)
              : null,
          });
          if (meaning) {
            meaning.dataset.panelAction = "meaning";
            controls.append(meaning);
          }
        } else {
          relatedTools.forEach(appendTool);
        }
      } else if (scope === "verse") {
        const verseTarget = createVerseTarget(
          {
            translation_id: ctx.state.translationId,
            book_id: ctx.state.bookId,
            chapter: ctx.state.chapter,
            verse,
          },
          ctx.state.translationId,
        );
        const marks = ctx.detailViews.renderStudyMarksTrigger(verseTarget, {
          align: "right",
          boundary: "detail-pane",
          label: `verse ${reference}`,
          onChange: () => {
            ctx.renderChapter();
            ctx.syncFavoriteButtons?.();
          },
        });
        marks.dataset.panelAction = "study-marks";
        controls.append(marks);
        relatedTools.forEach(appendTool);
      } else {
        relatedTools.forEach(appendTool);
      }

      groups.append(group);
    });

  tabs.append(groups);
  tabs.updateStrongSectionAvailability = (availability) => {
    if (!hasWord) return;
    ["hebrew", "greek"].forEach((section) => {
      syncStrongSectionControl(tabs.querySelector(`[data-strong-section-control="${section}"]`), section, availability, reference);
    });
  };
  return tabs;
}
