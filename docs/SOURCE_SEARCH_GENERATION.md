# Source and Search generation

`package.json` names the maintained commands. The logical generators are
`app/tools/import-original-language-sources.mjs` and
`app/tools/generate-search-indexes.mjs`. Package inventory and physical-pack
builders measure and package their outputs; they do not define text extraction,
token transformation, or Search indexing.

## Original-language authority

`import-original-language-sources.mjs` is the single maintained original-language
importer. Its XHTML mode extracts WLC, WLCO, Nestle 1904, and TR 1894 source text;
its Strong's mode groups reviewed verse-word JSONL into interlinear books and
lexicon JSONL into numbered chunks. There is no maintained Python generator.

```sh
npm run sources:check -- --archive-root <reviewed-extracted-archive>
npm run sources:check -- --strongs-root <reviewed-strongs-extract>
npm run test:source-generators
```

Replace `sources:check` with `sources:import` only for an intentional regeneration
from the correct reviewed input revision. `--check` compares without creating
directories or rewriting mismatches. Source files remain external; private
archive locations must never enter tracked reports or generation metadata.
For a separate review destination use `--output-root <verse-output-root>` in
XHTML mode or `--data-root <data-output-root>` in Strong's mode. Both modes accept
`--manifest-path <book-catalog>`, `--provenance-path <reviewed-source-manifest>`,
and `--identity-output <generation-manifest>`. The identity file is deterministic
and is also compared without writes in check mode. The reviewed archive hash is
a provenance declaration; hashes of the actual supplied files identify the
extract and do not prove that the directory reconstructs the original ZIP.

The XHTML transformation strips navigation and markup, requires nonempty source
script, and normalizes to NFC. It preserves source chapter/verse references,
including gaps and non-applicable pages, rather than imposing English verse
counts. Source identity includes the witness and its versification authority.
Strong's grouping preserves the current token tuple and chunk layout; it does
not derive a source witness from a Strong's number or silently substitute a
historical spelling/morphology revision. Safe relative source provenance is
retained; private machine paths are not publication metadata.

The preserved Python input is an older extraction revision. For example, its
Genesis 1:1 first-token original and morphology differ from the currently
packaged tuple. It must not be used to overwrite the current corpus. Fixture
tests prove the maintained transformations and check contract. A complete
no-write comparison of the preserved extract reproduced all 15 current lexicon
chunks (8,674 Hebrew and 5,624 Greek entries); its 384,267 word records
(268,136 Hebrew and 116,131 Greek) differ in all 66 interlinear books. Full current
interlinear reconstruction therefore requires matching reviewed external inputs.
Packaged-data tests remain the authority for the currently shipped source records.

## Current exact Search authority

```sh
npm run search:generate
npm run search:check
npm run test:search-generator
npm run test:search-contract
```

Search is reconstructed from the tracked verse books, lexicon chunks, outline
books, and commentary source books under `app/data`, with source registration
and rights/provenance from the tracked manifests. `NOTICE.md` remains the retained
distribution notice checked by the package audit, not an input to tokenization. Generation is
offline and writes only its owned `app/data/search` namespace. Ordinary checks
fail on missing, stale, unexpected, or invalid inputs/outputs rather than fixing
them during tests. Diagnostics name the relevant logical path and the command
needed to regenerate a reviewed change.

The generated manifest records deterministic source identities, source and
output digests, schema/normalization versions, per-shard counts and aggregate
counts. Ordering is explicit, not filesystem or locale dependent. It has no
wall-clock generation timestamp or machine-specific path. Display text is
resolved from canonical records; Search indexes contain term postings and
reference/edition identity.

Compatibility deliberately includes the existing indexing rules:

- Index normalization uses NFKD, removes combining marks, lowercases, and emits
  ASCII letter/digit tokens. Existing short terms, stop words and repeated
  postings remain represented.
- Query normalization uses the same character normalization, then removes
  terms shorter than two characters and the fixed runtime English stop words.
  Queries with several terms use the existing posting-count matcher; this is
  not positional phrase search. Duplicate postings and repeated query terms
  are observable under that contract and cannot be silently deduplicated.
- Verse references stay `[chapter, verse]`; commentary references stay
  `[chapter, verse, entry_index]`; outlines use item indexes and lexicon results
  use Strong's codes. Manifest ordering continues to define cross-shard order.
- Lexicon Search indexes the currently searchable six fields: summary, meaning,
  short definition, original word, transliteration, and concordance definition.
  Commentary Search indexes commentary HTML text, not the separate verse-text
  field. Adding other fields would change Search behavior and needs its own
  explicit contract change.

Direct Search tests invoke production lookup and result resolution through
storage adapters. They cover normalization, posting multiplicity, ordering,
scopes, editions, canonical result objects and missing data. They make no browser
rendering claim; the existing Search interaction suite covers that surface.

The #83 reconciliation reproduced all 992 pre-existing posting shards byte for
byte (357,584,792 bytes). Only the Search manifest gained identity/count metadata;
its runtime shard descriptors and order are unchanged. The reconciled counts are:

| Collection | Shards | Canonical records | Terms across shards | Postings |
|---|---:|---:|---:|---:|
| Verses | 660 | 310,970 | 791,969 | 7,831,635 |
| Lexicon | 2 | 14,298 | 37,139 | 358,525 |
| Outlines | 66 | 2,441 | 7,066 | 20,181 |
| Commentaries | 264 | 81,891 | 1,241,644 | 18,330,502 |

The posting-output digest is
`b223a61b9a02524e14b8e764629547a2d8df891fb1ed04cad4c10efc2a1292b5`.
It hashes the sorted path/byte-count/SHA-256 inventory, not concatenated text.
Current input and manifest identities are stored in the generated manifest;
they change when provenance or canonical inputs change.

## Future witness and alignment contracts

The source identity is witness-qualified, with a source-specific versification
identifier and source reference. Text, lemma, morphology, alignment and
provenance are distinct authorities: identical Strong's codes do not prove
identical tokens or aligned verses across witnesses. A future witness must use
its own output namespace, never a WLC/GNT compatibility path. Source-only or
unaligned records retain their source identity and explicit absent alignment;
they are not discarded or assigned a fabricated English reference.

New alignment generators must expose the same deterministic identity, counts,
digest and no-write comparison discipline before any alignment pack is shipped.
This slice imports no LXX/CATSS corpus and adds no multilingual Search lanes,
SQLite store, native pack delivery, or user-data migration.

## Historical candidate reconciliation

All sixteen candidates were inspected outside the repository. Their SHA-256,
original modification timestamps, archive-copy timestamps and dispositions are
in the local implementation report. No archive file was copied wholesale into
the branch. The following map is safe to publish without private archive paths.

| Candidate | Disposition | Current authority or conclusion |
|---|---|---|
| `build_app_data_indexes.py` | Merge | Port grouping/chunking into the Node importer with current schemas, provenance and check behavior; archived input revision is not current corpus authority. |
| `build-search-indexes.mjs` | Promote | Reconstruct in `generate-search-indexes.mjs`; archived shard layout, fields, deduplication and timestamps are incompatible with current Search. |
| `search-test.mjs` | Promote | Reconstruct in `tests/search-contract.mjs`, exercising production Search instead of copying its algorithm or obsolete package expectations. |
| `benchmark-search-json.mjs` | Reference | Historical filesystem read/parse/isolated lookup measurements are not current browser evidence. |
| `benchmark-search-sqlite.mjs` | Reference | In-memory Node SQLite build/count proxy does not measure persisted browser storage, startup or migration; no adoption. |
| `browser-performance-report.mjs` | Reference | Historical selectors, browser harness and thresholds do not establish current acceptance. |
| `build-word-map-indexes.mjs` | Reference | Early Strong's/index fallback mapping is evidence; `generate-analysis-packs.mjs` and `aggregate-analysis-manifest.mjs` own current analysis. |
| `performance-test.mjs` | Reference | Obsolete paths and informational thresholds; no new performance conclusion. |
| `build-graph-indexes.mjs` | Superseded | Maintained analysis generator/aggregator and analysis contracts. |
| `build-package-manifest.mjs` | Superseded | The maintained `inventory:refresh`/`inventory:check` commands and `build-physical-packs.mjs`; the uninvoked old metrics helper is not generation authority. |
| `build-semantic-metadata.mjs` | Superseded | Retired text-edition/provenance layout; current source manifest, generation identities and semantic contracts. |
| `contract-test.mjs` | Superseded | Maintained integrity, platform, capability, analysis, semantic, package and documentation contracts. |
| `smoke-test.mjs` | Superseded | Maintained interaction suite starts its own server and covers the Reader journey. |
| `hover-mouse.py` | Unsafe/obsolete | Owner-desktop pointer helper; not executed or restored. |
| `prepare-publish-clean.mjs` | Unsafe/obsolete | Destructive recursive source pruning/manifest rewriting; not executed or restored. |
| `sync-data.py` | Unsafe/obsolete | Preserved deprecation stub exits with an explanation; do not revive the obsolete import/sync path. |

## Validation and package identity

`test:static` includes focused generator and direct Search tests, complete
`search:check`, and `inventory:check`. It does not require a private source archive.
After intentional output/provenance changes, regenerate package identities with
`npm run inventory:refresh`, then reconcile physical-pack scenario measurements
with `node app/tools/build-physical-packs.mjs --write-scenarios` and check them.
The packaging path preserves NOTICE and source-manifest references.

At the final checkpoint run `npm run verify`, `npm run desktop:prepare`,
`npm run desktop:check`, `npm audit --audit-level=low`, and `git diff --check`,
plus the complete requested Gitleaks commit range. Runtime behavior changes
also require the applicable browser/desktop acceptance; generator-only work
does not require owner-profile or installer lifecycle tests.
