import {
  fetchCommentarySource,
  fetchLexiconEntry,
  fetchSearchManifest,
  fetchSearchShard,
  fetchVerseBook,
} from "../data-service.js?v=pr13-live-qa-20260711e";
import { createDetailList, setDetail, textNode } from "../dom.js?v=pr13-live-qa-20260711e";
import { capabilityMessage } from "../capabilities.js";

const SEARCH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "he",
  "her",
  "him",
  "his",
  "i",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "she",
  "so",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "they",
  "this",
  "to",
  "unto",
  "was",
  "were",
  "with",
  "you",
  "your",
]);

function searchTerms(query) {
  return (
    String(query || "")
      .normalize("NFKD")
      .replace(/\p{Mark}/gu, "")
      .toLowerCase()
      .match(/[a-z0-9]+/g) || []
  ).filter((term) => term.length >= 2 && !SEARCH_STOP_WORDS.has(term));
}

function stripSearchHtml(value) {
  const template = document.createElement("template");
  template.innerHTML = String(value || "");
  return template.content.textContent || "";
}

function textMatchesSearch(text, terms) {
  const lower = String(text || "")
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase();
  return terms.every((term) => lower.includes(term));
}

function appendHighlightedSearchText(container, text, query) {
  const value = String(text || "");
  const lower = value.toLowerCase();
  const queryLower = String(query || "").trim().toLowerCase();
  const terms = searchTerms(query);
  let index = queryLower ? lower.indexOf(queryLower) : -1;
  let length = queryLower.length;

  if (index < 0) {
    const term = terms.find((item) => lower.includes(item));
    index = term ? lower.indexOf(term) : -1;
    length = term ? term.length : 0;
  }

  if (index < 0 || !length) {
    container.textContent = value;
    return;
  }

  container.append(textNode(value.slice(0, index)));
  const mark = document.createElement("mark");
  mark.textContent = value.slice(index, index + length);
  container.append(mark, textNode(value.slice(index + length)));
}

function refsMatchingTerms(shard, terms, limit = 250) {
  if (!shard?.terms || !terms.length) return [];
  const counts = new Map();
  for (const term of terms) {
    const refs = shard.terms[term] || [];
    for (const ref of refs) {
      const key = JSON.stringify(ref);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  const results = [];
  for (const [key, count] of counts) {
    if (count !== terms.length) continue;
    results.push(JSON.parse(key));
    if (results.length >= limit) break;
  }
  return results;
}

function collectBookSearchResults(ctx, bookData, query, limit, translationCode) {
  const terms = searchTerms(query);
  if (!terms.length || !bookData?.chapters) return [];
  const results = [];
  const bookId = bookData.book?.id || ctx.state.bookId;
  const bookName = bookData.book?.name || ctx.findBook(bookId)?.name || bookId;

  Object.keys(bookData.chapters)
    .sort((a, b) => Number(a) - Number(b))
    .some((chapter) => {
      const verses = bookData.chapters[chapter] || {};
      return Object.keys(verses)
        .sort((a, b) => Number(a) - Number(b))
        .some((verse) => {
          const text = verses[verse];
          if (!textMatchesSearch(text, terms)) return false;
          results.push({
            kind: "verse",
            label: `${bookName} ${chapter}:${verse}`,
            meta: translationCode || bookData.translation?.code || ctx.state.translationId.toUpperCase(),
            text,
            location: { book_id: bookId, chapter, verse_start: verse },
          });
          return results.length >= limit;
        });
    });

  return results;
}

async function resolveVerseSearchResult(ref, translationId, bookId, shard) {
  const bookData = await fetchVerseBook(translationId, bookId);
  const [chapter, verse] = ref;
  const text = bookData?.chapters?.[chapter]?.[verse];
  if (!text) return null;
  return {
    kind: "verse",
    label: `${bookData.book?.name || shard?.book?.name || bookId} ${chapter}:${verse}`,
    meta: bookData.translation?.code || translationId.toUpperCase(),
    text,
    location: { book_id: bookId, chapter, verse_start: verse },
  };
}

async function runIndexedVerseSearch(ctx, query, scope, limit) {
  const terms = searchTerms(query);
  const manifest = await fetchSearchManifest();
  if (!manifest || !terms.length) return null;

  const shards =
    scope === "book"
      ? [{ translation_id: ctx.state.translationId, book_id: ctx.state.bookId, path: `search/verses/${ctx.state.translationId}/${ctx.state.bookId}.json` }]
      : (manifest.generated?.verses || []).filter((item) => item.translation_id === ctx.state.translationId);

  if (!shards.length) return null;
  const results = [];
  let loadedShards = 0;
  for (const item of shards) {
    const shard = await fetchSearchShard(item.path);
    if (!shard) continue;
    loadedShards += 1;
    const refs = refsMatchingTerms(shard, terms, limit - results.length);
    for (const ref of refs) {
      const result = await resolveVerseSearchResult(ref, item.translation_id, item.book_id, shard);
      if (result) results.push(result);
      if (results.length >= limit) return results;
    }
  }
  if (!loadedShards) return null;
  return results;
}

async function runVerseSearch(ctx, query, scope, limit) {
  const indexed = await runIndexedVerseSearch(ctx, query, scope, limit);
  if (indexed) return indexed;

  const code = ctx.state.verseBook?.translation?.code || ctx.state.translationId.toUpperCase();
  if (scope === "book") {
    return collectBookSearchResults(ctx, ctx.state.verseBook, query, limit, code);
  }

  const results = [];
  for (const book of ctx.state.manifest?.books || []) {
    const bookData = book.id === ctx.state.bookId ? ctx.state.verseBook : await fetchVerseBook(ctx.state.translationId, book.id);
    if (!bookData) continue;
    results.push(...collectBookSearchResults(ctx, bookData, query, limit - results.length, code));
    if (results.length >= limit) break;
  }
  return results;
}

async function runLexiconSearch(query, scope, limit) {
  const terms = searchTerms(query);
  const manifest = await fetchSearchManifest();
  if (!manifest || !terms.length) return [];

  const shards = (manifest.generated?.lexicon || []).filter((item) => scope === "all" || item.language === scope);
  const seen = new Set();
  const results = [];
  for (const item of shards) {
    const shard = await fetchSearchShard(item.path);
    const refs = refsMatchingTerms(shard, terms, limit);
    for (const strongCode of refs) {
      if (seen.has(strongCode)) continue;
      seen.add(strongCode);
      const entry = await fetchLexiconEntry(strongCode);
      if (!entry) continue;
      results.push({
        kind: "lexicon",
        label: `${entry.strong_code} ${entry.transliteration || entry.original_word || ""}`.trim(),
        meta: `${entry.language || item.language} Strong's`,
        text: entry.summary || entry.short_definition || entry.meaning || entry.concordance_definition || "",
        strong_token: {
          strong_code: entry.strong_code,
          language: entry.language || item.language,
          original: entry.original_word,
          transliteration: entry.transliteration,
          morphology: entry.part_of_speech,
          gloss: entry.short_definition || entry.meaning,
        },
      });
      if (results.length >= limit) return results;
    }
  }
  return results;
}

async function runOutlineSearch(ctx, query, scope, limit) {
  const terms = searchTerms(query);
  const manifest = await fetchSearchManifest();
  if (!manifest || !terms.length) return [];
  const shards =
    scope === "book"
      ? [{ book_id: ctx.state.bookId, path: `search/outlines/${ctx.state.bookId}.json` }]
      : manifest.generated?.outlines || [];
  const results = [];
  for (const item of shards) {
    const [shard, outline] = await Promise.all([fetchSearchShard(item.path), fetchSearchShard(`outlines/books/${item.book_id}.json`)]);
    if (!shard || !outline) continue;
    const refs = refsMatchingTerms(shard, terms, limit - results.length);
    refs.forEach((itemIndex) => {
      const outlineItem = outline.items?.[Number(itemIndex)];
      if (!outlineItem) return;
      const ref = outlineItem.reference || {};
      results.push({
        kind: "outline",
        label: `${outline.book?.name || item.book_id} - ${outlineItem.title || ref.label || "Outline"}`,
        meta: ref.label || "Outline",
        text: [outlineItem.marker, outlineItem.title].filter(Boolean).join(" "),
        location: {
          book_id: ref.book_id || item.book_id,
          chapter: ref.start_chapter || ref.chapter || 1,
          verse_start: ref.start_verse || ref.verse_start || 1,
        },
      });
    });
    if (results.length >= limit) return results.slice(0, limit);
  }
  return results;
}

async function runCommentarySearch(ctx, query, scope, limit) {
  const terms = searchTerms(query);
  const manifest = await fetchSearchManifest();
  if (!manifest || !terms.length) return [];
  const shards =
    scope === "book"
      ? (manifest.generated?.commentaries || []).filter((item) => item.book_id === ctx.state.bookId)
      : manifest.generated?.commentaries || [];
  const results = [];
  for (const item of shards) {
    const [shard, sourceBook] = await Promise.all([fetchSearchShard(item.path), fetchCommentarySource(item.source_id, item.book_id)]);
    if (!shard || !sourceBook) continue;
    const refs = refsMatchingTerms(shard, terms, limit - results.length);
    refs.forEach((ref) => {
      const [chapter, verse, entryIndex] = ref;
      const entry = sourceBook.chapters?.[chapter]?.[verse]?.[Number(entryIndex)];
      if (!entry) return;
      results.push({
        kind: "commentary",
        label: `${sourceBook.book?.name || item.book_id} ${chapter}:${verse}`,
        meta: item.source_id,
        text: stripSearchHtml(entry.commentary_html).slice(0, 360),
        location: { book_id: item.book_id, chapter, verse_start: verse },
      });
    });
    if (results.length >= limit) return results.slice(0, limit);
  }
  return results;
}

function runSearch(ctx, query, collection, scope, limit) {
  if (collection === "lexicon" && !ctx.canUseCapability?.("lexicon-language-metadata")) return [];
  if (collection === "commentaries" && !ctx.canUseCapability?.("commentary")) return [];
  if (collection === "outlines" && !ctx.canUseCapability?.("outlines")) return [];
  if (collection === "lexicon") return runLexiconSearch(query, scope, limit);
  if (collection === "commentaries") return runCommentarySearch(ctx, query, scope, limit);
  if (collection === "outlines") return runOutlineSearch(ctx, query, scope, limit);
  return runVerseSearch(ctx, query, scope, limit);
}

function renderSearchResults(ctx, showStrong, container, results, query, collection, scope, limit) {
  container.replaceChildren();
  const summary = document.createElement("p");
  summary.className = "search-summary";
  const capped = results.length >= limit ? `first ${limit}` : String(results.length);
  const scopeLabel =
    collection === "lexicon"
      ? scope === "all"
        ? "Hebrew and Greek lexicon"
        : `${scope} lexicon`
      : scope === "book"
        ? "this book"
        : collection === "verses"
          ? "this translation"
          : "all books";
  summary.textContent = `${capped} result${results.length === 1 ? "" : "s"} in ${scopeLabel}.`;
  container.append(summary);

  if (!results.length) {
    const empty = document.createElement("p");
    empty.textContent = "No matching records found.";
    container.append(empty);
    return;
  }

  container.append(
    createDetailList(results, (li, result) => {
      li.className = "search-result";
      const top = document.createElement("div");
      top.className = "search-result-top";
      const labelButton = document.createElement("button");
      labelButton.type = "button";
      labelButton.className = "link-button";
      labelButton.textContent = result.label;
      labelButton.addEventListener("click", () => {
        if (result.strong_token) {
          showStrong(result.strong_token, { pin: true, force: true });
          return;
        }
        if (result.location) {
          void ctx.goToLocation(result.location.book_id, result.location.chapter, result.location.verse_start || 1);
        }
      });
      top.append(labelButton);
      const meta = document.createElement("span");
      meta.className = "reference-meta";
      meta.textContent = result.meta;
      top.append(meta);

      const text = document.createElement("div");
      text.className = "search-result-text";
      appendHighlightedSearchText(text, result.text, query);
      li.append(top, text);
    }),
  );
}

export function createSearchView(ctx, { showStrong }) {
  return function showSearch() {
    if (!ctx.canUseCapability?.("search")) {
      const unavailable = document.createElement("section");
      unavailable.className = "study-empty-state physical-pack-unavailable";
      const heading = document.createElement("h3");
      heading.tabIndex = -1;
      heading.textContent = "Search unavailable";
      const message = document.createElement("p");
      message.textContent = capabilityMessage(ctx.getCapabilityState?.("search"));
      unavailable.append(heading, message);
      setDetail("Search", unavailable);
      heading.focus();
      return;
    }
    const wrap = document.createElement("div");
    wrap.className = "search-panel";
    const heading = document.createElement("h3");
    heading.textContent = "Search";

    const form = document.createElement("form");
    form.className = "search-form";

    const queryLabel = document.createElement("label");
    const queryText = document.createElement("span");
    queryText.textContent = "Query";
    const queryInput = document.createElement("input");
    queryInput.name = "query";
    queryInput.required = true;
    queryInput.minLength = 2;
    queryInput.placeholder = "wisdom";
    queryLabel.append(queryText, queryInput);

    const collectionLabel = document.createElement("label");
    const collectionText = document.createElement("span");
    collectionText.textContent = "Collection";
    const collectionSelect = document.createElement("select");
    collectionSelect.name = "collection";
    [
      ["verses", "Bible verses", true],
      ["lexicon", "Strong's lexicon", ctx.canUseCapability?.("lexicon-language-metadata") === true],
      ["commentaries", "Commentaries", ctx.canUseCapability?.("commentary") === true],
      ["outlines", "Outlines", ctx.canUseCapability?.("outlines") === true],
    ].forEach(([value, label, available]) => {
      const item = document.createElement("option");
      item.value = value;
      item.textContent = label;
      item.disabled = !available;
      collectionSelect.append(item);
    });
    collectionLabel.append(collectionText, collectionSelect);

    const scopeLabel = document.createElement("label");
    const scopeText = document.createElement("span");
    scopeText.textContent = "Scope";
    const scopeSelect = document.createElement("select");
    scopeSelect.name = "scope";
    scopeLabel.append(scopeText, scopeSelect);

    const updateScopeOptions = () => {
      const current = scopeSelect.value;
      scopeSelect.replaceChildren();
      const options =
        collectionSelect.value === "lexicon"
          ? [
            ["all", "Hebrew and Greek"],
            ["hebrew", "Hebrew"],
            ["greek", "Greek"],
          ]
          : collectionSelect.value === "verses"
            ? [
              ["book", "Current book"],
              ["translation", "Selected translation"],
            ]
            : [
              ["book", "Current book"],
              ["all", "All books"],
            ];
      options.forEach(([value, label]) => {
        const item = document.createElement("option");
        item.value = value;
        item.textContent = label;
        scopeSelect.append(item);
      });
      if (options.some(([value]) => value === current)) scopeSelect.value = current;
    };
    collectionSelect.addEventListener("change", updateScopeOptions);
    updateScopeOptions();

    const limitLabel = document.createElement("label");
    const limitText = document.createElement("span");
    limitText.textContent = "Limit";
    const limitInput = document.createElement("input");
    limitInput.name = "limit";
    limitInput.type = "number";
    limitInput.min = "10";
    limitInput.max = "250";
    limitInput.step = "10";
    limitInput.value = "80";
    limitLabel.append(limitText, limitInput);

    const actions = document.createElement("div");
    actions.className = "search-actions";
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "mini-button";
    submit.textContent = "Search";
    actions.append(submit);

    form.append(queryLabel, collectionLabel, scopeLabel, limitLabel, actions);
    const resultSlot = document.createElement("div");
    resultSlot.className = "search-results";

    let runId = 0;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const query = queryInput.value.trim();
      const collection = collectionSelect.value;
      const scope = scopeSelect.value;
      const limit = Math.max(10, Math.min(250, Number(limitInput.value || 80)));
      if (query.length < 2) return;

      const currentRun = (runId += 1);
      resultSlot.textContent = "Searching index...";
      runSearch(ctx, query, collection, scope, limit)
        .then((results) => {
          if (currentRun !== runId) return;
          renderSearchResults(ctx, showStrong, resultSlot, results, query, collection, scope, limit);
        })
        .catch(() => {
          if (currentRun !== runId) return;
          resultSlot.textContent = "Search failed.";
        });
    });

    wrap.append(heading, form, resultSlot);
    setDetail("Search", wrap);
    queryInput.focus();
  };
}
