import { extractScriptureReferences } from "./references.js";
import { resolveScripturePassage } from "./data-service.js?v=pr13-live-qa-20260711e";
import { currentDetailIntent, isDetailIntentCurrent } from "./dom.js?v=pr13-live-qa-20260711e";

export function attachFootnoteScripture(wrap, note, ctx) {
  const references = extractScriptureReferences(note.text, ctx.state.manifest?.books);
  if (!references.length) return;
  const section = document.createElement("section");
  section.className = "footnote-scripture";
  section.setAttribute("aria-label", "Referenced scripture");
  const heading = document.createElement("h4");
  heading.textContent = "Referenced scripture";
  const version = document.createElement("p");
  version.className = "footnote-scripture-version";
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "footnote-scripture-refresh";
  refresh.textContent = "Refresh scripture";
  const list = document.createElement("div");
  section.append(heading, version, refresh, list);
  wrap.append(section);
  let generation = 0;

  async function hydrate() {
    const ticket = ++generation, intent = currentDetailIntent();
    const translationId = ctx.state.translationId;
    const translation = ctx.state.manifest?.translations?.find(t => t.id === translationId);
    version.textContent = `${translation?.code || translationId?.toUpperCase() || "Unknown version"} · Reader translation`;
    list.replaceChildren();
    const current = () => ticket === generation && wrap.isConnected && ctx.state.translationId === translationId && isDetailIntentCurrent(intent);
    await Promise.all(references.map(async entry => {
      const article = document.createElement("article");
      article.className = "footnote-scripture-entry";
      const label = document.createElement("h5");
      label.textContent = entry.label;
      const status = document.createElement("p");
      status.className = "footnote-scripture-status";
      status.setAttribute("role", "status");
      status.textContent = "Loading scripture…";
      article.dataset.status = "loading";
      article.append(label, status);
      list.append(article);
      const result = entry.unsupported
        ? {status:"unsupported", message:"This reference format is not supported. Use a complete book, chapter and verse range."}
        : !translation
          ? {status:"unavailable", message:"The selected translation is unavailable. No other version was substituted."}
          : await resolveScripturePassage(translationId, entry.reference);
      if (!current()) return;
      article.dataset.status = result.status;
      if (result.status !== "available") { status.textContent = result.message; return; }
      status.textContent = `${result.translation_code} · ${result.verses.length} ${result.verses.length === 1 ? "verse" : "verses"}`;
      const passage = document.createElement("div");
      passage.className = "footnote-scripture-passage";
      for (const verse of result.verses) {
        const line = document.createElement("p");
        const number = document.createElement("span");
        number.className = "footnote-scripture-number";
        number.textContent = `${verse.chapter}:${verse.verse} `;
        const text = document.createElement("bdi");
        text.dir = "auto";
        text.textContent = verse.text;
        line.append(number, text);
        passage.append(line);
      }
      const long = result.verses.length > 3 || result.verses.reduce((n, v) => n + v.text.length, 0) > 650;
      if (long) {
        passage.tabIndex = 0;
        passage.setAttribute("role", "region");
        passage.setAttribute("aria-label", `${entry.label}, ${result.translation_code}`);
        const details = document.createElement("details"), summary = document.createElement("summary");
        details.className = "footnote-scripture-expanded";
        const update = () => { summary.textContent = `${details.open ? "Collapse" : "Show"} all ${result.verses.length} verses`; };
        details.addEventListener("toggle", update);
        update();
        details.append(summary, passage);
        article.append(details);
      } else article.append(passage);
      const navigate = document.createElement("button");
      navigate.type = "button";
      navigate.className = "link-button footnote-scripture-open";
      navigate.textContent = `Read ${entry.label} in ${result.translation_code}`;
      navigate.addEventListener("click", () => {
        if (current()) void ctx.goToLocation(entry.reference.book_id, entry.reference.chapter, entry.reference.verse_start);
      });
      article.append(navigate);
    }));
  }
  refresh.addEventListener("click", () => void hydrate());
  wrap.dataset.detailRestore = "footnote-scripture";
  wrap.addEventListener("detail:restore", () => void hydrate());
  void hydrate();
}
