import {
  fetchVerseBook,
  fetchWordMapBook,
  fetchLexiconEntry,
  loadLanguageMetadata,
  loadOriginalSourceTexts,
} from "../data-service.js?v=pr13-live-qa-20260711e";
import { createDetailList, els, setDetail, setDetailMessage, textNode } from "../dom.js?v=pr13-live-qa-20260711e";
import {
  setLanguageTextWithTooltips,
  setTransliterationTextWithTooltips,
} from "../language-tooltips.js?v=pr13-live-qa-20260711e";
import { setMorphologyHelp } from "../morphology-tooltips.js?v=pr13-live-qa-20260711e";
import { referenceKey } from "../references.js";
import { analyzeOriginalWord, summarizeHebrewGematriaTokens, wordHasLanguageScript } from "../language.js";
import {
  resolveInterlinearVerseTokens,
  resolveSourceBearingPresentationSegment,
} from "../strongs.js?v=pr13-live-qa-20260711e";
import { getTokenRenderings, getWorkspaceVerse, setTokenRendering, setVerseDraft } from "../stores.js?v=pr13-live-qa-20260711e";
import { createVerseContextTabs } from "./verse-context-tabs.js?v=pr13-live-qa-20260711e";
import { createStudyEmptyState } from "../study-empty-state.js";
import { interlinearTokenIdentity } from "../ui-contracts.js";
import { createSourceTokenTarget } from "../semantic-targets.js?v=pr13-live-qa-20260711e";

function normalizeWordMapSpan(raw, bsbVerseText) {
  const start = Number(raw[2] || 0);
  const end = Number(raw[3] || start);
  return {
    strong_token_index: raw[0],
    source_token_index: raw[1],
    start_offset: start,
    end_offset: end,
    strong_code: raw[4],
    language: raw[5],
    bsb_span: bsbVerseText.slice(start, end),
  };
}

function createWordMapLookup(rawSpans, bsbVerseText) {
  const spans = (rawSpans || []).map((span) => normalizeWordMapSpan(span, bsbVerseText));
  const bySource = new Map();
  const byStrong = new Map();
  spans.forEach((span) => {
    if (span.source_token_index !== null && span.source_token_index !== undefined) {
      bySource.set(Number(span.source_token_index), span);
    }
    byStrong.set(`${span.strong_token_index}:${span.strong_code}`, span);
  });
  return { bySource, byStrong, spans };
}

function wordMapForToken(token, lookup) {
  if (!lookup) return null;
  return lookup.bySource.get(Number(token.token_index)) || lookup.byStrong.get(`${token.token_index}:${token.strong_code}`) || null;
}

function tokenWordInfo(token) {
  const meaning = token.english || token.gloss || token.short_definition || "";
  return {
    meaning,
    strongCode: token.strong_code || "",
    transliteration: token.transliteration || "",
  };
}

function normalizeOriginalKey(text, language) {
  const normalized = String(text || "").normalize("NFD");
  const letterPattern = language === "greek" ? /[\u0370-\u03ff\u1f00-\u1fff]/gu : /[\u05d0-\u05ea]/gu;
  return Array.from(normalized.matchAll(letterPattern), (match) => match[0]).join("");
}

function createOriginalWordInfoLookup(tokens) {
  const lookup = new Map();
  tokens.forEach((token) => {
    if (!token.original) return;
    const info = tokenWordInfo(token);
    lookup.set(String(token.original).normalize("NFD"), info);
    lookup.set(normalizeOriginalKey(token.original, token.language), info);
  });
  return lookup;
}

function appendWorkspaceWordMap(card, token, wordMapSpan) {
  const panel = document.createElement("div");
  panel.className = wordMapSpan ? "workspace-word-map" : "workspace-word-map missing";

  const title = document.createElement("div");
  title.className = "workspace-word-map-title";
  title.textContent = "BSB word map";
  panel.append(title);

  if (!wordMapSpan) {
    const missing = document.createElement("div");
    missing.className = "workspace-map-row";
    missing.append(textNode("No BSB span mapped for this source token yet."));
    panel.append(missing);
    card.append(panel);
    return;
  }

  const rows = [
    ["BSB span", wordMapSpan.bsb_span || "(empty span)"],
    ["Offsets", `${wordMapSpan.start_offset}-${wordMapSpan.end_offset}`],
    ["Source token", `#${wordMapSpan.source_token_index || token.token_index}: ${token.original || ""}`],
    ["Strong", wordMapSpan.strong_code || token.strong_code || "No Strong's"],
  ];

  rows.forEach(([label, value]) => {
    const row = document.createElement("div");
    row.className = "workspace-map-row";
    const key = document.createElement("span");
    key.className = "workspace-map-key";
    key.textContent = label;
    const val = document.createElement("span");
    val.className = label === "BSB span" ? "workspace-map-value bsb-span" : "workspace-map-value";
    val.textContent = value;
    row.append(key, val);
    panel.append(row);
  });

  card.append(panel);
}

function rangesOverlap(a, b) {
  if (!a || !b) return false;
  return Number(a.start_offset) < Number(b.end) && Number(a.end_offset) > Number(b.start);
}

function createTranslationAlignmentPanel(tokens, wordMapLookup, selectedRange) {
  const panel = document.createElement("section");
  panel.className = "translation-alignment";
  const heading = document.createElement("h4");
  heading.textContent = "Word-by-word alignment";
  const intro = document.createElement("p");
  intro.textContent = "Hover a source word or BSB span to focus the paired words.";
  panel.append(heading, intro);

  const grid = document.createElement("div");
  grid.className = "translation-alignment-grid";
  tokens.forEach((token) => {
    const span = wordMapForToken(token, wordMapLookup);
    const pair = document.createElement("button");
    pair.type = "button";
    pair.className = "translation-token-pair";
    if (rangesOverlap(span, selectedRange)) pair.classList.add("selected-range");
    pair.dataset.sourceIndex = String(token.token_index ?? "");

    const source = document.createElement("span");
    source.className = token.language === "hebrew" ? "alignment-source rtl-token" : "alignment-source";
    setLanguageTextWithTooltips(source, token.original || "", token.language, { wordInfo: tokenWordInfo(token) });

    const english = document.createElement("span");
    english.className = "alignment-english";
    english.textContent = span?.bsb_span || token.english || "(unmapped)";

    const meta = document.createElement("span");
    meta.className = "alignment-meta";
    meta.textContent = [token.strong_code, token.gloss].filter(Boolean).join(" - ");

    pair.append(source, english, meta);
    grid.append(pair);
  });
  panel.append(grid);
  return panel;
}

function createVerseGematriaSummary(total, tokens) {
  const summary = document.createElement("section");
  summary.className = "verse-gematria-total";
  const label = document.createElement("span");
  label.textContent = "Verse gematria total";
  const value = document.createElement("strong");
  value.textContent = String(total);
  const count = document.createElement("small");
  count.textContent = `${tokens.length} Hebrew words`;
  summary.append(label, value, count);
  return summary;
}

async function calculateHebrewVerseGematria(tokens) {
  const hasHebrewScript = tokens.some(
    (token) =>
      token.language === "hebrew" &&
      token.original &&
      wordHasLanguageScript(token.original, "hebrew"),
  );
  if (!hasHebrewScript) return null;
  return summarizeHebrewGematriaTokens(tokens, await loadLanguageMetadata("hebrew"));
}

export function createInterlinearTranslationViews(ctx, { appendLanguageBreakdown, showStrong }) {
  let stopInterlinearLazyLoad = () => {};
  const meaningWordMaps = new Map();

  async function exactMappedBsbMeaning(token, verse) {
    const key = referenceKey(ctx.state.bookId, ctx.state.chapter, verse);
    if (!meaningWordMaps.has(key)) {
      meaningWordMaps.set(key, Promise.all([
        fetchWordMapBook("bsb", ctx.state.bookId),
        fetchVerseBook("bsb", ctx.state.bookId),
      ]).then(([wordMapBook, bsbBook]) => {
        const text = bsbBook?.chapters?.[ctx.state.chapter]?.[verse] || "";
        return createWordMapLookup(wordMapBook?.chapters?.[ctx.state.chapter]?.[verse] || [], text);
      }).catch(() => null));
    }
    const lookup = await meaningWordMaps.get(key);
    return String(wordMapForToken(token, lookup)?.bsb_span || "").replace(/\s+/g, " ").trim();
  }

  function superscriptionForVerse(verse) {
    const blocks = ctx.state.presentation?.chapters?.[ctx.state.chapter]?.blocks || [];
    for (const block of blocks) {
      if (String(block.before_verse || "") !== String(verse)) continue;
      const segment = resolveSourceBearingPresentationSegment({
        bookId: ctx.state.bookId,
        chapter: ctx.state.chapter,
        block,
        rawStrongByVerse: ctx.state.strongs?.chapters?.[ctx.state.chapter],
        rawInterlinearByVerse: ctx.state.interlinear?.chapters?.[ctx.state.chapter],
      });
      if (segment) return segment;
    }
    return null;
  }

  function interlinearTokensForVerse(verse) {
    const superscription = superscriptionForVerse(verse);
    return resolveInterlinearVerseTokens({
      rawInterlinearByVerse: ctx.state.interlinear?.chapters?.[ctx.state.chapter],
      rawStrongByVerse: ctx.state.strongs?.chapters?.[ctx.state.chapter],
      chapterVerses: ctx.state.verseBook?.chapters?.[ctx.state.chapter],
      targetVerse: verse,
      reference: { bookId: ctx.state.bookId, chapter: ctx.state.chapter },
      excludedTokenIndexes: superscription?.token_indexes || [],
    });
  }

  function interlinearVerses() {
    return Object.keys(ctx.state.verseBook?.chapters?.[ctx.state.chapter] || {})
      .filter((verse) => interlinearTokensForVerse(verse).length)
      .sort((a, b) => Number(a) - Number(b));
  }

  function splitSourceText(text, wordCount) {
    const words = String(text || "").trim().split(/\s+/u);
    return {
      superscription: words.slice(0, wordCount).join(" "),
      verse: words.slice(wordCount).join(" "),
    };
  }

  async function sourceTextsForVerse(tokens, verse, part = "verse") {
    const sources = await loadOriginalSourceTexts(ctx.state, tokens[0]?.language, verse);
    const superscription = superscriptionForVerse(verse);
    if (!superscription) return sources;
    const wordCount = superscription.interlinear_tokens.length;
    return sources.map((source) => ({ ...source, text: splitSourceText(source.text, wordCount)[part] })).filter((source) => source.text);
  }

  function createSourceTextList(sourceTexts, language, wordInfoLookup) {
    const sourceList = document.createElement("div");
    sourceList.className = "source-text-list";
    sourceTexts.forEach((source) => {
      const item = document.createElement("div");
      const label = document.createElement("div");
      label.className = "reference-label";
      label.textContent = source.label;
      const text = document.createElement("div");
      text.className = source.id === "wlc" || source.id === "wlco" ? "source-text rtl-text" : "source-text";
      text.lang = language === "hebrew" ? "he" : "grc";
      text.dir = language === "hebrew" ? "rtl" : "ltr";
      item.dataset.sourceId = source.id;
      item.className = source.variant === "consonants-only" ? "source-text-row secondary" : "source-text-row";
      setLanguageTextWithTooltips(text, source.text, language, { wordInfoLookup });
      item.append(label, text);
      sourceList.append(item);
    });
    return sourceList;
  }

  function createInterlinearTokenCard(token, options = {}) {
    const card = document.createElement("div");
    card.className = "interlinear-token";
    card.dataset.tokenIndex = String(token.token_index ?? "");
    card.dataset.strongCode = token.strong_code || "";
    card.dataset.verse = String(token.verse || options.verseContext?.verse || "");
    card.dataset.segmentId = String(token.segment_id || options.verseContext?.segmentId || "");
    card.dataset.interlinearKey = interlinearTokenIdentity({
      verse: card.dataset.verse,
      segmentId: card.dataset.segmentId,
      tokenIndex: card.dataset.tokenIndex,
      strongCode: card.dataset.strongCode,
    });

    const original = document.createElement("div");
    original.className = token.language === "hebrew" ? "token-original rtl-token" : "token-original";
    setLanguageTextWithTooltips(original, token.original || "", token.language, { wordInfo: tokenWordInfo(token) });

    const transliteration = document.createElement("div");
    transliteration.className = "token-translit";
    const translitText = token.transliteration || "";
    const visibleTransliteration = translitText && translitText !== (token.original || "") ? translitText : "";
    transliteration.hidden = !visibleTransliteration;
    if (visibleTransliteration) {
      setTransliterationTextWithTooltips(transliteration, visibleTransliteration, {
        sourceLabel: "Bundled interlinear transliteration",
      });
    }

    const meta = document.createElement("div");
    meta.className = "token-meta";
    const strong = token.strong_code ? document.createElement("button") : document.createElement("span");
    strong.className = token.strong_code ? "link-button compact-link" : "";
    strong.textContent = token.strong_code || "No Strong's";
    if (token.strong_code) {
      strong.type = "button";
      strong.disabled = !ctx.canUseCapability?.("strongs-overlay");
      strong.addEventListener("click", (event) => {
        if (!ctx.canUseCapability?.("strongs-overlay")) return;
        event.stopPropagation();
        stopInterlinearLazyLoad();
        const tokenVerseContext = {
          ...options.verseContext,
          verse: card.dataset.verse,
          reference: ctx.currentReference(card.dataset.verse),
          segmentId: card.dataset.segmentId || undefined,
        };
        ctx.highlightReaderContext?.({
          verse: tokenVerseContext.verse,
          segmentId: tokenVerseContext.segmentId,
          word: {
            tokenIndex: token.token_index,
            strongCode: token.strong_code,
            language: token.language,
            original: token.original,
          },
          commit: true,
        });
        showStrong(token, { pin: true, verseContext: tokenVerseContext });
      });
    }
    meta.append(strong);
    if (token.morphology) {
      meta.append(textNode(" / "));
      const morphology = document.createElement("span");
      setMorphologyHelp(morphology, token.morphology, token.language);
      meta.append(morphology);
    }

    const english = document.createElement("div");
    english.className = "token-english";
    english.textContent = token.english || "";

    const gloss = document.createElement("div");
    gloss.className = "token-gloss";
    gloss.textContent = token.gloss || "";

    card.append(original, transliteration, meta, english, gloss);

    const targetReferenceKey =
      options.referenceKey ||
      referenceKey(ctx.state.bookId, ctx.state.chapter, card.dataset.verse);
    const sourceTarget = createSourceTokenTarget(
      targetReferenceKey,
      {
        token_index: token.token_index,
        strong_code: token.strong_code,
        language: token.language,
        original: token.original,
      },
      ctx.state.translationId,
    );
    if (sourceTarget) {
      const actions = document.createElement("div");
      actions.className = "token-tag-actions";
      const controls = document.createElement("div");
      controls.className = "token-tag-controls";
      const tokenLabel = `${ctx.currentReference(card.dataset.verse)} ${token.original || token.transliteration || "source token"}`;
      const refreshTargetActions = () => {
        actions.querySelector(".token-target-badges")?.remove();
        const badges = ctx.detailViews.renderTargetTagBadges(sourceTarget, {
          className: "token-target-badges",
          interactive: true,
          label: tokenLabel,
          preview: [token.english, token.gloss].filter(Boolean).join(" — "),
          onChange: refreshTargetActions,
        });
        if (badges) actions.insertBefore(badges, controls);
      };
      const marks = ctx.detailViews.renderStudyMarksTrigger(sourceTarget, {
        className: "token-study-marks-button",
        align: "right",
        boundary: "detail-pane",
        label: tokenLabel,
        preview: [token.english, token.gloss].filter(Boolean).join(" — "),
        onChange: refreshTargetActions,
      });
      const meaning = ctx.detailViews.renderWordMeaningControl({
        target: sourceTarget,
        token,
        label: tokenLabel,
        loadExactMappedEnglish: () => exactMappedBsbMeaning(token, card.dataset.verse),
        loadLexicon: token.strong_code ? () => fetchLexiconEntry(token.strong_code) : null,
      });
      controls.append(marks);
      if (meaning) controls.append(meaning);
      actions.append(controls);
      refreshTargetActions();
      card.append(actions);
    }
    appendLanguageBreakdown(card, token);

    const highlight = (commit = false) => ctx.highlightReaderContext?.({
      verse: card.dataset.verse,
      segmentId: card.dataset.segmentId || undefined,
      word: {
        tokenIndex: token.token_index,
        strongCode: token.strong_code,
        language: token.language,
        original: token.original,
      },
      commit,
    });
    card.addEventListener("pointerenter", () => highlight(false));
    card.addEventListener("focusin", () => highlight(false));

    if (options.workspace && options.referenceKey) {
      if (options.wordMapLookup) appendWorkspaceWordMap(card, token, wordMapForToken(token, options.wordMapLookup));

      const renderings = getTokenRenderings(ctx.state, options.referenceKey);
      const label = document.createElement("label");
      label.className = "token-rendering";
      const labelText = document.createElement("span");
      labelText.textContent = "Your rendering";
      const input = document.createElement("input");
      input.value = renderings[token.token_index]?.rendering || "";
      input.addEventListener("change", () => {
        setTokenRendering(ctx.state, options.referenceKey, token, input.value.trim());
      });
      label.append(labelText, input);
      card.append(label);
    }

    return card;
  }

  async function createSuperscriptionSection(verse) {
    const segment = superscriptionForVerse(verse);
    if (!segment) return null;
    const reference = ctx.currentReference(verse);
    const section = document.createElement("section");
    section.className = "interlinear-verse-section interlinear-superscription-section";
    section.dataset.verse = String(verse);
    section.dataset.segmentId = segment.segment_id;
    const heading = document.createElement("h3");
    heading.textContent = `${reference} — Superscription`;
    const english = document.createElement("p");
    english.className = "original-language-superscription-english";
    english.textContent = segment.text;
    const list = document.createElement("div");
    list.className = "interlinear-token-list";
    const verseContext = { reference, verse: String(verse), segmentId: segment.segment_id };
    segment.interlinear_tokens.forEach((token) => list.append(createInterlinearTokenCard(token, { verseContext })));
    section.append(heading, english);
    const sourceTexts = await sourceTextsForVerse(segment.interlinear_tokens, verse, "superscription");
    if (sourceTexts.length) {
      section.append(createSourceTextList(
        sourceTexts,
        segment.interlinear_tokens[0].language,
        createOriginalWordInfoLookup(segment.interlinear_tokens),
      ));
    }
    section.append(list);
    return section;
  }

  async function createInterlinearVerseSection(verse) {
    const reference = ctx.currentReference(verse);
    const tokens = interlinearTokensForVerse(verse);
    if (!tokens.length) return null;

    const section = document.createElement("section");
    section.className = "interlinear-verse-section";
    section.dataset.verse = String(verse);
    const heading = document.createElement("h3");
    heading.textContent = reference;
    const key = referenceKey(ctx.state.bookId, ctx.state.chapter, verse);
    const verseContext = { reference, verse };
    const wordInfoLookup = createOriginalWordInfoLookup(tokens);
    section.append(heading);

    const sourceTexts = await sourceTextsForVerse(tokens, verse, "verse");
    if (sourceTexts.length) {
      section.append(createSourceTextList(sourceTexts, tokens[0].language, wordInfoLookup));
    }

    const tokenList = document.createElement("div");
    tokenList.className = "interlinear-token-list";
    tokens.forEach((token) => {
      tokenList.append(
        createInterlinearTokenCard(token, {
          workspace: false,
          referenceKey: key,
          verseContext,
        }),
      );
    });
    section.append(tokenList);
    const verseGematria = await calculateHebrewVerseGematria(tokens);
    if (verseGematria) section.append(createVerseGematriaSummary(verseGematria.total, verseGematria.tokens));
    return section;
  }

  async function showInterlinearVerse(reference, verse, options = {}) {
    stopInterlinearLazyLoad();
    if (!ctx.canUseCapability?.("interlinear")) {
      setDetail(
        "Language Study",
        createStudyEmptyState(ctx, "interlinear", {
          reference,
          capabilityIds: ["interlinear"],
        }),
        options,
      );
      return;
    }
    const initialSection = await createInterlinearVerseSection(verse);
    if (!initialSection) {
      const empty = document.createElement("div");
      const heading = document.createElement("h3");
      heading.textContent = reference;
      const message = document.createElement("p");
      message.textContent = `No Language Study data found for ${reference}.`;
      empty.append(heading, createVerseContextTabs(ctx, reference, verse, "interlinear", ctx.studyContext?.strong), message);
      setDetail("Language Study", empty, options);
      return;
    }

    const wrap = document.createElement("div");
    wrap.className = "interlinear-lazy-reader";
    wrap.dataset.detailRestore = "interlinear-lazy-reader";
    wrap.append(createVerseContextTabs(ctx, reference, verse, "interlinear", ctx.studyContext?.strong));
    const superscriptionSection = await createSuperscriptionSection(verse);
    if (superscriptionSection) wrap.append(superscriptionSection);
    wrap.append(initialSection);
    const status = document.createElement("p");
    status.className = "interlinear-lazy-status";
    status.setAttribute("role", "status");
    wrap.append(status);
    setDetail("Language Study", wrap, options);

    wrap.addEventListener("language-study:open-strong", async (event) => {
      const detail = event.detail || {};
      const scrollTop = pane?.scrollTop || 0;
      const entry = detail.entry || await fetchLexiconEntry(detail.strongCode).catch(() => null);
      wrap.addEventListener("detail:restore", () => window.requestAnimationFrame(() => {
        if (pane) pane.scrollTop = scrollTop;
      }), { once: true });
      showStrong({
        strong_code: detail.strongCode,
        strong_number: Number(String(detail.strongCode || "").slice(1)) || null,
        language: detail.language,
        original: entry?.original_word || "",
        transliteration: entry?.transliteration || "",
        english: detail.label || entry?.short_definition || "Related entry",
        gloss: entry?.short_definition || "",
        morphology: entry?.part_of_speech || "",
      }, { pin: true, forceHistory: true, verseContext: detail.verseContext });
    });

    const verses = interlinearVerses();
    let currentIndex = verses.indexOf(String(verse));
    let loading = false;
    const pane = els.detail || els.detailPane;
    const updateStatus = () => {
      const nextVerse = verses[currentIndex + 1];
      status.textContent = nextVerse ? `Scroll to load ${ctx.currentReference(nextVerse)}.` : "End of chapter.";
    };
    const stop = () => {
      pane?.removeEventListener("scroll", onScroll);
      if (stopInterlinearLazyLoad === stop) stopInterlinearLazyLoad = () => {};
    };
    const loadNext = async () => {
      if (loading || !wrap.isConnected) {
        if (!wrap.isConnected) stop();
        return;
      }
      const nextVerse = verses[currentIndex + 1];
      if (!nextVerse) {
        updateStatus();
        stop();
        return;
      }
      loading = true;
      status.textContent = `Loading ${ctx.currentReference(nextVerse)}…`;
      const section = await createInterlinearVerseSection(nextVerse);
      if (section && wrap.isConnected) {
        const superscription = await createSuperscriptionSection(nextVerse);
        if (superscription) wrap.insertBefore(superscription, status);
        wrap.insertBefore(section, status);
        currentIndex += 1;
      }
      loading = false;
      updateStatus();
      if (nearBottom()) window.requestAnimationFrame(maybeLoadNext);
    };
    const nearBottom = () =>
      pane && pane.scrollHeight - pane.scrollTop - pane.clientHeight <= 160;
    const maybeLoadNext = () => {
      if (nearBottom()) void loadNext();
    };
    function onScroll() {
      maybeLoadNext();
    }
    function restoreLazyLoad() {
      stopInterlinearLazyLoad();
      if (!wrap.isConnected) return;
      stopInterlinearLazyLoad = stop;
      pane?.addEventListener("scroll", onScroll, { passive: true });
      updateStatus();
      window.requestAnimationFrame(maybeLoadNext);
    }
    wrap.addEventListener("detail:restore", restoreLazyLoad);
    stopInterlinearLazyLoad = stop;
    pane?.addEventListener("scroll", onScroll, { passive: true });
    updateStatus();
    window.requestAnimationFrame(maybeLoadNext);
  }

  function showInterlinearChapter() {
    stopInterlinearLazyLoad();
    if (!ctx.canUseCapability?.("interlinear")) {
      setDetail(
        "Language Study",
        createStudyEmptyState(ctx, "interlinear", {
          capabilityIds: ["interlinear"],
        }),
      );
      return;
    }
    const verses = interlinearVerses();
    if (!verses.length) {
      setDetailMessage("Language Study", "No Language Study data found for this chapter.");
      return;
    }

    const wrap = document.createElement("div");
    wrap.className = "interlinear-picker";
    const heading = document.createElement("h3");
    heading.textContent = `${ctx.state.verseBook?.book?.name || ctx.state.bookId} ${ctx.state.chapter} Language Study`;
    const intro = document.createElement("p");
    intro.textContent =
      "Choose a verse to inspect source text, Strong's numbers, morphology, glosses, and token renderings.";
    wrap.append(heading, intro);
    wrap.append(
      createDetailList(verses, (li, verse) => {
        const reference = ctx.currentReference(verse);
        li.append(ctx.createReferenceButton(reference, { book_id: ctx.state.bookId, chapter: ctx.state.chapter, verse_start: verse }));
        const inspect = document.createElement("button");
        inspect.type = "button";
        inspect.className = "mini-button";
        inspect.textContent = "Inspect";
        inspect.addEventListener("click", () => void showInterlinearVerse(reference, verse));
        li.append(inspect);
      }),
    );
    setDetail("Language Study", wrap);
  }

  return {
    showInterlinearChapter,
    showInterlinearVerse,
  };
}
