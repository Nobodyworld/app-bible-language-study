# Optional Physical Pack Architecture

Status: implementation contract for issue #46  
Prepared baseline: `ac361ebdccd9bbeff4515cdcd94ccd48aae3f4cc`  
Prepared branch: `feat/physical-pack-foundation`

## Purpose

Bible App Reader currently ships one complete static application package. Its
logical package planner can describe installed and disabled feature packs, but
all physical JSON data remains bundled under `app/data/`; logical install and
remove operations do not fetch or delete bytes.

This architecture adds a real, browser-local physical-pack lifecycle without
removing the current complete package or weakening the local-first, static-app,
o-account, offline, provenance, or user-data contracts.

The implementation must remain useful in the current full checkout while also
providing the reference path needed for a future owner-approved lean
distribution.

## Current measured boundary

The maintained package contains 29 feature packs, 2,804 files, and approximately
910.1 MiB of uncompressed data. Search and commentary account for most of the
installed footprint:

- `search-verses`: approximately 341.10 MiB raw;
- `commentary-verse-index`: approximately 203.48 MiB raw;
- search plus commentary: approximately 59.84% of the raw package.

The completed runtime-delivery work reduced default reader transfer to roughly
5.04 MB and publish-mode reload transfer to roughly 15.9 KB. Optional packs are
therefore a distribution and installed-footprint concern, not a default-reader
eager-loading fix.

## Non-negotiable invariants

1. `bundled_static_data` remains the default physical mode in this branch.
2. No tracked bundled data is deleted, moved, or duplicated into a second
   tracked artifact tree.
3. The complete all-in-one offline application remains valid.
4. Normal operation requires no account, application backend, analytics,
   external write API, or cloud synchronization.
5. Pack bytes are not treated as installed until their immutable manifest and
   file digests have been verified.
6. Logical preferences and physical byte presence are separate states.
7. Physical registry records are browser-local operational data and cannot be
   blindly restored as proof of installed bytes on another browser profile.
8. Rights, notices, source references, and transformations remain attached to
   every distributable pack.
9. Search and Commentary must fail closed into explicit accessible unavailable,
   incompatible, corrupt, or load-failed states.
10. No release, tag, hosted pack publication, or lean-distribution migration is
    authorized by this architecture alone.

## State model

### Logical package intent

The existing package planner remains authoritative for:

- dependency closure;
- requested package and feature-pack IDs;
- blocked and cascade removal planning;
- estimated file and byte summaries;
- disabled capabilities and feature packs;
- portable user intent and operation history.

Existing `installed_feature_pack_ids` must not be used as proof that physical
bytes are present. The implementation may migrate the logical store to clearer
requested/desired terminology, but version-3 user-data imports must remain
compatible and must not silently discard current package preferences.

Portable backups may preserve desired package or feature-pack IDs. They must not
claim that Cache Storage or another browser-local binary store was transferred.
After import into a different profile, the UI must explain that desired packs
require local installation or that bundled fallback is being used.

### Physical registry

Use a separate browser-local registry, preferably a dedicated IndexedDB
database, for operational physical state. It must not share authority with the
portable user-data database.

Each physical pack record should include at least:

- pack ID and immutable pack version;
- artifact-manifest digest;
- aggregate content digest;
- lifecycle state;
- active and rollback storage identifiers;
- source catalog or local-source identity;
- expected and verified file counts and bytes;
- compatibility result;
- installed, activated, last-verified, and updated timestamps;
- last failure classification and sanitized message;
- retained notice and provenance references.

Supported lifecycle states should distinguish at least:

- discovered;
- staging;
- verifying;
- active;
- update-available;
- incompatible;
- corrupt;
- repair-required;
- removing;
- rollback-available;
- failed.

Startup reconciliation must compare registry claims with the actual physical
store. Missing caches, missing files, digest drift, interrupted operations, and
orphan staging areas must not be reported as active.

## Physical modes

### `bundled_static_data`

This remains the default. All current manifest packs are logically available
from the tracked static data tree unless deliberately disabled. Pack management
may show measured artifacts and exercise fixture/reference operations, but it
must not hide existing bundled data.

### `managed_cache_packs`

This opt-in/reference mode resolves capability availability from verified active
physical pack records plus any explicitly declared immutable base packs. It is
the architecture used to test missing, installed, corrupt, repaired, removed,
and updated optional-pack states.

Switching modes must be explicit, reversible, and protected from stale physical
registry claims. The branch must not silently make managed mode the public
default.

## Artifact contract

The build tooling should generate an immutable catalog and one manifest per
physical pack. Generated output belongs under an ignored distribution or
temporary path, not under tracked `app/data/`.

### Catalog

The catalog should identify:

- catalog schema version and generated timestamp;
- compatible application/package-manifest version or range;
- immutable pack IDs and versions;
- manifest location and manifest SHA-256;
- dependencies and provided capabilities;
- file count, raw bytes, and compressed/transfer estimate;
- source/notice references;
- supported artifact transport form;
- complete-offline bundle composition.

### Pack manifest

Each pack manifest should identify:

- a stable kind and schema version;
- pack ID, label, version, and description;
- app/package compatibility;
- dependencies and provided capabilities;
- canonical aggregate digest;
- every artifact file with canonical runtime path, byte length, media type, and
  SHA-256 digest;
- total files and bytes;
- source-manifest and notice references;
- generation/tool version and reproducibility metadata.

Canonical paths must be relative runtime paths. Reject absolute paths, traversal,
backslash ambiguity, encoded traversal, duplicate normalized paths, fragments,
credentials, and query-string identity tricks.

The aggregate digest must be deterministic. Define and test a canonical ordering
and framing of path, length, and file digest rather than hashing implementation-
specific JSON serialization.

## Artifact transport

A static loose-file artifact layout is the required initial transport because it
can be served by a plain static host and installed without adding a large archive
runtime dependency. The builder should generate a catalog, immutable manifests,
and a file tree preserving canonical runtime paths.

The implementation may additionally produce a ZIP or TAR archive for human
download and complete-offline assembly, but browser activation must not depend
on an unreviewed archive parser. Any additional archive form is derivative of
the canonical loose-file manifest.

Pack installation sources may include:

- a same-origin or explicitly allowed static catalog URL;
- a relative catalog shipped with a complete offline directory;
- user-selected local files or directory handles when the browser supports a
  safe deterministic path.

No source may bypass the same manifest, path, compatibility, and digest checks.
Cross-origin installation is out of scope unless CORS, integrity, privacy, and
failure behavior are deliberately implemented and tested.

## Physical storage and atomicity

Cache Storage is the preferred byte store because pack files are immutable
request/response resources. An equivalent implementation is acceptable only
when it remains auditable, capacity-aware, path-safe, and efficient for hundreds
of large JSON shards.

Use separate versioned staging and active storage identifiers. A safe install or
update follows this order:

1. fetch and validate the catalog and pack manifest;
2. check compatibility, dependencies, estimated storage, and path safety;
3. create a unique staging store;
4. fetch or read each file into staging;
5. verify byte length and SHA-256 before accepting each file;
6. verify file count and canonical aggregate digest;
7. record a verified staged registry state;
8. atomically change the active registry pointer in one transaction;
9. retain the previous active version as rollback until post-activation checks
   pass;
10. remove obsolete staging and, after the rollback boundary, obsolete active
    storage.

A failed operation must preserve the previous active pack. Cleanup failure must
be reported separately from install failure and must not erase the only valid
rollback copy.

Removal must update the active registry before deleting physical bytes, preserve
logical dependency rules, and recover deterministically when deletion is
interrupted.

Repair re-verifies the active manifest and bytes, replaces only invalid or
missing files in staging, and atomically activates the repaired result.

## Runtime resolution

`app/src/data-service.js` owns, or delegates to one focused resolver that owns,
pack-aware data lookup. Individual reader, Search, Commentary, Language Study,
and other views must not acquire Cache Storage or IndexedDB-specific logic.

Resolution order in the current complete application:

1. when managed mode declares an active verified pack for the canonical path,
   read that active pack response;
2. otherwise use bundled/static network resolution when bundled fallback is
   permitted;
3. classify a missing managed optional pack before falling through to an opaque
   JSON parse or generic 404 failure;
4. cache parsed JSON only under a key that includes physical source/version so
   activation or repair cannot return stale parsed data.

The resolver must expose structured failure classifications sufficient for
capability state and user-visible messaging:

- not installed;
- disabled;
- dependency missing;
- incompatible version;
- corrupt;
- load failed.

Activation, update, repair, removal, or mode changes must invalidate affected
parsed and pending data-service caches without resetting unrelated reader state.

## Capability and UI behavior

The existing capability registry remains the user-facing availability model.
Managed physical state must feed it without changing the meaning of current
capability IDs.

Search and Commentary require explicit accessible states that identify:

- whether the feature is included in the current complete bundle;
- whether a managed pack is missing, disabled, incompatible, corrupt, or failed;
- which pack is required;
- the safe next action: install, enable, repair, retry, or return to bundled
  mode;
- that ordinary scripture reading remains available.

Physical-pack controls belong under My Data / Advanced diagnostics for this
foundation. They must not become a new primary header destination. The
management surface should provide:

- current mode and storage support;
- catalog source and refresh status;
- desired versus physically active pack state;
- size and dependency plan before mutation;
- install, update, verify, repair, remove, rollback, and cleanup actions;
- progress and cancellable staging where practical;
- operation history with sanitized errors;
- storage-estimate and quota information when available;
- explicit notice/provenance access.

Opening, cancelling, or dismissing a plan must not mutate logical or physical
state.

## Provenance and rights

Every generated pack must retain the applicable package-manifest license note
and explicit references into `app/data/source-manifest.json` and `NOTICE.md`.
Generation must fail when a pack lacks required notice/provenance metadata.

Do not describe all pack data as MIT, CC0, open source, or public domain. The
application code/tooling license and bundled-source rights remain distinct.

## Migration and recovery

The current all-in-one checkout maps to `bundled_static_data` and requires no
physical registry migration.

A future lean distribution may declare immutable base packs and optional managed
packs only after separate owner approval. The migration plan must preserve:

- existing version-3 user-data imports;
- disabled capability and desired pack preferences;
- operation-history compatibility or an explicit versioned normalization;
- a clean fallback when physical caches are unavailable or cleared;
- reinstallation guidance rather than false installed claims;
- a complete all-in-one offline distribution.

Cache deletion by browser settings is not user-data loss, but it must be detected
and reported as pack reinstallation/repair work.

## Measured scenarios

The branch must generate a durable report for at least:

1. current complete package;
2. base reader without Search and Commentary physical artifacts;
3. base plus Search;
4. base plus Commentary;
5. full offline bundle assembled from the optional artifacts.

For every scenario record:

- file count;
- extracted/raw bytes;
- transfer/compressed estimate and any actual artifact archive size;
- build/install/update steps;
- first-use and warm-use latency;
- offline behavior;
- unavailable-state behavior;
- integrity method;
- notice/provenance disposition.

Measurements must come from maintained manifests and generated outputs. Do not
copy old totals when the current inventory differs.

## Test requirements

Add deterministic domain coverage for:

- catalog and manifest schemas;
- canonical paths and aggregate digest framing;
- dependency and compatibility validation;
- logical-versus-physical state separation;
- startup reconciliation;
- staged install and atomic activation;
- interrupted install/update/remove recovery;
- repair and rollback;
- corrupt, missing, incompatible, and quota/error states;
- portable-backup behavior;
- provenance enforcement;
- scenario metrics.

Add maintained Edge browser coverage using small fixture packs for:

- diagnostic manager presentation;
- data-neutral plan/cancel behavior;
- install, progress, activation, and reload persistence;
- Search and Commentary unavailable states;
- installed pack lookup through the pack-aware data resolver;
- corruption detection and repair;
- removal and rollback;
- mode return to bundled fallback;
- keyboard, focus, Escape, narrow/mobile, dark/light, reduced-motion, and no
  horizontal-overflow behavior;
- console, page, request, and HTTP health.

Do not make the browser suite copy or hash the production 571 MB Search and
Commentary corpus. Full artifact generation and measurements are local build
checks; browser lifecycle tests use representative deterministic fixtures.

## Completion and future decision

This branch may close issue #46 when it delivers the architecture, measured
scenarios, artifact builder, verified lifecycle reference implementation,
pack-aware resolver, explicit unavailable states, recovery behavior, tests, and
documentation while preserving the complete package.

Any later step that removes Search or Commentary from the default tracked or
published package requires a separate exact owner decision and a focused
migration/release issue. No such removal is authorized here.
