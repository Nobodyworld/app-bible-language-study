# Current-feature cleanup — #124

## Scope and order

One branch (`ui/current-feature-cleanup`), one PR, one final integration checkpoint.
Baseline: `4dd494c8c44c3d9a494bba7ec98bee5d5cd89aac`.
Do not start new study capabilities while the existing surfaces are confusing.

1. **My Data:** show saved Study Marks, Word interpretations and relevant custom
   labels; retain backup/restore and concise recovery help. No default catalog URL,
   installation plan, orphan-cache count, runtime-source vocabulary or operation
   history. Remove the App settings paragraph that contains no setting.
2. **Physical packs:** experimental manager remains in isolated Lab. Stable users
   already using managed copies must retain an explicit non-destructive recovery
   path. Hiding controls must not switch modes, purge caches or imply installed
   bytes are included in a personal backup.
3. **Study navigation:** Word scope opens Definition, Concordance and Interpretation;
   Verse scope exposes Translations, References, Commentary and Language. Keep
   bookmark controls with scoped accessible names. Use real DOM labels, compact
   consistent buttons, small scope captions and bounded wrapping. Preserve history,
   exact selection, async section state and current-action behavior.
4. **Interpretation copy:** action `Interpretation`, title `Word interpretation`,
   custom entry `Alternative wording`. Explain that translation/lexicon wording
   is source material while saved wording is a study aid, not a Bible-text edit.
   Label and separate suggestion choices; never concatenate translation, gloss
   and dictionary prose into an unreadable row. Keep existing storage and actions.
5. **Backups:** ordinary download/copy may omit empty legacy job arrays, null
   on-apply-job hooks, empty retired polls and an entirely default package store.
   Preserve active tag definitions, populated histories, unknown data, marks,
   renderings, drafts and recovery/quarantine records. Keep kind/version 3.
   This is serialization, not a destructive store migration or a new backup format.
6. **CSS and naming:** consolidate touched rules in their existing owner, with
   conditional variants kept explicit. Enforce no same-context duplicate selector
   blocks or properties in the cleaned context stylesheet. Retain the existing
   cross-file structural ownership gate. Visible labels must be unique per scope,
   meaningful without tooltips and consistent with accessible names.

## Focused checks

```sh
node tests/portable-backup-format.mjs
node tests/portable-backup-roundtrip.mjs
node tests/current-feature-cleanup.mjs
npm run ui:hygiene
npm run test:cleanup
node tests/stylesheet-ownership.mjs
node tests/panel-context-model.mjs
node tests/word-meaning.mjs
node app/scripts/word-meaning-focus-test.mjs
node app/scripts/panel-context-interaction-test.mjs
node app/scripts/physical-pack-interaction-test.mjs
```

Update existing tests/docs for owner-approved wording/layout changes, not for
retired assertions. Wire the new tests into the maintained static suite before
Ready. `test:cleanup` is part of the browser aggregate and checks four isolated
light/dark, Compact/Standard, narrow and touch profiles plus non-destructive
Stable recovery and Lab isolation. Set `CLEANUP_SCREENSHOT_DIR` to an external
evidence directory to retain its focused captures. It checks viewport reflow;
actual browser zoom remains a separate rendered gate.

The hygiene scanner also supports explicit file checks and an all-sheet
report; agent maintenance should reuse it rather than invent another linter.

Required browser evidence: Stable My Data; fresh and populated data; valid
legacy/sparse import in merge and replace modes; malformed-import atomicity;
existing managed-mode recovery; Lab isolation; Hebrew and Greek word selection;
no duplicate labels/IDs; Interpretation suggestions, custom save/cancel/remove,
keyboard focus through delayed loading; Compact and Standard workspace; narrow
and touch layouts; actual 175% and 200% zoom; no clipped labels or page overflow.
Use existing isolated test profiles. Never ask the owner to replace their real
study data just to test a backup. Existing high-zoom/G227/footnote/wrapping
acceptance remains baseline evidence, not a request to reopen unrelated work.

After focused acceptance, run `npm run verify` once on final local source,
`npm audit --audit-level=low`, `git diff --check` and exact-range Gitleaks. Update
README, UI/data documentation, test inventory and affected capture assertions in
this same PR. Review screenshots where visible product claims changed. Only then
request Ready/hosted integration and owner acceptance. Do not call the draft a
PASS merely because it compiles. No merge/tag/release is implied.

## Remaining Study-pane acceptance on PR #125

My Data and Interpretation are owner-accepted. Further rendered acceptance is
limited to the Study header/history, context height, open-pane zoom reflow,
Language lock persistence, English phrase emphasis and sticky verse handoff.
`npm run test:study-followup` is in the browser aggregate. It checks both Language
entry points, passive interactions, Clear/history/navigation, short viewports and
desktop/drawer transitions without reload or manual reopening. Existing contained
tool tests also click the relocated header history control through the real UI.
Viewport regression evidence does not establish genuine Edge 175% to 200% zoom.

## Deferred future work

Future feature: #96 remaining Septuagint work; #78 multilingual Search; #89 context;
#90 citations/proof; #91 catalog; #98 traditions; #99 manuscript evidence;
#100 prophecy; #101 reception; #102 authorship. Preserve their existing work,
recording this freeze centrally rather than editing every issue.
#81 desktop remains a separate exception. Security/dependency maintenance stays
separate and must not inflate this UI PR.
