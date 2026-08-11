import { fetchVerseBook, resolvePassageText } from "../data-service.js";
import { createDetailList, setDetail, setDetailMessage } from "../dom.js?v=pr13-live-qa-20260711e";
import { createVerseContextTabs } from "./verse-context-tabs.js?v=pr13-live-qa-20260711e";

export function createReferenceViews(ctx) {
  function appendPassageText(container, text) {
    container.replaceChildren();
    const raw = String(text || "");
    const matches = [...raw.matchAll(/(?:^|\s)(\d{1,3})\.\s+/g)];
    if (!matches.length) {
      container.textContent = raw;
      return;
    }

    let cursor = 0;
    matches.forEach((match, index) => {
      const markerStart = match.index || 0;
      const textStart = markerStart + match[0].length;
      const nextStart = matches[index + 1]?.index ?? raw.length;
      const prefix = raw.slice(cursor, markerStart);
      if (prefix) container.append(document.createTextNode(prefix));
      const marker = document.createElement("sub");
      marker.className = "passage-verse-number";
      marker.textContent = match[1];
      container.append(marker, document.createTextNode(raw.slice(textStart, nextStart).trimStart()));
      if (index < matches.length - 1) container.append(document.createTextNode(" "));
      cursor = nextStart;
    });
    if (cursor < raw.length) container.append(document.createTextNode(raw.slice(cursor)));
  }

  function appendPassageVerses(container, passage) {
    if (!passage?.verses?.length) {
      appendPassageText(container, passage?.text || "");
      return;
    }
    container.replaceChildren();
    passage.verses.forEach((item, index) => {
      const marker = document.createElement("sub");
      marker.className = "passage-verse-number";
      marker.textContent = item.verse;
      container.append(marker, document.createTextNode(item.text || ""));
      if (index < passage.verses.length - 1) container.append(document.createTextNode(" "));
    });
  }

  function showFootnote(note, reference) {
    const wrap = document.createElement("div");
    wrap.className = "footnote-detail";
    const heading = document.createElement("h3");
    heading.textContent = reference;
    const marker = document.createElement("div");
    marker.className = "footnote-detail-marker";
    marker.textContent = `Footnote ${note.marker}`;
    const body = document.createElement("p");
    body.textContent = note.text;
    wrap.append(heading, marker, body);
    setDetail("Footnote", wrap, { forceHistory: true });
  }

  async function showParallelVerse(reference, verse, verseText, options = {}) {
    const detailIntent = setDetailMessage("Parallel", "Loading parallel translations...", {
      forceHistory: true,
      ...options,
    });
    if (detailIntent === null) return;
    const detailOptions = { ...options, detailIntent };
    const wrap = document.createElement("div");
    wrap.className = "parallel-panel";
    const heading = document.createElement("h3");
    heading.textContent = reference;
    const tabs = createVerseContextTabs(ctx, reference, verse, "par", ctx.getActiveWordContext?.(verse));
    const intro = document.createElement("p");
    intro.textContent = verseText;
    const list = document.createElement("div");
    list.className = "parallel-list";
    wrap.append(heading, tabs, intro, list);
    setDetail("Parallel", wrap, { history: "replace", ...detailOptions, verse });

    const rows = await Promise.all(
      (ctx.state.manifest?.translations || []).map(async (translation) => {
        try {
          const book = await fetchVerseBook(translation.id, ctx.state.bookId);
          const text = book?.chapters?.[ctx.state.chapter]?.[verse];
          return text ? { translation, text } : null;
        } catch {
          return null;
        }
      }),
    );

    if (!list.isConnected) return;
    list.replaceChildren();
    rows
      .filter(Boolean)
      .forEach(({ translation, text }) => {
        const row = document.createElement("div");
        row.className = translation.id === ctx.state.translationId ? "parallel-verse active" : "parallel-verse";
        const top = document.createElement("div");
        top.className = "parallel-verse-top";
        const label = document.createElement("button");
        label.type = "button";
        label.className = "link-button";
        label.textContent = `${translation.code || translation.id.toUpperCase()} - ${translation.name || translation.id}`;
        label.addEventListener("click", () =>
          void ctx.goToRoute({
            translationId: translation.id,
            bookId: ctx.state.bookId,
            chapter: ctx.state.chapter,
            verse,
          }),
        );
        const marker = document.createElement("span");
        marker.className = "reference-meta";
        marker.textContent = translation.id === ctx.state.translationId ? "selected" : "click to read";
        top.append(label, marker);
        const body = document.createElement("div");
        body.className = "parallel-verse-text";
        body.textContent = text;
        row.append(top, body);
        list.append(row);
      });

    if (!list.children.length) {
      const empty = document.createElement("p");
      empty.textContent = "No parallel translation text found for this verse.";
      list.append(empty);
    }
  }

  function showCrossrefs(reference, record, options = {}) {
    const wrap = document.createElement("div");
    wrap.className = "crossref-panel";
    const heading = document.createElement("h3");
    heading.textContent = reference;
    wrap.append(heading);
    if (options.verse) {
      wrap.append(createVerseContextTabs(ctx, reference, options.verse, "refs", ctx.getActiveWordContext?.(options.verse)));
    }

    const refs = [...(record.cross_references || []), ...(record.treasury || [])];
    if (!refs.length) {
      const empty = document.createElement("p");
      empty.textContent = "No cross references found for this verse.";
      wrap.append(empty);
      setDetail("Cross References", wrap, { forceHistory: true, ...options });
      return;
    }

    wrap.append(
      createDetailList(refs.slice(0, 80), (li, item) => {
        li.className = "crossref-item";
        const label = document.createElement("div");
        label.className = "reference-label";
        label.append(ctx.createReferenceButton(item.label || `${item.book_id} ${item.chapter}:${item.verse_start}`, item));
        const meta = document.createElement("div");
        meta.className = "reference-meta";
        meta.textContent = item.source === "treasury" ? "Treasury" : "Cross reference";
        const body = document.createElement("div");
        body.className = "reference-passage";
        body.textContent = item.text || "Loading passage...";
        resolvePassageText(ctx.state.translationId, item)
          .then((passage) => {
            if (!body.isConnected) return;
            if (!passage) {
              body.textContent = item.text || "Referenced passage could not be loaded.";
              return;
            }
            appendPassageVerses(body, passage);
            meta.textContent = `${meta.textContent} - ${passage.translation_code}`;
          })
          .catch(() => {
            if (body.isConnected) appendPassageText(body, item.text || "Referenced passage could not be loaded.");
          });
        li.append(label, meta, body);
      }),
    );
    setDetail("Cross References", wrap, { forceHistory: true, ...options });
  }

  return { showCrossrefs, showFootnote, showParallelVerse };
}
