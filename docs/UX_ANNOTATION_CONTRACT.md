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

### Persistent record

The normalized user record should contain:

```json
{
  "classification": "red",
  "start": 0,
  "end": 12,
  "text": "selected text",
  "source": "user",
  "revision": 1,
  "updated_at": "ISO-8601 timestamp"
}
```

The containing workspace key already supplies the exact translation/reference identity. If a future migration moves these records to explicit semantic targets, old v3 records remain readable.

### Legacy red-letter compatibility

Existing `workspace.red_letter_ranges` records are valid historical user data. On read, a record with no classification is treated as `red`. Migration must be non-destructive:

- old ranges remain importable;
- old exact range/text values are preserved;
- merge does not duplicate the same exact range/classification;
- reclassification updates the exact user range rather than layering contradictory duplicates;
- clearing a classification removes only that user annotation;
- bundled/source-provided red-letter presentation remains separate.

The compatibility `addRedLetterRange()` API may remain temporarily as a wrapper for applying `classification: "red"` while newer code uses the generalized attribution API.

### Range overlap

Rendering must segment on all relevant boundaries, but persistence should stay simple:

- identical `start/end` => one user record, newest classification wins;
- contained/overlapping different ranges may coexist;
- the renderer chooses the most specific active range for a segment; if specificity ties, the most recently updated record wins;
- a user must be able to clear the exact selected range without deleting neighboring annotations.

This rule prevents text corruption while allowing nuanced user decisions.

### Reader presentation

Use CSS classes/data attributes such as:

- `speech-attribution speech-attribution-red`
- `speech-attribution speech-attribution-pink`
- `speech-attribution speech-attribution-gray`
- `speech-attribution speech-attribution-black`
- `data-speech-attribution="red|pink|gray|black"`

Every annotated fragment exposes an accessible label/tooltip identifying it as a **user** attribution annotation. `black` must remain visibly identifiable even where ordinary Reader text is already dark; use a subtle underline/background/marker rather than color alone.

Selection UI should offer the four states plus Clear. A compact three-state workflow remains possible simply by not using `black`.

## Interpretation marker

### Source of truth

`workspace.token_renderings` remains the only persistence authority. Do not create a parallel Study Mark/tag assertion solely to remember that an interpretation exists.

A marker exists exactly when the canonical source-token target has a normalized rendering record.

### Marker content

The compact visible marker uses the canonical `interpretation` UI action identity. Its hover/focus preview contains:

- `Interpretation` heading/label;
- saved alternative wording (`record.rendering`);
- original/source wording (`record.original` or canonical token original);
- Strong's code when present;
- copy making clear this is the user's saved alternative wording.

The marker itself should not replace the Reader word with the saved rendering.

### Placement and deduplication

A source token may be split into multiple DOM fragments by range boundaries. Render **one** marker for the exact token, preferably after the fragment that ends at the token's canonical end boundary. Never render one marker per fragment.

The same principle applies inside Language Study: the existing saved-rendering badge can adopt the shared Interpretation marker presentation, but both surfaces derive from the same record.

### Interaction

- Hover and keyboard focus show a viewport-safe preview.
- Touch gets an explicit activation/focus fallback rather than hover-only information.
- If the exact token can safely reopen the existing Interpretation editor, activation may do so.
- Updating/removing the saved rendering updates/removes every derived marker immediately.
- Marker interaction must not disturb Reader route/scroll or unintentionally unlock a locked Study view.

## Shared action identity and quick tips

Persistent annotation controls also participate in the canonical action system from `app/src/ui-contracts.js`:

- `data-ui-action` identifies semantic actions rather than DOM-specific buttons.
- full and compact labels come from one contract;
- quick tips come from one contract;
- dynamic and static entry points should share presentation classes/tokens where practical;
- context-specific labels are allowed only when they intentionally describe different scope.

## Validation matrix

Before PR #127 becomes Ready, focused validation must cover:

- legacy red-letter migration;
- all speech-attribution states, update, clear, overlap, reload;
- v3 backup/export/merge/replace/recovery;
- browser and native persistence/isolation;
- Interpretation marker create/update/delete and exact-token deduplication;
- hover/focus/touch preview behavior;
- dynamic/static action identity drift checks;
- light/dark and compact/standard/expanded/narrow layouts;
- actual zoom-sensitive layouts;
- CSS ownership/hygiene;
- no Reader route/scroll/Study-lock regression.

Related: #126, #128, #129, PR #127.
