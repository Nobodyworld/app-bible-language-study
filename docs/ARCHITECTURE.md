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

## Static Features and Profiles

`app/src/feature-registry.js` is the pure-data feature authority. Descriptors
declare lifecycle (`core`, `stable`, `lab`, `frozen`, or
`compatibility_only`), dependencies, capabilities, physical packs, providers,
UI surfaces and exclusive controls, storage namespaces, portable-data
participation, unavailable behavior, cleanup/migration authority, and focused
test owners. Validation rejects duplicate IDs/control owners, invalid values,
missing or cyclic dependencies, incomplete profiles, experimental dependencies
from Core, ordinary compatibility-only UI, and missing test ownership.

`app/src/feature-profiles.js` deterministically resolves Stable and Lab. Stable
is the default and exposes Core/Stable features ordinarily while retaining
frozen/Lab diagnostics as collapsed recovery access. Lab is explicit through
`?profile=lab`, includes Core and Stable, and exposes the experimental controls
against isolated state. Unknown profile values fall back to Stable with a
testable diagnostic. Interpretation polls remain compatibility-only and own no
ordinary UI.

## Platform Composition

Before:

```text
browser globals consumed directly by stores/views/data/manager
```

After:

```text
app.js creates browser platform and resolves profile
  -> user storage + scoped notifications
  -> file operations
  -> static data source
  -> physical registry + physical byte store + source/digest/estimate/cancellation
domain and feature logic consume explicit contracts
```

`app/src/platform/browser-platform.js` is the browser composition root for
`platform.kind`, `platform.profile`, `platform.environment`,
`platform.userStorage`, `platform.files`, `platform.data`,
`platform.physicalPacks`, and `platform.notifications`. Environment paths that
do not exist in a browser are `null`; no fake filesystem path, shell/process
access, or unrestricted network service is exposed.

`stores.js` retains normalization, conflicts, defaults, user-data version 3,
merge/replace, recovery semantics, summaries, and application mutations. The
browser user-storage adapter owns IndexedDB, localStorage fallback, identity,
timeouts, migration, structured failure state, and profile-scoped advisory
notifications. The My Data view consumes the file service rather than Blob,
File, object-URL, or Clipboard globals. `data-service.js` retains logical
parsed/pending caches, physical source identity, and structured fallback while
the browser data adapter performs actual static-asset fetches.

The platform contract is ready for a later desktop composition adapter, but no
desktop shell, native filesystem pack, SQLite database, or desktop application
is implemented here.

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

`app/src/physical-pack-registry.js` owns the profile-scoped browser registry
implementation; Stable retains the independent `bibleapp-physical-packs`
IndexedDB database. `app/src/physical-pack-manager.js`
owns catalog refresh, dependency planning, verified staging, atomic activation,
update, repair, retained rollback, removal, cleanup, startup reconciliation,
and orphan-cache classification. Staging, active, and rollback data use
separate immutable names through an explicit physical byte-store contract; the
browser implementation wraps Cache Storage. Active and rollback claims are verified
independently; invalid rollback metadata is removed without invalidating a
verified active copy. Persisted catalogs and manifests are revalidated against
the current schema, package identity, semantic app range, source policy,
canonical inventory, aggregate framing, and cache bytes before authority is
restored. Incompatible authority is distinct from corrupt storage and is never
used for managed reads.

The validated distribution manifest scopes physical requirements to
`managed_optional_pack_ids`. Other shipped feature packs remain bundled in
managed mode. Search and Commentary prefer verified managed bytes and follow
the manifest's explicit bundled-fallback flag. Full semantic-version checks and
same-origin source policy run before artifact fetch.
The same checks run against restored IndexedDB metadata without fetching a
rejected stored source. Bundled fallback remains identified when permitted;
strict distributions preserve `incompatible_version`.

`app/src/data-service.js` is the single pack-aware runtime JSON boundary. It
uses verified managed responses when managed mode is explicit, keys parsed data
by physical source/version, identifies permitted bundled fallback, and preserves
structured errors when fallback is forbidden. Search, Commentary, and other views do not acquire Cache Storage or
physical-registry logic.

My Data → Advanced diagnostics renders the management surface. It exposes
mode, catalog, immutable version, expected/verified totals, provenance,
operation history, progress, plan/confirmation, focus restoration, repair,
rollback, removal, and cleanup without creating a new primary destination.
Application snapshot events are dispatched only to currently mounted manager
nodes, allowing asynchronous verification to update the open surface without a
global view subscription or reader rerender.
`update_available` has UI/state precedence over `rollback_available` when both
facts are true; the retained rollback pointer remains an independent action.

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
