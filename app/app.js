import { DEFAULT_ROUTE } from "./src/config.js?v=pr13-live-qa-20260711e";
import { capabilityAvailable, resolveCapability } from "./src/capabilities.js";
import { createChapterRenderer } from "./src/chapter-renderer.js?v=pr13-live-qa-20260711e";
import {
  loadManifest,
  loadReaderBookData,
  translationCanLoadBook,
} from "./src/data-service.js?v=pr13-live-qa-20260711e";
import { createDetailViews } from "./src/detail-views.js?v=pr13-live-qa-20260711e";
import {
  els,
  goBackDetail,
  goForwardDetail,
  option,
  resetDetail,
  resetDetailForNavigation,
  setDetailHoverLocked,
  setStatus,
  sortedNumericKeys,
  trackReaderLocation,
} from "./src/dom.js?v=pr13-live-qa-20260711e";
import { createReferenceButton as makeReferenceButton, referenceKey, refDomId } from "./src/references.js";
import { buildReferenceContext, referenceContextKey } from "./src/reference-context.js";
import { createBookTarget, createChapterTarget } from "./src/semantic-targets.js?v=pr13-live-qa-20260711e";
import { normalizeRoute, parseReaderRoute, writeReaderRoute } from "./src/routing.js";
import { getTagTargets, initStores, listenForUserDataChanges } from "./src/stores.js?v=pr13-live-qa-20260711e";
import { studyUnavailableLabel } from "./src/study-empty-state.js";
import { chapterSwipeDirection, CONTROL_STATES, resolveControlState } from "./src/ui-contracts.js?v=pr13-live-qa-20260711e";

const state = {
  manifest: null,
  translationId: DEFAULT_ROUTE.translationId,
  bookId: DEFAULT_ROUTE.bookId,
  chapter: DEFAULT_ROUTE.chapter,
  verseBook: null,
  footnotes: null,
  presentation: null,
  crossrefs: null,
  strongs: null,
  commentary: null,
  outline: null,
  interlinear: null,
  pendingScrollVerse: null,
  tagStore: null,
  workspaceStore: null,
  userStoreBackend: null,
  userStoreMigration: null,
  activeReferenceContext: null,
  hoverReferenceContext: null,
};

function findBook(bookId) {
  return state.manifest?.books?.find((book) => book.id === bookId) || null;
}

function currentReference(verse) {
  const book = state.verseBook?.book || findBook(state.bookId);
  return `${book?.name || state.bookId} ${state.chapter}:${verse}`;
}

function currentRoute(verse = null) {
  return {
    translationId: state.translationId,
    bookId: state.bookId,
    chapter: state.chapter,
    verse,
  };
}

function createReferenceButton(label, location) {
  return makeReferenceButton(label, location, goToLocation);
}

function canUseCapability(capabilityId) {
  if (!state.manifest?.package_manifest && !state.packageManifest) return true;
  return capabilityAvailable(state.packageManifest || state.manifest.package_manifest, state.packageStore, capabilityId, {
    assumeBundledFullAccess: true,
  });
}

function getCapabilityState(capabilityId) {
  return resolveCapability(state.packageManifest || state.manifest?.package_manifest, state.packageStore, capabilityId, {
    assumeBundledFullAccess: true,
  });
}

function getReferenceContext(overrides = {}) {
  const hasVerse = Object.prototype.hasOwnProperty.call(overrides, "verse");
  const hasWord = Object.prototype.hasOwnProperty.call(overrides, "word");
  return buildReferenceContext({
    translationId: state.translationId,
    bookId: state.bookId,
    chapter: state.chapter,
    verse: hasVerse ? overrides.verse : state.activeReferenceContext?.verse,
    word: hasWord ? overrides.word : state.activeReferenceContext?.word,
    ...overrides,
  });
}

function clearReaderHighlight() {
  document.querySelectorAll(".reader-context-verse, .reader-context-word").forEach((node) => {
    node.classList.remove("reader-context-verse", "reader-context-word");
  });
  state.hoverReferenceContext = null;
}

function highlightReaderContext(options = {}) {
  clearReaderHighlight();
  const wordElement = options.wordElement || null;
  const segmentId = options.segmentId || wordElement?.dataset?.segmentId || wordElement?.closest?.("[data-segment-id]")?.dataset?.segmentId || null;
  const verse = options.verse || wordElement?.closest?.(".verse-row, .source-bearing-segment")?.dataset?.verse || null;
  const row =
    wordElement?.closest?.(".verse-row, .source-bearing-segment") ||
    (segmentId ? document.querySelector(`[data-segment-id="${CSS.escape(segmentId)}"]`) : null) ||
    (verse ? document.getElementById(refDomId(referenceKey(state.bookId, state.chapter, verse))) : null);
  if (row) row.classList.add("reader-context-verse");
  if (wordElement?.classList) wordElement.classList.add("reader-context-word");
  const context = getReferenceContext({
    verse,
    segmentId,
    word:
      options.word ||
      (wordElement
        ? {
            tokenIndex: wordElement.dataset.tokenIndex,
            strongCode: wordElement.dataset.strongCode,
            language: wordElement.__bibleAppStrongToken?.language,
            original: wordElement.__bibleAppStrongToken?.original,
          }
        : null),
  });
  if (options.commit) {
    state.activeReferenceContext = context;
  } else {
    state.hoverReferenceContext = context;
  }
}

function restoreReaderHighlightFromContext(context) {
  if (!context?.verse) {
    clearReaderHighlight();
    return;
  }
  const row =
    (context.segment_id ? document.querySelector(`[data-segment-id="${CSS.escape(context.segment_id)}"]`) : null) ||
    document.getElementById(refDomId(referenceKey(state.bookId, state.chapter, context.verse)));
  if (!row) return;
  const word = context.word || {};
  const tokens = [...row.querySelectorAll(".strong-token")];
  const wordElement =
    (word.interlinearKey && tokens.find((node) => node.dataset.interlinearKey === word.interlinearKey)) ||
    (word.strongCode &&
      word.tokenIndex &&
      tokens.find((node) => node.dataset.strongCode === word.strongCode && node.dataset.tokenIndex === word.tokenIndex)) ||
    (word.strongCode && tokens.find((node) => node.dataset.strongCode === word.strongCode)) ||
    null;
  highlightReaderContext({
    verse: context.verse,
    segmentId: context.segment_id,
    wordElement,
    word,
    commit: true,
  });
}

const ctx = {
  state,
  clearReaderHighlight,
  createReferenceButton,
  currentReference,
  findBook,
  goToLocation,
  goToRoute: navigateToRoute,
  highlightReaderContext,
  canUseCapability,
  getCapabilityState,
  getReferenceContext,
  referenceContextKey,
  renderChapter: () => renderer.renderChapter(),
  syncChapterButtons,
  syncFavoriteButtons,
  syncToolButtons,
  studyContext: {}, // Stores current Strong's word context for tab switching
};

const detailViews = createDetailViews(ctx);
ctx.detailViews = detailViews;
const renderer = createChapterRenderer(ctx);
const OLD_TESTAMENT_BOOK_COUNT = 39;

function setPickerExpanded(button, panel, expanded) {
  if (!button || !panel) return;
  button.setAttribute("aria-expanded", expanded ? "true" : "false");
  panel.hidden = !expanded;
}

function closeReaderPickers(except = null) {
  if (except !== "book") setPickerExpanded(els.bookPickerButton, els.bookPickerPanel, false);
  if (except !== "chapter") setPickerExpanded(els.chapterPickerButton, els.chapterPickerPanel, false);
}

function syncReaderPickerButtons() {
  const book = findBook(state.bookId);
  if (els.bookPickerButton) {
    els.bookPickerButton.textContent = book?.name || state.bookId || "Select book";
  }
  if (els.chapterPickerButton) {
    els.chapterPickerButton.textContent = state.chapter || "Select chapter";
  }
}

function createPickerOption(label, active, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = ["reader-picker-option", active ? "active" : ""].filter(Boolean).join(" ");
  button.textContent = label;
  button.setAttribute("aria-pressed", active ? "true" : "false");
  button.addEventListener("click", onClick);
  return button;
}

function renderBookPicker() {
  if (!els.bookPickerPanel || !state.manifest?.books) return;
  els.bookPickerPanel.replaceChildren();
  const groups = [
    ["Old Testament", state.manifest.books.slice(0, OLD_TESTAMENT_BOOK_COUNT)],
    ["New Testament", state.manifest.books.slice(OLD_TESTAMENT_BOOK_COUNT)],
  ];
  groups.forEach(([title, books]) => {
    const column = document.createElement("section");
    column.className = "book-picker-column";
    const heading = document.createElement("h3");
    heading.textContent = title;
    const list = document.createElement("div");
    list.className = "book-picker-list";
    books.forEach((book) => {
      list.append(
        createPickerOption(book.name, book.id === state.bookId, () => {
          closeReaderPickers();
          els.book.value = book.id;
          void navigateToRoute({
            translationId: state.translationId,
            bookId: book.id,
            chapter: "1",
            verse: null,
          });
        }),
      );
    });
    column.append(heading, list);
    els.bookPickerPanel.append(column);
  });
}

function renderChapterPicker() {
  if (!els.chapterPickerPanel) return;
  els.chapterPickerPanel.replaceChildren();
  const grid = document.createElement("div");
  grid.className = "chapter-picker-grid";
  sortedNumericKeys(state.verseBook?.chapters).forEach((chapter) => {
    grid.append(
      createPickerOption(chapter, chapter === state.chapter, () => {
        closeReaderPickers();
        els.chapter.value = chapter;
        void navigateToRoute({
          translationId: state.translationId,
          bookId: state.bookId,
          chapter,
          verse: null,
        });
      }),
    );
  });
  els.chapterPickerPanel.append(grid);
}

function syncReaderPickers() {
  syncReaderPickerButtons();
  renderBookPicker();
  renderChapterPicker();
}

function fillTranslationOptions() {
  els.translation.replaceChildren();
  state.manifest.translations.forEach((translation) => {
    els.translation.append(option(translation.id, translation.code || translation.id.toUpperCase()));
  });
  els.translation.value = state.translationId;
}

function fillBookOptions() {
  els.book.replaceChildren();
  state.manifest.books.forEach((book) => {
    els.book.append(option(book.id, book.name));
  });
  els.book.value = state.bookId;
  syncReaderPickers();
}

function fillChapterOptions() {
  els.chapter.replaceChildren();
  sortedNumericKeys(state.verseBook.chapters).forEach((chapter) => {
    els.chapter.append(option(chapter, chapter));
  });
  els.chapter.value = state.chapter;
  syncReaderPickers();
}

function syncChapterButtons() {
  const chapters = sortedNumericKeys(state.verseBook?.chapters);
  const index = chapters.indexOf(state.chapter);
  els.prev.disabled = index <= 0;
  els.next.disabled = index < 0 || index >= chapters.length - 1;
  if (els.prevFloat) els.prevFloat.disabled = els.prev.disabled;
  if (els.nextFloat) els.nextFloat.disabled = els.next.disabled;
}

function currentFavoriteTargets() {
  return {
    book: createBookTarget({
      translation_id: state.translationId,
      book_id: state.bookId,
    }),
    chapter: createChapterTarget({
      translation_id: state.translationId,
      book_id: state.bookId,
      chapter: state.chapter,
    }),
  };
}

function currentScopeTargets() {
  return currentFavoriteTargets();
}

function syncFavoriteButtons() {
  syncScopeControls();
}

function renderScopeMarkControl(mount, target, label, options = {}) {
  if (!mount || !target || !detailViews?.renderStudyMarksTrigger) return;
  mount.replaceChildren();
  const refresh = () => {
    syncScopeControls();
    renderer.renderChapter();
  };

  mount.append(
    detailViews.renderStudyMarksTrigger(target, {
      className: "scope-mark-button",
      id: label === "Book" ? "favoriteBook" : "favoriteChapter",
      align: options.align || "left",
      label: `current ${label.toLowerCase()}`,
      visibleLabel: label,
      title: `${label} marks`,
      manageLabel: "Manage other tags",
      onChange: refresh,
    }),
  );

  const badges = detailViews.renderTargetTagBadges(target, {
    className: "scope-target-badges",
    compact: true,
    includeFavorite: false,
    interactive: true,
    align: options.align || "left",
    label: `Current ${label.toLowerCase()}`,
    onChange: refresh,
  });
  if (badges) mount.append(badges);
}

function syncScopeControls() {
  const targets = currentScopeTargets();
  renderScopeMarkControl(els.bookTagControl, targets.book, "Book");
  renderScopeMarkControl(els.chapterTagControl, targets.chapter, "Chapter");
}

function syncToolButtons() {
  const tools = [
    [els.showSearch, "search", "Search this book", true],
    [els.showOutline, "outlines", "Book outline", Boolean(state.outline)],
    [
      els.showInterlinear,
      "interlinear",
      "Language Study",
      Object.values(state.interlinear?.chapters?.[state.chapter] || {}).some(
        (tokens) => Array.isArray(tokens) && tokens.length > 0,
      ),
    ],
  ];
  tools.forEach(([button, key, fallbackTitle, dataAvailable]) => {
    if (!button) return;
    const control = resolveControlState({
      capabilityAvailable: canUseCapability(key),
      dataAvailable,
    });
    button.disabled = control.disabled;
    if (control.state === CONTROL_STATES.capabilityUnavailable) {
      button.title = studyUnavailableLabel(key);
    } else if (control.state === CONTROL_STATES.dataUnavailable) {
      button.title =
        key === "outlines"
          ? "Outline data is not available for this book."
          : "Language Study data is not available for this chapter.";
    } else {
      button.title = fallbackTitle;
    }
    button.setAttribute("aria-label", button.title);
    button.dataset.unavailable = control.disabled ? "true" : "false";
    button.dataset.controlState = control.state;
  });
}

function writeHomeRoute(options = {}) {
  if (window.location.hash === "#/home") return;
  if (options.replace) {
    window.history.replaceState(null, "", "#/home");
  } else {
    window.history.pushState(null, "", "#/home");
  }
}

function showHomePage(options = {}) {
  setStatus("Home");
  if (options.writeUrl !== false) writeHomeRoute({ replace: Boolean(options.replace) });
  els.title.textContent = "Bible App Home";
  if (els.bookTagControl) els.bookTagControl.hidden = true;
  if (els.chapterTagControl) els.chapterTagControl.hidden = true;
  els.content.replaceChildren();
  const home = document.createElement("div");
  home.className = "home-view";

  const intro = document.createElement("section");
  intro.className = "home-intro";
  const heading = document.createElement("h3");
  heading.textContent = "Study workspace";
  const text = document.createElement("p");
  text.textContent = "Open the reader, search, Study Marks, language study, and your browser-local data from one place.";
  intro.append(heading, text);

  const grid = document.createElement("div");
  grid.className = "home-action-grid";
  const runWithReaderData = (action) => async () => {
    if (!state.verseBook) await navigateToRoute(currentRoute(), { replace: true });
    action();
  };
  const actions = [
    ["Continue reading", () => void navigateToRoute(currentRoute(), { replace: true })],
    ["Search", runWithReaderData(detailViews.showSearch)],
    ["Study Marks", runWithReaderData(detailViews.showTagIndex)],
    ["My Data", runWithReaderData(detailViews.showMyData)],
  ];
  actions.forEach(([label, action]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "home-action";
    button.textContent = label;
    button.addEventListener("click", action);
    grid.append(button);
  });

  home.append(intro, grid);
  els.content.append(home);
  els.prev.disabled = true;
  els.next.disabled = true;
  if (els.prevFloat) els.prevFloat.disabled = true;
  if (els.nextFloat) els.nextFloat.disabled = true;
}

async function loadBookData() {
  setStatus("Loading book data...");
  const requestedChapter = state.chapter;
  const bookData = await loadReaderBookData(state.translationId, state.bookId);

  Object.assign(state, bookData, { commentary: null });

  if (!state.verseBook.chapters?.[state.chapter]) {
    state.chapter = sortedNumericKeys(state.verseBook.chapters)[0] || "1";
  }

  fillChapterOptions();
  if (els.bookTagControl) els.bookTagControl.hidden = false;
  if (els.chapterTagControl) els.chapterTagControl.hidden = false;
  renderer.renderChapter();
  syncScopeControls();

  if (state.chapter !== requestedChapter) {
    writeReaderRoute(currentRoute(), { replace: true });
  }
}

async function navigateToRoute(route, options = {}) {
  if (route.home) {
    if (state.manifest) {
      fillTranslationOptions();
      fillBookOptions();
    }
    ctx.studyContext = {}; // Clear study context when going home
    showHomePage(options);
    return;
  }
  clearReaderHighlight();
  const normalized = normalizeRoute(route, state.manifest);
  const canLoad = await translationCanLoadBook(normalized.translationId, normalized.bookId);
  const next = {
    ...normalized,
    translationId: canLoad ? normalized.translationId : DEFAULT_ROUTE.translationId,
  };

  // Clear study context when navigating to a different location
  if (
    next.translationId !== state.translationId ||
    next.bookId !== state.bookId ||
    next.chapter !== state.chapter
  ) {
    ctx.studyContext = {};
    setDetailHoverLocked(false);
    detailViews.clearStrongPin();
    resetDetailForNavigation();
  }

  state.translationId = next.translationId;
  state.bookId = next.bookId;
  state.chapter = next.chapter;
  state.pendingScrollVerse = next.verse || null;
  state.activeReferenceContext = buildReferenceContext({
    translationId: state.translationId,
    bookId: state.bookId,
    chapter: state.chapter,
    verse: next.verse,
  });

  fillTranslationOptions();
  fillBookOptions();

  if (options.writeUrl !== false) {
    writeReaderRoute(next, { replace: Boolean(options.replace) });
  }

  await loadBookData();

  // Track this location in reader history
  trackReaderLocation({
    bookId: next.bookId,
    chapter: next.chapter,
    verse: next.verse || null,
  });
}

async function goToLocation(bookId, chapter, verse) {
  await navigateToRoute({
    translationId: state.translationId,
    bookId,
    chapter: String(chapter || 1),
    verse: verse == null ? null : String(verse),
  });
}

async function goToChapter(delta) {
  clearReaderHighlight();
  const chapters = sortedNumericKeys(state.verseBook?.chapters);
  const index = chapters.indexOf(state.chapter);
  const next = chapters[index + delta];
  if (!next) return;
  await navigateToRoute({
    translationId: state.translationId,
    bookId: state.bookId,
    chapter: next,
    verse: null,
  });
}

function bindEvents() {
  function disengageDetailFollow() {
    setDetailHoverLocked(false);
    detailViews.clearStrongPin();
    clearReaderHighlight();
  }

  function maybeDisengageLockedDetail(event) {
    if (
      !event.target.closest?.(
        "button, a, input, select, textarea, summary, label, [role='button'], .verse-context-tabs, .detail-floating-nav, .strong-token, .language-word-hover, .language-letter-hover, .letter-unit",
      )
    ) {
      disengageDetailFollow();
    }
  }

  els.translation.addEventListener("change", () => {
    void navigateToRoute({
      translationId: els.translation.value,
      bookId: state.bookId,
      chapter: state.chapter,
      verse: null,
    });
  });
  els.book.addEventListener("change", () => {
    void navigateToRoute({
      translationId: state.translationId,
      bookId: els.book.value,
      chapter: "1",
      verse: null,
    });
  });
  els.chapter.addEventListener("change", () => {
    void navigateToRoute({
      translationId: state.translationId,
      bookId: state.bookId,
      chapter: els.chapter.value,
      verse: null,
    });
  });
  els.bookPickerButton?.addEventListener("click", () => {
    const expanded = els.bookPickerButton.getAttribute("aria-expanded") === "true";
    closeReaderPickers("book");
    setPickerExpanded(els.bookPickerButton, els.bookPickerPanel, !expanded);
  });
  els.chapterPickerButton?.addEventListener("click", () => {
    const expanded = els.chapterPickerButton.getAttribute("aria-expanded") === "true";
    closeReaderPickers("chapter");
    setPickerExpanded(els.chapterPickerButton, els.chapterPickerPanel, !expanded);
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest?.(".reader-controls label")) closeReaderPickers();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeReaderPickers();
  });
  els.prev.addEventListener("click", () => void goToChapter(-1));
  els.next.addEventListener("click", () => void goToChapter(1));
  els.prevFloat?.addEventListener("click", () => void goToChapter(-1));
  els.nextFloat?.addEventListener("click", () => void goToChapter(1));
  els.homeButton?.addEventListener("click", () => void navigateToRoute({ home: true }, { writeUrl: true }));
  // Theme toggle functionality
  function initializeTheme() {
    const savedTheme = localStorage.getItem("bibleAppTheme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

    if (savedTheme) {
      document.documentElement.setAttribute("data-theme", savedTheme);
    } else if (prefersDark) {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.setAttribute("data-theme", "light");
    }

    updateThemeControl();
  }

  function updateThemeControl() {
    const theme = document.documentElement.getAttribute("data-theme") ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    if (!els.themeToggle) return;
    const isDark = theme === "dark";
    els.themeToggle.setAttribute("aria-pressed", String(isDark));
    els.themeToggle.setAttribute("aria-label", `Switch to ${isDark ? "light" : "dark"} theme`);
    els.themeToggle.title = `Switch to ${isDark ? "light" : "dark"} theme`;
  }

  function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute("data-theme") ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const newTheme = currentTheme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", newTheme);
    localStorage.setItem("bibleAppTheme", newTheme);
    updateThemeControl();
  }

  els.themeToggle?.addEventListener("click", toggleTheme);

  // Initialize theme on page load
  initializeTheme();

  // Clear study context when opening non-study views
  const clearStudyContextAndCall = (fn) => {
    return () => {
      ctx.studyContext = {};
      fn();
    };
  };

  els.showOutline.addEventListener("click", clearStudyContextAndCall(detailViews.showOutline));
  els.showInterlinear.addEventListener("click", clearStudyContextAndCall(detailViews.showInterlinearChapter));
  els.openStudyPanel?.addEventListener("click", () => {
    setDetailHoverLocked(true);
    els.detailPane?.classList.add("visible");
  });
  els.showSearch.addEventListener("click", clearStudyContextAndCall(detailViews.showSearch));
  els.showTags.addEventListener("click", clearStudyContextAndCall(detailViews.showTagIndex));
  els.showMyData.addEventListener("click", clearStudyContextAndCall(detailViews.showMyData));
  els.detailBack.addEventListener("click", () => {
    detailViews.clearStrongPin();
    const restoredLocation = goBackDetail();
    if (restoredLocation) {
      void goToLocation(restoredLocation.bookId, restoredLocation.chapter, restoredLocation.verse);
    }
  });
  els.detailForward.addEventListener("click", () => {
    detailViews.clearStrongPin();
    const restoredLocation = goForwardDetail();
    if (restoredLocation) {
      void goToLocation(restoredLocation.bookId, restoredLocation.chapter, restoredLocation.verse);
    }
  });
  els.clearDetail.addEventListener("click", () => {
    detailViews.clearStrongPin();
    clearReaderHighlight();
    state.activeReferenceContext = getReferenceContext({ verse: null, word: null });
    resetDetail();
  });

  // Add hover highlighting for reference buttons and outline items in detail panel
  els.detailContent?.addEventListener("mouseenter", (event) => {
    const referenceButton = event.target.closest?.(".link-button[data-verse]");
    if (!referenceButton) return;

    const bookId = referenceButton.dataset.bookId;
    const chapter = referenceButton.dataset.chapter;
    const verse = referenceButton.dataset.verse;

    // Only highlight if it's the current book and chapter
    if (bookId === state.bookId && chapter == state.chapter) {
      highlightReaderContext({ verse });
    }
  }, true);

  els.detailContent?.addEventListener("mouseleave", (event) => {
    const referenceButton = event.target.closest?.(".link-button[data-verse]");
    if (!referenceButton) return;
    clearReaderHighlight();
  }, true);

  document.addEventListener("pointerdown", maybeDisengageLockedDetail, true);
  document.addEventListener("click", maybeDisengageLockedDetail, true);

  let readerSwipeStart = null;
  els.content?.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    readerSwipeStart = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
  });
  els.content?.addEventListener("pointerup", (event) => {
    if (!readerSwipeStart || event.pointerId !== readerSwipeStart.pointerId) return;
    const deltaX = event.clientX - readerSwipeStart.x;
    const deltaY = event.clientY - readerSwipeStart.y;
    readerSwipeStart = null;
    const direction = chapterSwipeDirection({ deltaX, deltaY });
    if (!direction) return;
    disengageDetailFollow();
    void goToChapter(direction);
  });
  els.content?.addEventListener("pointercancel", () => {
    readerSwipeStart = null;
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", (event) => {
    // Ctrl+K or Cmd+K to open search
    if ((event.ctrlKey || event.metaKey) && event.key === "k") {
      event.preventDefault();
      ctx.studyContext = {};
      detailViews.showSearch();
    }

    // Ctrl+G or Cmd+G to open verse lookup
    if ((event.ctrlKey || event.metaKey) && event.key === "g") {
      event.preventDefault();
      ctx.studyContext = {};
      const query = prompt("Jump to verse (e.g., Genesis 1:1, John 3:16, or Psalm 23):");
      if (!query) return;

      // Parse verse reference like "Genesis 1:1" or "Gen 1:1" or "John 3:16"
      const match = query.trim().match(/^(.+?)\s+(\d+)(?::(\d+))?$/);
      if (!match) {
        alert(`Could not parse reference: ${query}`);
        return;
      }

      const [, bookName, chapter, verse = "1"] = match;

      if (!bookName || !chapter) return;

      // Find matching book
      const matchingBook = state.manifest?.books?.find(
        (book) =>
          book.name.toLowerCase().startsWith(bookName.toLowerCase()) ||
          book.id.toLowerCase().startsWith(bookName.toLowerCase())
      );

      if (!matchingBook) {
        alert(`Book not found: ${bookName}`);
        return;
      }

      void goToLocation(matchingBook.id, chapter, verse);
    }

    // Escape to close detail pane (on mobile)
    if (event.key === "Escape") {
      event.preventDefault();
      const detailPane = document.querySelector(".detail-pane");
      if (detailPane?.classList.contains("visible")) {
        detailPane.classList.remove("visible");
      } else {
        resetDetail();
        clearReaderHighlight();
      }
    }
  });

  // Interlinear hover interaction - link Bible words to detail panel tokens
  function setupInterlinearInteraction() {
    const detailPane = document.querySelector(".detail-pane");
    const detailContent = document.querySelector(".detail-content");

    const panelTokens = () => [...(detailPane?.querySelectorAll(".interlinear-token") || [])];
    const readerTokens = () => [...(els.content?.querySelectorAll(".strong-token") || [])];
    const clearPanelTokenHighlight = () => {
      panelTokens().forEach((token) => token.classList.remove("interlinear-hover"));
    };
    const findExactMatch = (nodes, source) => {
      const key = source?.dataset.interlinearKey;
      if (key) {
        const exact = nodes.find((node) => node.dataset.interlinearKey === key);
        if (exact) return exact;
      }
      const strongCode = source?.dataset.strongCode;
      if (!strongCode) return null;
      const candidates = nodes.filter((node) => node.dataset.strongCode === strongCode);
      return candidates.length === 1 ? candidates[0] : null;
    };

    els.content?.addEventListener("mouseover", (event) => {
      const readerToken = event.target.closest?.(".strong-token");
      if (!readerToken || readerToken.contains(event.relatedTarget)) return;
      const cards = panelTokens();
      if (!cards.length) return;
      const panelToken = findExactMatch(cards, readerToken);
      if (!panelToken) return;
      clearPanelTokenHighlight();
      panelToken.classList.add("interlinear-hover");
      highlightReaderContext({
        verse: readerToken.dataset.verse,
        wordElement: readerToken,
      });
    });

    els.content?.addEventListener("mouseout", (event) => {
      const readerToken = event.target.closest?.(".strong-token");
      if (!readerToken || readerToken.contains(event.relatedTarget)) return;
      clearPanelTokenHighlight();
      clearReaderHighlight();
    });

    detailContent?.addEventListener("mouseover", (event) => {
      const panelToken = event.target.closest?.(".interlinear-token");
      if (!panelToken || panelToken.contains(event.relatedTarget)) return;
      const readerToken = findExactMatch(readerTokens(), panelToken);
      clearPanelTokenHighlight();
      panelToken.classList.add("interlinear-hover");
      highlightReaderContext({
        verse: panelToken.dataset.verse,
        wordElement: readerToken,
      });
    });

    detailContent?.addEventListener("mouseout", (event) => {
      const panelToken = event.target.closest?.(".interlinear-token");
      if (!panelToken || panelToken.contains(event.relatedTarget)) return;
      clearPanelTokenHighlight();
      clearReaderHighlight();
    });
  }

  setupInterlinearInteraction();

  els.detail?.addEventListener("detail:restore", (event) => {
    restoreReaderHighlightFromContext(event.detail?.readerContext);
  });

  const handleRouteChange = () => {
    const route = parseReaderRoute();
    if (route.home) {
      showHomePage({ writeUrl: false });
      return;
    }
    void navigateToRoute(route, { writeUrl: false });
  };
  window.addEventListener("popstate", handleRouteChange);
  window.addEventListener("hashchange", handleRouteChange);
}

async function init() {
  await initStores(state);
  listenForUserDataChanges(state, () => {
    setStatus("User data changed in another tab");
  });
  bindEvents();
  try {
    state.manifest = await loadManifest();
    state.packageManifest = await fetch("./data/package-manifest.json").then((response) => {
      if (!response.ok) throw new Error("Package manifest could not be loaded.");
      return response.json();
    });
    await navigateToRoute(parseReaderRoute(), {
      replace: !window.location.hash,
      writeUrl: true,
    });
  } catch (error) {
    console.error(error);
    els.content.innerHTML = "";
    const node = document.createElement("div");
    node.className = "error-state";
    node.textContent = error instanceof Error ? error.message : "Unable to load reader data.";
    els.content.append(node);
    setStatus("Data load failed");
  }
}

init();
