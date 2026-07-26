# Bible App Reader

> **PUBLIC PREVIEW — ACTIVE DEVELOPMENT**
>
> The static reader is functional and actively developed. Compact reader
> context, personal Meaning, Study Marks, and My Data remain evolving product
> surfaces. This repository does not promise a production release or stable
> API.
>
> Application code, tests, scripts, schemas, and tooling are MIT-licensed.
> Bundled Bible and study data retains its own source rights and notices.
> Downstream users must review [NOTICE.md](NOTICE.md) and
> [`app/data/source-manifest.json`](app/data/source-manifest.json) before
> redistribution.

Bible App Reader is a local-first Bible study workspace that runs as a static
browser application. It combines multi-translation reading, hover-first
supplemental context, Hebrew and Greek Language Study, commentary,
cross-references, Strong's lexicons, structured study marks, and portable
browser-local data without requiring an account, hosted backend, analytics
service, or remote application API.

The app keeps the reader primary while deeper material remains close at hand.
Reader words, references, source-language forms, morphology, transliteration
marks, and related lexical entries reveal context through hover, keyboard focus,
touch, and explicit activation.

## What Makes It Different

| Capability | Practical value |
|---|---|
| Hover-first study | Supplemental word, reference, language, and lexical context appears on demand without permanently crowding the reader. |
| Local-first reading | Reading and research do not depend on a hosted service or account. |
| Integrated context | Reader text, commentary, outlines, cross-references, Strong's data, and source-language records remain connected in one workspace. |
| Original-language depth | Hebrew and Greek cards separate source text, transliteration, pronunciation guidance, dictionary form, morphology, glosses, word origin, and related entries. |
| Structured Study Marks | Favorites and tags can be attached at book, chapter, verse, text-span, and source-token scope. |
| Portable personal data | Browser-local study state can be exported, imported, and recovered as JSON. |
| Auditable package | Source manifests, notices, deterministic data tools, package inventory, and verification scripts are included. |

## Study Experience

### Reader and navigation

- Ten bundled English Bible translations.
- Book and chapter navigation for desktop, narrow, and mobile layouts.
- Footnotes, outlines, commentary, parallel passages, cross-references, and
  verse-scoped actions.
- Reader-to-panel word highlighting and panel history restoration.
- Prose, headings, superscriptions, poetry, and indentation retain their intended
  presentation.

### Hover-first supplemental context

- Reader words can show transient Strong's and language detail without changing
  the reading location.
- Reference controls can preview a passage before navigation.
- Language and transliteration elements explain letters, marks, and scholarly
  notation on demand.
- Transient previews do not intentionally replace a locked panel or mutate panel
  history.
- Pointer interactions have keyboard and practical touch equivalents.

The interaction model is functional today. Additional unification remains
tracked in issue #16.

### Hebrew and Greek Language Study

- Westminster Leningrad Codex and consonants-only Hebrew records.
- Nestle Greek New Testament 1904 and Scrivener's Textus Receptus 1894 records.
- Source text, transliteration, phonetic spelling, lemma, gloss, morphology,
  Strong's entries, word origin, and related lexical references.
- Hebrew marks and gematria where applicable.
- Greek letter analysis preserving breathing marks, accents, diaeresis, iota
  subscript, and other attached marks.
- Lazy verse loading so extended chapter study does not render every card at
  once.

### Study Marks and browser-local data

- Canonical semantic targets for books, chapters, verses, ranges, text spans,
  source tokens, and source-token spans.
- Favorite remains the canonical `favorite` assertion, with applicable tags at
  each supported scope.
- A Study Marks dashboard for reviewing tagged and favorited targets.
- Personal Meaning is separate from Study Marks and applies only to exact
  canonical source-token identity.
- One My Data surface organized as My study data, Backup and restore, App
  settings, Local maintenance, and Advanced diagnostics. Advanced diagnostics
  is collapsed and lazy by default.

Study Marks and personal Meaning remain separate user tools. My Data keeps raw
job, package, storage, and capability controls out of the ordinary reader path.
Portable exports retain kind `bibleapp:user-data` and version `3`, including
sparse legacy compatibility, recovery backups before replacement, and
all-or-nothing rejection of malformed imports. Browser-local data is not an
account; users should download backups they care about.

### Resilience and accessibility

- IndexedDB startup falls back to localStorage when browser storage is blocked
  or stalls beyond the startup boundary.
- Keyboard-operable study controls and visible focus treatment.
- Pointer, focus, keyboard, and touch support for app-controlled previews.
- Reduced-motion, forced-colors, right-to-left source text, and mobile touch
  coverage where static or browser verification is practical.
- Tooltips and previews are constrained to the visible panel and viewport.

## Context and Side-Panel Direction

Study information exists at different scopes:

- a **word** owns lexical, source-language, morphology, and saved-meaning data;
- a **verse** owns parallel text, references, commentary, and verse Study Marks;
- a **chapter** owns chapter navigation and chapter-level Language Study entry;
- a **book** owns outline and book-level study context;
- global/user tools own personal data, package, and diagnostic functions.

The accepted compact contextual side-panel hierarchy is `Word → Verse`. Word is
present only for exact canonical word or source-token context; Verse retains its
parallel, reference, commentary, Language Study, and Study Marks actions.
Chapter Language Study and Book Outline remain reader-header actions rather than
persistent side-panel groups. The shared detail pane preserves panel lock,
highlight, and history behavior while leaving more room for study material.

## Screenshots

These 19 captures are the current, manually reviewed, accepted public-preview
evidence for the reader and personal-study experience. They are generated by
the maintained capture workflow from deterministic UI state and reviewed at
actual size. The `interlinear*.png` filenames remain technical, while the
product surface they show is Language Study.

### Reader and navigation

| View | Light | Dark |
|---|---|---|
| Reader | ![Psalm 23 reader](docs/images/reader.png) | ![Dark Psalm 23 reader](docs/images/reader-dark.png) |
| Compact `Word → Verse` detail | ![Exact-token compact detail](docs/images/detail-panel.png) | ![Dark exact-token compact detail](docs/images/detail-panel-dark.png) |
| Distinct mobile state | ![Open mobile Psalm 118:4 Verse study panel](docs/images/mobile.png) | ![Dark mobile John 1:1 My Data summary](docs/images/mobile-dark.png) |

- [Book picker](docs/images/book-picker.png)
- [Verse context controls](docs/images/verse-context-controls.png)

### Study surfaces

| View | Light | Dark |
|---|---|---|
| Language Study | [John 11:35 Language Study](docs/images/interlinear.png) | [Dark John 11:35 Language Study](docs/images/interlinear-dark.png) |
| Hebrew and Strong's detail | [Exact Hebrew token and Strong's detail](docs/images/hebrew-side-panel.png) | [Dark exact Hebrew token and Strong's detail](docs/images/hebrew-side-panel-dark.png) |
| Study Marks | [Seeded exact-token Favorite](docs/images/study-marks.png) | [Dark seeded exact-token Favorite](docs/images/study-marks-dark.png) |

- [Populated search results](docs/images/search.png)
- [Exact-token personal Meaning dialog](docs/images/meaning.png)

### My Data

- [My study data summary](docs/images/my-data.png)
- [Backup and restore controls](docs/images/my-data-backup-restore.png)
- [Completed local maintenance](docs/images/my-data-maintenance.png)

## Run Locally

### Prerequisites

- Node.js 20 or newer.
- A modern browser.
- Microsoft Edge on Windows when running the complete automated browser suite.

```powershell
npm ci
npm run serve
```

Open:

```text
http://127.0.0.1:8000/#/read/bsb/psalms/23
```

Routes are hash-based, so the app can run from the included Node static server
without a framework-specific deployment runtime.

## Verification

```powershell
npm run inventory:check
npm run test:static
npm run test:browser
npm run test:browser:mobile
npm run verify
npm audit --audit-level=low
gitleaks detect --source . --no-git=false
git diff --check
```

`npm run verify` runs the static, domain, accessibility-source, desktop-browser,
mobile-browser, inventory, and publish-audit suites. Browser automation currently
uses Microsoft Edge on Windows; broader manual browser QA remains tracked in
issue #7.

See [the test inventory](tests/TEST_INVENTORY.md) for the executable coverage
map.

## Architecture

The application is intentionally deployable as static files:

- `app/index.html`, `app/app.js`, and the app stylesheets provide the shell.
- Focused ES modules under `app/src/` implement routing, rendering, panel state,
  study tools, semantic targets, persistence, and package state.
- Deterministic runtime datasets live under `app/data/`.
- Schemas and data-generation tools live under `app/schemas/` and `app/tools/`.
- Repository-level integrity and regression tests live under `tests/`.

Further documentation:

- [Architecture](docs/ARCHITECTURE.md)
- [Data model](docs/DATA_MODEL.md)
- [Security posture](docs/SECURITY_POSTURE.md)
- [UI functionality contract](app/docs/UI_FUNCTIONALITY_SCHEMA.md)
- [Test inventory](tests/TEST_INVENTORY.md)

Repository-wide documentation and loose-file reconciliation is completed
through issue #15. The dependency-ordered program roadmap is issue #22.

## Package Inventory and Repository Size

The current full-study package contains:

- 10 reader translations;
- 29 feature packs;
- 2,804 packaged files;
- 954,311,610 aggregate bytes;
- 180,460,807 aggregate gzip bytes.

The repository is much larger than a typical static web project. Keeping the data
together allows the preview to run without a hosted data service. Post-public
measurement and data-pack planning remain tracked in issue #6.

## Data Rights

Application code, tests, scripts, schemas, and tooling are available under the
MIT License. Bundled Bible and study data retains its source rights and notices
and is not described as MIT-licensed.

Before redistributing bundled content, review:

- [NOTICE.md](NOTICE.md)
- [`app/data/source-manifest.json`](app/data/source-manifest.json)

Some retained source notices contain both permission or copyright language and
later public-domain wording. The repository preserves those notices and the
recorded transformations so downstream users can inspect provenance rather than
rely on an oversimplified license summary. Publication of this repository does
not create a blanket relicensing conclusion for bundled data.

## Security and Privacy Model

Bible App Reader has no server-side account system, analytics service, payment
flow, remote write API, or application backend. Personal study state remains in
the current browser profile unless the user exports it.

The static application includes a Content Security Policy and sanitizes
commentary HTML, but changes involving HTML rendering, imported data, browser
persistence, or bundled third-party content still require review.

See [SECURITY.md](SECURITY.md) for vulnerability reporting and the current
repository-security posture.

## Current Boundaries

- Browser-local study data does not automatically synchronize across devices or
  browser profiles.
- There is no collaborative account system or cloud backup.
- Automated browser QA is currently Edge-focused.
- The bundled package increases clone and checkout size.
- The side-panel, Meaning, Study Marks, and My Data interfaces are
  active-development surfaces rather than stable APIs.
- Bundled data should be redistributed only after reviewing the included source
  notices and manifest.

## Project Status

The repository is **PUBLIC PREVIEW — ACTIVE DEVELOPMENT**. Public visibility is
separate from a stable release, release tag, API promise, or blanket relicensing
of bundled data.

Compact `Word → Verse` context, unified target-aware Study Marks, exact
source-token Meaning, consolidated My Data, and repository documentation
reconciliation are complete. The maintained public screenshot workflow and its
current capture review are also complete. Remaining work is dependency-ordered
under issue #22:

- issue #16 — remaining hover-first, touch, and containment evidence;
- issues #6 and #7 — later package/performance classification and broader
  manual browser QA;
- issue #5 — live security evidence and final release/tag gates.

No release or tag is authorized by this status or by automated checks alone.

## Contributing

Focused bug reports, documentation corrections, accessibility findings,
data-rights questions, and reproducible browser issues are welcome. See
[CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.
