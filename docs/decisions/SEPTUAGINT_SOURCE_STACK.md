# Septuagint Source Stack Decision

Status: **Phase 0 proof complete — #96 Phase 1 may proceed with exclusions.**

Decision date: 2026-09-08. Related issues: #97 (this decision), #96 (comparison),
#78 (multilingual Search), completed #83 (maintained generation authority).
Accepted base: `e420f31be6a79fd34e5e520c80fa76cc640d9c40`.
Proof started at `055e0b6d5ce4982834c90858eec23ff2f05eed75` on
`research/septuagint-source-stack`. Tracked application inputs are unchanged.

## Decision and scope

Select Swete as the Greek text source for a future separately licensed optional
pack. Small-fixture parsing and reference comparison are feasible. Automatic
Swete token lemmas, morphology and Hebrew↔Greek word alignment remain unproved
and must initially be absent. Lexical resources retain separate authority.

| Decision | Selected first boundary | Evidence / exclusion |
|---|---|---|
| Greek text | Pinned Swete with source-native references and token order | 1,054 fixture tokens parse; text/data CC BY-SA 4.0 |
| Lemma source | **None for Swete token annotations**; Open Scriptures LxxLemmas is a deferred join candidate; TBESG is dictionary support only | 1,041 positional candidates, six unequal-length verses, no certified surface bridge |
| Morphology | **None / deferred** | No Swete-compatible tagged corpus established; TAGOT unavailable |
| Versification | Pinned TVTMS plus explicit project projection onto actual app records | Psalm title merge proved; bounded Genesis/Isaiah identity fallbacks; no full TVTMS interpreter |
| Hebrew↔Greek alignment | **Defer word-level alignment** | No defensible authorized occurrence alignment; no local restricted adapter or generated candidates in first delivery |
| Packaging | Optional, separately licensed Swete text/data pack, shared by browser and Windows | Rights boundary and text-only measurements support feasibility; no pack created here |
| #96 Phase 1 readiness | **Proceed with exclusions** | Source/identity/licensing/reference contracts can begin; full-corpus delivery and annotated-token features are not cleared |

This clears the Phase 0 prerequisite for defining #96 production contracts. It
does not start implementation in #97: no production corpus, full generated
output, provider, pack, UI, #78 Search, user-data v3 change, backend/account/sync,
release, tag, settings change, merge or PR is included. Future code belongs to
the [#83 generation authority](../SOURCE_SEARCH_GENERATION.md), with explicit
inputs, output ownership, provenance, deterministic digests and no-write checks.
The disposable proof is not a second maintained generator.

## Invariants and supported claims

- `wlc` and `wlco` are two representations of one Westminster Leningrad Codex
  Hebrew base (`openbible:wlc`), never two independent witness votes.
- Text, lexical identity, token lemmas, morphology, versification and word
  alignment have distinct authorities. Strong's codes do not prove token alignment.
- Keep source-only, unaligned and ambiguous records with source identity; an
  absent app target stays null rather than acquiring an invented reference.
- Initial #96 contracts may describe source-qualified verse comparison and
  dictionary lookup with provenance and uncertainty. They may not advertise
  certified Swete lemma occurrences or exact Nestle token highlighting. The
  demonstrated lexical overlap is an unpositioned inventory result.
- Lexical overlap does not establish quotation, allusion, dependence or identical
  contextual meaning. Token differences do not establish omission, addition,
  alternate Vorlage or other text-critical conclusions.
- No restricted CATSS/CCAT text or alignment bytes were downloaded, used,
  transformed, committed or used as hidden authority. Public readability is not
  redistribution permission.

## Exact source acquisition and rights

Prior GitHub discovery was reused. Swete and GreekResources heads remained at
their pins. STEPBible advanced to `ae39711d7843b2902d54993e432de9c12d6a4b9a`;
the [one-commit comparison](https://github.com/STEPBible/STEPBible-Data/compare/ea47bd4c7eab7375f2dca07086ccc356e95a4128...ae39711d7843b2902d54993e432de9c12d6a4b9a)
changes only TIPNR proper names. README, TVTMS and TBESG remain unchanged and
the proof retains the requested pin. Neither inspected tree contains TAGOT.

| Source | Exact proof revision | Roles / repository terms |
|---|---|---|
| [nathans/lxx-swete](https://github.com/nathans/lxx-swete/tree/26bad3eb42bba98471d154c954e36a6f30a0279d) | `26bad3eb42bba98471d154c954e36a6f30a0279d` | Greek text/data annotations CC BY-SA 4.0; build code MIT |
| [openscriptures/GreekResources](https://github.com/openscriptures/GreekResources/tree/dd5a2fd530ab3c6b748c174cec38966c356d8111) | `dd5a2fd530ab3c6b748c174cec38966c356d8111` | Own lexical resources CC BY 4.0; credit Open Scriptures Septuagint Project; actual restricted LXX text excluded |
| [STEPBible/STEPBible-Data](https://github.com/STEPBible/STEPBible-Data/tree/ea47bd4c7eab7375f2dca07086ccc356e95a4128) | `ea47bd4c7eab7375f2dca07086ccc356e95a4128` | TVTMS versification / TBESG lexical data CC BY 4.0; retain supplied attribution and changes |

Acquired 2026-09-08 through raw HTTPS URLs addressing exact commits. Local
SHA-256 covers untouched downloaded bytes. Byte length and independently
computed Git blob SHA-1 also match each pinned recursive-tree entry: **all pass**.
Blob identity verifies correspondence and does not replace SHA-256. Only three
Swete book files and selected fixture outputs are consumed; no full text corpus
was downloaded or generated. Tree metadata supplies the full-source size estimate.

TVTMS means exactly
`Versification/TVTMS - Translators Versification Traditions with Methodology for Standardisation for Eng+Heb+Lat+Grk+Others - STEPBible.org CC BY.txt`.
TBESG means exactly
`Lexicons/TBESG - Translators Brief lexicon of Extended Strongs for Greek - STEPBible.org CC BY.txt`.

| Source: exact path | Bytes | Local SHA-256 |
|---|---:|---|
| lxx-swete: data/01.Genesis.txt | 609,070 | `b5abf507f757de3c96f3e44944515dba46d6e5b9edd8e653d7ce6096588c5ce6` |
| lxx-swete: data/27.Psalmi.txt | 716,207 | `d9a8fe86689e23c8b5b04d8edc857a1861362eccb03514e92560b7f048785e2e` |
| lxx-swete: data/48.Isaias.txt | 553,905 | `e552647fd45e3c06ee506659536be1193fc88779e2c225ee8d963f97ecd4c5e0` |
| GreekResources: LxxLemmas/Gen.js | 1,485,365 | `4da2dc0c4d4a35e6288509a829260c83bb65bed2f92229e3479b92fb76b3bc14` |
| GreekResources: LxxLemmas/Isa.js | 1,250,435 | `cc79c1ce7e0008374d6b9e9b0d18d4784f8d5403202242e239a983c8a3beed29` |
| GreekResources: LxxLemmas/Ps.js | 1,625,022 | `bf7264c582076d790a44f628352f50e692945ffbb31ec183495b98f4cbdfb291` |
| GreekResources: LxxLemmas/readme.md | 1,067 | `87e2aa28e344624e9f3da262d4e84dfd45bdf0066cea4d172949589372cfe307` |
| lxx-swete: README.md | 845 | `ca5869019f542d01ae0ecd9e0381ddbfe6bd0a6c14ed7edf52b8d0973634c325` |
| GreekResources: README.md | 1,711 | `3e7f9d9202a4c09f604ba7a79be15df919e9d32901b14b968ded89756bfadf18` |
| STEPBible-Data: TBESG | 4,736,912 | `312f723d7b8ef263bbdfb0451c9b8057125804dfff390b6f8544cff2a84b57f4` |
| STEPBible-Data: README.md | 14,495 | `261d5157c0ffeadeedad3f734db945a4c3642e3e4ce5fa28002985b6c52437b1` |
| lxx-swete: COPYING-Code | 1,090 | `ae21033db0eb664b0be84881d8993a32357e0cf66e6961a37bba0844b8e695d2` |
| STEPBible-Data: TVTMS | 5,790,928 | `63058e0f20201af4bdaa7d830da5be8f493455d947c5f147d84840b33db9ddf8` |

Separate role review:

- [Swete README](https://github.com/nathans/lxx-swete/blob/26bad3eb42bba98471d154c954e36a6f30a0279d/README.md#L3-L16)
  identifies First1KGreek `tlg0527` and upstream
  `eb81494731fd632f582c4b94634127bdbd596b43`. This is declared upstream
  provenance, not an independently reconstructed upstream edition. Greek text
  and data annotations are CC BY-SA 4.0; `COPYING-Code` separately licenses
  Nathan D. Smith's code under MIT. No code is adopted here.
- [GreekResources README](https://github.com/openscriptures/GreekResources/blob/dd5a2fd530ab3c6b748c174cec38966c356d8111/README.md#L38-L40)
  grants CC BY 4.0 for its own resources. The
  [lemma format](https://github.com/openscriptures/GreekResources/blob/dd5a2fd530ab3c6b748c174cec38966c356d8111/LxxLemmas/readme.md)
  documents historical lxxmorph order and editorial lemma work. This grants
  neither access to the excluded text nor proof of Swete compatibility.
- STEPBible README lines 53–67 identifies TVTMS, a morphology-code glossary and
  forthcoming TAGOT. A glossary is not a tagged Swete corpus. TBESG lines 69–76
  define the Greek headword and lexical grammatical category. Retain its supplied
  Abbott-Smith/Middle Liddell/STEP contributor credits. Lexicon data does not
  establish morphology or word-alignment authority.
- TVTMS lines 10–18 and TBESG lines 12–20 permit software/publication inclusion
  and changes with a visible change record, while requesting upstream raw-data
  distribution for update management. Pinned README lines 12–14 permits linked,
  current mirrors. Preserve both notices: select derived application use under
  the CC BY grant and no standalone raw-data mirror. Do not omit the older request.
- No redistributable Hebrew↔Greek occurrence alignment was established. CATSS
  is rejected for this delivery without acquiring restricted bytes. TAGOT is
  deferred until an actual source revision, rights and measured joins exist.

### Future license and delivery boundary

Select an optional Swete text/data pack with its own license, attribution,
source revision/hash manifest and transformation/change history. Swete content
and project adaptations retain CC BY-SA 4.0. Separately identifiable Open
Scriptures/STEP components retain CC BY 4.0 credits and notices; any combined
Swete-derived data adaptation uses the chosen BY-SA boundary with component
credits intact. Application code remains MIT. Personal study data and portable
backups receive no new format or licensing rule in this slice.

Official [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/legalcode.en)
and [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/legalcode.en) terms
were reviewed. They permit commercial use subject to their conditions: preserve
supplied creator/copyright/license/disclaimer information and source links;
identify changes and prior changes; avoid implied endorsement and conflicting
downstream legal/technical restrictions. BY-SA adds adaptation-license and
database-rights conditions. Technical format conversion alone is not necessarily
an adaptation, but cannot remove source licensing. This pack boundary is a
conservative project decision; optionality does not avoid share-alike or make
every separate MIT application file BY-SA.

This public commit contains decision prose, measurements, links, hashes and short
source examples, not corpora or generated Greek records. Swete surface examples
in this document retain CC BY-SA 4.0, credited to Nathan D. Smith,
Open Greek and Latin First1KGreek and the Swete edition; changes are selection
and the explicitly described normalization comparisons. Open Scriptures lemma
examples retain CC BY 4.0 with credit to the Open Scriptures Septuagint Project.
These examples are not relabeled MIT. The limited mapping summary here credits
STEPBible.org / Tyndale House, CC BY 4.0; changes are fixture selection, range
expansion and app-target projection. Later redistribution of Swete-derived data,
even a small fixture, must retain its notices and data-license boundary. No
restricted local adapter is selected. Browser and Windows delivery must preserve
these obligations rather than inherit the repository's MIT application label.

## Disposable proof and token integrity

Ignored `.tmp-issue97-20260908/` holds source downloads, scripts and detailed
reports. Logical inputs are `swete/`, `lemmas/`, `rights/`, `versification/` and
tracked app data; outputs are `output/`, `gnt/`, `rights/` and `versification/`.
No private absolute machine paths enter this record. Retained local commands:

```text
node .tmp-issue97-20260908/acquire.mjs
node .tmp-issue97-20260908/proof.mjs
node .tmp-issue97-20260908/memory-bench.mjs
node .tmp-issue97-20260908/rights/analyze-tbesg.mjs
node .tmp-issue97-20260908/versification/proof.mjs
node .tmp-issue97-20260908/gnt/check-gnt.mjs
```

These scripts are intentionally untracked and unavailable in a fresh public
clone. None is promoted into #83. Reproduction algorithm: preserve source
lines/newlines; parse `^(\d+)\.(\d+)\.(\d+) (\S+)$` after removing line
endings; explicitly map book numbers 1/27/48 to Gen/Ps/Isa; select Gen.1.*,
Ps.50.* and Isa.40.3; enumerate tokens from 1 in source order per verse. Require
Greek or punctuation-only surfaces and contiguous verse blocks. Preserve repeated words. Parse
LxxLemmas JSON and check duplicate verse keys and valid key/lemma strings. Attach
only a separately labeled positional candidate; leave the token lemma null.

| Fixture | Source lines, 1-based | Units | Tokens | Malformed | Duplicate positions | Missing source refs / unmapped targets |
|---|---|---:|---:|---:|---:|---:|
| Genesis 1 | 1–753 | 31 | 753 | 0 | 0 | 0 / 0 |
| Psalm 50:1–21 | 11,426–11,710 | 21 | 285 | 0 | 0 | 0 / 0 |
| Isaiah 40:3 | 15,906–15,921 | 1 | 16 | 0 | 0 | 0 / 0 |
| Total | Three fixtures | 53 | 1,054 | 0 | 0 | 0 / 0 |

All three downloaded books also have zero malformed lines under the parser.
The leading `1.1.1` means book.chapter.verse, not word ID. There is no upstream
word-position field; zero duplicate positions applies to the explicitly
enumerated identity. Genesis/Psalm/Isaiah have 185/20/0 repeated identical raw
lines, which are retained word occurrences rather than corrupt duplicates.
The counts are source token records: **1,053 contain Greek letters and one is a
standalone punctuation marker**, `•` (U+2022), at Gen.1.20 position 22 / file
line 447. Thus Genesis has 752 Greek-word records plus this marker. The stricter
all-Greek assertion exposed it; retaining and classifying the marker is required,
not deleting it to improve lemma coverage. It contributes to that verse's 25/24
positional mismatch and remains in the measured output and identity sequence.

NFC changes zero fixture surfaces and causes zero collisions. A deliberately
lossy diagnostic alias (NFD, combining-mark removal, lowercase, edge punctuation
removal, final-sigma fold) collapses **33/13/0** groups of distinct raw forms.
It cannot define token identity: examples include `ὁ`/`ὃ`/`ὅ`, `ΕΝ`/`ἐν`,
`ἑσπέρα`/`ἐσπέρα`, enclitic/accent forms `σου`/`σοῦ`, `μου`/`μού`.
There are **99/53/2** punctuation-bearing tokens; retain attached punctuation.
Proper names retain source spelling/case (`Δαυείδ,`, `Ναθὰν`); normalization
is not person identity. Multiple-accent surfaces include `Ἐλέησόν` and
`ἄρχεῖν`; record rather than silently repair them or infer morphology.
Psalm 50:19 splits `ἐξ` and `ουθενώσει.` where the lexical resource proposes
one compound-verb lemma; resegmentation would alter token identity.

Proposed #83-compatible identity:

```json
{
  "witness_id": "swete:lxx",
  "versification": "swete:source-references",
  "source_reference": "Ps.50.3",
  "token_index": 1
}
```

Bind this namespace to source revision, file SHA-256, parser/tokenizer version
and source line provenance. Changed tokenization/upstream revisions require
explicit compatibility/version review, not silent reuse of offsets. Display
normalization, app reference and pack path do not create witnesses. Keep
Ps.50.1/.2/.3 distinct even when all compare with app `psalms/51/1`.
Unsupported annotations and alignment remain null.

## Lemma join and morphology

Candidate key: fixed book-number→OSIS mapping, unchanged source chapter/verse,
one-based Swete token position = Open Scriptures array index + 1. No surface
normalization affects this key. Preserve key/lemma, repo/revision/file/hash,
reference/index and `unverified-positional-candidate` status. Checked fixture
objects have valid key/lemma strings, no duplicate verse keys, ambiguous
positional keys or compound/multi-lemma values under the delimiter check.
There are no missing lemma verse references or lemma tail positions exceeding
Swete verse lengths. These structural facts do not validate compatibility.

| Fixture | Swete tokens | Candidate present | Candidate absent | Equal / unequal length verses | Absent rate |
|---|---:|---:|---:|---:|---:|
| Genesis 1 | 753 | 741 | 12 | 26 / 5 | 1.5936% |
| Psalm 50 | 285 | 284 | 1 | 20 / 1 | 0.3509% |
| Isaiah 40:3 | 16 | 16 | 0 | 1 / 0 | 0% |
| Total | 1,054 | 1,041 | 13 | 47 / 6 | 1.2334% |

Unequal counts, Swete/LxxLemmas: Gen.1.11 **37/35**, .14 **46/39**,
.20 **25/24**, .30 **35/34**, .31 **21/20**; Ps.50.19 **14/13**.
Gen.1.14 position 16 pairs `καὶ` with candidate `ὁ`; position 17 pairs
`ἄρχεῖν` with `διαχωρίζω`. Thus absent tails understate positional mismatch:
earlier entries can already be shifted. Equal length, including Isaiah 40:3,
does not prove identical order.

LxxLemmas omits inflected source surfaces and morphology needed for independent
token comparison. NFC surface-versus-lemma diagnostics with edge punctuation
removed equal 130/53/2 tokens; lossy alias comparisons equal 295/133/3. These
compare inflected words to dictionary forms and are not correctness rates.
No stemmer, inferred deletion, automatic repair or restricted text improves them.

**Production acceptance: 0 certified Swete token-lemma assignments; 1,054/1,054
unresolved (100%).** This does not mean every candidate is linguistically wrong.
Select no automatic token-lemma source. A compatible permissive annotation set
or independently reviewed adapter needs later measured acceptance. Morphology
is **none/deferred**: Swete supplies surfaces, LxxLemmas key/lemma, TBESG lexical
category, and TAGOT remains forthcoming. A glossary cannot generate token tags.

### TBESG lexical support

Parse tab-separated rows after the header; preserve eStrong/dStrong/uStrong,
Greek and source row. Match app `G<decimal>` to eStrong padded to at least four
digits; within matching rows compare the **whole** Greek field using NFC only.
Do not remove sense suffixes, split headword alternatives or substitute uStrong.

| Measurement | Result |
|---|---:|
| Rows / distinct eStrong / distinct dStrong | 11,035 / 10,847 / 11,035 |
| Structurally malformed / duplicate dStrong | 0 / 0 |
| Missing Greek field | 1, line 2343, G2199H; exclude from lemma lookup |
| eStrong keys with multiple rows | 109 |
| Meaningful app codes present | 5,523 / 5,523 |
| Absent app entries | 101, all `Not Used` placeholders |
| Same code + whole NFC headword match | 5,170 / 5,523 |
| Unique / ambiguous exact rows | 5,077 / 93 |
| Code present, Greek field differs | 353 |
| Unresolved or ambiguous unique-row rate | 446 / 5,523 = 8.0753% |

Unique NFC examples: `ἀρχή` G0746 line 855, `βοάω` G0994 line 1116,
`ἑτοιμάζω` G2090 line 2232, `θεός` G2316 line 2465. `κύριος` has
G2962G/H at lines 3157–3158; `φωνή` has G5456G/H at 5621–5622. Retain
sense ambiguity. This supports dictionaries given a trustworthy lemma, not
Swete token occurrences, contextual senses, morphology or alignment.

## Versification

Pinned TVTMS Psalm selectors are at lines **1513–1518**, columns **1519**,
rules **1520–1522**; expanded Latin+Greek rows **12979–12999** corroborate
the mapping. This proof evaluates the fixture conditions, not all TVTMS rules.

Swete has Ps.9:30, ends Ps.50 at 21 and has no separate pre-v1 title: the
Latin+Greek selector (1515) applies. Actual app WLC/WLCO/KJV/WEB lack Ps.9:30,
end Ps.51 at 19 and embed the title in 51:1: **EngTitleMerged** (1516).
Choosing the 21-record Hebrew column solely because app text is Hebrew is wrong.
The fixture uses direct chapter-inventory absence for Ps.9:30. TVTMS's generic
`NotExist` explanation (line 120) also requires preceding-verse text, but app
Ps.9 ends at 20, so 9:29 is absent too. This conflicts with the selected column's
predicate and remains outside validated interpreter scope; the fixture projection
is supported by the concrete title/body rows and actual app contents.

| TVTMS line | Rule | Greek | Traditional MT | App projection |
|---|---|---|---|---|
| 1520 | SubdividedVerse / title | Ps.50:1–2 | Ps.51:1–2 | Title embedded in app Ps.51:1; EngTitleMerged has `Absent [=Psa.51:1]` |
| 1521 | OneToOne | Ps.50:3 | Ps.51:3 | App Ps.51:1 |
| 1522 | OneToOne range | Ps.50:4–21 | Ps.51:4–21 | App Ps.51:2–19 |

Therefore **Greek 50:1–3 → app 51:1** is one many-to-one group. Two source
superscription units contain 18 tokens and retain separate identities. The
remaining 18 units map one-to-one. Zero source splits, source-only units or
orphan/unmapped records occur. Do not discard title tokens or invent app verse 0.

Genesis 1:1–31 and Isaiah 40:3 have no TVTMS chapter exception records. Their
identity mappings are **explicit project fallbacks**, checked against actual
WLC/WLCO/KJV/WEB references and inspected source passages, not invented TVTMS
rows. Prefix `48.40.3` becomes source `Isa.40.3` and app `isaiah/40/3`.
Totals: **53 source units / 1,054 tokens → 51 app targets**. Full-corpus
conditional mapping and token correspondence remain unproved; future unmatched
units must remain source-qualified with absent targets.

## LXX and current Nestle/GNT identity lanes

Inputs: tracked source manifest, six `app/data/lexicon/greek/*.json` chunks,
27 NT `app/data/interlinear/books/*.json` files and all 27 Nestle text books.
Bounded textual comparisons use Matthew/Mark/Luke/John/Romans. Historical app archive
provenance remains `5873f5a28ceb3cb760cc0dcaa9b9d28ffaf00595bad0c424b60c7f1ad56283fe`;
it is not proof of a matching external extract. Per-file hashes are retained in
`gnt/input-inventory.tsv` and `gnt/gnt-report.json`; the latter's deterministic
input-inventory digest is
`44fb1a4a12a44216c3fffc86ab3f216103d429abea59292a7e37f19d1ec15f2d`.

**Exact canonical lexical lane:** NFC-only equality of Open Scriptures lemma
to a unique complete app `original_word` field, then its code occurring anywhere
in current NT interlinear data. This is dictionary identity/unpositioned usage,
not certified Swete or Nestle occurrence identity.

| Open Scriptures fixture | Unique lemmas | Unique dictionary + NT-used matches | Matched occurrences |
|---|---:|---:|---:|
| Genesis 1 | 114 | 104 | 584 / 741 |
| Psalm 50 | 132 | 106 | 175 / 284 |
| Isaiah 40:3 | 13 | 11 | 11 / 16 |
| Combined distinct inventory | 237 | 201 | 770 / 1,041 |

The 5,624-entry dictionary has 5,511 distinct NFC fields, including placeholders;
5,337 codes occur in NT data. Four fixture headwords (`εἰ`, `εἷς`, `οὐ`,
`ὁ`) have multiple entries: withhold their 192 occurrences from unique identity.
The separate weaker exact-headword-presence result including ambiguity is
205/237 distinct and 962/1,041 occurrences. Neither annotates Swete tokens.

**Normalized alias lane:** NFC canonical equivalence is already exact. Lossy
NFD/mark-removal/case/sigma folds propose `Νάθαν→Ναθάν`, `μοι→μοί`,
`μου→μοῦ`; **zero aliases approved**. Alternatives are not silently split.

**Surface lane:** punctuation-split, NFC Greek string intersection only.
Isaiah 40:3 shares 13/11/13/6 distinct exact strings with Nestle Matthew 3:3 /
Mark 1:3 / Luke 3:4 / John 1:23. Case/accents remain significant (`Φωνὴ`
versus `φωνὴ`). Surface agreement does not establish lemma identity or alignment.

**Lexical relationship lane:** existing `word_origin_refs` links, such as
`εὐθύνω` G2116 → `εὐθύς` G2117 and `ἔπω` G2036 / `λέγω` G3004,
remain relations, not exact identity. The selected NT passages are comparison
fixtures, not the result of quotation/allusion detection.

Current GNT limitation: all **138,131 tuples / 27 books / 1,953 storage blocks**
have `original === transliteration`, contain Latin letters and contain no Greek
letters. They are not Nestle Greek surface tokens. Structural checks find zero
malformed tuples, duplicate indexes, empty originals or unknown Strong's codes.
John storage key 1:1 has 61 tuples versus Nestle John 1:1's 17 Greek words;
John 1:23 has no separate interlinear key. Equal counts elsewhere do not prove
order (Matthew 3:3 differs). Do not label these blocks certified verse mappings.
A positional bridge to Nestle needs separate proof; repairing current data is
outside #97.

## Size and performance

Raw slices preserve source line endings. Diagnostic JSON repeats per-token
identity/provenance with null lemma/morphology/alignment and an unverified
candidate. The text-only trial envelope stores witness/revision/file/hash once,
ordered verse references/line starts and NFC token arrays (index + 1 is position).
Neither is an adopted production schema. UTF-8 minified JSON has one final LF.
gzip level 9 and Brotli quality 11 run independently per fixture. NT/lexicon
bodies are excluded.

| Fixture | Raw | Diagnostic JSON | gzip / Brotli | Text-only JSON | gzip / Brotli |
|---|---:|---:|---:|---:|---:|
| Genesis 1 | 13,351 | 345,284 | 14,225 / 9,519 | 12,112 | 2,406 / 2,022 |
| Psalm 50 | 5,836 | 132,458 | 6,995 / 5,353 | 5,687 | 1,836 / 1,548 |
| Isaiah 40:3 | 318 | 7,540 | 852 / 707 | 569 | 415 / 342 |
| Sum, bytes | 19,505 | 485,282 | 22,072 / 15,579 | 18,368 | 4,657 / 3,912 |

| Raw fixture slice | SHA-256 |
|---|---|
| Genesis 1 | `517ce05cc4e220f9cab06b5545607f4f85334374890fa50cdcde63b1dbf29b8e` |
| Psalm 50 | `1527f430b874540259796ac419ebd02ceb5cc6077cf9bdc8cea69840eabe7d3c` |
| Isaiah 40:3 | `553476f4f17b951ee55093c12b7cdc105149b87c2cdde310dce3ef48e2974abe` |

The pinned tree lists **55 `data/*.txt` files / 11,795,198 raw bytes**: source
inventory, not 55 approved app books or witnesses. Scale fixture output/raw
ratios by `11,795,198 / 19,505 = 604.7268905`: diagnostic JSON **293,463,075**,
gzip **13,347,532**, Brotli **9,421,040** bytes; text-only JSON **11,107,624**,
gzip **2,816,213**, Brotli **2,365,692** bytes. Three nonrandom fixtures and
separate compression streams make this approximate; full mapping/lexicon/index/
notice overhead is excluded. It demonstrates schema repetition cost, not a
capacity guarantee. The estimate supports an optional text pack without requiring
a backend, database or desktop-only delivery.

Node **v24.19.0**, Windows x64; 25 in-process samples after loading inputs:
median token parse **0.466 / 0.123 / 0.0065 ms**, candidate attachment
**0.131 / 0.0345 / 0.0018 ms** (Genesis/Psalm/Isaiah). Parse ranges
0.241–0.763 / 0.099–0.334 / 0.006–0.019 ms; join ranges
0.044–0.526 / 0.018–0.085 / 0.0014–0.0129 ms. This excludes acquisition,
reading, dictionary JSON parsing and compression, and measures no linguistic
resolution. These timings are an observation, not deterministic output.
The recorded timing run is retained as `output/report-timing-snapshot.json`;
the final assertion run reproduced all fixture sizes, hashes and join counts.

Five fresh Node child processes, forced GC before/after retained objects:
all fixture file reads+parse **1.625–2.432 ms**, retained heap delta
**152,528–157,704 bytes**, RSS delta **1,114,112–1,470,464 bytes**.
Loading three complete lemma book dictionaries separately took **39.364–45.097 ms**,
added **9,776,032–9,781,208 heap bytes** and **13,410,304–13,828,096 RSS bytes**.
Allocator/GC/cache effects apply. These are not peak-memory, cold-disk, browser,
mobile, installer or full-corpus runtime measurements.

## Completion and remaining gates

Phase 0 acquisition, token integrity, positional compatibility, lexical inventory,
bounded versification and sizes are measured. **Proceed with exclusions** clears
source-contract work without requiring fabricated alignment. Remaining production
gates: full-source reference/conditional mapping coverage, a compatible lemma/
morphology source if required, a verified GNT positional bridge for token-level
results, and an attributed separately licensed pack implemented through #83.
Fixture success cannot establish full-corpus coverage.
For example, the downloaded full Psalm lemma file includes `Ps.144.13a` outside
the fixtures; future contracts must preserve suffix references instead of
extrapolating this fixture's numeric-only parser.

The completion commit changes this document and registers it in the existing
documentation consistency model; the focused check found the earlier branch's
new decision record was unclassified. Earlier commits started the decision and
source discovery. Proof downloads/code/output stay ignored and local. No
production code, data manifest or user-data contract changes.
Final delivery validation is reported against the committed SHA: focused document
consistency, `npm run verify`, `npm audit --audit-level=low`, `git diff --check`,
worktree status and available Gitleaks over
`e420f31be6a79fd34e5e520c80fa76cc640d9c40..FINAL_HEAD`.
Installer lifecycle/native physical acceptance is not applicable and not run.
No PR is created; hosted required checks remain a later pre-merge gate, not a
claimed result of local proof.
