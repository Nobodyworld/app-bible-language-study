# UX Action Inventory

This inventory supports #126 / PR #127. It records when multiple controls are the **same semantic action** and therefore must share naming/help/presentation contracts, while still allowing scope-specific behavior.

## Canonical action matrix

| Action ID | Full label | Compact label | Known entry points | Scope differences | Current wiring status |
| --- | --- | --- | --- | --- | --- |
| `language-study` | Language Study | Language | Reader chapter toolbar; Verse context; selected text; chapter verse picker | Chapter opens the verse picker; Verse and selected text open exact verse Language Study. | Canonical identity, labels and tips wired, including the former Study/Inspect shortcuts. |
| `translations` | Translations | Translations | Verse context; Reader verse number | Exact verse comparison. The verse number is a content affordance with a Translations accessible name. | Canonical identity and tips wired. |
| `references` | References | References | Verse context; reference links within details are navigation, not this action | Opens verse cross-reference view. | Canonical contract + dynamic identity wired. |
| `commentary` | Commentary | Commentary | Verse context | Exact verse commentary. | Canonical contract + dynamic identity wired. |
| `definition` | Definition | Definition | Word context; Reader Strong fragments; Language Study Strong code | Opens/returns to the selected word definition. Text/code affordances keep their content and identify Definition in their accessible name. | Canonical identity/tip wired. |
| `study-marks` | Study Marks | Study Marks | Reader toolbar; Home; My Data saved-count link; Book/Chapter, Word/Verse, text/token triggers and interactive badges | Same mark system; target changes by Book/Chapter/Verse/Text/Source token. Icons, counts and Book/Chapter captions describe the target, with a Study Marks accessible name. | Shared target constructor owns identity, scope and canonical tip; rendered audit passes. |
| `interpretation` | Interpretation | Interpretation | Word context; Language Study token control/saved badge; Reader exact-token marker | Same token_renderings record. Reader activation opens preview; Study activation opens the existing editor. | One Reader marker after the token's final fragment; the saved Study trigger adopts the same marker identity without a duplicate action. |
| `saved-annotations` | Saved annotations | Saved annotations | Reader verse; beside Verse Study Marks | Derived `Saved in BSB · 2` caption describes other-translation records; hover/focus previews, click/tap opens a list. | Canonical identity and tip; counts use exact records, never DOM fragments. |
| `open-annotation-source` | Open saved source | Open saved source | Discovery list | `Open in BSB` names the captured original translation/reference. | Explicit navigation only; unavailable passages disable the action. |
| `outline` | Outline | Outline | Reader chapter toolbar | Book-scoped outline. | Canonical contract + static identity wired. |
| `search` | Search | Search | Reader toolbar; Home | Opens book search. | Canonical labels/tips/identity wired on both surfaces. |
| `my-data` | My Data | My Data | Reader toolbar; Home | Global saved-study/backup/recovery view. | Canonical labels/tips/identity wired on both surfaces. |
| `tags` | Tags | Tags | Target editor entry inside Study Marks surfaces | Edits tags for the current target. Distinct from opening Study Marks. | Canonical label and target-aware tip wired; exact Book/Chapter/Verse/Text/Source token scope retained. |

## Controls that are intentionally *not* the same action

Do not merge identities merely because controls look similar.

- **Study panel / Show study workspace / Hide study workspace** control workspace visibility, not a study destination.
- **Back / Forward** are Study history navigation.
- **Previous / Next chapter** are Reader navigation.
- **Book / Chapter selectors** are Reader location controls.
- **Hebrew/Greek Concordance** buttons scroll to language-specific subsections inside the active Strong's detail; they are not the same destination as Language Study.
- **Study Marks overview** and **Tags editor** share the same underlying mark/tag domain but are different semantic actions.
- **Speech attribution** is a user annotation operation, not a detail-view destination; it has its own annotation contract under #128.
- **Search form submit** executes the entered query; the `search` destination action opens the form. **Save/download/import backup** operate on files/data and are distinct from opening My Data.

## Canonical connection rules

1. Every repeated destination/function gets one action ID.
2. Static and dynamic controls expose `data-ui-action="<id>"` whenever they represent that action.
3. Visible labels, compact labels, quick tips, and feature ownership come from the canonical contract.
4. Scope is data, not a renamed action. Example: Chapter Language Study and Verse Language Study both remain `language-study` and carry their chapter/verse scope separately.
5. Presentation can compress for space, but compact wording is declared in the action contract rather than invented in a component.
6. Active/current state remains component-specific but must not change the action identity.
7. Disabled/unavailable copy may add context, but the action's primary label remains stable.
8. User annotation markers (Interpretation, speech attribution) use the same identity wherever the same persisted record is represented.

## Runtime audit and remaining owner review

The maintained `test:annotation-browser` journey enumerates visible semantic
controls in Reader, Word/Verse context, Language Study, selected text and Home.
The existing context/cleanup/Reader suites cover exact target editing, My Data,
empty data, loading/retry, disabled controls, history and profile isolation.
Empty-state explanatory panels contain no additional destination shortcuts.
The audit checks:

- same action ID => same canonical full label/tip and compatible visual treatment;
- action ID + scope => correct destination and exact target;
- no duplicate event handler produces a second navigation/history entry;
- keyboard activation matches pointer activation;
- active/disabled/hover/focus states remain recognizable in light/dark, touch, narrow, and zoomed layouts;
- Home/empty-state shortcuts, if present, are added to this inventory rather than creating new wording.

The draft iteration covers light/dark, compact/standard/expanded, narrow/touch,
real mouse/keyboard controls and viewport-sensitive reflow. Actual browser-menu
zoom and installed WebView restart remain separate rendered owner-review checks.
Native adapter and native file-storage tests are persistence evidence only.

Related: #126, #128, #129, PR #127.
