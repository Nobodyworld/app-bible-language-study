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

The entries below preserve the latest repository-recorded findings. The local #97 proof must re-verify exact source revision, files, hashes, terms, and fitness before changing any disposition to approved.

| Role | Candidate | Repository-recorded revision | Recorded terms | Current disposition |
|---|---|---:|---|---|
| Greek OT text proof | `nathans/lxx-swete` | `26bad3eb42bba98471d154c954e36a6f30a0279d` | Greek text/data annotations recorded as CC BY-SA 4.0; build code MIT | Preferred proof candidate; production approval pending |
| LXX lexical support | `openscriptures/GreekResources` | `dd5a2fd530ab3c6b748c174cec38966c356d8111` | Repository-owned resources recorded as CC BY 4.0; actual LXX text explicitly excluded | Candidate for reproducible lemma/word-list joins only |
| Lexicon/versification support | `STEPBible/STEPBible-Data` | `ea47bd4c7eab7375f2dca07086ccc356e95a4128` | Recorded as CC BY 4.0 | Candidate where exact current files/fields prove fit; TAGOT not assumed available |
| Hebrew↔Greek alignment | CATSS/Tov-style parallel data | restricted | Restrictive user agreement / noncommercial or permission constraints recorded | Not approved for repository/public redistribution |

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

Record for every source actually used:

- repository/site and exact data role;
- pinned commit/version;
- exact file path(s);
- retrieval/acquisition date;
- source archive/file hash where practical;
- relevant license/terms evidence;
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

### Versification

Report:

- canonical-app reference versus source reference;
- Psalm numbering/superscription behavior;
- split/merged or source-only units encountered;
- orphan/unmapped counts;
- exact data source and revision supporting the mapping.

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
| Greek text | Swete candidate / other / reject | Pending | Pending local proof |
| Lemma source | same-source / Open Scriptures / STEPBible / other / none | Pending | Pending join measurements |
| Morphology source | same-source / STEPBible / other / none | Pending | Pending coverage measurements |
| Versification source | STEPBible / source-native + project map / other | Pending | Pending mapping proof |
| Hebrew↔Greek alignment | redistributable source / local-only adapter / deterministic candidate / manual limited / defer | Pending | Pending rights and feasibility decision |
| Packaging | core bundled / optional pack / desktop-only / user-supplied / hybrid | Pending | Pending rights + size/performance evidence |
| #96 Phase 1 readiness | proceed / proceed with exclusions / blocked | Pending | Pending all above |

## Delivery and licensing decision

Pending.

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
- TAGOT: **do not assume available**. Recheck exact current STEPBible files before any production dependency is proposed.

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
