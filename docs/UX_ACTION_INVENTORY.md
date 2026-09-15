# UX Action Inventory

This inventory supports #126 / PR #127. It records when multiple controls are the **same semantic action** and therefore must share naming/help/presentation contracts, while still allowing scope-specific behavior.

## Canonical action matrix

| Action ID | Full label | Compact label | Known entry points | Scope differences | Current wiring status |
| --- | --- | --- | --- | --- | --- |
| `language-study` | Language Study | Language | Reader chapter toolbar; Verse context button | Reader opens chapter Language Study; Verse opens exact verse Language Study. Same destination family, different scope. | Canonical contract + static/dynamic `data-ui-action` wired. |
| `translations` | Translations | Translations | Verse context | Exact verse comparison. | Canonical contract + dynamic identity wired. |
| `references` | References | References | Verse context; reference links within details are navigation, not this action | Opens verse cross-reference view. | Canonical contract + dynamic identity wired. |
| `commentary` | Commentary | Commentary | Verse context | Exact verse commentary. | Canonical contract + dynamic identity wired. |
| `definition` | Definition | Definition | Word context | Opens/returns to Strong's word definition for selected token. | Canonical contract + dynamic identity wired. |
| `study-marks` | Study Marks | Study Marks | Reader toolbar; Book/Chapter mark triggers; Word/Verse contextual triggers; token/target surfaces | Same mark system, target changes by Book/Chapter/Verse/Text/Source token. | Reader + contextual identity hook wired; remaining target triggers need runtime audit. |
| `interpretation` | Interpretation | Interpretation | Word context; Language Study token controls; future Reader exact-token marker | Same exact source-token rendering record. | Canonical contract + Word-context identity wired; persistent marker tracked in #129. |
| `outline` | Outline | Outline | Reader chapter toolbar | Book-scoped outline. | Canonical contract + static identity wired. |
| `search` | Search | Search | Reader toolbar; any future Home/Search shortcut must resolve here | Current Reader action searches the current book. | Canonical contract + static identity wired. |
| `my-data` | My Data | My Data | Reader toolbar; any future Home/backup shortcut must resolve here | Global saved-study/backup/recovery view. | Canonical contract + static identity wired. |
| `tags` | Tags | Tags | Tag-management actions inside Study Marks surfaces | Edits tags for the current target. Distinct from opening the Study Marks overview. | Canonical contract defined; target-editor entry points need runtime audit. |

## Controls that are intentionally *not* the same action

Do not merge identities merely because controls look similar.

- **Study panel / Show study workspace / Hide study workspace** control workspace visibility, not a study destination.
- **Back / Forward** are Study history navigation.
- **Previous / Next chapter** are Reader navigation.
- **Book / Chapter selectors** are Reader location controls.
- **Hebrew/Greek Concordance** buttons scroll to language-specific subsections inside the active Strong's detail; they are not the same destination as Language Study.
- **Study Marks overview** and **Tags editor** share the same underlying mark/tag domain but are different semantic actions.
- **Speech attribution** is a user annotation operation, not a detail-view destination; it has its own annotation contract under #128.

## Canonical connection rules

1. Every repeated destination/function gets one action ID.
2. Static and dynamic controls expose `data-ui-action="<id>"` whenever they represent that action.
3. Visible labels, compact labels, quick tips, and feature ownership come from the canonical contract.
4. Scope is data, not a renamed action. Example: Chapter Language Study and Verse Language Study both remain `language-study` and carry their chapter/verse scope separately.
5. Presentation can compress for space, but compact wording is declared in the action contract rather than invented in a component.
6. Active/current state remains component-specific but must not change the action identity.
7. Disabled/unavailable copy may add context, but the action's primary label remains stable.
8. User annotation markers (Interpretation, speech attribution) use the same identity wherever the same persisted record is represented.

## Next runtime audit

The local/rendered pass should enumerate all elements matching these domains and verify:

- same action ID => same canonical full label/tip and compatible visual treatment;
- action ID + scope => correct destination and exact target;
- no duplicate event handler produces a second navigation/history entry;
- keyboard activation matches pointer activation;
- active/disabled/hover/focus states remain recognizable in light/dark, touch, narrow, and zoomed layouts;
- Home/empty-state shortcuts, if present, are added to this inventory rather than creating new wording.

Related: #126, #128, #129, PR #127.
