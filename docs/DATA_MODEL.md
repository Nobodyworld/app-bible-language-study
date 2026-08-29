# Data Model

The runtime data model is file-backed JSON. The app does not require a server
database for normal study sessions.

## Manifests

- `app/data/manifest.json` is the runtime capability manifest used by the app.
- `app/data/package-manifest.json` describes bundled feature packs, byte sizes,
  shard counts, and package composition.
- `app/data/distribution-manifest.json` declares the tracked physical-data mode,
  complete-offline status, bundled fallback, package identity, and managed-pack
  candidates.
- `app/data/source-manifest.json` records source package classification,
  retained notices, and transformation notes.

## Bundled Data

Data categories include translation verse shards, commentary shards, search
indexes, cross-references, outlines, lexicons, Strong's mappings, interlinear
records, BSB footnotes, presentation metadata, semantic seeds, word maps, and
cross-reference graph analysis.

The tracked public-preview distribution remains `bundled_static_data` and
complete offline. Search and Commentary remain present in the bundled tree;
managed copies are opt-in browser-local operational state.

## Logical and Physical Package State

Logical package intent and physical bytes are separate authorities.

The existing portable package store records desired/installed feature-pack IDs,
disabled capabilities, and operation history. Those records do not prove that a
Cache Storage entry or another browser-local binary store exists.

Physical-pack operational state belongs in the separate
`bibleapp-physical-packs` IndexedDB database, store `pack_records`.
Its records identify immutable pack versions, manifest and aggregate digests,
staging/active/rollback caches, expected and verified totals, lifecycle state,
compatibility, timestamps, and sanitized failures. Startup reconciliation must
compare any registry claim with actual physical storage before reporting a pack
as active.

`startup_verifying` is a safe transient state: registry metadata may name an
active cache, but runtime resolution cannot use it until cache existence, exact
declared inventory, required entries, media types, byte lengths, per-file
SHA-256, and verified totals all pass. Missing storage becomes
`repair_required`; content drift becomes `corrupt`. Rollback metadata is not
promoted until the same verification passes. Active and rollback records are
independent claims: a valid active cache remains authoritative if rollback
verification fails. Invalid rollback pointers are cleared, sanitized
`rollback_lost` evidence is retained, and state becomes `active` or remains
`update_available` as appropriate.

Startup revalidates every persisted active and rollback manifest through the
current schema, immutable pack identity, package identity, full semantic-version
range, canonical paths, inventory/aggregate digests, totals, provenance, and
source references before cache hashing. A compatible manifest with invalid
bytes is corrupt or repair-required; valid cached bytes with an incompatible
package identity or app-version range are `incompatible`, remain preserved as
non-authoritative local data, and cannot satisfy managed resolution.

Physical registry authority and pack bytes are not part of portable
`bibleapp:user-data` backups. An imported logical preference may require local
installation or may continue using bundled fallback; import must never fabricate
physical installation state.

## Physical Pack Artifacts

Immutable pack artifacts use:

- a catalog;
- one manifest per pack;
- canonical relative runtime paths;
- per-file byte lengths, media types, and SHA-256 digests;
- deterministic aggregate framing;
- retained NOTICE and source-manifest references;
- explicit package/app compatibility.

`app/src/physical-pack-contract.js` and the physical-pack schemas are the
pure-data authority. `app/src/physical-pack-manager.js` stages and verifies
bytes before one-record atomic activation, retains the previous active cache
and manifest for rollback, and never treats a portable logical preference as
physical proof.

Registry metadata stores the explicit physical mode, last validated catalog,
catalog URL, and operation history. Pack records retain the active manifest so
runtime paths can be checked against the immutable file inventory. Interrupted
staging restores the previous active record; interrupted removal completes its
recorded cache-deletion list; missing active storage activates a valid retained
rollback or becomes `repair_required`. Unreferenced pack caches are reported as
orphans and removed only by startup staging cleanup or the explicit cleanup
action.

Persisted catalog metadata is not trusted merely because IndexedDB returned it.
The catalog and URL are revalidated for schema/kind, package/app compatibility,
same-origin HTTP(S), no credentials, and no fragment before use. Rejection
clears catalog authority, records sanitized history, and returns to bundled
mode without fetching the invalid source or changing portable user data.

Lifecycle state and rollback presence are separate fields. When a newer
catalog version exists beside a compatible rollback, state is
`update_available` and rollback metadata remains present; therefore update has
display precedence while both update and rollback operations remain available.

The mounted diagnostics view is a projection of manager snapshots, not another
authority. Scoped events update only connected manager nodes after asynchronous
reconciliation; removed nodes own no global listener.

The validated distribution manifest remains the authority for
`managed_optional_pack_ids` and `bundled_fallback`. Physical records describe
actual local state even when a capability remains usable from an identified
bundled fallback. Physical state never becomes portable user-data authority.

The deterministic production artifact builder writes ignored output under
`dist/physical-packs/`. Its loose-file layout is
`packs/<pack>/<version>/files/<runtime-path>` with a sibling immutable
`manifest.json`; catalog entries carry the exact manifest SHA-256. The
maintained scenario source is `app/data/physical-pack-scenarios.json`.

## User Data

User-created study state is separate from bundled canonical data. Favorites,
tags, assertions, poll responses, package operations, legacy verse drafts,
personal token renderings, and local job events live in browser storage and can
be exported as portable JSON.

### Profile storage authority

Stable preserves the existing production identities exactly: IndexedDB
`bibleapp`, object store `user_stores`, the existing `bibleapp:` localStorage
keys, notification channel `bibleapp:user-data`, physical registry
`bibleapp-physical-packs`, and physical bytes under `bibleapp-pack:`. Existing
IndexedDB authority, localStorage fallback, and legacy Stable migration remain
unchanged; valid Stable data is not rewritten to symmetric new keys.

Lab uses deterministic isolated identities: IndexedDB `bibleapp-lab`,
`bibleapp:lab:*` fallback keys, notification channel
`bibleapp:lab:user-data`, physical registry
`bibleapp-physical-packs-lab`, and byte stores under `bibleapp-pack:lab:`.
This includes Study Marks, Meaning, drafts, import-recovery backups, package
operations, compatibility poll records, physical registry records, and pack
bytes. No automatic Stable/Lab copy or migration exists.

Theme (`bibleAppTheme`) and Study workspace width
(`bibleapp:study-workspace-width:v1`) remain shared presentation preferences;
they do not contain personal study records. A deliberate version-3 export and
import is the only supported cross-profile data movement.

### Personal meanings

`workspaceStore.token_renderings` stores optional personal meanings for exact
canonical schema-v2 `source_token` targets. A rendering is identified by its
translation/reference and source-token index, not by display spelling or a
shared Strong's code. These values are distinct from Favorites and
classification tags: they do not create tag definitions or tag assertions.

Legacy token-rendering records that contain only a rendering, original word,
Strong's code, and update time remain valid. When they are edited, canonical
target metadata is added without rejecting or deleting the saved value.

### Legacy verse drafts and portable exports

`workspaceStore.verse_drafts` remains independent legacy user data. The former
Translation workspace has no primary editing surface, but drafts remain
counted, importable, exportable, merge/replace-compatible, and separate from
personal meanings. Existing `bibleapp:user-data` exports remain compatible,
including exports with legacy token-rendering records or verse drafts.

### My Data backup and maintenance contract

The My Data surface reports user-owned records before implementation history:
custom labels, tagged verses, Study Mark assertions, active Study Marks,
personal meanings, and preserved legacy verse drafts. These stores remain local
to the current browser profile and are not associated with an online account.

Portable backups retain kind `bibleapp:user-data` and version `3`. Download,
raw JSON copy, file selection, pasted JSON, merge, and replace all use the same
export/import contract. Replace creates a browser-local recovery backup before
overwriting current stores. Import normalization and compatibility checks occur
before mutation; malformed, foreign, or unsupported future-version payloads do
not partially change current stores.

`tag-index-refresh` rebuilds a disposable Study Marks projection from canonical
local assertions. The ordinary maintenance action does not edit assertions or
other personal study data. Job history, package state, raw payloads/results,
storage authority and migrations, quarantined records, and capability controls
remain diagnostics. No part of this contract adds cloud backup, accounts,
cross-device synchronization, remote package checks, or network calls.
