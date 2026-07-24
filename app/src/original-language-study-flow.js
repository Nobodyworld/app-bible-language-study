import { fetchLexiconEntry } from "./data-service.js?v=pr13-live-qa-20260711e";
import {
  setLanguageTextWithTooltips,
  setTransliterationTextWithTooltips,
} from "./language-tooltips.js?v=pr13-live-qa-20260711e";
import { createStrongReferenceControl } from "./strong-reference-control.js?v=pr13-live-qa-20260711e";

const INTERLINEAR_DETAIL_TITLE = "Language Study";
const ENHANCED_ATTRIBUTE = "data-original-language-study";

function createSectionHeading(text, className) {
  const heading = document.createElement("div");
  heading.className = className;
  heading.textContent = text;
  return heading;
}

function languageForCard(card) {
  return String(card.dataset.strongCode || "").toUpperCase().startsWith("H") ? "hebrew" : "greek";
}

function hasLanguageScript(text, language) {
  const value = String(text || "");
  return language === "hebrew" ? /[\u0590-\u05ff]/u.test(value) : /[\u0370-\u03ff\u1f00-\u1fff]/u.test(value);
}

function validStrongCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return /^[HG]\d+$/u.test(code) ? code : "";
}

function createRelatedEntryControl(item, language, card) {
  const row = document.createElement("li");
  const code = validStrongCode(item?.strong_code);
  const label = String(item?.label || "Related entry").trim();
  if (!code) {
    row.textContent = [item?.strong_code, label].filter(Boolean).join(" — ");
    return row;
  }
  const button = createStrongReferenceControl({ ...item, strong_code: code, language }, {
    label: `${code} — ${label}`,
    onActivate: async () => {
    const section = card.closest(".interlinear-verse-section");
    const entry = await fetchLexiconEntry(code).catch(() => null);
    button.dispatchEvent(new CustomEvent("language-study:open-strong", {
      bubbles: true,
      detail: {
        strongCode: code,
        label,
        language,
        entry,
        verseContext: {
          verse: section?.dataset.verse,
          segmentId: section?.dataset.segmentId || undefined,
          reference: section?.querySelector(":scope > h3")?.textContent?.replace(/\s+— Superscription$/u, ""),
        },
      },
    }));
    },
  });
  button.classList.add("link-button", "compact-link", "original-language-related-link");
  row.append(button);
  return row;
}

async function appendLexicalContext(card, source, language, originalIsScript) {
  const strongCode = String(card.dataset.strongCode || "");
  if (!strongCode) return;
  const entry = await fetchLexiconEntry(strongCode);
  if (!entry || !card.isConnected) return;

  if (!originalIsScript && entry.original_word && hasLanguageScript(entry.original_word, language)) {
    const label = createSectionHeading("Dictionary form", "original-language-card-label");
    const word = document.createElement("div");
    word.className = "original-language-dictionary-word";
    word.lang = language === "hebrew" ? "he" : "grc";
    word.dir = language === "hebrew" ? "rtl" : "ltr";
    setLanguageTextWithTooltips(word, entry.original_word, language);
    source.prepend(label, word);
  }

  const originText = String(entry.word_origin || "").trim();
  const related = Array.isArray(entry.word_origin_refs) ? entry.word_origin_refs.filter((item) => item?.strong_code) : [];
  if (!originText && !related.length) return;

  const details = document.createElement("section");
  details.className = "original-language-word-origin";
  if (originText) {
    details.append(createSectionHeading("Word origin", "original-language-card-label"));
    const origin = document.createElement("p");
    origin.textContent = originText;
    details.append(origin);
  }
  if (related.length) {
    details.append(
      createSectionHeading(
        language === "hebrew" ? "Related Hebrew entries" : "Related Greek entries",
        "original-language-card-label",
      ),
    );
    const list = document.createElement("ul");
    list.className = "original-language-related-entries";
    related.forEach((item) => list.append(createRelatedEntryControl(item, language, card)));
    details.append(list);
  }
  source.after(details);
}

function enhanceWordCard(card) {
  if (!(card instanceof HTMLElement) || card.hasAttribute(ENHANCED_ATTRIBUTE)) return;

  const original = card.querySelector(":scope > .token-original");
  const transliteration = card.querySelector(":scope > .token-translit");
  const meta = card.querySelector(":scope > .token-meta");
  const english = card.querySelector(":scope > .token-english");
  const gloss = card.querySelector(":scope > .token-gloss");

  if (!original || !meta || !english || !gloss) return;

  card.setAttribute(ENHANCED_ATTRIBUTE, "true");
  card.classList.add("original-language-word-card");
  card.setAttribute("role", "listitem");

  const summary = document.createElement("div");
  summary.className = "original-language-word-summary";
  summary.append(createSectionHeading("Word meaning", "original-language-card-label"), english, gloss, meta);

  const language = languageForCard(card);
  const originalIsScript = hasLanguageScript(original.textContent, language);
  const source = document.createElement("div");
  source.className = "original-language-word-source";
  source.append(createSectionHeading(originalIsScript ? "Source word" : "Transliteration", "original-language-card-label"), original);
  if (!originalIsScript) {
    original.classList.add("original-language-token-transliteration");
    setTransliterationTextWithTooltips(original, original.textContent, {
      sourceLabel: "Bundled interlinear transliteration",
    });
  }
  if (originalIsScript && transliteration) source.append(transliteration);

  card.prepend(source);
  card.prepend(summary);
  appendLexicalContext(card, source, language, originalIsScript);
}

function languageForTokenList(tokenList) {
  return tokenList.querySelector(":scope > .interlinear-token[data-strong-code^='H']") ? "hebrew" : "greek";
}

function verseTransliteration(tokenList, language) {
  return [...tokenList.querySelectorAll(":scope > .interlinear-token")]
    .map((card) => {
      const transliteration = card.querySelector(":scope > .token-translit")?.textContent.trim();
      const original = card.querySelector(":scope > .token-original")?.textContent.trim();
      if (transliteration) return transliteration;
      return original && !hasLanguageScript(original, language) ? original : "";
    })
    .filter(Boolean)
    .join(" ");
}

function createSourceList(tokenList) {
  const language = languageForTokenList(tokenList);
  const sourceList = document.createElement("div");
  sourceList.className = "source-text-list";
  const unavailable = document.createElement("p");
  unavailable.className = "original-language-source-unavailable";
  unavailable.textContent = `Original ${language === "hebrew" ? "Hebrew" : "Greek"} source text unavailable.`;
  sourceList.append(unavailable);
  return sourceList;
}

function decorateSourceList(sourceList, tokenList) {
  const language = languageForTokenList(tokenList);
  sourceList.classList.add("original-language-source-card");
  sourceList.prepend(
    createSectionHeading(language === "hebrew" ? "Original Hebrew" : "Original Greek", "original-language-section-label"),
  );

  const transliterationText = verseTransliteration(tokenList, language);
  if (!transliterationText) return;
  const row = document.createElement("div");
  row.className = "original-language-transliteration-row";
  const label = document.createElement("div");
  label.className = "reference-label";
  label.textContent = "Transliteration";
  const text = document.createElement("div");
  text.className = "original-language-transliteration";
  text.dir = "ltr";
  setTransliterationTextWithTooltips(text, transliterationText, {
    sourceLabel: "Bundled interlinear transliteration",
  });
  row.append(label, text);
  sourceList.append(row);
}

function enhanceVerseSection(section) {
  if (!(section instanceof HTMLElement) || section.hasAttribute(ENHANCED_ATTRIBUTE)) return;

  const reference = section.querySelector(":scope > h3");
  let sourceList = section.querySelector(":scope > .source-text-list");
  const tokenList = section.querySelector(":scope > .interlinear-token-list");
  if (!reference || !tokenList) return;

  if (!sourceList) {
    sourceList = createSourceList(tokenList);
    tokenList.before(sourceList);
  }

  section.setAttribute(ENHANCED_ATTRIBUTE, "true");
  section.classList.add("original-language-verse-card");
  reference.classList.add("original-language-verse-reference");

  decorateSourceList(sourceList, tokenList);

  tokenList.classList.add("original-language-word-grid");
  tokenList.setAttribute("role", "list");
  tokenList.setAttribute("aria-label", `${reference.textContent.trim()} word-by-word study`);
  tokenList.before(createSectionHeading("Word-by-word study", "original-language-section-heading"));
  tokenList.querySelectorAll(":scope > .interlinear-token").forEach(enhanceWordCard);
}

function ensureStudyIntroduction(root) {
  if (!(root instanceof HTMLElement) || root.querySelector(":scope > .original-language-study-intro")) return;

  const intro = document.createElement("section");
  intro.className = "original-language-study-intro";
  const eyebrow = document.createElement("div");
  eyebrow.className = "original-language-study-eyebrow";
  eyebrow.textContent = "Original Language Study";
  const summary = document.createElement("p");
  summary.textContent =
    "Read the complete Hebrew or Greek verse first, then inspect each source word with its English sense, Strong's reference, morphology, transliteration, and study tools.";
  intro.append(eyebrow, summary);

  const contextTabs = root.querySelector(":scope > .verse-context-tabs");
  if (contextTabs) contextTabs.after(intro);
  else root.prepend(intro);
}

function enhanceInterlinearPicker(picker) {
  if (!(picker instanceof HTMLElement) || picker.hasAttribute(ENHANCED_ATTRIBUTE)) return;
  picker.setAttribute(ENHANCED_ATTRIBUTE, "true");
  picker.classList.add("original-language-study-picker");
  const intro = picker.querySelector(":scope > p");
  if (intro) {
    intro.textContent =
      "Choose a verse to read the full source text and inspect each Hebrew or Greek word with Strong's, morphology, glosses, transliteration, and personal study controls.";
  }
}

function enhanceOriginalLanguageStudy() {
  const detailTitle = document.getElementById("detailTitle");
  const detailContent = document.getElementById("detailContent");
  if (!detailTitle || !detailContent || detailTitle.textContent.trim() !== INTERLINEAR_DETAIL_TITLE) return;

  detailContent.querySelectorAll(".interlinear-lazy-reader").forEach(ensureStudyIntroduction);
  detailContent.querySelectorAll(".interlinear-verse-section").forEach(enhanceVerseSection);
  detailContent.querySelectorAll(".interlinear-picker").forEach(enhanceInterlinearPicker);
}

let enhancementQueued = false;
function queueStudyEnhancement() {
  if (enhancementQueued) return;
  enhancementQueued = true;
  window.requestAnimationFrame(() => {
    enhancementQueued = false;
    enhanceOriginalLanguageStudy();
  });
}

const detailTitle = document.getElementById("detailTitle");
const detailContent = document.getElementById("detailContent");
const observer = new MutationObserver(queueStudyEnhancement);
if (detailTitle) observer.observe(detailTitle, { childList: true, characterData: true, subtree: true });
if (detailContent) observer.observe(detailContent, { childList: true, subtree: true });

document.getElementById("showInterlinear")?.addEventListener("click", queueStudyEnhancement);
document.addEventListener("click", (event) => {
  const target = event.target;
  if (target instanceof Element && target.closest(".verse-context-tabs")) queueStudyEnhancement();
});

queueStudyEnhancement();
