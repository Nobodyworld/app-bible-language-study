# Architecture

Bible App Reader is a static browser application. The shell is served from
`app/index.html`, `app/app.js`, and `app/styles.css`; runtime behavior is split
across ES modules in `app/src/`.

## Runtime Shape

- Routing uses hash routes so the app can run from a plain static server.
- Reader state is loaded from local JSON datasets under `app/data/`.
- Reader-header actions expose Search, Chapter Language Study, Book Outline,
  Study Marks, and My Data. An invoked action may render in the shared detail
  pane without becoming persistent contextual navigation.
- Contextual side-panel navigation is limited to exact Word when present,
  followed by Verse: `Word → Verse`. Verse owns Parallel, References,
  Commentary, verse Language Study, and verse Study Marks actions.
- Strong's and lexical detail can follow an exact reader word. Lock, highlight,
  Back/Forward history, and transient hover behavior remain coordinated by the
  shared panel state rather than by each view independently.
- User-created state is stored in browser storage and can be exported/imported
  as JSON.

## UI Ownership

- `app/src/panel-context-model.js` derives scope order and tool ownership.
- `app/src/ui-contracts.js` resolves control availability.
- `app/src/active-word-context.js` owns the exact word retained by contextual
  navigation.
- `app/src/dom.js` owns the shared detail-pane history and lock state.
- Internal `interlinear` modules, datasets, CSS hooks, and test identifiers
  implement the user-facing Language Study feature.

Study Marks remains target-aware across Book, Chapter, Verse, selected text,
and exact source tokens. Favorite remains the canonical `favorite` assertion.
Meaning is separate from Study Marks and is stored only for exact canonical
source-token identity.

My Data is the single ordinary entry for My study data, Backup and restore, App
settings, Local maintenance, and collapsed, lazy Advanced diagnostics. Job
history, package state, raw storage records, capability controls, and similar
implementation surfaces remain diagnostic details rather than separate
Processing or Study Data product areas.

## Data Loading

The app uses deterministic JSON shards for Bible text, search, commentary,
cross-references, lexicons, interlinear records, semantic seeds, and generated
analysis. Package and source manifests describe what is bundled and where it
came from.

Bundled canonical data is separate from browser-local user state. Portable user
data retains kind `bibleapp:user-data` and version `3`; sparse legacy records,
recovery backups, malformed-import atomicity, and browser-local operation remain
part of the persistence contract. The app does not add an account, cloud
backup, external update service, or synchronization network boundary.

## Physical Pack Lifecycle

The tracked distribution remains a complete offline bundle in
`bundled_static_data` mode. `app/data/distribution-manifest.json` records that
current authority and identifies Search and Commentary as the first managed-pack
candidates without hiding or relocating their bundled files.

`app/src/physical-pack-contract.js` defines the pure contract
for:

- strict canonical runtime paths;
- SHA-256 identity;
- deterministic aggregate framing;
- distribution, catalog, and immutable pack-manifest normalization;
- versioned Cache Storage names;
- physical registry records;
- verified active-pack identity;
- separation of bundled package authority from managed physical-pack authority.

`app/src/physical-pack-registry.js` owns the independent
`bibleapp-physical-packs` IndexedDB database. `app/src/physical-pack-manager.js`
owns catalog refresh, dependency planning, verified staging, atomic activation,
update, repair, retained rollback, removal, cleanup, startup reconciliation,
and orphan-cache classification. Staging, active, and rollback data use
separate immutable Cache Storage names.

The validated distribution manifest scopes physical requirements to
`managed_optional_pack_ids`. Other shipped feature packs remain bundled in
managed mode. Search and Commentary prefer verified managed bytes and follow
the manifest's explicit bundled-fallback flag. Full semantic-version checks and
same-origin source policy run before artifact fetch.

`app/src/data-service.js` is the single pack-aware runtime JSON boundary. It
uses verified managed responses when managed mode is explicit, keys parsed data
by physical source/version, identifies permitted bundled fallback, and preserves
structured errors when fallback is forbidden. Search, Commentary, and other views do not acquire Cache Storage or
physical-registry logic.

My Data → Advanced diagnostics renders the management surface. It exposes
mode, catalog, immutable version, expected/verified totals, provenance,
operation history, progress, plan/confirmation, focus restoration, repair,
rollback, removal, and cleanup without creating a new primary destination.

The detailed non-destructive implementation contract is
`docs/OPTIONAL_PACK_ARCHITECTURE.md`; operational and UI behavior is summarized
in `docs/PHYSICAL_PACK_LIFECYCLE.md`. This implementation does not authorize deleting bundled
Search or Commentary data, publishing pack artifacts, changing the tracked
default mode, or adding a required backend.

## Tests

Repository tests cover static integrity, data-domain behavior, UI contracts,
reader regressions, accessibility source checks, desktop browser flows, mobile
browser flows, package inventory, documentation policy, public-preview rights
and release boundaries, and publish audit checks. `package.json` is the
executable command authority; `tests/TEST_INVENTORY.md` explains the current
coverage map.
