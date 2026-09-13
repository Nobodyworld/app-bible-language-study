export function referenceKey(bookId, chapter, verse) {
  return `${bookId}:${chapter}:${verse}`;
}

export function refDomId(key) {
  return `ref-${key.replace(/[^a-z0-9_-]/gi, "-")}`;
}

// Human-readable references share the Reader's canonical book metadata. Only
// explicit book + chapter:verse forms are recognized; aliases never pick an
// arbitrary book when metadata collides.
export function extractScriptureReferences(text, books = []) {
  const aliases = new Map();
  for (const book of books) {
    for (const name of [book.name, book.osis, book.id?.replaceAll("_", " "), ...(book.aliases || []), ...(book.id === "psalms" ? ["Psalm"] : [])]) {
      if (!name) continue;
      const key = name.toLowerCase().replace(/\.$/, "").trim();
      aliases.set(key, aliases.has(key) && aliases.get(key) !== book.id ? null : book.id);
    }
  }
  if (!aliases.size) return [];
  const names = [...aliases.keys()].sort((a, b) => b.length - a.length).map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])(${names.join("|")})\\.?\\s+(\\d+):(\\d+)(?:\\s*[-–—]\\s*(?:(\\d+):)?(\\d+))?(?![\\p{L}\\p{N}])`, "giu");
  const input = String(text || "");
  const references = [], seen = new Set();
  for (const match of input.matchAll(pattern)) {
    const bookId = aliases.get(match[1].toLowerCase());
    if (!bookId) continue;
    const reference = {book_id:bookId, chapter:Number(match[2]), verse_start:Number(match[3]), chapter_end:Number(match[4] || match[2]), verse_end:Number(match[5] || match[3])};
    const suffix = input.slice(match.index + match[0].length);
    // A malformed range or abbreviated list must not become a shorter passage.
    const unsupported = /^\s*(?:[-–—:]|,\s*\d)/.test(suffix);
    const key = JSON.stringify(reference) + unsupported;
    if (seen.has(key)) continue;
    seen.add(key);
    references.push({label:match[0], reference, unsupported});
  }
  return references;
}

export function parseLocationFromHref(href, findBook) {
  if (!href) return null;
  const normalized = href.replace(/\\/g, "/");
  let match = normalized.match(/#\/read\/[^/]+\/([^/]+)\/(\d+)(?:\/(\d+))?/i);
  if (match && findBook(decodeURIComponent(match[1]))) {
    return {
      book_id: decodeURIComponent(match[1]),
      chapter: Number(match[2]),
      verse_start: Number(match[3] || 1),
    };
  }
  match = normalized.match(/\/([1-3]?[a-z0-9_]+)\/(\d+)-(\d+)\.htm/i);
  if (match && findBook(match[1])) {
    return {
      book_id: match[1],
      chapter: Number(match[2]),
      verse_start: Number(match[3]),
    };
  }
  match = normalized.match(/\/([1-3]?[a-z0-9_]+)\/(\d+)\.htm(?:#(\d+))?/i);
  if (match && findBook(match[1])) {
    return {
      book_id: match[1],
      chapter: Number(match[2]),
      verse_start: Number(match[3] || 1),
    };
  }
  return null;
}

export function createReferenceButton(label, location, goToLocation) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "link-button";
  button.textContent = label;
  // Store location data for hover highlighting
  button.dataset.bookId = location.book_id;
  button.dataset.chapter = location.chapter;
  button.dataset.verse = location.verse_start || location.verse || 1;
  button.addEventListener("click", () => {
    void goToLocation(location.book_id, location.chapter, location.verse_start || location.verse || 1);
  });
  return button;
}

export function makeInternalLinksNavigable(container, findBook, goToLocation) {
  container.addEventListener("click", (event) => {
    const link = event.target.closest?.("a[href]");
    if (!link) return;
    const location = parseLocationFromHref(link.getAttribute("href"), findBook);
    if (!location) return;
    event.preventDefault();
    void goToLocation(location.book_id, location.chapter, location.verse_start);
  });
}
