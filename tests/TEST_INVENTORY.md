# Test Inventory and Disposition

Reviewed: 2026-08-28

## Authority

`package.json` is the executable authority for test composition. This document
explains the tracked coverage map; it must be updated when package scripts add,
remove, or reclassify a maintained test.

## Command Map

| Command | Current composition |
|---|---|
| `npm run test:static` | Repository integrity, feature registry/profile/platform contracts, data contracts, UI/source regressions, public-preview and public-screenshot policy, domain tests, generated package-inventory check, accessibility-source checks, and documentation consistency. |
| `npm run test:domain` | Job, logical package, physical-pack contract and lifecycle, poll, recovery, semantic-target, and user-data behavior under `app/scripts/`. |
| `npm run test:browser` | Desktop rendered interaction, Stable/Lab/disabled-profile behavior, Search-match contrast, highlight, Language Study, tooltip containment, Strong's preview, flexible workspace widths/scrolling/anchors, compact context, contained Study Marks/Meaning, and physical-pack Edge lifecycle flows. |
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
| `npm run test:feature-registry` | `tests/feature-registry.mjs`. |
| `npm run test:feature-profiles` | `tests/feature-profiles.mjs`. |
| `npm run test:platform-contracts` | `tests/platform-contracts.mjs`. |
| `npm run test:feature-profile-browser` | Stable, Lab, unknown-profile, isolation, and disabled-feature behavior in Edge. |
| `npm run test:analysis` | `tests/analysis.mjs`. |
| `npm run test:interlinear` | `tests/interlinear.mjs`. |
| `npm run test:tags` | `tests/tags.mjs`. |
| `npm run test:public-preview` | `tests/public-preview-readiness.mjs`. |
| `npm run test:word-meaning` | `tests/word-meaning.mjs`. |
| `npm run test:word-meaning-focus` | `app/scripts/word-meaning-focus-test.mjs`. |
| `npm run test:study-workspace` | `app/scripts/study-workspace-interaction-test.mjs`. |
| `npm run test:reader-data-loading` | `app/scripts/reader-data-loading-interaction-test.mjs`. |
| `npm run test:search-highlight` | `app/scripts/search-highlight-interaction-test.mjs`. |
| `npm run test:physical-packs` | Distribution, catalog, compatibility, pack-manifest, path, digest-framing, independent registry, complete lifecycle/recovery, resolver, capabilities, and logical/physical separation. |
| `npm run test:physical-packs:edge` | Real Edge/IndexedDB/Cache Storage lifecycle, offline resolver, UI, focus, theme, responsive, and browser-health acceptance. |
| `npm run physical-packs:check` | Deterministic fixture check plus two independent production Search/Commentary inventory builds with byte-for-byte catalog/manifest comparison and digest validation. |
| `npm run physical-packs:scenarios:check` | Maintained five-scenario file/raw/transfer measurement reconciliation. |
| `npm run test:ui` | UI, compact panel-context, workspace-width model, and contained-surface source contracts. |

## Static and Source-Level Tests

The following scripts are invoked directly by `test:static`, in package-script
order:

| Script | Maintained coverage |
|---|---|
| `tests/integrity.mjs` | Tracked package, manifest, path, and bundled-data integrity. |
| `tests/serve-app.mjs` | Static server behavior and application delivery boundaries. |
| `tests/run.mjs` | Core runtime-data and application-source contracts. |
| `tests/feature-registry.mjs` | Complete static feature inventory, lifecycle values, dependencies, ownership, profile closure, test ownership, and actionable invalid-fixture diagnostics. |
| `tests/feature-profiles.mjs` | Deterministic Stable/Lab resolution, recovery/compatibility access, unknown fallback, disabled-feature closure, unchanged Stable identities, and isolated Lab identities. |
| `tests/platform-contracts.mjs` | Platform shape, user-storage isolation, profile-scoped notifications, browser file/data operations, digest/source/estimate services, profile-scoped physical registry identity, and explicit byte-store operations. |
| `tests/capabilities.mjs` | Capability declarations and availability behavior. |
| `tests/analysis.mjs` | Generated analysis data and manifest contracts. |
| `tests/interlinear.mjs` | Internal interlinear records, token resolution, marked Greek glyphs, and Hebrew analysis behavior. |
| `tests/strong-reference-control.mjs` | Structured Strong's reference resolution and plain-text fallback. |
| `tests/ui-contracts.mjs` | Control schema, availability, scopes, and panel transitions. |
| `tests/panel-context-model.mjs` | Compact `Word → Verse` ordering, tool ownership, labels, and responsive contracts. |
| `tests/study-workspace-width.mjs` | Exact width modes/default, normalization, malformed and throwing storage, isolated preference key, follow/locked separation, and pressed-state synchronization. |
| `tests/study-workspace-contracts.mjs` | Width-control DOM, responsive clamps, independent scrolling, semantic anchoring, contained tool surface, explicit Study Marks/Meaning presentations, lifecycle cleanup, and reduced motion. |
| `tests/strong-section-lifecycle.mjs` | Strong's section loading, presence, absence, and rerender lifecycle. |
| `tests/reader-ui-regressions.mjs` | Reader layout and source-level UI regressions, including deterministic picker handoff, bounded indexed Reader snapshots, browser-owned route history, exact phrase preservation, informational alignment groups, contained Strong's scrolling, and retired header controls. |
| `tests/original-language-source-importer.mjs` | Reproducible original-language source transformation. |
| `tests/original-language-source-data.mjs` | Packaged Hebrew and Greek source coverage and identity. |
| `tests/original-language-study.mjs` | Language Study entry, source-backed cards, and related-reference behavior. |
| `tests/morphology.mjs` | Original-language morphology parsing and display contracts. |
| `tests/module-singletons.mjs` | Release-key consistency and singleton stateful module URLs. |
| `tests/reference-context.mjs` | Immutable reference hierarchy, stable navigation keys, and serializable reader-navigation snapshots with exact zero-scroll and canonical text-span preservation. |
| `tests/tags.mjs` | Tag definitions, assertions, target applicability, and projections. |
| `tests/word-meaning.mjs` | Exact canonical source-token Meaning storage and compatibility. |
| `tests/word-meaning-hidden.mjs` | Hidden Meaning-dialog regression behavior. |
| `tests/public-preview-readiness.mjs` | Public-preview status, rights/provenance, security, and release-authorization boundaries. |
| `tests/public-screenshot-contract.mjs` | Public capture manifest, Standard-width and contained-tool capture guards, browser-health enforcement, retired-dependency guard, generated inventory, documentation references, and tracked screenshot consistency. |
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
| `app/scripts/physical-pack-contract-test.mjs` | Default bundled distribution, catalog/manifest schemas, canonical path rejection, deterministic aggregate framing, immutable cache naming, exact Stable/Lab cache-ownership grammar, physical registry activation criteria, distribution-scoped managed authority, and full semantic-version minimum/exclusive-maximum/prerelease ordering. |
| `app/scripts/physical-pack-lifecycle-test.mjs` | Independent registry; mutation-free plans; quota estimates; fresh and persisted catalog schema/package/version/URL authority; recovery after catalog rejection; persisted active/rollback manifest schema, package, semantic-version, inventory, aggregate, and exact-byte verification; compatible/incompatible active and rollback combinations; bundled and strict incompatible behavior; update state coexisting with rollback through reload, Verify, rollback, and update; interrupted staging/removal; shared Stable/Lab orphan cleanup and startup isolation; and removal fallback. |
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
| `app/scripts/interaction-test.mjs` | Desktop and `--mobile` | Main rendered reader journey, including deliberately delayed Book → Chapter synchronization, authoritative route/native-control/active-option/focus convergence, selection, Study Marks, My Data, persistence, and cleanup. |
| `app/scripts/search-highlight-interaction-test.mjs` | Edge desktop and narrow; light/dark, OS-preferred dark, and forced colors | Populated Search-match semantics, computed contrast, visible distinction, Search-only highlight scope, containment, overflow, and browser health. |
| `app/scripts/reader-data-loading-interaction-test.mjs` | Desktop | Deferred reader-dataset request boundaries, first/repeat activation, stale-route suppression, retry behavior, reader-core preservation, and browser-error checks. |
| `app/scripts/frozen-highlight-interaction-test.mjs` | Edge desktop, portrait, narrow, mobile/touch, light/dark, forced colors, and reduced motion | Locked/frozen reader-to-panel highlighting; exact phrase preservation through pointer, keyboard, touch, and same-verse tools; informational alignment semantics; browser-owned indexed Reader history with panel-only Detail history; truthful detail reset; zero/moderate/deep scroll restoration; long-chapter stability; responsive containment; and browser-error health. |
| `app/scripts/original-language-study-interaction-test.mjs` | Desktop | Rendered Language Study data, lazy enhancement, references, history, and tooltip containment. |
| `app/scripts/language-study-tooltip-interaction-test.mjs` | Desktop, narrow, mobile-width, and optional touch mode | Exact H3068 Language Study readiness plus morphology and original-language mark tooltip interaction, containment, dismissal, repositioning, and state non-mutation. |
| `app/scripts/strong-preview-hydration-test.mjs` | Desktop | Strong's preview hydration and interaction lifecycle. |
| `app/scripts/panel-context-interaction-test.mjs` | Desktop, narrow, and mobile; light/dark | Compact context, scope inheritance, explicit contained Study Marks, stable underlay, focus restoration, responsive layout, and browser-error checks. |
| `app/scripts/word-meaning-focus-test.mjs` | Desktop and mobile | Contained Meaning and Study Marks overlay coordination, exact-target save/remove, data-neutral dismissal, lifecycle cleanup, and focus restoration. |
| `app/scripts/study-workspace-interaction-test.mjs` | Desktop, intermediate, mobile, light/dark, forced colors, and reduced motion | Width switching/persistence/storage failure, semantic reader anchors, independent scroll ownership, contained tools, lifecycle/history/selection preservation, Clear behavior with browser-owned Reader navigation availability, responsive header container bands at 320px and 420px, exact 773px title containment, 280–760px Study-panel sweeps, per-word geometry, focus order/clipping, responsive bounds, and browser-error/overflow checks. |
| `app/scripts/physical-pack-interaction-test.mjs` | Edge desktop, portrait, narrow, mobile-width, mobile-device, light/dark, and reduced motion | Distribution-aware fallback and strict `incompatible_version`; real persisted incompatible active records; compatible rollback recovery; simultaneous update/rollback state and actions after reload; update and rollback context preservation; storage plans; plan/cancel; install/offline reads; delayed `startup_verifying` live transition; action suppression; mounted-node-only updates; corruption/repair; invalid rollback loss; removal fallback; exact reader/detail context; containment; and zero console/page/request/HTTP errors. |
| `app/scripts/feature-profile-interaction-test.mjs` | Edge desktop plus deterministic disabled-feature viewport | Stable default/UI/Search/recovery access; Lab identity, expanded diagnostics, separate user/notification/physical namespaces, shared-origin Cache Storage cleanup/startup isolation, version-3 imports, bidirectional isolation across reloads, unknown-profile fallback, disabled-control/data-request ownership, Reader preservation, and browser health. |

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
