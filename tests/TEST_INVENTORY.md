# Test Inventory and Disposition

Reviewed: 2026-07-23

## Authority

`package.json` is the executable authority for test composition. This document
explains the tracked coverage map; it must be updated when package scripts add,
remove, or reclassify a maintained test.

## Command Map

| Command | Current composition |
|---|---|
| `npm run test:static` | Repository integrity and data contracts, UI/source regressions, public-preview and public-screenshot policy, domain tests, generated package-inventory check, accessibility-source checks, and documentation consistency. |
| `npm run test:domain` | Job, package, poll, recovery, semantic-target, and user-data behavior under `app/scripts/`. |
| `npm run test:browser` | Desktop rendered interaction, highlight, Language Study, Language Study tooltip containment, Strong's preview, compact context, Study Marks, and Meaning flows. |
| `npm run test:browser:mobile` | The maintained interaction journey in mobile mode. |
| `npm test` | Static, desktop-browser, and mobile-browser suites. |
| `npm run audit` | Public package/file audit through `app/tools/publish-audit.mjs`. |
| `npm run verify` | `npm test` followed by the public package audit. |

## Focused Aliases

These maintained aliases expose narrower checks without changing the suite
composition above:

| Command | Direct coverage |
|---|---|
| `npm run audit:health` | `tests/integrity.mjs`. |
| `npm run test:integrity` | `tests/integrity.mjs`. |
| `npm run test:capabilities` | `tests/capabilities.mjs`. |
| `npm run test:analysis` | `tests/analysis.mjs`. |
| `npm run test:interlinear` | `tests/interlinear.mjs`. |
| `npm run test:tags` | `tests/tags.mjs`. |
| `npm run test:public-preview` | `tests/public-preview-readiness.mjs`. |
| `npm run test:word-meaning` | `tests/word-meaning.mjs`. |
| `npm run test:word-meaning-focus` | `app/scripts/word-meaning-focus-test.mjs`. |
| `npm run test:ui` | UI contracts and compact panel-context model tests. |

## Static and Source-Level Tests

The following scripts are invoked directly by `test:static`, in package-script
order:

| Script | Maintained coverage |
|---|---|
| `tests/integrity.mjs` | Tracked package, manifest, path, and bundled-data integrity. |
| `tests/serve-app.mjs` | Static server behavior and application delivery boundaries. |
| `tests/run.mjs` | Core runtime-data and application-source contracts. |
| `tests/capabilities.mjs` | Capability declarations and availability behavior. |
| `tests/analysis.mjs` | Generated analysis data and manifest contracts. |
| `tests/interlinear.mjs` | Internal interlinear records, token resolution, marked Greek glyphs, and Hebrew analysis behavior. |
| `tests/strong-reference-control.mjs` | Structured Strong's reference resolution and plain-text fallback. |
| `tests/ui-contracts.mjs` | Control schema, availability, scopes, and panel transitions. |
| `tests/panel-context-model.mjs` | Compact `Word → Verse` ordering, tool ownership, labels, and responsive contracts. |
| `tests/strong-section-lifecycle.mjs` | Strong's section loading, presence, absence, and rerender lifecycle. |
| `tests/reader-ui-regressions.mjs` | Reader layout and source-level UI regressions, including retired header controls. |
| `tests/original-language-source-importer.mjs` | Reproducible original-language source transformation. |
| `tests/original-language-source-data.mjs` | Packaged Hebrew and Greek source coverage and identity. |
| `tests/original-language-study.mjs` | Language Study entry, source-backed cards, and related-reference behavior. |
| `tests/morphology.mjs` | Original-language morphology parsing and display contracts. |
| `tests/module-singletons.mjs` | Release-key consistency and singleton stateful module URLs. |
| `tests/reference-context.mjs` | Immutable reference hierarchy and stable navigation keys. |
| `tests/tags.mjs` | Tag definitions, assertions, target applicability, and projections. |
| `tests/word-meaning.mjs` | Exact canonical source-token Meaning storage and compatibility. |
| `tests/word-meaning-hidden.mjs` | Hidden Meaning-dialog regression behavior. |
| `tests/public-preview-readiness.mjs` | Public-preview status, rights/provenance, security, and release-authorization boundaries. |
| `tests/public-screenshot-contract.mjs` | Public capture manifest, retired-dependency guard, generated inventory, documentation references, and tracked screenshot consistency. |
| `app/scripts/accessibility-test.mjs` | Static accessibility and retired-control source assertions. |
| `app/scripts/doc-consistency-test.mjs` | Classified maintained-document, command, manifest, job, schema, and current-product consistency. |

`test:static` also runs `npm run test:domain` and
`npm run inventory:check`. The inventory command checks the generated package
manifest through `app/tools/refresh-package-inventory.mjs --check`.

## Domain Tests

| Script | Maintained coverage |
|---|---|
| `app/scripts/job-processor-test.mjs` | Declared processors, job execution, persistence, and stale-result handling. |
| `app/scripts/package-planner-test.mjs` | Current package dependencies, install/removal plans, and summaries. |
| `app/scripts/package-state-test.mjs` | Bundled/managed package modes, capability toggles, operations, and import/export. |
| `app/scripts/poll-response-test.mjs` | Poll identity, updates, aggregates, tombstones, schema behavior, and import/export. |
| `app/scripts/recovery-scenarios-test.mjs` | IndexedDB fallback/migration, quota visibility, malformed imports, backups, quarantine, and legacy export migration. |
| `app/scripts/semantic-test.mjs` | Semantic definitions, relations, propositions, and current target types. |
| `app/scripts/user-data-semantic-test.mjs` | Schema-v2 targets/assertions, migrations, graph projection, revisions, quarantine, version-3 import/export, and sparse legacy compatibility. |

`app/scripts/schema-validation.mjs` is the maintained helper imported by domain
tests for lightweight schema assertions; it is not a separate package-script
entry.

## Browser Tests

| Script | Invocation | Maintained coverage |
|---|---|---|
| `app/scripts/interaction-test.mjs` | Desktop and `--mobile` | Main rendered reader journey, selection, Study Marks, My Data, persistence, and cleanup. |
| `app/scripts/frozen-highlight-interaction-test.mjs` | Desktop | Locked/frozen reader-to-panel highlighting. |
| `app/scripts/original-language-study-interaction-test.mjs` | Desktop | Rendered Language Study data, lazy enhancement, references, history, and tooltip containment. |
| `app/scripts/language-study-tooltip-interaction-test.mjs` | Desktop, narrow, mobile-width, and optional touch mode | Exact H3068 Language Study readiness plus morphology and original-language mark tooltip interaction, containment, dismissal, repositioning, and state non-mutation. |
| `app/scripts/strong-preview-hydration-test.mjs` | Desktop | Strong's preview hydration and interaction lifecycle. |
| `app/scripts/panel-context-interaction-test.mjs` | Desktop | Compact context, scope inheritance, Study Marks containment, responsive layout, and browser-error checks. |
| `app/scripts/word-meaning-focus-test.mjs` | Desktop | Meaning and Study Marks overlay coordination, dismissal, focus, and non-mutation behavior. |

## Historical July 1 Promotion and Retirement Record

The 2026-07-01 audit promoted previously local domain scripts into the tracked
`test:domain` command and retained `schema-validation.mjs` as their helper. That
event is historical context; the current command map above is authoritative.

The same audit left these obsolete local scripts untracked:

| Script | Historical disposition | Replacement or reason |
|---|---|---|
| `contract-test.mjs` | Retired | Assumed removed text-edition/package metadata; current integrity, capability, analysis, semantic, documentation, and publish audits cover maintained contracts. |
| `search-test.mjs` | Retired | Targeted an obsolete generated search manifest and modular search packs; runtime search is covered by integrity and rendered interaction tests. |
| `performance-test.mjs` | Retired | Targeted obsolete lexicon paths and unenforced thresholds; performance classification remains issue #6 work. |
| `smoke-test.mjs` | Replaced | Assumed an externally running server; `interaction-test.mjs` starts its own server and covers the broader journey. |

Build, benchmark, performance-report, publish-cleaning, synchronization, and
mouse-helper scripts that remain ignored are not release tests. They must not be
added to maintained commands without an explicit contract.
