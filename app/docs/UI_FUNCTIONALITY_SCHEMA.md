# UI Functionality Contract

Reviewed: 2026-08-12

## Control placement

- The chapter study-tool group contains Search, Language Study, and Outline. The workspace group contains Study Marks and one global My Data control titled `Settings, backup, and personal study data`.
- Processing and Study Data are not separate reader-header or home actions. Home exposes one My Data action.
- Contextual side-panel navigation follows one compact visible scope order: `Word → Verse`.
- Word and Verse controls render in `#detailContext` when a verse detail is active. Chapter Language Study and Book Outline remain reader-header actions and do not mount as persistent side-panel groups.
- The derived scope semantics and tool ownership remain centralized in `src/panel-context-model.js`; hiding Chapter and Book from the compact side panel does not remove their valid application scope.
- Word is present only when canonical word/source-token context exists for the active verse, and it is always the first scope when present.
- Verse owns the Verse self-control, Parallel, References, Commentary, verse Language Study, and the side-panel verse Study Marks trigger. In the reader, the verse number owns the canonical inline verse Study Marks picker; there is no separate verse-row Study Marks icon.
- Chapter owns the chapter-level Language Study entry. Book owns Outline.
- A compact context summary identifies the selected word and containing verse without repeating explanatory prose inside each detail view.
- Visible contextual labels use the full product terms Verse, Parallel, References, Commentary, and Language. Stable short DOM labels (`Par`, `Refs`, `Cmt`, `Int`) remain only for existing browser automation compatibility; full labels are rendered and exposed through `title` and `aria-label`.
- `Language Study` is the user-facing name. Existing `Interlinear` identifiers, capability names, data contracts, and test names remain intentionally internal.
- Mobile exposes a Study panel launcher so side-panel-only tools remain reachable.
- There is exactly one Book mark control and one Chapter mark control. Each shared trigger contains a real visible `Book` or `Chapter` label, the official Study Marks SVG, and its bounded active-mark count in one button. Favorite remains a `favorite` assertion reported through `aria-pressed`; the menu also exposes the other tags applicable to that target.
- Book and Chapter mark triggers expose menu state through `aria-haspopup="menu"` and `aria-expanded`. Active non-favorite tags remain visible outside the closed menu as persistent editable badges.
- Book and Chapter mark controls rerender after tag changes and after navigation so their labels, icons, counts, badges, targets, and menu contents remain current.
- The reader ellipsis is only the verse study-tools launcher. It remains hover/focus-revealed on pointer devices and touch-reachable on coarse layouts; a locked reader context does not make it permanently visible.
- Verse-context and Language Study source-token Study Marks controls use canonical targets and preserve Favorite as the `favorite` assertion.
- Language Study source-token tag actions open the target-aware tag editor. The editor only presents active tags whose `allowed_target_types` include `source_token`.
- Selecting reader text exposes Favorite, Tags, Study, Draft, and Red letters actions. Favorite and Tags use one canonical `text_span` target.

The executable control map is `src/ui-contracts.js`. The scoped navigation order and tool matrix are `src/panel-context-model.js`.

## Scoped panel context

The panel distinguishes direct data ownership from inherited containing context:

| Scope | Direct tools/data | Availability |
|---|---|---|
| Word | Strong's/lexical detail, source word, morphology, word-level actions | Only when canonical word context exists |
| Verse | Parallel text, references, commentary, verse Language Study, verse Study Marks | When a verse is active |
| Chapter | Reader-header Language Study entry | When a chapter is active |
| Book | Reader-header Outline entry | When a book is active |
| Global/user | My study data, backup/restore, app settings, local maintenance, advanced diagnostics | My Data in the reader header and home |

A selected word retains its containing Verse controls. `Word` is the current self-control only for exact canonical word context; `Verse` is the current self-control for whole-verse context. Parallel, References, Commentary, and Language are actions rather than false current-context claims. Chapter and Book keep their valid scope semantics while remaining attached to their reader-header controls. Word detail must never imply that cross-references or commentary belong to the lexical entry itself.

`src/active-word-context.js` is the explicit authority for the selected word available to contextual navigation. It stores only a token plus navigation options, suppresses forced duplicate history entries, rejects a stored word when its verse does not match the active verse, and clears through existing navigation/reset paths. View code must not read or write an ad hoc `studyContext.strong` property.

## My Data

My Data is one stable global detail-history entry and follows this order: My study data, Backup and restore, App settings, Local maintenance, and Advanced diagnostics. Reopening the current My Data view does not add a duplicate history entry. Global activation clears transient word/verse study context and retains the reader route. The existing Study panel launcher keeps the view reachable on mobile.

The summary prioritizes user-owned records: custom labels, tagged verses, Study Mark assertions, active Study Marks, personal meanings, and preserved legacy verse drafts. It states that storage belongs to the current browser, is not an online account, and requires user-downloaded backups for portability.

Backup download and merge/replace import preserve `bibleapp:user-data` version 3. Raw export and paste textareas are optional disclosures. Replace uses an accessible explicit confirmation, creates the existing pre-replace recovery backup, and supports Cancel/Escape without mutation. Validation happens before store mutation; malformed, foreign, or future-version data reports an error.

App settings intentionally contains no package capability toggles. Theme remains in the global header. Technical capability controls, storage details, package operations, job states, raw payloads/results, simulations, run/requeue controls, and other internal records remain usable only inside Advanced diagnostics, which is collapsed by default and renders raw values as text.

Local maintenance exposes `Refresh Study Marks index` as a repeat-safe recovery action. It rebuilds a derived browser-local projection, reports success/failure/unavailability in plain language, and does not alter canonical personal study data. It is not external synchronization; the app has no account, cloud backup, cross-device sync, remote update check, or new network call.

## Responsive panel placement

- Desktop keeps the side panel sticky beside the reader and requires the detail heading to remain visible. The reader and study workspace remain two practical columns at every width above the established mobile breakpoint.
- The desktop-only width group exposes `compact`, `standard`, and `expanded`; Standard is the default. The stored mode is declarative on the root element and is separate from the detail panel's `follow`/`locked` interaction state.
- Normal desktop bounds are `clamp(320px, 25vw, 420px)`, `clamp(400px, 33vw, 620px)`, and `clamp(500px, 40vw, 760px)`. From `769px` through `1100px`, they are constrained to `clamp(300px, 32vw, 340px)`, `clamp(340px, 38vw, 400px)`, and `clamp(380px, 44vw, 440px)` so Expanded cannot force horizontal overflow.
- From `769px` through `960px`, the app header becomes three rows. The still-adjacent detail panel therefore uses a larger sticky offset and reduced viewport height so its heading and context summary begin below the header.
- At `768px` and below, the detail panel becomes the existing full-screen mobile surface.
- Width controls are hidden on mobile without changing the stored desktop mode; returning above `768px` reapplies that mode's responsive bounds.
- Context controls wrap; the scoped navigation must not create horizontal document or panel overflow. The sticky pane has a bounded usable-viewport height, while `#detailContent` owns panel scrolling independently from document/reader scrolling.

## Study-workspace width preference and anchoring

The browser-local UI preference key is `bibleapp:study-workspace-width:v1`. Only the exact strings `compact`, `standard`, and `expanded` are supported. Missing, malformed, unsupported, unavailable, or throwing storage falls back to Standard without blocking startup. The key is never part of the portable `bibleapp:user-data` export.

Changing width synchronously records the selected source word or active verse as a semantic anchor, falling back to the first meaningfully visible verse/source segment. It records the anchor's viewport top, applies only the root width attribute, re-resolves the same reference/token identity, and corrects document scroll by the resulting delta. It also retains the detail scroller's practical `scrollTop`. Width changes do not render the reader, replace the detail DOM, call `scrollIntoView`, or mutate route, hash, browser history, panel history/forward history, selection, Strong's section, follow/locked state, focus, or user data.

## Control availability

Every study control resolves to exactly one state:

| State | Enabled | Meaning |
|---|---:|---|
| `enabled` | yes | Required capability and scoped data are available. |
| `capability_unavailable` | no | A required package or capability is disabled, missing, or invalid. |
| `data_unavailable` | no | The capability exists, but the current book, chapter, or verse has no applicable data. |

The chapter Language Study control requires the internal interlinear capability plus at least one tokenized verse in the current chapter. The verse `Int` automation label represents the visibly rendered Language control and requires tokens for that exact verse. Strong's concordance controls resolve in this order: recognized canonical selected-token language, Strong code or authoritative Strong metadata, source metadata, then book/testament fallback. An unrecognized canonical placeholder may still yield to exact Strong/source evidence, but never to broad testament inference; otherwise unknown language renders neither. Only the resolved Hebrew or Greek control renders. The rendered control follows the existing loading/present/absent lifecycle with native `disabled`, `aria-disabled`, title, accessible name, and unavailable state. The current scoped self-control uses `aria-current="page"` and remains visually distinct.

## Panel interaction modes

| Mode | Behavior |
|---|---|
| `follow` | Reader Strong's hover may show transient word details. |
| `locked` | The selected panel remains open while reader and interlinear tokens can still highlight each other. |

These interaction modes are unrelated to the three study-workspace width modes and share no normalization, persistence, or transition authority.

Transitions:

- Activating a chapter tool, side-panel tool, verse action, context control, Strong's token, or detail action enters `locked`.
- Hover alone never enters `locked`.
- Clicking a disengage/background target, clearing the panel, or resetting it returns to `follow`.
- Changing translation, book, or chapter returns to `follow`, clears the Strong's pin and stale detail content, and preserves reader-location Back/Forward history.
- Panel Back/Forward restores the saved panel and mode. Restoring an internal interlinear verse view must re-arm its lazy loader.
- Scope navigation reuses the existing detail-history and lock authority in `src/dom.js`; it must not create another history stack or independent lock state.

## Runtime module identity

All versioned static JavaScript imports use one release query key. Stateful modules, especially `dom.js` and `stores.js`, must resolve to one URL throughout the runtime graph. Different query strings create independent browser module instances and would split panel history, lock state, or persistence authority.

## Internal interlinear rendering and synchronization

Reader and panel tokens match by `verse + token_index`. Strong's code is used only when it identifies exactly one token.

- Reader token hover/focus highlights and scrolls the matching interlinear card into view.
- Language Study card hover/focus highlights the matching reader token.
- Leaving either token clears both temporary highlights.
- Synchronization does not unlock or replace a locked panel.
- A verse inspection renders one verse initially and appends the next verse as the user nears the bottom of `#detailContent`.
- Cards must constrain both original-language and English/gloss columns so long words wrap without overlapping.
- Hebrew-only analysis such as gematria and Hebrew mark details must not render for Greek tokens.
- Original-language analysis separates base-letter records from attached mark metadata. Each visible Greek letter glyph reconstructs its base letter plus every attached mark and safely normalizes the display cluster.
- Greek breathing marks, accents, diaeresis, iota subscript, and multiple attached marks remain on the visible glyph. Letter names and base transliterations continue to come from the base alphabet record.
- The separate `Greek marks / symbols` list remains explanatory detail. The shared Hebrew analysis and gematria behavior remain intact.
- Each card's favorite and tag actions use the exact canonical `source_token` target built from its verse reference and token metadata; they do not infer identity from display text.
- Active non-favorite source-token tags render as editable card badges without replacing the favorite star.

## Strong's reference controls

- Word origin, Language Study related entries, and valid concordance `see GREEK` / `see HEBREW` references share the Strong's reference-control contract.
- Destinations resolve from exact structured metadata. Unresolved references remain plain text.
- Pointer, keyboard, focus, and touch access hydrate app-controlled previews without changing panel history. Activating a resolved reference opens the destination Strong's entry, and panel Back restores the originating panel.
- App-controlled language and Strong's previews are clamped or flipped within the intersection of the visible detail panel and viewport.

## Reader text-span selection

- Every rendered verse-text segment carries its canonical start/end character offsets.
- A selection derives its range from the DOM Range endpoints, not by searching for the selected string. Repeated words therefore retain the selected occurrence's identity.
- Leading/trailing whitespace is excluded from the canonical target and snapshot.
- Selecting text takes precedence over activating a Strong's token.
- Tagged spans render a visible highlight and editable tag badges.
- Snapshot drift resolves only when the original offsets still match or the snapshot has one unique relocated occurrence. Ambiguous or unresolved snapshots are not rendered on arbitrary text.

## Canonical reference context

Navigation and selection use one immutable hierarchy:

`translation → testament → book → chapter → verse → word`

`src/reference-context.js` normalizes this context and creates stable keys at translation, testament, book, chapter, verse, or word scope. A word key ends at its verse-local token index; Strong's code, language, and original spelling are metadata, not identity.

Committed selection and transient hover remain separate:

- `activeReferenceContext` changes only through navigation or explicit selection.
- `hoverReferenceContext` exists only during follow-along highlighting.
- Leaving a hovered word clears only `hoverReferenceContext`.
- Persisted records require a complete key for their declared scope. Key generation rejects missing or unknown hierarchy data.

The navigation reference hierarchy supports one word token. Text spans and source-token spans use the separate schema-v2 semantic target model and are not forced into the navigation word key.

Tag persistence uses schema-v2 semantic targets for book, chapter, verse, verse range, text span, source token, and source-token span. `verse_tags` remains a rebuildable verse-only compatibility projection; `tag_target_index` indexes every supported target type.

## Persistence startup boundary

IndexedDB initialization and migration have a three-second boundary. If the browser blocks or stalls the request, startup continues with the localStorage backend instead of leaving the reader on its loading shell.

## Executable validation

- `tests/ui-contracts.mjs`: availability, panel transitions, control schema, corrected data scopes, and token identity.
- `tests/panel-context-model.mjs`: Word-first scope order, tool ownership, active-word API, shell ordering, full visible labels, responsive wrapping, and narrow sticky-offset contracts.
- `tests/study-workspace-width.mjs`: exact width-mode normalization/defaults, fault-tolerant persistence, key isolation, follow/locked separation, and active-button state.
- `tests/study-workspace-contracts.mjs`: declarative widths, responsive clamps, independent scrolling, semantic anchors, reusable contained surface, lifecycle cleanup, and explicit panel presentations.
- `tests/reference-context.mjs`: hierarchy normalization and stable keys.
- `tests/interlinear.mjs`: packaged interlinear data contracts, Greek marked-glyph reconstruction, and shared Hebrew gematria behavior.
- `tests/module-singletons.mjs`: one release key and singleton URLs for stateful runtime modules.
- `tests/strong-reference-control.mjs`: exact concordance reference resolution and unresolved plain-text fallback.
- `tests/reader-ui-regressions.mjs`: source-level reader layout, panel-aware tooltip, concordance control, and navigation-reset regressions.
- `tests/original-language-study.mjs`: visible Language Study naming and source-backed study/reference behavior.
- `app/scripts/panel-context-interaction-test.mjs`: light/dark desktop, narrow, and mobile Word-first ordering, inherited Verse navigation, Verse-only clearing, explicit contained source-word and verse Study Marks tools, focus restoration, horizontal-overflow checks, sticky-header placement, visible headings, and browser-error coverage.
- `app/scripts/study-workspace-interaction-test.mjs`: all three width modes, reload/storage failure, reader-anchor and panel-state preservation, independent scroll ownership, contained tools, responsive desktop/mobile transitions, theme/reduced-motion, overflow, and browser-error coverage.
- `app/scripts/original-language-study-interaction-test.mjs`: rendered source/transliteration rows, lazy study enhancement, related-reference preview/navigation/history, and tooltip-containment behavior when the browser runner is available.
- `app/scripts/interaction-test.mjs`: rendered interaction behavior, including reader text-span selection, favorite controls, editable target badges, source-token tagging, Favorites grouping, panel history, and cleanup, when the browser runner is available.
## Compact side-panel Study Marks contract

The reader side panel is limited to the current exact Word (when present) and Verse context. Its selected-word summary is visually separated from a compact control row. Chapter Language Study and Book Outline remain reader-header actions. Study Marks is one reusable icon trigger backed by the canonical target-aware picker; Book, Chapter, Verse, selected English text, and exact source tokens preserve their existing separate semantic targets and Favorite remains the `favorite` tag assertion. Meaning is a separate action beside Study Marks on exact Language Study source-token cards and in the pinned exact-word Word row. It is absent from transient, lexicon-only, and whole-verse contexts and is not a Study Marks behavior.

The reader verse number retains its inline picker as the canonical verse Study Marks control, while the adjacent ellipsis opens verse study tools. Book and Chapter use actual visible scope labels inside their shared triggers, not CSS-generated label text.

Inside the detail pane, source-word and verse Study Marks open only after explicit button activation and use the shared contained tool surface layered over the existing work area. The surface shows the exact target label/preview, Favorite, every valid tag, and Manage tags. Opening, closing, Escape, and Cancel-like dismissal are data-neutral; an explicit toggle updates that exact canonical target immediately. The preserved work area becomes inert and `aria-hidden` without reflow or DOM replacement, and Close/Escape restores the original trigger or a stable same-target replacement after a legitimate rerender. Manage tags cleanly transitions to the full editor through the existing single detail-history entry.

Meaning uses the same surface only through its explicit `presentation: "detail-pane"` contract; the default non-panel fixed-dialog presentation remains available. Contained Meaning retains exact `source_token` validation, lazy exact-English/lexicon suggestions, quick choices, Other/custom input, Save, Cancel, and Remove. Open/close/Cancel are data-neutral, while Save and Remove mutate only the exact canonical source token. Study Marks and Meaning remain separate tools that replace one another through the single overlay coordinator without stale Escape ownership.

The reusable surface is a sibling of the preserved work area inside `.detail-workspace`; it never participates in `#detailContent` snapshots or adds panel height. Escape closes only the active contained tool. Detail replacement, Back, Forward, Clear/reset, route navigation, and mobile dismissal remove its ownership before any underlying detail snapshot or replacement.
