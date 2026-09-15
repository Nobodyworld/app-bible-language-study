import { clearActiveWordContext, getActiveWordContext, setActiveWordContext } from "./active-word-context.js?v=pr13-live-qa-20260711e";
import { createCommentaryOutlineViews } from "./views/commentary-outline-view.js?v=pr13-live-qa-20260711e";
import { createInterlinearTranslationViews } from "./views/interlinear-translation-view.js?v=pr13-live-qa-20260711e";
import { createReferenceViews } from "./views/reference-view.js?v=pr13-live-qa-20260711e";
import { createSearchView } from "./views/search-view.js?v=pr13-live-qa-20260711e";
import { createStrongsView } from "./views/strongs-view.js?v=pr13-live-qa-20260711e";
import { createTagsView } from "./views/tags-view.js?v=pr13-live-qa-20260711e";
import { createUserDataView } from "./views/user-data-view.js?v=pr13-live-qa-20260711e";
import { setDetail } from "./dom.js?v=pr13-live-qa-20260711e";
import { createWordMeaningControl, refreshWordMeaningControls } from "./word-meaning.js?v=pr13-live-qa-20260711e";

function studyMarkBadgeOptions(options = {}) {
  return {
    ...options,
    includeFavorite: true,
  };
}

function renderStudyMarkBadges(tagsView, target, options = {}) {
  const rendered = tagsView.renderTargetTagBadges(target, studyMarkBadgeOptions(options));
  const badges = rendered?.classList?.contains("target-tag-badges")
    ? rendered
    : rendered?.querySelector?.(".target-tag-badges");
  const favorite = [...(badges?.children || [])].find((badge) =>
    String(badge.title || "").startsWith("Favorite"),
  );
  if (favorite) badges.append(favorite);
  return rendered;
}

export function createDetailViews(ctx) {
  ctx.getActiveWordContext = (verse = null) => getActiveWordContext(ctx, verse);
  ctx.setActiveWordContext = (context) => setActiveWordContext(ctx, context);
  ctx.clearActiveWordContext = () => clearActiveWordContext(ctx);

  const strongsCtx = Object.create(ctx);
  Object.defineProperty(strongsCtx, "studyContext", {
    value: null,
    writable: false,
  });
  const strongsView = createStrongsView(strongsCtx);
  const showStrong = (token, options = {}) => {
    if (options.verseContext && !options.hover) {
      ctx.setActiveWordContext({
        token,
        options,
      });
    }
    return strongsView.showStrong(token, options);
  };

  const commentaryOutlineViews = createCommentaryOutlineViews(ctx);
  const interlinearTranslationViews = createInterlinearTranslationViews(ctx, {
    appendLanguageBreakdown: strongsView.appendLanguageBreakdown,
    showStrong,
    scrollStrongSection: strongsView.scrollStrongSection,
  });
  const referenceViews = createReferenceViews(ctx);
  const tagsView = createTagsView(ctx);
  const renderWordMeaningControl = (options = {}) => createWordMeaningControl({
    state: ctx.state,
    ...options,
    onChange: (change) => {
      ctx.refreshInterpretationMarkers?.();
      refreshWordMeaningControls();
      options.onChange?.(change);
    },
  });

  return {
    clearStrongPin: strongsView.clearStrongPin,
    createFavoriteButton: tagsView.createFavoriteButton,
    createStudyMarksIcon: tagsView.createStudyMarksIcon,
    renderInlineTagPicker: tagsView.renderInlineTagPicker,
    renderTagBadges: tagsView.renderTagBadges,
    renderTargetTagPicker: tagsView.renderTargetTagPicker,
    renderStudyMarksTrigger: tagsView.renderStudyMarksTrigger,
    renderWordMeaningControl,
    renderTargetTagBadges: (target, options = {}) => renderStudyMarkBadges(tagsView, target, options),
    showCommentary: commentaryOutlineViews.showCommentary,
    showCrossrefs: referenceViews.showCrossrefs,
    showFootnote: referenceViews.showFootnote,
    showInterlinearChapter: interlinearTranslationViews.showInterlinearChapter,
    showInterlinearVerse: interlinearTranslationViews.showInterlinearVerse,
    showOutline: commentaryOutlineViews.showOutline,
    showParallelVerse: referenceViews.showParallelVerse,
    showSearch: createSearchView(ctx, { showStrong }),
    showStudyUnavailable: (title, node, options = {}) => setDetail(title, node, options),
    showStrong,
    scrollStrongSection: strongsView.scrollStrongSection,
    showFavorites: tagsView.showFavorites,
    showTargetTagEditor: tagsView.showTargetTagEditor,
    showTagEditor: tagsView.showTagEditor,
    showTagIndex: tagsView.showTagIndex,
    showMyData: createUserDataView(ctx, { showStudyMarks: tagsView.showTagIndex }),
  };
}
