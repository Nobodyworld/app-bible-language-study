import { createDetailList, setDetail } from "../dom.js?v=pr13-live-qa-20260711e";
import { referenceKey } from "../references.js";
import {
  createCustomTag,
  deleteCustomTag,
  getTagTargets,
  getTargetTags,
  getVerseTags,
  setTagAssertion,
  setVerseTag,
  updateCustomTag,
} from "../stores.js?v=pr13-live-qa-20260711e";
import { tagDefinitionId, targetId } from "../semantic-targets.js?v=pr13-live-qa-20260711e";
import { createVerseContextTabs } from "./verse-context-tabs.js?v=pr13-live-qa-20260711e";
import {
  activateOverlay,
  deactivateOverlay,
} from "../overlay-coordinator.js?v=pr13-live-qa-20260711e";
import {
  closeContainedDetailTool,
  openContainedDetailTool,
} from "../detail-tool-surface.js";

function tagIcon(tag) {
  return String(tag?.icon || tag?.label?.slice(0, 1) || "*").slice(0, 3);
}

function activeTagAssertions(state) {
  return Object.values(state.tagStore.tag_assertions || {})
    .filter((assertion) => assertion.active && assertion.target)
    .sort((a, b) => String(a.target_id).localeCompare(String(b.target_id)) || String(a.tag_id).localeCompare(String(b.tag_id)));
}

function runtimeTagDefinitionId(tag) {
  return tag?.tag_definition_id || tagDefinitionId(tag?.id);
}

function assertionTagDefinitionId(assertion) {
  return tagDefinitionId(assertion?.tag_id || assertion?.legacy_tag_id);
}

function assertionMatchesTag(tag, assertion) {
  return runtimeTagDefinitionId(tag) === assertionTagDefinitionId(assertion);
}

function tagForAssertion(state, assertion) {
  const definitionId = assertionTagDefinitionId(assertion);
  return (
    Object.values(state.tagStore.tags || {}).find((tag) => runtimeTagDefinitionId(tag) === definitionId) ||
    state.tagStore.tags[assertion?.legacy_tag_id] ||
    state.tagStore.tags[assertion?.tag_id] ||
    null
  );
}

function targetReferenceLabel(ctx, target) {
  const ref = target?.reference || {};
  const book = ctx.findBook(ref.book_id);
  let label = book?.name || ref.book_id || "Unknown reference";
  if (ref.chapter) label += ` ${ref.chapter}`;
  if (ref.verse_start) {
    label += `:${ref.verse_start}`;
    if (ref.verse_end > ref.verse_start) label += `-${ref.verse_end}`;
  }
  return label;
}

function targetPreview(ctx, target) {
  if (!target) return "";
  if (target.target_type === "text_span") return target.anchor?.text_snapshot || "Selected English text";
  if (target.target_type === "source_token") {
    const parts = [target.token?.original, target.token?.strong_code].filter(Boolean);
    return parts.length ? parts.join(" — ") : `Source token ${target.token?.token_index ?? ""}`.trim();
  }
  if (target.target_type === "source_token_span") {
    return (target.token_span?.source_snapshots || []).join(" ") || "Selected source-language phrase";
  }
  if (target.target_type === "verse" || target.target_type === "verse_range") {
    const ref = target.reference || {};
    const chapter = ctx.state.verseBook?.chapters?.[ref.chapter];
    const start = Number(ref.verse_start);
    const end = Number(ref.verse_end || ref.verse_start);
    if (!chapter?.[start]) return "";
    if (end > start) {
      return Array.from({ length: end - start + 1 }, (_, index) => chapter[start + index])
        .filter(Boolean)
        .join(" ");
    }
    return chapter[start] || "";
  }
  return "";
}

function targetTypeLabel(target) {
  const labels = {
    book: "Book",
    chapter: "Chapter",
    verse: "Verse",
    verse_range: "Verse range",
    text_span: "English phrase",
    source_token: "Source word",
    source_token_span: "Source phrase",
  };
  return labels[target?.target_type] || "Target";
}

function appendStudyMarkItem(ctx, li, assertions, options = {}) {
  const target = assertions[0]?.target;
  const top = document.createElement("div");
  top.className = "study-mark-item-top";
  const label = document.createElement("span");
  label.className = "study-mark-label";
  label.textContent = `${targetReferenceLabel(ctx, target)} · ${targetTypeLabel(target)}`;
  const ref = target?.reference || {};
  const actions = document.createElement("div");
  actions.className = "study-mark-actions";
  if (ref.book_id) {
    actions.append(
      ctx.createReferenceButton("Open", {
        book_id: ref.book_id,
        chapter: ref.chapter || 1,
        verse_start: ref.verse_start || null,
      }),
    );
  }
  if (target) {
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "mini-button";
    edit.textContent = "Edit tags";
    actions.append(
      ctx.detailViews.renderTargetTagPicker(target, {
        trigger: edit,
        align: "right",
        label: targetReferenceLabel(ctx, target),
        preview: targetPreview(ctx, target),
        onChange: () => {
          ctx.renderChapter?.();
          ctx.syncFavoriteButtons?.();
          options.onChange?.();
        },
      }),
    );
  }
  top.append(label, actions);
  li.className = "study-mark-item";
  li.append(top);

  const preview = targetPreview(ctx, target);
  if (preview) {
    const text = document.createElement("p");
    text.className = "study-mark-preview";
    text.textContent = preview;
    li.append(text);
  }

  const badges = target ? ctx.detailViews.renderTargetTagBadges(target, { includeFavorite: true }) : null;
  if (badges) li.append(badges);
}

function groupAssertionsByTarget(assertions) {
  const grouped = new Map();
  assertions.forEach((assertion) => {
    if (!assertion.target_id || !assertion.target) return;
    if (!grouped.has(assertion.target_id)) grouped.set(assertion.target_id, []);
    grouped.get(assertion.target_id).push(assertion);
  });
  return [...grouped.values()];
}

function targetSortValue(assertions) {
  const target = assertions[0]?.target || {};
  const ref = target.reference || {};
  const typeOrder = {
    book: 0,
    chapter: 1,
    verse: 2,
    verse_range: 3,
    text_span: 4,
    source_token: 5,
    source_token_span: 6,
  };
  return [
    String(ref.book_id || ""),
    Number(ref.chapter || 0),
    Number(ref.verse_start || 0),
    typeOrder[target.target_type] ?? 9,
    target.target_id || assertions[0]?.target_id || "",
  ];
}

function compareTargetGroups(a, b) {
  const left = targetSortValue(a);
  const right = targetSortValue(b);
  for (let index = 0; index < left.length; index += 1) {
    if (typeof left[index] === "number" && left[index] !== right[index]) return left[index] - right[index];
    const comparison = String(left[index]).localeCompare(String(right[index]));
    if (comparison) return comparison;
  }
  return 0;
}

function createStudyMarkList(ctx, groups, options = {}) {
  return createDetailList(
    groups.slice().sort(compareTargetGroups),
    (li, assertions) => appendStudyMarkItem(ctx, li, assertions, options),
  );
}

function createStudyDetails(className, label, count) {
  const details = document.createElement("details");
  details.className = className;
  details.open = true;
  const summary = document.createElement("summary");
  summary.textContent = `${label} (${count})`;
  details.append(summary);
  return details;
}

function createScriptureBuckets(ctx, assertions) {
  const books = new Map();
  const ensureBook = (ref) => {
    const bookId = ref.book_id || "unknown";
    if (!books.has(bookId)) {
      books.set(bookId, {
        id: bookId,
        label: ctx.findBook(bookId)?.name || bookId,
        targets: new Set(),
        bookTags: [],
        chapters: new Map(),
      });
    }
    return books.get(bookId);
  };
  const ensureChapter = (book, ref) => {
    const chapter = Number(ref.chapter || 0);
    if (!book.chapters.has(chapter)) {
      book.chapters.set(chapter, {
        number: chapter,
        targets: new Set(),
        chapterTags: [],
        verses: new Map(),
      });
    }
    return book.chapters.get(chapter);
  };
  const ensureVerse = (chapter, ref) => {
    const verse = Number(ref.verse_start || 0);
    if (!chapter.verses.has(verse)) {
      chapter.verses.set(verse, {
        number: verse,
        targets: new Set(),
        verseTags: [],
        textTags: [],
        sourceTags: [],
      });
    }
    return chapter.verses.get(verse);
  };

  groupAssertionsByTarget(assertions).forEach((group) => {
    const target = group[0]?.target;
    const ref = target?.reference || {};
    if (!ref.book_id) return;
    const book = ensureBook(ref);
    book.targets.add(target.target_id);

    if (target.target_type === "book") {
      book.bookTags.push(group);
      return;
    }

    const chapter = ensureChapter(book, ref);
    chapter.targets.add(target.target_id);
    if (target.target_type === "chapter") {
      chapter.chapterTags.push(group);
      return;
    }

    const verse = ensureVerse(chapter, ref);
    verse.targets.add(target.target_id);
    if (target.target_type === "verse" || target.target_type === "verse_range") {
      verse.verseTags.push(group);
      return;
    }
    if (target.target_type === "text_span") {
      verse.textTags.push(group);
      return;
    }
    if (target.target_type === "source_token" || target.target_type === "source_token_span") {
      verse.sourceTags.push(group);
    }
  });

  books.forEach((book) => {
    book.chapters.forEach((chapter) => {
      chapter.verses.forEach((verse) => {
        verse.targets.forEach((id) => {
          chapter.targets.add(id);
          book.targets.add(id);
        });
      });
      chapter.targets.forEach((id) => book.targets.add(id));
    });
  });
  return books;
}

function appendStudyCategory(ctx, parent, label, groups, options = {}) {
  if (!groups.length) return;
  const heading = document.createElement("h6");
  heading.textContent = `${label} (${groups.length})`;
  parent.append(heading, createStudyMarkList(ctx, groups, options));
}

function appendStudyMarksByScripture(ctx, wrap, assertions, options = {}) {
  const section = document.createElement("section");
  section.className = "study-scripture-index";
  const title = document.createElement("h4");
  title.textContent = "Study Marks by Scripture";
  section.append(title);

  if (!assertions.length) {
    const empty = document.createElement("p");
    empty.textContent = "No study marks yet. Mark a book, chapter, verse, selected phrase, or source word from the reader.";
    section.append(empty);
    wrap.append(section);
    return;
  }

  const books = [...createScriptureBuckets(ctx, assertions).values()].sort((a, b) => a.label.localeCompare(b.label));
  books.forEach((book) => {
    const bookDetails = createStudyDetails("study-scripture-book", book.label, book.targets.size);
    appendStudyCategory(ctx, bookDetails, "Book tags", book.bookTags, options);

    [...book.chapters.values()]
      .sort((a, b) => a.number - b.number)
      .forEach((chapter) => {
        const chapterDetails = createStudyDetails(
          "study-scripture-chapter",
          chapter.number ? `${book.label} ${chapter.number}` : `${book.label} chapter`,
          chapter.targets.size,
        );
        appendStudyCategory(ctx, chapterDetails, "Book/chapter tags", chapter.chapterTags, options);
        [...chapter.verses.values()]
          .sort((a, b) => a.number - b.number)
          .forEach((verse) => {
            const verseDetails = createStudyDetails(
              "study-scripture-verse",
              verse.number ? `${book.label} ${chapter.number}:${verse.number}` : `${book.label} ${chapter.number}`,
              verse.targets.size,
            );
            appendStudyCategory(ctx, verseDetails, "Verse tags", verse.verseTags, options);
            appendStudyCategory(ctx, verseDetails, "English word/phrase tags", verse.textTags, options);
            appendStudyCategory(ctx, verseDetails, "Source-word tags", verse.sourceTags, options);
            chapterDetails.append(verseDetails);
          });
        bookDetails.append(chapterDetails);
      });
    section.append(bookDetails);
  });

  wrap.append(section);
}

export function createTagsView(ctx) {
  let activeTargetTagMenu = null;
  let targetTagMenuCloseTimer = null;
  let targetTagMenuDismissalBound = false;

  function availableTagsForTarget(target) {
    return Object.values(ctx.state.tagStore.tags || {})
      .filter(
        (tag) =>
          tag.status !== "retired" &&
          Array.isArray(tag.allowed_target_types) &&
          tag.allowed_target_types.includes(target?.target_type),
      )
      .sort((a, b) => {
        if (a.id === "favorite") return -1;
        if (b.id === "favorite") return 1;
        return String(a.label || a.id).localeCompare(String(b.label || b.id));
      });
  }

  function setTargetTagMenuExpanded(menu, expanded) {
    menu.querySelectorAll(".target-tag-picker-trigger").forEach((trigger) => {
      trigger.setAttribute("aria-expanded", expanded ? "true" : "false");
    });
  }

  function cancelTargetTagMenuClose() {
    if (!targetTagMenuCloseTimer) return;
    window.clearTimeout(targetTagMenuCloseTimer);
    targetTagMenuCloseTimer = null;
  }

  // A tag toggle can rerender its owner synchronously. Do not let the
  // document-level dismissal handlers retain that detached menu or attempt to
  // restore focus to its equally detached trigger on a later Escape.
  function currentTargetTagMenu() {
    if (activeTargetTagMenu?.isConnected) return activeTargetTagMenu;
    deactivateOverlay(activeTargetTagMenu?.__overlayOwner);
    activeTargetTagMenu = null;
    return null;
  }

  function positionTargetTagMenu(menu) {
    if (!menu || menu.dataset.menuBoundary !== "detail-pane") return;
    const popover = menu.querySelector(".target-tag-picker-popover");
    const pane = menu.closest(".detail-pane");
    const trigger = menu.__targetTagTrigger || menu.querySelector(".target-tag-picker-trigger, .tag-picker-trigger");
    if (!popover || !pane || !trigger) return;

    const paneRect = pane.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const inset = 8;
    const minLeft = Math.max(inset, paneRect.left + inset);
    const maxRight = Math.min(viewportWidth - inset, paneRect.right - inset);
    if (maxRight <= minLeft) return;

    const width = Math.max(1, Math.min(230, Math.floor(maxRight - minLeft)));
    const left = Math.max(minLeft, Math.min(triggerRect.right - width, maxRight - width));
    popover.style.left = `${Math.round(left - menuRect.left)}px`;
    popover.style.right = "auto";
    popover.style.width = `${width}px`;
    popover.style.maxWidth = `${width}px`;
    popover.style.boxSizing = "border-box";

    const minTop = Math.max(inset, paneRect.top + inset);
    const maxBottom = Math.min(viewportHeight - inset, paneRect.bottom - inset);
    const spaceBelow = Math.max(0, maxBottom - triggerRect.bottom);
    const spaceAbove = Math.max(0, triggerRect.top - minTop);
    const requestedHeight = Math.min(260, Math.max(1, popover.scrollHeight));
    const placeBelow = spaceBelow >= requestedHeight || spaceBelow >= spaceAbove;
    const availableHeight = placeBelow ? spaceBelow : spaceAbove;
    const height = Math.max(1, Math.floor(Math.min(260, availableHeight)));
    const top = placeBelow
      ? triggerRect.bottom - menuRect.top
      : triggerRect.top - menuRect.top - height;
    popover.style.top = `${Math.round(top)}px`;
    popover.style.maxHeight = `${height}px`;
    popover.dataset.menuPlacement = placeBelow ? "below" : "above";
  }

  function closeTargetTagMenu(menu = activeTargetTagMenu, { restoreFocus = false } = {}) {
    if (!menu) return;
    cancelTargetTagMenuClose();
    if (activeTargetTagMenu === menu) activeTargetTagMenu = null;
    deactivateOverlay(menu.__overlayOwner);
    if (!menu.isConnected) return;
    delete menu.dataset.openedFromFocus;
    delete menu.__targetTagPointerStartedFocused;
    delete menu.__targetTagOpenedFromPointer;
    menu.dataset.menuClosed = "true";
    delete menu.dataset.menuOpen;
    setTargetTagMenuExpanded(menu, false);
    if (restoreFocus) {
      const trigger = menu.__targetTagTrigger || menu.querySelector(".target-tag-picker-trigger, .tag-picker-trigger");
      if (!trigger?.isConnected) return;
      menu.dataset.restoringFocus = "true";
      trigger.focus({ preventScroll: true });
      window.setTimeout(() => delete menu.dataset.restoringFocus, 0);
    }
  }

  function openTargetTagMenu(menu) {
    if (!menu) return;
    cancelTargetTagMenuClose();
    const openMenu = currentTargetTagMenu();
    if (openMenu && openMenu !== menu) closeTargetTagMenu(openMenu);
    activeTargetTagMenu = menu;
    delete menu.dataset.menuClosed;
    menu.dataset.menuOpen = "true";
    setTargetTagMenuExpanded(menu, true);
    activateOverlay(menu.__overlayOwner);
    positionTargetTagMenu(menu);
  }

  function scheduleTargetTagMenuClose(menu) {
    cancelTargetTagMenuClose();
    targetTagMenuCloseTimer = window.setTimeout(() => {
      targetTagMenuCloseTimer = null;
      if (menu.matches(":hover") || menu.contains(document.activeElement)) return;
      closeTargetTagMenu(menu);
    }, 160);
  }

  function ensureTargetTagMenuDismissal() {
    if (targetTagMenuDismissalBound) return;
    targetTagMenuDismissalBound = true;
    document.addEventListener("pointerdown", (event) => {
      const menu = currentTargetTagMenu();
      if (!menu || menu.contains(event.target)) return;
      closeTargetTagMenu(menu);
    });
    window.addEventListener("resize", () => positionTargetTagMenu(currentTargetTagMenu()));
  }

  function wireTargetTagMenu(menu) {
    ensureTargetTagMenuDismissal();
    menu.__overlayOwner = {
      document,
      isConnected: () => menu.isConnected && menu.dataset.menuOpen === "true",
      close: (options) => closeTargetTagMenu(menu, options),
    };
    menu.addEventListener("pointerenter", () => {
      if (menu.dataset.openOnFocus === "false" && menu.dataset.menuOpen !== "true") {
        menu.__targetTagOpenedFromPointer = true;
      }
      openTargetTagMenu(menu);
    });
    menu.addEventListener("pointerleave", () => scheduleTargetTagMenuClose(menu));
    menu.addEventListener("focusin", () => {
      if (menu.dataset.restoringFocus === "true") return;
      if (
        menu.dataset.openOnFocus === "false" &&
        document.activeElement === menu.__targetTagTrigger
      ) return;
      if (menu.dataset.menuOpen !== "true") menu.dataset.openedFromFocus = "true";
      openTargetTagMenu(menu);
    });
    menu.addEventListener("focusout", (event) => {
      if (menu.contains(event.relatedTarget)) return;
      scheduleTargetTagMenuClose(menu);
    });
  }

  function createFavoriteButton(target, options = {}) {
    const id = targetId(target);
    let active = id ? getTagTargets(ctx.state, "favorite").includes(id) : false;
    const button = document.createElement("button");
    button.type = "button";
    const updateState = () => {
      button.className = [options.className || "favorite-button", active ? "active" : ""].filter(Boolean).join(" ");
      button.textContent = options.showLabel ? `${active ? "★" : "☆"} Favorite` : active ? "★" : "☆";
      button.title = `${active ? "Remove" : "Add"} ${options.label || "target"} ${active ? "from" : "to"} favorites`;
      button.setAttribute("aria-label", button.title);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    };
    button.refreshFavoriteState = () => {
      active = id ? getTagTargets(ctx.state, "favorite").includes(id) : false;
      updateState();
    };
    updateState();
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const assertion = setTagAssertion(ctx.state, target, "favorite", !active);
      active = Boolean(assertion?.active);
      updateState();
      options.onChange?.(assertion);
    });
    return button;
  }

  function showTargetTagEditor(target, options = {}) {
    const wrap = document.createElement("div");
    wrap.className = "target-tag-editor";
    const heading = document.createElement("h3");
    heading.textContent = options.label || "Target tags";
    wrap.append(heading);
    if (options.preview) {
      const preview = document.createElement("p");
      preview.className = "target-tag-preview";
      preview.textContent = options.preview;
      wrap.append(preview);
    }

    const activeTags = new Set(getTargetTags(ctx.state, target));
    const group = document.createElement("div");
    group.className = "tag-editor";
    Object.values(ctx.state.tagStore.tags)
      .filter(
        (tag) =>
          tag.status !== "retired" &&
          Array.isArray(tag.allowed_target_types) &&
          tag.allowed_target_types.includes(target.target_type),
      )
      .forEach((tag) => {
        const active = activeTags.has(tag.id);
        const button = document.createElement("button");
        button.type = "button";
        button.className = active ? "tag-editor-toggle active" : "tag-editor-toggle";
        button.style.setProperty("--tag-color", tag.color || "#696f78");
        button.setAttribute("aria-pressed", active ? "true" : "false");
        button.setAttribute("aria-label", `${active ? "Remove" : "Add"} ${tag.label} tag`);
        button.addEventListener("click", () => {
          setTagAssertion(ctx.state, target, tag.id, !active);
          options.onChange?.();
          showTargetTagEditor(target, { ...options, history: "replace", lock: true });
        });
        const icon = document.createElement("span");
        icon.className = "tag-picker-icon";
        icon.textContent = tagIcon(tag);
        const text = document.createElement("span");
        text.textContent = tag.label;
        button.append(icon, text);
        group.append(button);
      });
    wrap.append(group);
    setDetail("Tags", wrap, options);
    if (options.focusOnOpen) {
      queueMicrotask(() => {
        if (!wrap.isConnected) return;
        wrap.querySelector(".tag-editor-toggle")?.focus({ preventScroll: true });
      });
    }
  }

  function createTargetTagPickerPopover(target, options = {}) {
    const wrap = document.createElement("div");
    wrap.className = options.presentation === "detail-pane"
      ? "contained-target-tag-picker"
      : "tag-picker-popover target-tag-picker-popover";
    wrap.addEventListener("click", (event) => event.stopPropagation());

    const title = document.createElement("div");
    title.className = "tag-picker-title";
    title.textContent = options.title || options.label || "Target tags";
    wrap.append(title);

    if (options.preview) {
      const preview = document.createElement("p");
      preview.className = "target-tag-picker-preview";
      preview.textContent = options.preview;
      wrap.append(preview);
    }

    const activeTags = new Set(getTargetTags(ctx.state, target));
    const tags = availableTagsForTarget(target);
    if (!tags.length) {
      const empty = document.createElement("p");
      empty.className = "tag-picker-empty";
      empty.textContent = "No tags are available for this target.";
      wrap.append(empty);
    }

    tags.forEach((tag) => {
      let active = activeTags.has(tag.id);
      const button = document.createElement("button");
      button.type = "button";
      button.className = active ? "tag-picker-option active" : "tag-picker-option";
      button.style.setProperty("--tag-color", tag.color || "#696f78");
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.setAttribute("aria-label", `${active ? "Remove" : "Add"} ${tag.label} tag`);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const assertion = setTagAssertion(ctx.state, target, tag.id, !active);
        active = Boolean(assertion?.active);
        button.className = active ? "tag-picker-option active" : "tag-picker-option";
        button.setAttribute("aria-pressed", active ? "true" : "false");
        button.setAttribute("aria-label", `${active ? "Remove" : "Add"} ${tag.label} tag`);
        if (active) activeTags.add(tag.id);
        else activeTags.delete(tag.id);
        if (options.onChange) options.onChange(assertion);
        else ctx.renderChapter?.();
      });
      const icon = document.createElement("span");
      icon.className = "tag-picker-icon";
      icon.textContent = tagIcon(tag);
      const text = document.createElement("span");
      text.textContent = tag.label;
      button.append(icon, text);
      wrap.append(button);
    });

    const manage = document.createElement("button");
    manage.type = "button";
    manage.className = "tag-picker-manage";
    manage.textContent = options.manageLabel || "Manage tags";
    manage.addEventListener("click", (event) => {
      event.stopPropagation();
      if (options.presentation === "detail-pane") {
        closeContainedDetailTool({ restoreFocus: false, reason: "manage-tags" });
      } else {
        closeTargetTagMenu(manage.closest(".target-tag-picker-menu"));
      }
      showTargetTagEditor(target, {
        label: options.label,
        preview: options.preview,
        forceHistory: true,
        focusOnOpen: true,
        lock: true,
        onChange: options.onChange,
      });
    });
    wrap.append(manage);
    return wrap;
  }

  function renderTargetTagPicker(target, options = {}) {
    const menu = document.createElement("div");
    menu.className = ["target-tag-picker-menu", "tag-picker-menu-wrap", options.className || ""]
      .filter(Boolean)
      .join(" ");
    if (options.align === "right") menu.dataset.menuAlign = "right";
    if (options.boundary === "detail-pane") menu.dataset.menuBoundary = "detail-pane";
    if (options.openOnFocus === false) menu.dataset.openOnFocus = "false";

    const trigger = options.trigger || document.createElement("button");
    if (trigger.tagName === "BUTTON") trigger.type = "button";
    trigger.classList.add("target-tag-picker-trigger");
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    if (!trigger.getAttribute("aria-label")) {
      trigger.setAttribute("aria-label", `${options.label || "Target"} tags`);
    }
    const rememberPointerFocus = () => {
      if (typeof menu.__targetTagPointerStartedFocused !== "undefined") return;
      menu.__targetTagPointerStartedFocused = document.activeElement === trigger;
    };
    trigger.addEventListener("pointerdown", rememberPointerFocus);
    trigger.addEventListener("touchstart", rememberPointerFocus, { passive: true });
    trigger.addEventListener("mousedown", rememberPointerFocus);
    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!window.matchMedia("(hover: hover)").matches) {
        openTargetTagMenu(menu);
        return;
      }
      const keepFocusOpenedMenu =
        event.detail > 0 &&
        menu.dataset.openedFromFocus === "true" &&
        menu.__targetTagPointerStartedFocused === false;
      const keepPointerOpenedMenu =
        event.detail > 0 &&
        menu.dataset.openOnFocus === "false" &&
        menu.__targetTagOpenedFromPointer === true;
      delete menu.__targetTagPointerStartedFocused;
      delete menu.__targetTagOpenedFromPointer;
      delete menu.dataset.openedFromFocus;
      if (keepFocusOpenedMenu || keepPointerOpenedMenu) return;
      if (menu.dataset.menuOpen === "true") closeTargetTagMenu(menu);
      else openTargetTagMenu(menu);
    });

    menu.__targetTagTrigger = trigger;

    menu.append(trigger, createTargetTagPickerPopover(target, options));
    wireTargetTagMenu(menu);
    return menu;
  }

  // The symbol lives here, beside the canonical picker, so every compact mark
  // control shares one replaceable representation rather than ad-hoc glyphs.
  function createStudyMarksIcon() {
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("focusable", "false");
    icon.classList.add("study-marks-icon");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#study-marks-icon");
    icon.append(use);
    return icon;
  }

  function renderStudyMarksTrigger(target, options = {}) {
    const trigger = document.createElement("button");
    trigger.type = "button";
    if (options.id) trigger.id = options.id;
    trigger.className = ["study-marks-trigger", options.className || ""].filter(Boolean).join(" ");
    const label = options.label || targetTypeLabel(target);
    if (options.visibleLabel) {
      const visibleLabel = document.createElement("span");
      visibleLabel.className = "study-marks-trigger-label";
      visibleLabel.textContent = options.visibleLabel;
      trigger.append(visibleLabel);
    }
    trigger.append(createStudyMarksIcon());
    const syncTriggerState = () => {
      const activeCount = getTargetTags(ctx.state, target).length;
      let indicator = trigger.querySelector(".study-marks-count");
      if (activeCount && !indicator) {
        indicator = document.createElement("span");
        indicator.className = "study-marks-count";
        indicator.setAttribute("aria-hidden", "true");
        trigger.append(indicator);
      }
      if (indicator) {
        if (activeCount) indicator.textContent = activeCount > 9 ? "9+" : String(activeCount);
        else indicator.remove();
      }
      trigger.setAttribute(
        "aria-label",
        options.boundary === "detail-pane"
          ? `Study Marks for ${label}. ${activeCount ? `${activeCount} selected.` : "None selected."}`
          : `Study Marks for ${label}`,
      );
    };
    syncTriggerState();
    trigger.title = `Study Marks for ${label}`;

    if (options.boundary === "detail-pane") {
      const canonicalTargetId = targetId(target);
      trigger.dataset.studyMarksTargetId = canonicalTargetId;
      trigger.setAttribute("aria-haspopup", "dialog");
      trigger.setAttribute("aria-expanded", "false");
      trigger.setAttribute("aria-controls", "detailToolSurface");
      trigger.addEventListener("click", (event) => {
        event.stopPropagation();
        const focusRegion = trigger.closest("#detailContext") ? "context" : "content";
        trigger.dataset.studyMarksFocusRegion = focusRegion;
        const preview = options.preview || targetPreview(ctx, target);
        const content = createTargetTagPickerPopover(target, {
          ...options,
          presentation: "detail-pane",
          preview,
          onChange: (assertion) => {
            syncTriggerState();
            options.onChange?.(assertion);
          },
        });
        openContainedDetailTool({
          kind: "study-marks",
          title: "Study Marks",
          targetId: canonicalTargetId,
          content,
          trigger,
          initialFocus: ".tag-picker-option, .tag-picker-manage",
          resolveTrigger: () => {
            const matches = [...document.querySelectorAll("[data-study-marks-target-id]")]
              .filter((node) => node.dataset.studyMarksTargetId === canonicalTargetId && node.isConnected);
            return matches.find((node) => (
              Boolean(node.closest("#detailContext")) === (focusRegion === "context")
            )) || matches[0] || null;
          },
          focusFallback: () => document.querySelector("#clearDetail"),
        });
      });
      return trigger;
    }

    trigger.setAttribute("aria-pressed", String(getTargetTags(ctx.state, target).includes("favorite")));
    return renderTargetTagPicker(target, { ...options, trigger, className: "study-marks-menu" });
  }

  function renderTargetTagBadges(target, options = {}) {
    const tagIds = getTargetTags(ctx.state, target).filter(
      (tagId) => options.includeFavorite || tagId !== "favorite",
    );
    if (!tagIds.length) return null;

    const wrap = document.createElement(options.interactive ? "button" : "div");
    if (options.interactive) wrap.type = "button";
    wrap.className = ["target-tag-badges", options.compact ? "compact" : "", options.interactive ? "interactive" : ""]
      .filter(Boolean)
      .join(" ");
    wrap.title = tagIds
      .map((tagId) => ctx.state.tagStore.tags[tagId]?.label)
      .filter(Boolean)
      .join(", ");
    if (options.interactive) {
      wrap.setAttribute("aria-label", `${options.label || "Tagged target"}: edit tags`);
    }

    tagIds.forEach((tagId) => {
      const tag = ctx.state.tagStore.tags[tagId];
      if (!tag) return;
      const badge = document.createElement("span");
      badge.className = "target-tag-badge";
      badge.style.setProperty("--tag-color", tag.color || "#696f78");
      badge.title = [tag.label, tag.description].filter(Boolean).join(" - ");
      const icon = document.createElement("span");
      icon.className = "tag-badge-icon";
      icon.textContent = tagIcon(tag);
      const label = document.createElement("span");
      label.className = "target-tag-badge-label";
      label.textContent = tag.label;
      badge.append(icon, label);
      wrap.append(badge);
    });
    if (!wrap.childElementCount) return null;
    if (!options.interactive) {
      wrap.className = ["target-tag-badges", options.className || "", options.compact ? "compact" : ""]
        .filter(Boolean)
        .join(" ");
      return wrap;
    }
    return renderTargetTagPicker(target, {
      ...options,
      trigger: wrap,
      className: ["target-tag-badge-menu", options.className || ""].filter(Boolean).join(" "),
    });
  }

  function renderTagBadges(key) {
    const tagIds = getVerseTags(ctx.state, key);
    if (!tagIds.length) return null;
    const wrap = document.createElement("div");
    wrap.className = "tag-badges";
    tagIds.forEach((tagId) => {
      const tag = ctx.state.tagStore.tags[tagId];
      if (!tag) return;
      const badge = document.createElement("span");
      badge.className = "tag-badge";
      badge.style.setProperty("--tag-color", tag.color || "#696f78");
      badge.title = [tag.label, tag.description].filter(Boolean).join(" - ");
      const icon = document.createElement("span");
      icon.className = "tag-badge-icon";
      icon.textContent = tagIcon(tag);
      const label = document.createElement("span");
      label.className = "tag-badge-label";
      label.textContent = tag.label;
      badge.append(icon, label);
      wrap.append(badge);
    });
    return wrap;
  }

  function renderInlineTagPicker(key) {
    const wrap = document.createElement("div");
    wrap.className = "tag-picker-popover";
    wrap.addEventListener("click", (event) => event.stopPropagation());

    const title = document.createElement("div");
    title.className = "tag-picker-title";
    title.textContent = "Verse tags";
    wrap.append(title);

    Object.values(ctx.state.tagStore.tags).filter((tag) => tag.status !== "retired").forEach((tag) => {
      const active = getVerseTags(ctx.state, key).includes(tag.id);
      const button = document.createElement("button");
      button.type = "button";
      button.className = active ? "tag-picker-option active" : "tag-picker-option";
      button.style.setProperty("--tag-color", tag.color || "#696f78");
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.addEventListener("click", () => {
        setVerseTag(ctx.state, key, tag.id, !active);
        ctx.renderChapter();
      });
      const icon = document.createElement("span");
      icon.className = "tag-picker-icon";
      icon.textContent = tagIcon(tag);
      const text = document.createElement("span");
      text.textContent = tag.label;
      button.append(icon, text);
      wrap.append(button);
    });

    return wrap;
  }

  function showTagEditor(reference, verse, verseText, options = {}) {
    const key = referenceKey(ctx.state.bookId, ctx.state.chapter, verse);
    const wrap = document.createElement("div");
    const heading = document.createElement("h3");
    heading.textContent = reference;
    const body = document.createElement("p");
    body.textContent = verseText;
    wrap.append(heading, createVerseContextTabs(ctx, reference, verse, "tags", ctx.getActiveWordContext?.(verse)), body);

    const group = document.createElement("div");
    group.className = "tag-editor";
    Object.values(ctx.state.tagStore.tags).filter((tag) => tag.status !== "retired").forEach((tag) => {
      const active = getVerseTags(ctx.state, key).includes(tag.id);
      const button = document.createElement("button");
      button.type = "button";
      button.className = active ? "tag-editor-toggle active" : "tag-editor-toggle";
      button.style.setProperty("--tag-color", tag.color || "#696f78");
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.addEventListener("click", () => {
        setVerseTag(ctx.state, key, tag.id, !active);
        ctx.renderChapter();
        showTagEditor(reference, verse, verseText, { history: "replace", lock: true });
      });
      const icon = document.createElement("span");
      icon.className = "tag-picker-icon";
      icon.textContent = tagIcon(tag);
      const text = document.createElement("span");
      text.textContent = tag.label;
      button.append(icon, text);
      group.append(button);
    });
    wrap.append(group);
    setDetail("Tags", wrap, options);
  }

  function createCustomTagForm(onCreate) {
    const form = document.createElement("form");
    form.className = "custom-tag-form";

    const labelField = document.createElement("label");
    const labelText = document.createElement("span");
    labelText.textContent = "Label";
    const labelInput = document.createElement("input");
    labelInput.name = "label";
    labelInput.required = true;
    labelInput.maxLength = 48;
    labelInput.placeholder = "Memorize";
    labelField.append(labelText, labelInput);

    const colorField = document.createElement("label");
    const colorText = document.createElement("span");
    colorText.textContent = "Color";
    const colorInput = document.createElement("input");
    colorInput.name = "color";
    colorInput.type = "color";
    colorInput.value = "#4f6f91";
    colorField.append(colorText, colorInput);

    const iconField = document.createElement("label");
    const iconText = document.createElement("span");
    iconText.textContent = "Icon";
    const iconInput = document.createElement("input");
    iconInput.name = "icon";
    iconInput.maxLength = 3;
    iconInput.value = "*";
    iconInput.placeholder = "*";
    iconField.append(iconText, iconInput);

    const descriptionField = document.createElement("label");
    const descriptionText = document.createElement("span");
    descriptionText.textContent = "Description";
    const descriptionInput = document.createElement("input");
    descriptionInput.name = "description";
    descriptionInput.maxLength = 120;
    descriptionInput.placeholder = "Optional";
    descriptionField.append(descriptionText, descriptionInput);

    const actions = document.createElement("div");
    actions.className = "custom-tag-actions";
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "mini-button";
    submit.textContent = "Add Label";
    actions.append(submit);

    form.append(labelField, colorField, iconField, descriptionField, actions);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const tag = createCustomTag(ctx.state, {
        label: labelInput.value,
        color: colorInput.value,
        icon: iconInput.value,
        description: descriptionInput.value,
      });
      if (!tag) return;
      onCreate(tag);
    });
    return form;
  }

  function createTagManagerItem(tag, assertions) {
    const count = assertions.length;
    if (!tag.custom) {
      const item = document.createElement("span");
      item.className = "tag-manager-item";
      item.style.setProperty("--tag-color", tag.color || "#696f78");
      item.textContent = `${tagIcon(tag)} ${tag.label} (${count})`;
      if (tag.description) item.title = tag.description;
      return item;
    }

    const form = document.createElement("form");
    form.className = "tag-manager-item custom-tag-edit-form";
    form.dataset.tagId = tag.id;
    form.dataset.revision = String(tag.revision || 1);
    form.style.setProperty("--tag-color", tag.color || "#696f78");

    const colorInput = document.createElement("input");
    colorInput.name = "edit-color";
    colorInput.type = "color";
    colorInput.value = tag.color || "#4f6f91";
    colorInput.title = "Tag color";

    const labelInput = document.createElement("input");
    labelInput.name = "edit-label";
    labelInput.required = true;
    labelInput.maxLength = 48;
    labelInput.value = tag.label;

    const iconInput = document.createElement("input");
    iconInput.name = "edit-icon";
    iconInput.maxLength = 3;
    iconInput.value = tagIcon(tag);
    iconInput.title = "Tag icon";

    const descriptionInput = document.createElement("input");
    descriptionInput.name = "edit-description";
    descriptionInput.maxLength = 120;
    descriptionInput.value = tag.description || "";
    descriptionInput.placeholder = "Description";

    const countLabel = document.createElement("span");
    countLabel.className = "tag-manager-count";
    countLabel.textContent = `${tag.label} (${count})`;

    const conflict = document.createElement("span");
    conflict.className = "import-status error";
    conflict.hidden = true;

    const actions = document.createElement("span");
    actions.className = "tag-manager-actions";

    const save = document.createElement("button");
    save.type = "submit";
    save.className = "mini-button";
    save.textContent = "Save";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "mini-button danger-button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      if (remove.dataset.confirm === "true") {
        deleteCustomTag(ctx.state, tag.id);
        ctx.renderChapter();
        showTagIndex();
        return;
      }
      remove.dataset.confirm = "true";
      remove.textContent = "Confirm";
      window.setTimeout(() => {
        if (!remove.isConnected || remove.dataset.confirm !== "true") return;
        remove.dataset.confirm = "false";
        remove.textContent = "Remove";
      }, 3500);
    });

    actions.append(save, remove);
    form.append(colorInput, iconInput, labelInput, descriptionInput, countLabel, conflict, actions);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const updated = updateCustomTag(ctx.state, tag.id, {
        label: labelInput.value,
        color: colorInput.value,
        icon: iconInput.value,
        description: descriptionInput.value,
      }, {
        expected_revision: Number(form.dataset.revision || 1),
      });
      if (updated?.conflict) {
        conflict.hidden = false;
        conflict.textContent = "This tag changed in another tab. Reopen Tags before saving.";
        return;
      }
      if (!updated) return;
      ctx.renderChapter();
      showTagIndex();
    });
    return form;
  }

  function appendAllMarkedItems(wrap, assertions) {
    const section = document.createElement("section");
    section.className = "study-mark-section";
    const title = document.createElement("h4");
    title.textContent = `All marked items (${assertions.length})`;
    section.append(title);
    if (!assertions.length) {
      const empty = document.createElement("p");
      empty.textContent = "No study marks yet. Mark a book, chapter, verse, selected phrase, or source word from the reader.";
      section.append(empty);
      wrap.append(section);
      return;
    }

    const labels = {
      book: "Books",
      chapter: "Chapters",
      verse: "Verses",
      verse_range: "Verse ranges",
      text_span: "English words and phrases",
      source_token: "Source words",
      source_token_span: "Source-word chunks",
    };
    Object.entries(labels).forEach(([type, groupLabel]) => {
      const groupedByTarget = new Map();
      assertions
        .filter((assertion) => assertion.target?.target_type === type)
        .forEach((assertion) => {
          const key = assertion.target_id;
          if (!groupedByTarget.has(key)) groupedByTarget.set(key, []);
          groupedByTarget.get(key).push(assertion);
        });
      if (!groupedByTarget.size) return;
      const groupTitle = document.createElement("h5");
      groupTitle.textContent = `${groupLabel} (${groupedByTarget.size})`;
      section.append(groupTitle);
      section.append(createStudyMarkList(ctx, [...groupedByTarget.values()], { onChange: showTagIndex }));
    });
    wrap.append(section);
  }

  function showTagIndex() {
    const wrap = document.createElement("div");
    const heading = document.createElement("h3");
    heading.textContent = "Study Marks";
    const intro = document.createElement("p");
    intro.className = "study-mark-intro";
    intro.textContent = "Review favorites, labels, questions, memorization marks, word studies, and marked passages stored in this browser.";
    const favoritesButton = document.createElement("button");
    favoritesButton.type = "button";
    favoritesButton.className = "mini-button";
    favoritesButton.textContent = `Favorites (${getTagTargets(ctx.state, "favorite").length})`;
    favoritesButton.addEventListener("click", showFavorites);
    wrap.append(heading, intro, favoritesButton);

    const assertions = activeTagAssertions(ctx.state);
    appendStudyMarksByScripture(ctx, wrap, assertions, { onChange: showTagIndex });
    appendAllMarkedItems(wrap, assertions);

    const manage = document.createElement("details");
    manage.className = "manage-labels-panel";
    const manageSummary = document.createElement("summary");
    manageSummary.textContent = "Manage labels";
    manage.append(manageSummary);

    const createTitle = document.createElement("h4");
    createTitle.textContent = "Create Label";
    manage.append(createTitle, createCustomTagForm(() => showTagIndex()));

    const tags = Object.values(ctx.state.tagStore.tags).filter((tag) => tag.status !== "retired");
    const availableTitle = document.createElement("h4");
    availableTitle.textContent = "Available Labels";
    const available = document.createElement("div");
    available.className = "tag-manager-list";
    tags.forEach((tag) => {
      available.append(createTagManagerItem(tag, assertions.filter((assertion) => assertionMatchesTag(tag, assertion))));
    });
    manage.append(availableTitle, available);
    wrap.append(manage);

    setDetail("Study Marks", wrap);
  }

  function showFavorites() {
    const wrap = document.createElement("div");
    const heading = document.createElement("h3");
    heading.textContent = "Favorites";
    wrap.append(heading);

    const assertions = activeTagAssertions(ctx.state)
      .filter((assertion) => assertion.tag_id === "tag:favorite");
    if (!assertions.length) {
      const empty = document.createElement("p");
      empty.textContent = "No favorites yet. Use a star beside a book, chapter, verse, selected phrase, or source word.";
      wrap.append(empty);
      setDetail("Favorites", wrap);
      return;
    }

    const labels = {
      book: "Books",
      chapter: "Chapters",
      verse: "Verses",
      verse_range: "Verse ranges",
      text_span: "English words and phrases",
      source_token: "Source words",
      source_token_span: "Source-word chunks",
    };
    Object.entries(labels).forEach(([type, groupLabel]) => {
      const matching = assertions.filter((assertion) => assertion.target?.target_type === type);
      if (!matching.length) return;
      const title = document.createElement("h4");
      title.textContent = `${groupLabel} (${matching.length})`;
      wrap.append(title);
      wrap.append(createStudyMarkList(ctx, matching.map((assertion) => [assertion]), { onChange: showFavorites }));
    });
    setDetail("Favorites", wrap);
  }

  return {
    createFavoriteButton,
    createStudyMarksIcon,
    renderInlineTagPicker,
    renderTagBadges,
    renderTargetTagPicker,
    renderStudyMarksTrigger,
    renderTargetTagBadges,
    showFavorites,
    showTargetTagEditor,
    showTagEditor,
    showTagIndex,
  };
}
