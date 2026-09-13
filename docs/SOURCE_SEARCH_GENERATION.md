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
lexicon JSONL into numbered chunks. Its Swete mode imports pinned source-native
line records into shared textual-comparison contracts. There is no maintained
Python generator.

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
counts. Source identity includes the witness, versification authority and source
reference. Token identity uses that canonical witness identity plus token index;
the shared source-token namespace also identifies the Hebrew base. Representation
and output namespace do not create a new token identity or witness.
Strong's grouping preserves the current token tuple and chunk layout; it does
not derive a source witness from a Strong's number or silently substitute a
historical spelling/morphology revision. Safe relative source provenance is
retained; private machine paths are not publication metadata.

`wlc` and `wlco` are two representations of the same Westminster Leningrad Codex
Hebrew base. Both use `witness_id: openbible:wlc`,
`source_token_namespace: openbible:wlc`, and
`versification: openbible:wlc:source-references`. Their registration IDs and
output paths remain distinct so the existing source text bytes and display
choices are preserved:

| Registration | Representation ID | Unicode normalization | Display | Output path |
|---|---|---|---|---|
| `wlc` | `pointed` | `NFC` | Pointed Hebrew | `data/verses/wlc` |
| `wlco` | `consonants-only` | `NFC` | Consonants-only Hebrew | `data/verses/wlco` |

Representation metadata describes the stored text; it does not authorize
rewriting the consonantal corpus from pointed text. Future alignment or voting
code must group evidence by canonical `witness_id`: these registrations provide
one Hebrew witness vote, never two independent witness votes.

The preserved Python input is an older extraction revision. For example, its
Genesis 1:1 first-token original and morphology differ from the currently
packaged tuple. It must not be used to overwrite the current corpus. Fixture
tests prove the maintained transformations and check contract. A complete
no-write comparison of the preserved extract reproduced all 15 current lexicon
chunks (8,674 Hebrew and 5,624 Greek entries); its 384,267 word records
(268,136 Hebrew and 116,131 Greek) differ in all 66 interlinear books. Full current
interlinear reconstruction therefore requires matching reviewed external inputs.
Packaged-data tests remain the authority for the currently shipped source records.

## Swete text pipeline (#96 Phase 2)

The same `import-original-language-sources.mjs` owns Swete mode. Its only output
namespace is `<output-root>/sources/swete-lxx/text/`. The output root is mandatory.
It does not register a runtime corpus, build an installable pack, or change Search.
Raw sources and full generated records remain external or ignored; only input
identities and small synthetic tests are tracked.

```sh
npm run sources:import -- --swete-root <pinned-source-root> --output-root <proof-output-root>
npm run sources:check -- --swete-root <pinned-source-root> --output-root <proof-output-root>
npm run test:swete-generator
```

`app/tools/source-inputs/swete-pinned.json` locks all 55 `data/*.txt` files and
the source README at `nathans/lxx-swete` revision
`26bad3eb42bba98471d154c954e36a6f30a0279d`. Each entry has its exact logical path,
source book number, byte length, SHA-256 and Git blob SHA-1. Acquire these files
from public raw URLs at that exact commit, preserving bytes and paths under the
external root. The importer performs no network access. Missing, altered,
wrong-revision or colliding inputs fail before any output write. Extra raw files
are not consumed. Coverage means the files present in this pinned source, not
every book in another canon or an independently reconstructed upstream edition.
First1KGreek provenance is a declaration from the pinned source README.

`--provenance-path` accepts the identical pin manifest, or an explicitly synthetic
`fixture:swete` / `synthetic-v1` / CC0-1.0 declaration. The latter is labeled
synthetic with partial witness coverage; it cannot claim the approved revision.
There is no generic corpus or restricted-data import mode.

### Source references and token identity

One source line is `book.chapter.verse surface`. The parser preserves literal
source labels: the accepted alias `Ps.50.1` is stored as `27.50.1`. It supports
numeric zero units, `prologue`, `iva`, `ivb`, and suffixes such as `35I`, `13a`
and `1a1`. Leading-zero numeric aliases, invalid UTF-8, interior blank lines and
malformed records fail with logical file and one-based line diagnostics.

Every non-whitespace surface is preserved verbatim, including punctuation,
non-Greek artifacts and controls. Quality counters report these records without
correcting the source. NFC is a separate `normalized_forms.nfc` alias. Tokens
are emitted in source line order and carry `source_file` and `source_line`,
linked to the manifest's exact hash. The occurrence key remains the four fields
owned by Phase 1. `token_index` starts at one per literal source reference and
continues when it recurs later in the file; `segment_index` increments for each
recurring block. Repeated surfaces remain distinct occurrences. This extends
the bounded Phase-0 contiguous-block experiment without discarding source lines.

### Explicit verse-map coverage

`app/tools/source-inputs/swete-verse-maps.json` transcribes only the accepted #97
projection: Genesis 1, Psalm 50 and Isaiah 40:3. It records authority revisions,
hashes, credits and changes, plus exact hashes of the three actual app WLC book
files supplying targets. `--verse-map-path` and `--app-verses-root` accept an
explicit matching projection and app book extract. No target is synthesized
from numeric similarity. Changed app bytes fail their hash check. Expanding
the reviewed projection requires a separate input review; confidence never
promotes a candidate in the importer.

All source units are reconciled against the explicit maps. The shared contracts
validate exact, split, merged, moved, source-only, canonical-only, unavailable
and uncertain shapes. Orphan sources, nonexistent app targets, duplicate IDs
and conflicting ownership of either side fail; splits/merges belong in one
group. Unlisted units receive `unavailable` / `unreviewed` records with empty
target arrays. Declared source-only material is distinct from an unknown map.
Coverage counts all units as mapped, source-only or unmapped, globally and per
book. Unreferenced app units are measured only over supplied app books and are
not automatically declared canonical-only evidence.

Reviewed/source-provided maps with one target may populate token
`canonical_reference`. Splits, multiple targets, uncertain/unavailable maps and
generated/unreviewed candidates leave it null; the map preserves all references
and its review state. Psalm `27.50.1`–`27.50.3` jointly map to `psalms/51/1`,
preserving both superscriptions and three source identity sequences.
`27.50.4`–`27.50.21` map to `psalms/51/2`–`psalms/51/19`. This is bounded
accepted evidence, not a full TVTMS interpreter.

### Manifest, checks and rights

Outputs are `witness.json`, `tokens/<source-book-number>.jsonl`,
`verse-maps.jsonl`, `provenance.json`, `NOTICE.txt`, the source README under
`notices/`, and `manifest.json`. Every domain record passes the shared validators.
Lemma, morphology and transliteration stay null; external IDs stay empty.
Swete-specific validation rejects populated annotations, Strong's identities,
Hebrew alignment and unknown token/map fields. No word alignment, lexical bridge
or alternate-Vorlage conclusion is generated.

The manifest uses #83's sorted inventory/digest model: transformation ID/version,
LF-normalized importer/contract code hashes, raw input identities, provenance,
coverage, semantic-record/file counts and per-file byte lengths/SHA-256.
`output_records` counts witness, token and verse-map records;
`output_payload_bytes` excludes the manifest. Returned measurements include
manifest bytes and separate parse/total times. Timings, wall-clock timestamps
and absolute local paths are excluded from deterministic artifacts. Importer or
contract code changes intentionally change input identity.

`--check` reconstructs and compares exact bytes, including manifest and notices,
without creating directories or modifying files. Diagnostics identify missing,
changed and unexpected files and the review/regeneration action. Unexpected
files in the owned namespace also block writes; nothing is deleted automatically.
All output paths are checked against input and symbolic-link/junction aliases
before writing.

Swete text and project adaptations retain CC BY-SA 4.0. Attribution, the source
README, upstream change history and license links accompany output. Bounded
STEPBible components retain CC BY 4.0 credits/notices and the upstream raw-data
distribution request. Application code remains MIT. Synthetic fixture text is
invented CC0-1.0 material; it establishes no production text/mapping authority.

### Production-size local proof

The 2026-09-13 proof consumed all 55 pinned text files: **11,795,198 raw text
bytes, 29,308 source units and 588,579 tokens**. The source README adds 845 bytes.
All size/SHA-256/Git-blob checks passed, with zero parse failures, duplicate
occurrence identities or orphan mapping sources/targets. **53 source units map
to 51 app targets; 0 are classified source-only; 29,255 remain unmapped.**
The source contains 55 recurring reference blocks, 1,046 tokens without Greek
letters and 10 tokens with Unicode control/format characters, all retained.
No source surface changes under NFC.

There are 61 generated files and approximately 340 MB of uncompressed contract
records/metadata. Exact bytes, generation/check timings, input/output digests
and per-book coverage are recorded in
[`measurements/septuagint-phase2.json`](measurements/septuagint-phase2.json).
This measures local Node/filesystem work, not browser, native or compressed-pack
performance. Repeated reconstruction is byte-identical and no-write checking
passes. Full source-file parsing is covered; **full-corpus reference mapping and
optional-pack readiness remain incomplete**. Source artifacts also need editorial
review before future delivery. No installer lifecycle is involved.

The offline synthetic suite covers normal/malformed parsing, repeated tokens and
blocks, suffix/zero units, all map cardinalities, Psalm superscriptions,
candidates, source-only/unmapped records, stale/missing/wrong identities,
determinism, no-write drift, annotations and input/output alias boundaries.
It runs in `test:source-generators` and therefore `npm run verify`.

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

## Shared witness and alignment contracts

`app/src/textual-comparison-contracts.js` owns the framework-neutral shared
domain semantics and validators for `textWitness`, `sourceToken`, verse maps,
alignment evidence, lexical links and passage relations. Browser and Windows
consumers share that authority. `app/tools/import-original-language-sources.mjs`
remains the single deterministic original-language generation authority: it owns
extraction, transformation, output namespaces, provenance digests and no-write
checks. The shared module generates no corpus and does not replace the importer;
future import support must consume its semantics rather than define a second
witness/token model. Existing production data formats are unchanged in Phase 1.

A `textWitness` declares one canonical `id`, language/script, a source-defined
`canon` identifier, `edition.name`/`edition.version`, text `rights` (license and
delivery), revision-qualified `provenance`, source `versification` and default
`normalization_profile`. Its `coverage` array identifies source books using
`source_book_id`, not app book IDs. Each book has `scope: complete`, `partial`,
or `unknown`: complete means the whole source book, partial explicitly lists
covered source units in `source_references`, and unknown makes no coverage
claim. Complete/unknown entries have empty reference arrays. The coverage list
does not assert that the entire canon is present. Source-only books and suffix
references remain valid. `representations` declares unique display IDs and their
normalization profiles beneath this one witness; neither canon metadata nor
edition/representation labels create extra votes.

For `sourceToken`, `sourceTokenIdentityKey` uses exactly `witness_id`,
`versification`, `source_reference` and the one-based safe-integer `token_index`.
The record's `id` labels a record/view; consumers use the canonical key for
occurrence deduplication. Optional `segment_index` and `group_index` may be omitted
or null; when supplied they are one-based safe integers within the source
reference and representation (group indexes within the segment when supplied).
They describe segmentation/grouping and never restart `token_index` or define
new occurrences. Canonical/app reference, representation, display form, normalized
forms, annotations, external IDs and provenance are not token identity fields.
Changing source tokenization or edition offsets still requires explicit
compatibility review; metadata changes cannot silently reuse incompatible IDs.

The corpus-free `tests/textual-comparison-contracts.mjs` fixtures run directly
with Node and are imported once by `tests/run.mjs` in `test:static`. They exercise
coverage, nullable positioning/annotations, identity invariants, all eight verse
map types and nine alignment states, and distinct lexical/passage evidence.
The accepted Psalm 50:1–3 → app Psalm 51:1 many-to-one fixture keeps three source
identities even though their app target is shared. Generated confidence cannot
promote an alignment, lexical link or passage relation to reviewed evidence;
exact canonical lemma links require matching canonical lemma IDs.

The [accepted #97 decision](decisions/SEPTUAGINT_SOURCE_STACK.md) remains the
source/rights boundary: Swete is text-contract-ready, TVTMS is bounded reference
authority, and Swete token lemma/morphology must remain null (enforced by the
validator). Synthetic annotation fixtures for other witnesses establish schema
behavior only. Hebrew↔Greek word alignment, certified Swete/GNT token bridges,
production LXX delivery and an optional separately licensed pack remain unsupported.
Phase 2 adds local import/check proof as described above, without changing those
delivery limits. Text rights do not confer annotation/alignment rights.

The source identity is witness-qualified, with a canonical source-token namespace,
source-specific versification identifier and source reference. Representation,
normalization, display metadata and output paths are separate from that identity.
In particular, #96 must deduplicate WLC/WLCO evidence by `witness_id` before
counting witness votes; differing pointed/consonantal representation IDs or paths
cannot establish independent witnesses. Text, lemma, morphology, alignment and
provenance are distinct authorities: identical Strong's codes do not prove
identical tokens or aligned verses across witnesses. A future witness must use
its own output namespace, never a WLC/GNT compatibility path. Source-only or
unaligned records retain their source identity and explicit absent alignment;
they are not discarded or assigned a fabricated English reference.

New alignment generators must expose the same deterministic identity, counts,
digest and no-write comparison discipline before any alignment pack is shipped.
The maintained Swete mode consumes only its approved source inputs; CATSS remains
excluded. It adds no multilingual Search lanes, SQLite store, native pack
delivery, or user-data migration.

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
After intentional output/provenance changes, run `npm run search:generate` and
`npm run search:check` first: `source-manifest.json` is a Search-generation metadata
input, so a provenance-only change updates the Search manifest identity even when
all posting shard bytes remain unchanged. Then regenerate package identities with
`npm run inventory:refresh` (including the distribution's package digest), then
regenerate dependent fixture identities with
`node app/tools/build-physical-pack-fixtures.mjs` and reconcile scenario
measurements with `node app/tools/build-physical-packs.mjs --write-scenarios`.
Check them with `npm run physical-packs:check` and
`npm run physical-packs:scenarios:check`. Inventory refresh preserves timestamps
when inventory bytes are unchanged; check mode also rejects a stale distribution
reference without writing either manifest.
The packaging path preserves NOTICE and source-manifest references.

At the final checkpoint run `npm run verify`, `npm run desktop:prepare`,
`npm run desktop:check`, `npm audit --audit-level=low`, and `git diff --check`,
plus the complete requested Gitleaks commit range. Runtime behavior changes
also require the applicable browser/desktop acceptance; generator-only work
does not require owner-profile or installer lifecycle tests.
