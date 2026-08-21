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
and provenance references. Planning computes dependency order, totals, and
storage estimates without mutation.

Install, update, and repair:

1. validate and digest the immutable manifest;
2. download every loose file into a unique staging cache;
3. verify path, media type, byte length, and SHA-256;
4. verify the canonical aggregate digest;
5. copy verified responses to a unique active cache;
6. atomically point one registry record at the new active cache; and
7. retain the previous active manifest/cache as rollback.

Failure or cancellation deletes only unactivated operation caches and preserves
the previous active and rollback copies. Verification never deletes a corrupt
copy; it classifies it for repair. Rollback swaps two already verified cache
pointers. Removal records pending deletion before deleting cache bytes and
blocks removal while an active dependent pack still requires the target.

Startup reconciliation clears unreferenced staging caches, restores the prior
active record after an interrupted install/update, completes interrupted
removal, activates a valid retained rollback when the active cache disappeared,
or classifies the pack `repair_required`. Explicit cleanup handles remaining
unreferenced pack caches.

## Runtime behavior

`app/src/data-service.js` is the single physical resolution boundary. Managed
Search and Commentary paths are served only from verified active caches. Parsed
and pending JSON cache identity includes the physical pack version and manifest
digest, and lifecycle changes invalidate affected data without resetting the
reader route or chapter.

Structured capability states are `not_installed`, `disabled`,
`dependency_missing`, `incompatible_version`, `corrupt`, and `load_failed`.
Search and Commentary keep their existing capability IDs. Messages identify
the required action and explicitly preserve ordinary scripture reading.

Returning to bundled mode is immediate and uses the tracked complete data tree.

## My Data management UI

Controls live only under **My Data → Advanced diagnostics → Physical study
packs**. The surface shows runtime mode, catalog URL/version, storage support,
desired/active state, immutable version, file and byte totals, operation
history, failure, notice, and provenance.

Every mutation starts with a plan dialog. Escape and Cancel are data-neutral and
restore focus. Install/update/repair expose live progress and cancellation.
Remove and rollback require confirmation. Operations restore focus by stable
action identity, retain the reader route, and use existing light/dark and
responsive visual tokens.

## Test fixtures and coverage

`app/data/physical-pack-fixtures/` contains Search fixture-v1/v2 and Commentary
fixture-v1. The Commentary fixture depends on Search, allowing small tests to
exercise dependency planning without hashing or copying the production corpus.

`npm run test:physical-packs` covers contracts and the complete in-memory
lifecycle. `npm run test:physical-packs:edge` uses Microsoft Edge and real
IndexedDB/Cache Storage to cover plan/cancel, install, reload, offline reads,
corruption, repair, update, retained rollback, rollback, removal, bundled
fallback, reader context, focus, themes, reduced motion, responsive/mobile
containment, and browser/request health.
