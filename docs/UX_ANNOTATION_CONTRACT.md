# UX Annotation Contract

This document defines the current UX/persistence contract for user-created reader annotations in the `#126` / PR `#127` line of work.

## Principles

1. **User annotation is not source text.** A visual annotation can change how the Reader presents a range or token, but it never rewrites bundled Scripture, source-language data, or lexicon data.
2. **One durable source of truth.** Persistent UI markers are derived from the existing canonical user record whenever possible. Do not create duplicate persistence solely to drive a badge.
3. **Exact identity beats visible text.** Character ranges and canonical source-token targets identify annotations. Matching an English word by spelling alone is insufficient.
4. **Color is supplemental.** Every state has a non-color label/accessible description so light/dark themes and color-vision differences do not erase meaning.
5. **Private by default.** These records are local user choices and are not claims by the app about historical authorship, inspiration, or translation authority.
6. **Backups are part of the feature.** A feature is not complete until reload/native restart plus v3 export, merge, replace, and recovery retain it.

## Speech attribution

### Scholarly inspiration, not imported conclusions

The likely model behind the requested multi-color red-letter workflow is the Jesus Seminar's red/pink/gray/black scale for evaluating sayings attributed to Jesus. The app may borrow that graded-confidence interaction pattern, but it does **not** import the Seminar's verse-by-verse judgments and must not describe the colors as scholarly consensus.

The user applies a classification at their own discretion.

### Stable classification IDs

| ID | Default label | Meaning in this app |
| --- | --- | --- |
| `red` | Attributed | User considers the selected wording confidently attributable to the intended speaker. |
| `pink` | Possibly attributed | User considers the attribution plausible but uncertain. |
| `gray` | Unlikely attributed | User considers the attribution doubtful. |
| `black` | Not attributed | User considers the wording not attributable to that speaker. |

Visible color values are theme tokens and may be adjusted for contrast. The semantic IDs above must remain stable.

### Persistent record and identity

New user records must retain translation, reference, selected text and offsets,
as well as classification, source, revision and timestamp. For example:

```json
{
  "translation_id": "bsb",
  "reference_key": "john:1:1",
  "classification": "red",
  "start": 0,
  "end": 16,
  "text": "In the beginning",
  "source": "user",
  "revision": 1,
  "updated_at": "ISO-8601 timestamp"
}
```

The workspace reference key alone does not identify a translation. Read, apply,
change, clear, exact-range merge and overlap resolution must use the same full
identity. A BSB annotation cannot color or replace a KJV annotation merely
because the reference and offsets match. Verify the saved text against the
current text at its anchor before rendering. Mismatched/out-of-bounds anchors
remain preserved records, not permission to color unrelated words.

Legacy ranges without translation identity remain readable as historical backup
data. Do not invent a translation on load or silently bind the same record to
whichever translation happens to be open. A legacy record without a safely
established anchor must remain recoverable and unclassified by translation until
an explicit user action establishes that identity. Preserve original fields.

### Legacy red-letter compatibility

Existing `workspace.red_letter_ranges` records are valid historical user data.
A record with **no classification property** is legacy red. An explicit unknown
classification is opaque data, never silently converted into red. Invalid,
negative, fractional or unsafe offsets do not participate in rendering. Unknown
records and fields must survive backup normalization without reinterpretation.

- old ranges remain importable;
- old exact range/text values are preserved;
- merge does not duplicate the same exact identity;
- reclassification updates only the exact user range in its translation;
- clearing removes only that user annotation, not a neighboring or foreign range;
- bundled/source-provided red-letter presentation remains separate.

The compatibility `addRedLetterRange()` API may remain as a wrapper for applying
`classification: "red"` while newer code uses the generalized attribution API.

The generalized store APIs are `getSpeechAttributionRanges()`,
`applySpeechAttributionRange()`, `changeSpeechAttributionRange()` and
`clearSpeechAttribution()`. When an exact imported range ends inside a word,
selecting it permits changing or clearing that range without expanding it into
a neighboring annotation.

### Range overlap

Rendering must segment on all relevant boundaries, but persistence should stay simple:

- identical translation/reference/start/end/text snapshot => one user record, newest classification wins;
- different translations never collide or participate in one another's overlap resolution;
- contained/overlapping different ranges within one translation may coexist;
- the renderer chooses the most specific anchored range; equal specificity uses the most recent update;
- clearing an exact selected range does not delete neighboring annotations.

### Reader presentation

Use CSS classes/data attributes such as:

- `speech-attribution speech-attribution-red`
- `speech-attribution speech-attribution-pink`
- `speech-attribution speech-attribution-gray`
- `speech-attribution speech-attribution-black`
- `data-speech-attribution="red|pink|gray|black"`

Every annotated fragment exposes an accessible label/tooltip identifying it as a
**user** attribution annotation. `black` remains identifiable on ordinary dark
text through a non-color affordance. Selection offers four states plus Clear.

## Interpretation marker

### Source of truth and identity

`workspace.token_renderings` remains the only persistence authority. Do not
create a parallel Study Mark/tag assertion solely to remember an interpretation.

The canonical target includes translation. Verse plus numeric token index is not
a complete identity: saving a second translation must not overwrite the first;
get/update/delete and merge must address the exact same target. Apply equivalent
source-identity guards to writes and deletes, not just reads. Any representation
change within this workspace store must preserve v3 imports and populated data.

### Marker content

The compact visible marker uses the canonical `interpretation` UI action identity.
Its hover/focus preview contains:

- the Interpretation label;
- saved alternative wording (`record.rendering`);
- original/source wording (`record.original` or canonical token original);
- Strong's code when present;
- copy making clear this is the user's saved alternative wording.

The marker does not replace Reader Scripture with the saved rendering.

### Placement and interaction

Render one marker for each exact token within each reading/study surface, not one
per fragment created by range boundaries. Prefer the canonical token end.
Language Study derives its marker from the same saved record.

Hover and keyboard focus show a viewport-safe preview. Touch has an explicit
activation/focus path. Safe editor activation retains exact target and focus.
Updating/removing a record updates all its markers without disturbing Reader
route/scroll or unintentionally unlocking Study.

## Shared action identity and quick tips

Persistent annotation controls participate in `app/src/ui-contracts.js`:

- `data-ui-action` identifies semantic actions, not DOM-specific buttons;
- full/compact labels and quick tips have one owner;
- static and dynamic entries share presentation where practical;
- scope-specific wording is deliberate, not a duplicate action registry.

## Translation identity decision and cross-translation discovery

Owner clarification on 2026-09-15, before the preceding Codex handoff was sent:
use the existing translation ID to isolate these records, while allowing the
reader to discover saved work from another translation. The implementation below
integrates that identity into the existing workspace stores.

### Reuse existing identity; do not add a new ID system

`semantic-targets.js` already includes normalized `translation_id` and
`edition_id` in targets, and includes the translation in canonical `target_id`.
Reuse those IDs (for example `bsb` and `kjv`), not display labels or a second
translation registry. The current app-level identity is sufficient for this
slice; a future source/edition revision still needs anchor-drift checks.

The logical keys are:

- Interpretation: translation + reference + exact source-token target.
- Speech attribution: translation + reference + exact character range, with
  saved selected-text verification before rendering or changing the range.

Translation ID is one part of the key, not a key for the entire translation.
Merely storing a `translation_id` property is insufficient: physical storage
must permit two translations at the same verse/index or offsets to coexist.
Use full canonical target IDs where applicable, or an equivalent composite key
inside the existing workspace fields. Route read/save/update/delete, overlap,
merge/replace, backup/recovery and raw collection consumers through that same
identity. Capture the identity when the user opens/selects a target; a later
translation switch or asynchronous completion must not retarget the write.

Preserve populated legacy input before normalizing it. Use translation metadata
actually present in a saved record/target; never use the open translation or a
BSB fallback to guess a historical record's missing identity. Unscoped records
remain recoverable as "Translation not recorded" until explicitly associated.
Backward import of v3 backups is required. Do not promise that an older build
can read a new storage representation losslessly; test and document the boundary.

### Discovery is not applying an annotation to another translation

Use a small derived indicator beside the existing verse Study Marks affordance,
not a new global toolbar. Proposed visible copy for rendered review:
`Saved in BSB · 2`. Its accessible description explains that two annotations
exist for this passage in BSB. For several translations, use one grouped control
with a clear label such as `Saved in 2 other translations`.

An expanded preview/list identifies the originating translation, saved passage,
annotation type, speech classification or alternative wording, and the original
stored quotation/source wording when available. Do not invent an English
quotation for an old interpretation record that only retains source-language
wording. Use the same label/action/presentation consistently at every entry.
Hover/focus may preview; click/tap opens the list. An explicit `Open in BSB`
action navigates to the original translation and exact saved context, with a
return path; the preview itself must not navigate, unlock Study or change data.

Derive presence and counts from canonical saved records. A rebuildable in-memory
index is allowed; a second persisted Study Mark/tag/assertion is not. Creating,
updating, deleting, importing and restoring records must update the indicator.
Count each canonical record once, not each rendered fragment. Current-translation
markers remain distinct from this other-translation discovery control. Reuse
Study Marks styling/placement, not its manual-tag semantics or storage.

Group by the app's established passage/reference correspondence. Do not assume
identical word numbers, English spellings, or raw verse numbers in editions with
different numbering establish equivalence. Where correspondence is unavailable,
show the saved reference without claiming an alignment or attaching a word mark.
Never transfer colors/interpretations into the open translation automatically.
Missing/corrupt/stale original targets must remain discoverable with honest
availability messaging and no guessed destination or annotation application.

### Required focused cases

Prove independent BSB/KJV annotations at identical numeric token indices and
character offsets through save/change/delete, reload, merge, replace and recovery.
Verify cross-translation discovery is read-only, profile-isolated, deduplicated,
updates after deletion/import, and vanishes when no other-translation records
remain. Cover unscoped legacy records, mismatched text snapshots, missing source
translation, and a translation switch while a save/preview is pending. Retain
all existing action consistency, CSS, keyboard/touch and zoom acceptance.

## Validation and current checkpoint

The connector review of `9d71e25245796fdb357e25c312eec85d375ed1ac` exposed
translation/anchor and cross-target collision gaps. The integration now uses
`annotation-records.js` for normalization, exact collection merge, lookup and
derived discovery. Interpretation buckets use canonical target IDs. Unidentified
or conflicting entries stay under `@preserved:` keys without translation guesses;
opaque collection shapes are retained or reject conflicting merges atomically.
Repeated imports deduplicate preserved JSON values. Unknown nested fields survive
updates and merges. New v3 exports retain this representation; lossless reading
by older builds that only understand numeric token keys is not promised.

Discovery reuses the bundled Translations view's catalog reference coordinates.
Uncatalogued translations or explicitly different versification schemes do not
attach to the open passage. Help and recovery in My Data lists preserved records
whose identity or correspondence cannot be established. The discovery dialog
checks the original passage and exact source token, retaining stored previews
with explicit unavailable/stale status. It never infers word alignment.

The maintained identity regressions cover independent BSB/KJV targets and offsets,
foreign operations, raw missing/conflicting metadata, anchor drift, nested unknown
fields, idempotent opaque imports, rejected-import atomicity, reload and recovery.
The browser journey covers pending saves across translation switches, derived
counts after import/deletion, deliberate navigation, stale/unavailable originals,
marker deduplication and mouse/keyboard/touch previews in four layout profiles.
Native storage tests reopen isolated on-disk records containing both translations,
all four speech states and unidentified historical data, with Stable/Lab isolation.

The PR records exact-candidate focused, aggregate and security results. Native
unit/adapter restart is not an installed WebView restart. Before Ready, complete
the separate installed WebView and actual browser-menu zoom acceptance using an
isolated candidate or the existing final hosted desktop lifecycle. Do not touch
an owner's live profile or repeat installer runs during draft iteration.

Keep repeated-action naming, CSS hygiene, profile isolation, backups, marker
create/update/delete, light/dark, keyboard/touch, and Reader lock/history coverage.
Update desktop and public-capture expectations with the actual compact marker;
do not restore old product UI merely to satisfy stale tests.

Related: #126, #128, #129, PR #127.
