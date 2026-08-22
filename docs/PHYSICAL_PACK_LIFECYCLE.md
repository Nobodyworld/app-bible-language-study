# Physical Study-Pack Lifecycle

Issue #63 delivers an opt-in browser-local physical lifecycle for Search and
Commentary while the public application remains a complete
`bundled_static_data` distribution.

## Build and measurement

Production artifacts are generated outside the tracked application tree:

```text
npm run physical-packs:build
npm run physical-packs:check
npm run physical-packs:scenarios:check
```

The default build output is ignored `dist/physical-packs/`. Each pack has an
immutable manifest and loose-file tree. `--assemble-offline` also reconstructs
a complete application directory without deleting or moving the tracked Search
or Commentary data. Check mode independently rebuilds both production
inventories twice, compares the catalog and manifests byte-for-byte, validates
all file and aggregate digests, and checks the maintained scenario report.

`app/data/physical-pack-scenarios.json` records current package-manifest-derived
file, raw-byte, and transfer-byte totals for the complete app, reference base,
base plus either optional pack, and reconstructed complete offline bundle.
Hardware-dependent first/warm latency is reported by the maintained Edge run
rather than frozen as a misleading source constant.

## Browser-local authorities

- Portable personal data remains `bibleapp:user-data` version 3.
- Physical state uses the independent `bibleapp-physical-packs` IndexedDB
  database.
- Immutable bytes use versioned `bibleapp-pack:staging-*`,
  `bibleapp-pack:active-*`, and retained active-cache names referenced as
  rollback.
- Logical package preferences never prove that bytes exist.

Pack records include manifest and aggregate digests, exact expected/verified
totals, active and rollback manifests/caches, compatibility, provenance,
timestamps, operation state, and bounded failure text. History is browser-local
and is not exported with personal data.

## Lifecycle operations

Catalog refresh validates the catalog kind/schema, package identity, app
compatibility, immutable manifest paths/digests, dependencies, totals, notices,
and provenance references. Catalog, manifest, and artifact URLs are rejected
before fetch unless they use the application origin, HTTP(S), no credentials,
and no fragment. Compatibility uses full semantic-version precedence,
including prerelease ordering and an exclusive maximum. Planning computes
dependency order, required pack IDs, files, raw/transfer bytes, current/target
versions, and storage estimates without mutation. A meaningful insufficient
quota fails before staging storage is created; an unavailable estimate is
disclosed without a false rejection.

Install, update, and repair:

1. validate and digest the immutable manifest;
2. download every loose file into a unique staging cache;
3. verify path, media type, byte length, and SHA-256;
4. verify the canonical aggregate digest;
5. copy verified responses to a unique active cache;
6. atomically point one registry record at the new active cache; and
7. retain the previous active manifest/cache as rollback.

Failure or cancellation deletes only unactivated operation caches and preserves
the previous active and rollback copies. One stored-pack verifier checks cache
existence, exact inventory, required entries, media types, byte lengths,
per-file SHA-256, and verified totals. Missing storage is `repair_required`;
content drift is `corrupt`. Explicit rollback verifies its target before any
pointer change and retains the current active copy as the next rollback only
when its bytes also verify. Removal records pending deletion before deleting cache bytes and
blocks removal while an active dependent pack still requires the target.

Startup reconciliation clears unreferenced staging caches, restores the prior
active record after an interrupted install/update, and completes interrupted
removal. Active claims enter `startup_verifying`, so managed resolution cannot
use unverified bytes while full verification completes asynchronously. A
verified rollback may recover an invalid active copy; an invalid rollback is
never activated. Active and rollback are independent physical authorities, so
a valid active copy remains active when its optional rollback cache is missing
or corrupt. Reconciliation clears invalid rollback metadata, records sanitized
rollback-loss history, preserves catalog-driven `update_available`, and deletes
or reports the invalid cache for cleanup. Explicit cleanup handles remaining
unreferenced pack caches.

## Runtime behavior

`app/src/data-service.js` is the single physical resolution boundary. Only the
distribution manifest's `managed_optional_pack_ids` participate in physical
resolution. Search and Commentary prefer verified active caches. When none is
valid and `bundled_fallback` is true, they resolve the tracked static file with
runtime source `bundled_fallback`; removal exposes that fallback without a mode
switch. With fallback false, managed errors remain structured and
`tryFetchJson()` cannot erase them. All other bundled capabilities remain
available in managed mode. Parsed and pending JSON cache identity includes the
physical source/version, and lifecycle changes invalidate affected data without
resetting the reader.

Structured capability states are `not_installed`, `disabled`,
`dependency_missing`, `incompatible_version`, `corrupt`, and `load_failed`.
Search and Commentary keep their existing capability IDs. Messages identify
the required action and explicitly preserve ordinary scripture reading.

The current complete distribution sets `bundled_fallback: true`. Managed mode
is an opt-in reference implementation; returning to bundled mode remains
immediate and uses the tracked complete data tree.

## My Data management UI

Controls live only under **My Data → Advanced diagnostics → Physical study
packs**. The surface shows runtime mode, catalog URL/version, storage support,
desired/active state, immutable version, file and byte totals, operation
history, failure, notice, and provenance.

Every mutation starts with a plan dialog. Escape and Cancel are data-neutral and
restore focus. Install/update/repair expose live progress and cancellation.
Remove and rollback require confirmation. Operations restore focus by stable
action identity and preserve the exact reader route/chapter, selected word or
verse, highlight, reader scroll, detail history, lock/follow state, and detail
scroll without rerendering the reader. Plans disclose usage, quota, approximate
available storage, and required raw bytes. The surface uses existing light/dark
and responsive visual tokens.

An open manager receives scoped snapshot events only while its node is mounted.
Cards move live from `startup_verifying` to their final truthful state without
reopening My Data. Verify, update, repair, rollback, and removal are absent
while startup hashing is incomplete; removed manager nodes receive no global
events or retained subscriptions.

## Test fixtures and coverage

`app/data/physical-pack-fixtures/` contains Search fixture-v1/v2 and Commentary
fixture-v1. The Commentary fixture depends on Search, allowing small tests to
exercise dependency planning without hashing or copying the production corpus.

`npm run test:physical-packs` covers contracts and the complete in-memory
lifecycle. `npm run test:physical-packs:edge` uses Microsoft Edge and real
IndexedDB/Cache Storage to cover plan/cancel, install, reload, offline reads,
missing and modified byte reconciliation, repair, update, independent active
and rollback verification, delayed live startup transitions, invalid rollback
authority removal, removal, distribution-aware bundled fallback, strict
unavailable states, storage/quota behavior, full reader context, focus, themes,
reduced motion, responsive/mobile containment, and browser/request health.
