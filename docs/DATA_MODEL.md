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
complete offline. Search and Commentary remain present in the bundled tree while
the optional physical-pack reference implementation is developed.

## Logical and Physical Package State

Logical package intent and physical bytes are separate authorities.

The existing portable package store records desired/installed feature-pack IDs,
disabled capabilities, and operation history. Those records do not prove that a
Cache Storage entry or another browser-local binary store exists.

Physical-pack operational state belongs in a separate browser-local registry.
Its records identify immutable pack versions, manifest and aggregate digests,
staging/active/rollback caches, expected and verified totals, lifecycle state,
compatibility, timestamps, and sanitized failures. Startup reconciliation must
compare any registry claim with actual physical storage before reporting a pack
as active.

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

`app/src/physical-pack-contract.js` and the physical-pack schemas are the current
pure-data authority. The lifecycle implementation will stage and verify bytes
before atomic activation and retain a previous valid version for rollback.

## User Data

User-created study state is separate from bundled canonical data. Favorites,
tags, assertions, poll responses, package operations, legacy verse drafts,
personal token renderings, and local job events live in browser storage and can
be exported as portable JSON.

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
