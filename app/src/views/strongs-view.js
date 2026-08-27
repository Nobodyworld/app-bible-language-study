import {
  fetchLexiconEntry,
  fetchVerseBook,
  fetchWordMapBook,
  loadLanguageMetadata,
} from "../data-service.js?v=pr13-live-qa-20260711e";
import { els, isDetailHoverLocked, setDetail, textNode } from "../dom.js?v=pr13-live-qa-20260711e";
import { capabilityMessage } from "../capabilities.js";
import {
  languageUnitTooltip,
  setLanguageTextWithTooltips,
  setTransliterationTextWithTooltips,
} from "../language-tooltips.js?v=pr13-live-qa-20260711e";
import { setMorphologyHelp } from "../morphology-tooltips.js?v=pr13-live-qa-20260711e";
import { analyzeOriginalWord, gematriaValueForUnit, languageUnitDisplayGlyph, wordHasLanguageScript } from "../language.js";
import { createStrongReferenceControl, resolveStrongSeeSegments } from "../strong-reference-control.js?v=pr13-live-qa-20260711e";
import { createVerseContextTabs } from "./verse-context-tabs.js?v=pr13-live-qa-20260711e";
import { DETAIL_SCROLL_POLICIES, DETAIL_VIEW_IDS } from "../ui-contracts.js";
import {
  absentStrongSections,
  createStrongSectionLifecycle,
  resolveStrongLanguage,
  resolveStrongSectionLifecycle,
  strongSectionAvailabilityFor,
  STRONG_SECTION_AVAILABILITY,
} from "../strong-section-lifecycle.js?v=pr13-live-qa-20260711e";

function languageTitle(language) {
  return language === "hebrew" ? "Hebrew" : "Greek";
}

function displayMarkChar(record) {
  const char = record.mark?.char || record.char || "";
  return char.match(/\p{Mark}/u) ? `\u25CC${char}` : char;
}

function renderMarkPill(record) {
  const mark = record.mark;
  const pill = document.createElement("span");
  pill.className = mark ? "mark-pill" : "mark-pill unknown-mark";
  const glyph = document.createElement("span");
  glyph.className = "mark-glyph";
  glyph.textContent = displayMarkChar(record);
  const label = document.createElement("span");
  label.className = "mark-label";
  label.textContent = mark?.short_label || mark?.name || record.code_point;
  pill.title = [mark?.name, record.code_point, mark?.category, mark?.description].filter(Boolean).join(" - ");
  pill.append(glyph, label);
  return pill;
}

function tokenWordInfo(token) {
  return {
    meaning: token.english || token.gloss || token.short_definition || "",
    strongCode: token.strong_code || "",
    transliteration: token.transliteration || "",
  };
}

function renderWordBreakdown(analysis, wordInfo = null) {
  const section = document.createElement("section");
  section.className = `language-breakdown ${analysis.language}`;

  const title = document.createElement("h4");
  title.textContent = `${languageTitle(analysis.language)} word breakdown`;
  section.append(title);

  const letters = document.createElement("div");
  letters.className = "letter-breakdown";
  analysis.units.forEach((unit) => {
    const letter = document.createElement("span");
    letter.className = unit.standalone ? "letter-unit mark-unit" : "letter-unit";
    letter.dataset.tooltip = languageUnitTooltip(unit, analysis.language, { wordInfo });
    letter.setAttribute("aria-label", letter.dataset.tooltip);
    letter.tabIndex = 0;

    const glyph = document.createElement("span");
    glyph.className = "letter-glyph";
    glyph.textContent = languageUnitDisplayGlyph(unit);

    const name = document.createElement("span");
    name.className = "letter-name";
    const markName = unit.marks[0]?.mark?.name;
    name.textContent = unit.letter?.name || markName || unit.code_point;

    const value = document.createElement("span");
    value.className = "letter-value";
    const gematriaValue = gematriaValueForUnit(unit);
    value.textContent =
      analysis.language === "hebrew" && gematriaValue
        ? `${unit.letter?.transliteration || ""} = ${gematriaValue}`
        : unit.letter?.transliteration || unit.letter?.sound || "";

    letter.append(glyph, name, value);
    letters.append(letter);
  });
  let gematriaTotalNode = null;
  if (analysis.language === "hebrew") {
    const gematriaTotal = analysis.units.reduce((sum, unit) => sum + gematriaValueForUnit(unit), 0);
    const total = document.createElement("div");
    total.className = "gematria-total";
    const label = document.createElement("span");
    label.textContent = "Gematria total";
    const value = document.createElement("strong");
    value.textContent = String(gematriaTotal);
    total.append(label, value);
    gematriaTotalNode = total;
  }

  const markRecords = analysis.units.flatMap((unit) => unit.marks || []);
  if (markRecords.length) {
    const marksTitle = document.createElement("h5");
    marksTitle.textContent = `${languageTitle(analysis.language)} marks / symbols`;
    if (analysis.language === "hebrew") {
      const markStudy = document.createElement("div");
      markStudy.className = "mark-study";
      const markWord = document.createElement("div");
      markWord.className = "mark-study-word rtl-text";
      setLanguageTextWithTooltips(markWord, analysis.word, analysis.language, { wordInfo });
      markStudy.append(markWord);
      const marks = document.createElement("div");
      marks.className = "mark-list";
      markRecords.forEach((record) => marks.append(renderMarkPill(record)));
      markStudy.append(marks);
      section.append(marksTitle, markStudy, letters);
      if (gematriaTotalNode) section.append(gematriaTotalNode);
    } else {
      const marks = document.createElement("div");
      marks.className = "mark-list";
      markRecords.forEach((record) => marks.append(renderMarkPill(record)));
      section.append(letters);
      section.append(marksTitle, marks);
    }
  } else {
    section.append(letters);
    if (gematriaTotalNode) section.append(gematriaTotalNode);
  }

  if (analysis.unknown_marks.length) {
    const warning = document.createElement("p");
    warning.className = "unknown-mark-note";
    warning.textContent = `Unknown marks found: ${analysis.unknown_marks.map((record) => record.code_point).join(", ")}`;
    section.append(warning);
  }

  return section;
}

function appendLanguageBreakdown(container, token, sourceWord = token.original) {
  const language = token.language;
  if ((language !== "hebrew" && language !== "greek") || !wordHasLanguageScript(sourceWord, language)) {
    return false;
  }

  const slot = document.createElement("div");
  slot.className = "language-breakdown-slot";
  slot.textContent = "Loading word breakdown...";
  container.append(slot);

  loadLanguageMetadata(language)
    .then((metadata) => {
      if (!metadata) return;
      const analysis = analyzeOriginalWord(sourceWord, language, metadata);
      slot.replaceChildren(renderWordBreakdown(analysis, tokenWordInfo(token)));
    })
    .catch(() => {
      slot.textContent = "Word breakdown could not be loaded.";
    });

  return true;
}

function createInternalStrongButton(item, label = item?.strong_code || item?.label || "Strong's", openStrongCode) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "strong-inline-link";
  button.textContent = label;
  button.disabled = !item?.strong_code;
  button.addEventListener("click", () => {
    if (item?.strong_code) openStrongCode(item.strong_code, item.language);
  });
  return button;
}

function appendStrongNavigation(container, entry, openStrongCode) {
  const previous = entry?.navigation?.previous;
  const next = entry?.navigation?.next;
  if (!previous && !next) return;

  const nav = document.createElement("div");
  nav.className = "strong-nav";
  if (previous) {
    const label = `\u2039 Previous ${previous.strong_code || previous.label || ""}`.trim();
    const button = createInternalStrongButton(previous, label, openStrongCode);
    button.classList.add("strong-nav-prev");
    nav.append(button);
  }
  if (next) {
    const label = `Next ${next.strong_code || next.label || ""} \u203A`.trim();
    const button = createInternalStrongButton(next, label, openStrongCode);
    button.classList.add("strong-nav-next");
    nav.append(button);
  }
  container.append(nav);
}

function appendLexicalRow(list, label, value, language = null) {
  if (!value) return;
  const term = document.createElement("dt");
  term.textContent = label;
  const detail = document.createElement("dd");
  if (value instanceof Node) {
    detail.append(value);
  } else {
    if (language) {
      setLanguageTextWithTooltips(detail, value, language);
    } else {
      detail.textContent = value;
    }
  }
  list.append(term, detail);
}

function createTransliterationValue(value) {
  if (!value) return null;
  const node = document.createElement("span");
  node.className = "lexical-transliteration";
  setTransliterationTextWithTooltips(node, value, { sourceLabel: "Bundled Strong's transliteration" });
  return node;
}

function createOriginValue(entry, openStrongCode) {
  if (!entry?.word_origin && !entry?.word_origin_refs?.length) return null;
  const wrap = document.createElement("span");
  wrap.className = "word-origin-value";
  const refs = entry.word_origin_refs || [];
  const createOriginLink = (ref) => {
    const label = ref.label || ref.original_word || ref.strong_code || "Origin word";
    const button = createStrongReferenceControl(ref, {
      label,
      onActivate: (item) => openStrongCode(item.strong_code, item.language),
    });
    button.classList.add("strong-origin-link");
    return button;
  };

  let remaining = String(entry.word_origin || "");
  const extraLinks = [];
  refs.forEach((ref) => {
    const label = String(ref.label || ref.original_word || "").trim();
    const index = label ? remaining.toLowerCase().indexOf(label.toLowerCase()) : -1;
    if (index >= 0) {
      wrap.append(textNode(remaining.slice(0, index)), createOriginLink(ref));
      remaining = remaining.slice(index + label.length);
      return;
    }
    extraLinks.push(createOriginLink(ref));
  });
  if (remaining) wrap.append(textNode(remaining));
  extraLinks.forEach((link) => {
    if (wrap.childNodes.length) wrap.append(textNode(" "));
    wrap.append(link);
  });
  return wrap;
}

function appendLexicalSummary(container, entry, openStrongCode) {
  const section = document.createElement("section");
  section.className = "lexical-summary";
  const heading = document.createElement("h4");
  heading.textContent = "Lexical summary";
  const rows = document.createElement("dl");

  appendLexicalRow(rows, "Original word", entry.original_word, entry.language);
  appendLexicalRow(rows, "Transliteration", createTransliterationValue(entry.transliteration));
  appendLexicalRow(rows, "Phonetic spelling", entry.phonetic_spelling);
  appendLexicalRow(rows, "Part of speech", entry.part_of_speech);
  appendLexicalRow(rows, "Short definition", entry.short_definition);
  if (entry.meaning && entry.meaning !== entry.short_definition) {
    appendLexicalRow(rows, "Meaning", entry.meaning);
  }
  appendLexicalRow(rows, "KJV renderings", entry.kjv_renderings);
  appendLexicalRow(rows, "Word origin", createOriginValue(entry, openStrongCode));
  appendLexicalRow(rows, "Concordance definition", entry.concordance_definition);

  if (!rows.children.length) return;
  section.append(heading, rows);
  container.append(section);
}

function cleanStrongCode(value) {
  const match = String(value || "").match(/^([HG])0*(\d+)/i);
  return match ? `${match[1].toUpperCase()}${Number(match[2])}` : String(value || "");
}

function mapRowToSpan(row, verseText) {
  if (!Array.isArray(row)) return null;
  const start = Number(row[2]);
  const end = Number(row[3]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return {
    strongTokenIndex: row[0],
    sourceTokenIndex: row[1],
    start,
    end,
    strongCode: cleanStrongCode(row[4]),
    language: row[5],
    text: String(verseText || "").slice(start, end),
  };
}

function findWordMapSpan(wordMapBook, chapter, verse, token, verseText) {
  const rows = wordMapBook?.chapters?.[String(chapter)]?.[String(verse)] || [];
  const strongCode = cleanStrongCode(token.strong_code);
  const tokenIndex = Number(token.token_index ?? token.index ?? token.strong_token_index);
  const candidates = rows
    .map((row) => mapRowToSpan(row, verseText))
    .filter((span) => span?.strongCode === strongCode);
  if (!candidates.length) return null;
  if (Number.isFinite(tokenIndex)) {
    const exact = candidates.find((span) => Number(span.strongTokenIndex) === tokenIndex);
    if (exact) return exact;
  }
  return candidates[0];
}

function verseTextFromBook(book, chapter, verse) {
  return cleanRenderedVerseText(book?.chapters?.[String(chapter)]?.[String(verse)] || "");
}

function cleanRenderedVerseText(value) {
  return String(value || "")
    .replace(/\|/g, '"')
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function appendRenderingRow(list, { label, value, note, exact = false }) {
  if (!value) return;
  const row = document.createElement("div");
  row.className = exact ? "translation-rendering-row exact" : "translation-rendering-row";
  const heading = document.createElement("div");
  heading.className = "translation-rendering-label";
  heading.textContent = label;
  const text = document.createElement("div");
  text.className = "translation-rendering-value";
  text.textContent = value;
  row.append(heading, text);
  if (note) {
    const noteLine = document.createElement("div");
    noteLine.className = "translation-rendering-note";
    noteLine.textContent = note;
    row.append(noteLine);
  }
  list.append(row);
}

function appendTranslationRenderings(container, token, options = {}, viewCtx = null) {
  if (!viewCtx || !token.strong_code || !options.verseContext) return;
  const { bookId, chapter } = viewCtx.state;
  const verse = options.verseContext.verse;
  if (!bookId || !chapter || !verse) return;

  const section = document.createElement("section");
  section.className = "translation-renderings";
  const heading = document.createElement("h4");
  heading.textContent = "Translation renderings";
  const list = document.createElement("div");
  list.className = "translation-rendering-list";
  const status = document.createElement("p");
  status.className = "translation-rendering-note";
  status.textContent = "Loading translation renderings...";
  section.append(heading, status, list);
  container.append(section);

  const priorityTranslationIds = ["bsb", "kjv", "ylt"];
  const translationById = new Map((viewCtx.state.manifest?.translations || []).map((translation) => [translation.id, translation]));

  Promise.all(
    priorityTranslationIds.map(async (translationId) => {
      const translation = translationById.get(translationId);
      if (!translation) return null;
      const [book, wordMapBook] = await Promise.all([fetchVerseBook(translationId, bookId), fetchWordMapBook(translationId, bookId)]);
      const text = verseTextFromBook(book, chapter, verse);
      if (!text) return null;
      const span = wordMapBook ? findWordMapSpan(wordMapBook, chapter, verse, token, text) : null;
      return {
        label: translation.code || translation.id.toUpperCase(),
        value: span?.text || text,
        note: span?.text ? "Exact mapped word or phrase span" : "Verse context; no exact word-map span found for this token",
        exact: Boolean(span?.text),
      };
    }),
  )
    .then(async (priorityRows) => {
      if (!section.isConnected) return;
      list.replaceChildren();

      priorityRows.filter(Boolean).forEach((row) => appendRenderingRow(list, row));

      const otherTranslations = (viewCtx.state.manifest?.translations || [])
        .filter((translation) => translation?.id && !priorityTranslationIds.includes(translation.id) && !["wlc", "wlco", "nestle", "tr94"].includes(translation.id))
        .slice(0, 24);

      const loadedRows = await Promise.all(
        otherTranslations.map(async (translation) => {
          const book = await fetchVerseBook(translation.id, bookId);
          const text = verseTextFromBook(book, chapter, verse);
          if (!text) return null;
          return {
            label: translation.code || translation.id.toUpperCase(),
            value: text,
            note: "Verse context; exact word alignment pending",
          };
        }),
      );

      loadedRows.filter(Boolean).forEach((row) => appendRenderingRow(list, row));
      status.textContent = "BSB, KJV, and YLT show exact spans where generated word maps exist; other translations show verse context until their word maps are built.";
    })
    .catch(() => {
      if (section.isConnected) status.textContent = "Translation renderings could not be loaded.";
    });
}

function appendLexiconConcordance(container, entry, openStrongCode, token = {}, languageContext = {}) {
  const sections = [];
  const seen = new Set();

  if (entry.strongs_concordance) {
    sections.push(["Strong's Concordance", entry.strongs_concordance, true]);
    seen.add("Strong's Concordance");
  }

  Object.entries(entry.sections || {}).forEach(([label, text]) => {
    if (!text || seen.has(label)) return;
    sections.push([label, text, false]);
    seen.add(label);
  });

  const language = resolveStrongLanguage({
    token,
    strongMetadata: entry,
    sourceMetadata: languageContext.sourceMetadata,
    sources: languageContext.sources,
    bookId: languageContext.bookId,
    testament: languageContext.testament,
  });
  if (!sections.length) return absentStrongSections();

  const wrap = document.createElement("section");
  wrap.className = "lexicon-sections";
  if (language === "hebrew" || language === "greek") wrap.dataset.strongSection = language;
  const heading = document.createElement("h4");
  heading.textContent = "Concordance and lexicon notes";
  wrap.append(heading);

  sections.forEach(([label, text, open]) => {
    const details = document.createElement("details");
    details.className = "lexicon-section";
    details.open = Boolean(open);
    const summary = document.createElement("summary");
    summary.textContent = label;
    const body = formatLexiconText(text, entry.word_origin_refs || [], openStrongCode);
    body.className = "concordance-text";
    details.append(summary, body);
    wrap.append(details);
  });

  container.append(wrap);
  return strongSectionAvailabilityFor(language, STRONG_SECTION_AVAILABILITY.present);
}

function formatLexiconText(text, refs = [], openStrongCode = null) {
  const body = document.createElement("div");
  const normalized = String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\s+—\s*/g, " — ")
    .replace(/([.;])\s+(\d+\s+[A-Za-z])/g, "$1\n$2")
    .replace(/\n(?=\d+\s)/g, "\n\n");
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);

  (paragraphs.length ? paragraphs : [normalized.trim()]).forEach((paragraph) => {
    const line = document.createElement("p");
    line.className = /^\d+\s/.test(paragraph) ? "lexicon-line section-line" : "lexicon-line";
    resolveStrongSeeSegments(paragraph, refs).forEach((segment) => {
      if (!segment.label) {
        line.append(textNode(segment.text));
        return;
      }
      line.append(textNode(segment.text));
      const control = segment.ref && openStrongCode
        ? createStrongReferenceControl(segment.ref, {
            label: segment.label,
            onActivate: (item) => openStrongCode(item.strong_code, item.language),
          })
        : null;
      line.append(control || textNode(segment.label));
    });
    body.append(line);
  });
  return body;
}

function compactDefinition(entry) {
  return (
    entry?.short_definition ||
    entry?.meaning ||
    entry?.concordance_definition ||
    String(entry?.strongs_concordance || "")
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ||
    ""
  );
}

function setOptionalLine(node, value) {
  const text = String(value || "").trim();
  node.hidden = !text;
  node.textContent = text;
}

export function createStrongsView(ctx = null) {
  let strongPinned = false;
  let currentStrongDetail = null;

  function clearStrongPin() {
    strongPinned = false;
  }

  function scrollStrongSection(section) {
    const target = currentStrongDetail?.querySelector(`[data-strong-section="${section}"]`);
    const scroller = els.detail;
    if (!target || !scroller?.contains(target)) return false;
    currentStrongDetail.querySelectorAll("[data-strong-section-active]").forEach((node) => {
      delete node.dataset.strongSectionActive;
    });
    target.dataset.strongSectionActive = "true";
    const scrollerRect = scroller.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const desiredTop = scroller.scrollTop + targetRect.top - scrollerRect.top;
    const maximumTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const top = Math.min(Math.max(0, desiredTop), maximumTop);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scroller.scrollTo({ top, behavior: reducedMotion ? "auto" : "smooth" });
    return true;
  }

  function openStrongCode(strongCode, language) {
    ctx?.clearReaderHighlight?.();
    showStrong(
      {
        strong_code: strongCode,
        language,
      },
      { pin: true, force: true, forceHistory: true },
    );
  }

  function readerContextForStrong(token, options) {
    if (Object.prototype.hasOwnProperty.call(options, "readerContext")) return options.readerContext;
    const verse = options.verseContext?.verse || null;
    if (!verse) return null;
    return {
      verse,
      word: {
        interlinearKey: token.interlinear_key || token.interlinearKey || "",
        strongCode: token.strong_code || "",
        tokenIndex: token.token_index == null ? "" : String(token.token_index),
        language: token.language || "",
        original: token.original || "",
      },
    };
  }

  function showStrong(token, options = {}) {
    if (!ctx?.canUseCapability?.("strongs-overlay")) {
      if (!options.hover) {
        setDetail("Strong's", document.createTextNode(capabilityMessage(ctx?.getCapabilityState?.("strongs-overlay"))), {
          viewId: DETAIL_VIEW_IDS.strongs,
        });
      }
      return;
    }
    if (options.hover && isDetailHoverLocked()) return;
    if (options.hover && !isDetailHoverLocked() && strongPinned) strongPinned = false;
    if (strongPinned && !options.pin && !options.force) return;
    if (options.pin) strongPinned = true;
    const isLockedSpan = Boolean(options.pin && token.english);

    const wrap = document.createElement("div");
    wrap.className = "strong-detail";
    currentStrongDetail = wrap;
    let updateStrongSections = () => {};
    const strongSectionLifecycle = createStrongSectionLifecycle(
      (availability) => updateStrongSections(availability),
      () => currentStrongDetail === wrap && wrap.isConnected,
    );
    const heading = document.createElement("h3");
    heading.textContent = token.english || token.original || token.strong_code || "Strong's entry";

    const stickySummary = document.createElement("div");
    stickySummary.className = "strong-sticky-summary";

    const overview = document.createElement("section");
    overview.className = "strong-overview";
    overview.dataset.strongSection = "word";

    const primary = document.createElement("div");
    primary.className = "strong-overview-primary";

    const sourceWordDisplay = document.createElement("p");
    sourceWordDisplay.className = "strong-source-word";

    const translit = document.createElement("p");
    translit.className = "strong-overview-translit";

    const rtlNote = document.createElement("button");
    rtlNote.type = "button";
    rtlNote.className = "hebrew-rtl-note";
    rtlNote.textContent = "!";
    rtlNote.title = "Explain Hebrew reading direction";
    rtlNote.setAttribute("aria-label", rtlNote.title);
    rtlNote.setAttribute("aria-expanded", "false");
    rtlNote.setAttribute("aria-controls", "strongHebrewRtlExplanation");
    rtlNote.hidden = true;

    primary.append(rtlNote, sourceWordDisplay, translit);

    const rtlExplanation = document.createElement("p");
    rtlExplanation.id = "strongHebrewRtlExplanation";
    rtlExplanation.className = "hebrew-rtl-explanation";
    rtlExplanation.textContent =
      "Hebrew is displayed from right to left. Begin with the character on the right; the transliteration remains left to right.";
    rtlExplanation.hidden = true;
    rtlNote.addEventListener("click", () => {
      const expanded = rtlNote.getAttribute("aria-expanded") === "true";
      rtlNote.setAttribute("aria-expanded", String(!expanded));
      rtlExplanation.hidden = expanded;
    });

    const gloss = document.createElement("p");
    gloss.className = "strong-overview-gloss";

    const meta = document.createElement("div");
    meta.className = "strong-overview-meta";
    const codeText = document.createElement("span");
    codeText.className = "strong-code";
    const pos = document.createElement("span");
    pos.className = "strong-overview-pos";
    const badge = document.createElement("span");
    badge.className = "strong-overview-badge";
    meta.append(codeText, pos, badge);

    function renderOverview(entry = null) {
      if (!token.english && entry) {
        heading.textContent = entry.summary || entry.title || token.strong_code || "Strong's entry";
      }
      if (isLockedSpan) {
        badge.textContent = "Selected span";
        badge.hidden = false;
      } else {
        badge.textContent = "";
        badge.hidden = true;
      }
      const language = token.language || entry?.language;
      const sourceWord = entry?.original_word || token.original || "";
      const isHebrew = language === "hebrew";
      overview.classList.toggle("hebrew", isHebrew);
      rtlNote.hidden = !isHebrew || !sourceWord;
      if (rtlNote.hidden) {
        rtlNote.setAttribute("aria-expanded", "false");
        rtlExplanation.hidden = true;
      }
      setOptionalLine(sourceWordDisplay, sourceWord);
      if (sourceWord) {
        sourceWordDisplay.classList.toggle("rtl-text", isHebrew);
        setLanguageTextWithTooltips(sourceWordDisplay, sourceWord, language);
      }
      const translitText = token.transliteration || entry?.transliteration || "";
      setOptionalLine(translit, translitText && translitText !== sourceWord ? translitText : "");
      if (!translit.hidden) {
        setTransliterationTextWithTooltips(translit, translitText, { sourceLabel: "Bundled Strong's transliteration" });
      }
      const morphology = token.morphology || entry?.part_of_speech || "";
      pos.hidden = !morphology;
      if (morphology) setMorphologyHelp(pos, morphology, language);
      codeText.textContent = token.strong_code || "No Strong's number";
      gloss.textContent = token.gloss || compactDefinition(entry) || (entry ? "No short definition available." : "Loading lexical summary...");
    }

    renderOverview();
    overview.append(primary, rtlExplanation, meta, gloss);
    stickySummary.append(heading, overview);
    wrap.append(stickySummary);
    if (options.verseContext && !options.hover && ctx) {
      const tabs = createVerseContextTabs(
        ctx,
        options.verseContext.reference,
        options.verseContext.verse,
        DETAIL_VIEW_IDS.strongs,
        null,
      );
      updateStrongSections = tabs.updateStrongSectionAvailability || updateStrongSections;
      wrap.append(tabs);
    }
    const renderedTokenBreakdown = appendLanguageBreakdown(wrap, token);
    setDetail("Strong's", wrap, {
      history: options.hover ? "replace" : "push",
      transient: Boolean(options.hover),
      forceHistory: Boolean(options.forceHistory || options.pin || options.force),
      invoker: options.invoker || null,
      readerContext: readerContextForStrong(token, options),
      scrollPolicy: options.scrollPolicy || DETAIL_SCROLL_POLICIES.reset,
      viewId: DETAIL_VIEW_IDS.strongs,
    });

    const extra = token.strong_code ? document.createElement("div") : null;
    if (extra) {
      extra.className = "lexicon-extra";
      extra.textContent = "Loading lexicon entry...";
      wrap.append(extra);
    }
    appendTranslationRenderings(wrap, token, options, ctx);

    void resolveStrongSectionLifecycle({
      token,
      lifecycle: strongSectionLifecycle,
      loadEntry: fetchLexiconEntry,
      isCurrent: () => wrap.isConnected && currentStrongDetail === wrap,
      onAbsent: (reason) => {
        if (!extra) return;
        extra.textContent = reason === "null" ? "No lexicon entry found." : "Lexicon entry could not be loaded.";
      },
      availabilityForEntry: (entry) => {
        extra.replaceChildren();
        const title = document.createElement("h4");
        title.textContent = entry.summary || entry.title || token.strong_code;
        renderOverview(entry);
        extra.append(title);
        appendLexicalSummary(extra, entry, openStrongCode);
        appendStrongNavigation(extra, entry, openStrongCode);
        if (!renderedTokenBreakdown && entry.original_word) {
          appendLanguageBreakdown(extra, { ...token, language: entry.language || token.language }, entry.original_word);
        }
        const availability = appendLexiconConcordance(extra, entry, openStrongCode, token, {
          bookId: ctx?.state?.bookId,
          sourceMetadata: token?.source_metadata || token?.sourceMetadata || null,
          sources: ctx?.state?.manifest?.original_language_sources,
          testament: token?.testament,
        });
        return availability;
      },
    });
  }

  return { appendLanguageBreakdown, clearStrongPin, showStrong, scrollStrongSection };
}
