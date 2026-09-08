# Septuagint Source Stack Decision

Status: **Phase 0 working record — no production Septuagint source stack is approved yet**

Related issues: #97 (this decision), #96 (Septuagint comparison), #78 (multilingual Search), completed #83 (deterministic source/Search authority).

Accepted repository baseline for this slice:

```text
e420f31be6a79fd34e5e520c80fa76cc640d9c40
```

## Purpose

Select and validate a legally and technically usable first source stack for a future witness-qualified Septuagint comparison capability without importing restricted data or overstating what the available evidence can establish.

This document is the maintained decision record for #97. It should be updated only from exact source evidence and reproducible proof results. It does not authorize the full #96 UI, full-corpus production import, Hebrew↔Greek scholarly alignment publication, or release/tag creation.

## Non-negotiable invariants

- `wlc` and `wlco` are pointed/consonantal representations of the same Westminster Leningrad Codex Hebrew base. They are not independent textual witnesses.
- Code, Greek text, annotations, lemma/morphology resources, alignment data, versification data, and derived-output rights must be evaluated separately.
- A publicly viewable source is not automatically redistributable.
- CATSS or other restricted bytes must not be committed, mirrored, transformed for redistribution, or used as an undisclosed authority for public derived alignment records without documented permission.
- Exact lemma reuse across LXX and NT does not by itself prove quotation, allusion, or identical meaning.
- Token mismatch does not automatically prove omission, addition, alternate Vorlage, harmonization, or another text-critical conclusion.
- Any generated alignment candidate must remain distinguishable from source-provided or manually reviewed alignment evidence.

## Current candidate inventory

The public GitHub candidates below were re-verified through the repository connector on 2026-09-08. The local #97 proof must still verify downloaded bytes/hashes, parsing behavior, join coverage, mapping quality, and fitness before changing any production disposition to approved.

| Role | Candidate | Connector-verified revision | Verified repository terms/state | Current disposition |
|---|---|---:|---|---|
| Greek OT text proof | `nathans/lxx-swete` | `26bad3eb42bba98471d154c954e36a6f30a0279d` | README states Greek text/data annotations are CC BY-SA 4.0 and build code is MIT | **Selected for the Phase 0 proof**; production approval pending measurements/packaging decision |
| LXX lexical support | `openscriptures/GreekResources` | `dd5a2fd530ab3c6b748c174cec38966c356d8111` | README states repository-owned resources are CC BY 4.0 and explicitly excludes actual LXX text because of CCAT restrictions | Candidate for reproducible lemma/word-list joins only; compatibility with Swete must be measured |
| Lexicon/versification support | `STEPBible/STEPBible-Data` | `ea47bd4c7eab7375f2dca07086ccc356e95a4128` | README states CC BY 4.0 and allows inclusion/modification with attribution and recorded changes | TVTMS/TBESG are current proof candidates; TAGOT remains unavailable/“coming” |
| Hebrew↔Greek alignment | CATSS/Tov-style parallel data | restricted | Restrictive user agreement / noncommercial or permission constraints remain recorded | Not approved for repository/public redistribution |

## Connector-verified source evidence — 2026-09-08

### Swete Greek text

- Repository/default branch: `nathans/lxx-swete` / `master`.
- Current head: `26bad3eb42bba98471d154c954e36a6f30a0279d` (2025-12-18).
- README states the data derive from OpenGreekAndLatin First1KGreek `tlg0527` and that the 2025-12 update rebased to upstream commit `eb81494731fd632f582c4b94634127bdbd596b43`.
- README states Greek text and annotations under `data/` are CC BY-SA 4.0; build source code is MIT.
- `data/01.Genesis.txt` exists at blob `aa532fd04891476d56f9f3f0191e57c24770d658`, size 609,070 bytes.
- The file shape is word-per-line with repeated `chapter.verse` prefixes, e.g. `1.1.1 ΕΝ`, `1.1.1 ΑΡΧΗ`, followed by the remaining verse tokens.

This verifies the planned proof input and basic deterministic parser shape. It does not establish lemma, morphology, Hebrew alignment, or app versification compatibility.

### Open Scriptures GreekResources

- Repository/default branch: `openscriptures/GreekResources` / `master`.
- Current head: `dd5a2fd530ab3c6b748c174cec38966c356d8111` (2019-12-30).
- Top-level README explicitly says the actual Septuagint text is excluded because of the restrictive CCAT license.
- The same README licenses the repository's own resources under CC BY 4.0 with attribution to the Open Scriptures Septuagint Project.
- `LxxLemmas/readme.md` says the lemma files use OSIS references and per-verse arrays of word objects with `key` and `lemma` fields; the array index corresponds to source word order.

These files are therefore a plausible lexical-join candidate, not an independent redistributable LXX text or alignment authority. Their word numbering is designed around the historical `lxxmorph` structure, so exact compatibility with Swete must be measured rather than assumed.

### STEPBible data

- Repository/default branch: `STEPBible/STEPBible-Data` / `master`.
- Current head: `ea47bd4c7eab7375f2dca07086ccc356e95a4128` (2026-09-07).
- README states the repository is CC BY 4.0 and permits inclusion/modification with attribution and change recording.
- The current `Versification` directory contains exactly one TVTMS file:
  - `Versification/TVTMS - Translators Versification Traditions with Methodology for Standardisation for Eng+Heb+Lat+Grk+Others - STEPBible.org CC BY.txt`
  - blob `4fdcb4fd761ba8a680a3f0cc95ad65f591e18d4b`
  - size 5,790,928 bytes.
- The current `Lexicons` directory contains, among others:
  - `TBESG - Translators Brief lexicon of Extended Strongs for Greek - STEPBible.org CC BY.txt`
  - blob `efe271a1dbb73fa01f8fa6e0f164c6687757a9ae`
  - size 4,736,912 bytes.
- README still lists `TAGOT - Translators Amalgamated Greek OT` under **Datasets coming**, not available datasets.

TVTMS is therefore a concrete current versification proof candidate and TBESG is a concrete Greek lexical candidate. Neither proves an exact join to Swete; TAGOT must not be treated as available production data.

## Required local proof

Use an isolated worktree or checkout from the branch created for #97. Do not modify or overwrite the owner's unrelated active worktree.

The proof must be disposable unless a small piece of code is later shown to meet #83's maintained generator ownership rules.

### Fixture coverage

At minimum exercise:

1. Genesis 1;
2. one Psalm with numbering or superscription complexity;
3. one prophetic passage reused or cited in the New Testament.

Record the exact selected passages and why they exercise the required boundary.

### Source integrity

The GitHub repository heads, repository-side licenses, and key file/blob identities above have already been connector-verified. The local proof should not spend time rediscovering those facts unless the remote heads have moved.

Record for every source actually downloaded/used:

- repository/site and exact data role;
- pinned commit/version;
- exact file path(s);
- retrieval/acquisition date;
- local downloaded file/archive SHA-256 and correspondence to the pinned GitHub content;
- any additional file-specific terms not visible in the verified repository-level evidence;
- transformations applied;
- whether any output may be committed or redistributed.

### Greek text parsing

Report:

- source token count per fixture;
- malformed lines;
- duplicate source positions;
- missing or unmapped references;
- normalization collisions;
- punctuation/proper-name/enclitic behavior that affects stable identity;
- deterministic witness-qualified verse/token identity shape.

### Lemma and morphology joins

Do not infer joins from surface similarity alone.

For each candidate lexical source, report:

- join key used;
- exact matched/unmatched counts;
- ambiguous joins;
- normalization rules;
- provenance retained per joined record;
- whether morphology is actually available and compatible with the chosen Greek text;
- unresolved-token rate.

At minimum measure the Open Scriptures LxxLemmas compatibility with Swete and whether STEPBible TBESG contributes a reproducible lexical identity mapping. Do not treat Extended Strong's compatibility as token alignment proof.

### Versification

Use the pinned STEPBible TVTMS file as the first mapping candidate unless direct proof rejects it.

Report:

- canonical-app reference versus source reference;
- Psalm numbering/superscription behavior;
- split/merged or source-only units encountered;
- orphan/unmapped counts;
- exact mapping rules/records used from the pinned data.

Do not assume source references are identical to the app's canonical references.

### LXX↔NT Greek identity proof

For the selected fixtures, compare only defensible identity lanes:

- exact canonical lemma match;
- normalized alias, if explicitly documented;
- surface-form match kept separate from lemma identity;
- lexical relation kept separate from exact lemma identity.

Report matched examples and unresolved cases without converting shared vocabulary into quotation/allusion claims.

### Size/performance evidence

Record at least:

- raw source bytes used in the fixture;
- normalized JSON bytes;
- compressed bytes;
- estimated full-corpus equivalents using a documented method;
- parse/import time for the fixture;
- index or join cost if measured;
- memory observations if material and reproducible.

## Decision matrix

Complete each row from proof evidence before closing #97.

| Decision | Options | Selected | Evidence |
|---|---|---|---|
| Greek text | Swete candidate / other / reject | **Swete for Phase 0 proof** | Connector-verified head, license, upstream provenance statement, and parseable Genesis file |
| Lemma source | same-source / Open Scriptures / STEPBible / other / none | Pending | Measure Open Scriptures/STEPBible joins to Swete |
| Morphology source | same-source / STEPBible / other / none | Pending | Current candidates do not yet establish Swete-compatible LXX morphology |
| Versification source | STEPBible / source-native + project map / other | **STEPBible TVTMS for proof** | Exact current TVTMS file verified; mapping quality still pending |
| Hebrew↔Greek alignment | redistributable source / local-only adapter / deterministic candidate / manual limited / defer | Pending | Pending rights and feasibility decision |
| Packaging | core bundled / optional pack / desktop-only / user-supplied / hybrid | Pending | Pending share-alike boundary + size/performance evidence |
| #96 Phase 1 readiness | proceed / proceed with exclusions / blocked | Pending | Pending all above |

## Delivery and licensing decision

Pending.

Current evidence already establishes that a Swete-derived production pack cannot be silently treated as MIT application data: its Greek text/data are CC BY-SA 4.0. The final delivery decision must define the separately licensed derivative-data boundary and attribution/share-alike handling.

The final decision must explicitly state:

- what may be committed to this public repository;
- what may be redistributed in a potentially commercial product;
- what attribution/share-alike obligations apply;
- whether source-derived outputs must be separately licensed;
- whether any source must remain user-supplied/local-only;
- whether optional-pack separation is required;
- which data roles remain unavailable.

## Alignment authority decision

Pending.

Select exactly one first-delivery posture, or explicitly defer word-level alignment:

1. redistributable source-provided alignment;
2. user-supplied/local-only restricted adapter;
3. deterministic generated candidates with no scholarly-authority claim;
4. manually reviewed limited-book alignment;
5. defer word-level alignment and initially permit only verse comparison plus LXX↔NT lexical lookup.

The final record must state what claims #96 can and cannot make under the selected posture.

## Rejected or deferred candidates

Add candidates here only with exact evidence and reason. Do not remove rejected candidates silently; retain the decision history.

- CATSS/restricted alignment data: **not approved for repository/public redistribution under the current evidence**. Reassess only with a documented permission or delivery model that satisfies its terms.
- TAGOT: **not available in the current connector-verified STEPBible repository state**. Recheck only if the upstream repository changes.

## #96 handoff boundary

#96 Phase 1 may begin only after this record answers, with evidence:

- which Greek witness/source identity is used;
- what token/lemma/morphology fields are supportable;
- how source and app versification are mapped;
- which Hebrew↔Greek alignment evidence class is available;
- what packaging/licensing boundary applies;
- which claims remain unsupported.

Until then, no production LXX corpus or authoritative Hebrew↔Greek alignment should be added.

## Validation before #97 merge

If this branch commits only documentation or small maintained proof tooling, run the applicable focused checks plus the repository's current required validation. Record exact commands and results in the PR/issue evidence.

At minimum before merge:

```text
npm run verify
npm audit --audit-level=low
git diff --check
```

Also require the repository's exact-range secret scan and exact-head hosted required checks. Do not create a release or tag from #97.
