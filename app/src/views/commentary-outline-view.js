import { fetchCommentaryAggregate, fetchCommentarySource } from "../data-service.js";
import { createDetailList, setDetail, setDetailMessage } from "../dom.js?v=pr13-live-qa-20260711e";
import { capabilityMessage } from "../capabilities.js";
import { makeInternalLinksNavigable } from "../references.js";
import { createStudyEmptyState } from "../study-empty-state.js";
import { setSanitizedCommentaryHtml } from "../sanitize-commentary.js?v=pr13-live-qa-20260711e";
import { createVerseContextTabs } from "./verse-context-tabs.js?v=pr13-live-qa-20260711e";

export function createCommentaryOutlineViews(ctx) {
  async function loadCommentaryAggregate() {
    if (ctx.state.commentary) return ctx.state.commentary;
    ctx.state.commentary = await fetchCommentaryAggregate(ctx.state.bookId);
    return ctx.state.commentary;
  }

  async function resolveCommentaryEntry(entry) {
    if (entry.commentary_html) return entry;
    const sourceRef = entry.source_ref;
    if (!sourceRef || !entry.source_id) return entry;

    const sourceBook = sourceRef.book_id || ctx.state.bookId;
    const source = await fetchCommentarySource(entry.source_id, sourceBook);
    const sourceChapter = String(sourceRef.source_chapter || sourceRef.chapter || ctx.state.chapter);
    const sourceVerse = String(sourceRef.verse || 1);
    const index = Number(sourceRef.entry_index || 0);
    const sourceEntry = source?.chapters?.[sourceChapter]?.[sourceVerse]?.[index];
    return sourceEntry ? { ...entry, ...sourceEntry } : entry;
  }

  async function showCommentary(reference, verse, options = {}) {
    if (!ctx.canUseCapability?.("commentary")) {
      setDetailMessage("Commentary", capabilityMessage(ctx.getCapabilityState?.("commentary")), options);
      return;
    }
    const detailIntent = setDetailMessage("Commentary", "Loading commentary...", options);
    if (detailIntent === null) return;
    const detailOptions = { ...options, detailIntent };
    const aggregate = await loadCommentaryAggregate();
    const entries = aggregate?.chapters?.[ctx.state.chapter]?.[verse] || [];
    if (!entries.length) {
      const empty = document.createElement("div");
      const heading = document.createElement("h3");
      heading.textContent = reference;
      const message = document.createElement("p");
      message.textContent = `No commentary entries found for ${reference}.`;
      empty.append(heading, createVerseContextTabs(ctx, reference, verse, "commentary", ctx.getActiveWordContext?.(verse)), message);
      setDetail("Commentary", empty, detailOptions);
      return;
    }

    const wrap = document.createElement("div");
    const heading = document.createElement("h3");
    heading.textContent = reference;
    wrap.append(heading, createVerseContextTabs(ctx, reference, verse, "commentary", ctx.getActiveWordContext?.(verse)));

    for (const entry of entries.slice(0, 8)) {
      const resolved = await resolveCommentaryEntry(entry);
      const article = document.createElement("article");
      article.className = "commentary-entry";
      const title = document.createElement("h4");
      title.textContent = entry.source_name || entry.source_id || "Commentary";
      const body = document.createElement("div");
      body.className = "commentary-body";
      setSanitizedCommentaryHtml(body, resolved.commentary_html || "No commentary body found.");
      makeInternalLinksNavigable(body, ctx.findBook, ctx.goToLocation);
      article.append(title, body);
      wrap.append(article);
    }

    setDetail("Commentary", wrap, detailOptions);
  }

  function showOutline(options = {}) {
    if (!ctx.canUseCapability?.("outlines")) {
      setDetail(
        "Outline",
        createStudyEmptyState(ctx, "outlines", {
          capabilityIds: ["outlines"],
        }),
        options,
      );
      return;
    }
    const wrap = document.createElement("div");
    const heading = document.createElement("h3");
    heading.textContent = `${ctx.state.verseBook?.book?.name || ctx.state.bookId} Outline`;
    wrap.append(heading);

    const items = ctx.state.outline?.items || [];
    if (!items.length) {
      const empty = document.createElement("p");
      empty.textContent = "No outline found for this book.";
      wrap.append(empty);
      setDetail("Outline", wrap, options);
      return;
    }

    wrap.append(
      createDetailList(items, (li, item) => {
        li.className = `outline-level-${item.level || 1}`;
        const label = document.createElement("div");
        label.className = "reference-label";
        label.textContent = [item.marker, item.title].filter(Boolean).join(" ");
        const ref = item.reference;
        if (ref) {
          const line = document.createElement("div");
          line.append(
            ctx.createReferenceButton(ref.label || `${ref.start_chapter}:${ref.start_verse}`, {
              book_id: ref.book_id || ctx.state.bookId,
              chapter: ref.start_chapter,
              verse_start: ref.start_verse,
            }),
          );
          li.append(label, line);
        } else {
          li.append(label);
        }
      }),
    );
    setDetail("Outline", wrap, options);
  }

  return { showCommentary, showOutline };
}
