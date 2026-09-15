# Repository Agent Instructions

## Working model

Use one persistent branch for an owner-approved, coherent development scope.
Normal in-scope edits, focused tests, commits, and pushes do not need repeated
approval. Keep main as the accepted public baseline. Do not change repository
settings, merge, release, tag, publish, or expand scope without authorization.
GitHub connector work comes first; a local/browser-agent handoff contains only
remaining execution or rendered checks. Never claim source review as rendered QA.

## Workspace and concurrent agents

Before editing, inspect origin, branch, HEAD, upstream, status and
`git worktree list --porcelain`. Reuse the existing clean checkout and caches.
Preserve every uncommitted/unpushed change. If a branch advanced, inspect it;
do not reset to an old prompt SHA. At most one additional worktree is justified
by actual concurrency. No stash, reset --hard, force push, broad git clean,
shared-cache removal or forced worktree removal. Leave unknown ignored files alone.
A squash-merged branch need not be an ancestor of main; start the next scope from
accepted main without merging the completed branch merely to repair ancestry.
Only one writing agent per branch at a time. Other agents may run read-only
spot checks. A browser agent currently on main must safely switch to the working
branch before edits; it must not cherry-pick concurrent writers' work blindly.

## Current priority: UX consistency and persistent annotations (#126)

Accepted baseline: `b905bd40c50f8e68fb49bfd6e5af304b222b7969` after PR #125.
Working branch: `ui/ux-consistency-polish`; PR #127 remains draft and unmerged.
Issue #124 is completed. Do not resume its old branch or repeat owner acceptance
of My Data, Interpretation wording, or the accepted Study-pane cleanup.

Read `docs/UX_ACTION_INVENTORY.md` and `docs/UX_ANNOTATION_CONTRACT.md`.
The authorized slice includes repeated-action identity/presentation, concise tips,
private speech-attribution annotations (#128), and exact-token Interpretation
markers (#129). Preserve completed work rather than redesigning it.

The connector review of `9d71e25245796fdb357e25c312eec85d375ed1ac` found
translation/anchor isolation and interpretation collision gaps not covered by
its reported PASS results. Resolve these before owner acceptance or Ready:
new speech annotations must retain translation and selected-text identity;
read/apply/change/clear/merge must not act on another translation's range;
interpretation save/delete/merge must not overwrite another exact target merely
because the verse and numeric token index match. Preserve legacy/opaque records
without inventing their missing identity. Review the PR discussion for evidence.

Future features remain DEFERRED: #78, #89, #90, #91, #96 and #98-#102.
#81 desktop is a separate exception, not permission to broaden this UI PR.
Security fixes are not blocked. Preserve the merged importer/source rights;
Swete lemma, morphology and Hebrew-Greek word alignment remain unsupported.

## Product and data safety

Browser and Windows reuse shared study behavior. Preserve Reader route, scroll,
selection/history/lock, Study Marks, exact token renderings, recovery data,
nonempty historical records, Stable/Lab isolation and version-3 backup import.
Removing confusing UI is authorized; deleting saved records is not. Sparse
serialization may omit only known empty defaults; do not strip unknown fields,
nonempty histories, tag definitions, quarantine or recovery evidence. Full store
snapshots remain available to recovery code. Do not silently change an existing
managed-pack mode or delete installed bytes when hiding its management surface.
Keep native permissions narrow and use isolated E2E data roots, never real profiles.
Keep existing data rights/notices and current corpus authorities unchanged.

## CSS and naming standard

Edit the owning component stylesheet, not a new patch/override file. Reuse
`app/tools/stylesheet-ownership.mjs` for parsing and ownership checks. Consolidate
repeated selector blocks within the SAME conditional context and duplicate
properties; media/theme/state variants are not interchangeable. No new !important,
font-size:0 text hiding, or pseudo-element replacement of an action's actual label.
Use component-scoped compact geometry, shared tokens, visible focus and practical
touch targets. Never globally shrink every bookmark/button to fix one toolbar.
Keep action labels in DOM text and accessible names consistent with visible text.
Test duplicate visible labels within each rendered scope and duplicate DOM IDs;
repeated legitimate controls in different scopes are not an automatic error.
Run the hygiene check for every affected UI change and at cleanup checkpoints.
No scheduled hosted job is needed for periodic maintenance.

## Validation and handoff

Run focused checks while editing. Update stale wording/layout expectations when
behavior intentionally changes; retain unrelated safety checks. At final local
acceptance run the applicable aggregate once plus checks it does not include.
Keep draft iteration free of hosted CI churn; use one final Ready checkpoint.
Installer acceptance is for native/packaging/persistence relevance, not repeated
for every wording change. Native storage unit/adapter tests are not installed
WebView restart acceptance. Actual browser-menu zoom is not viewport emulation.
Do not weaken relevance/security gates or bypass blocked automation. Report
failures, skipped and unrun checks distinctly, including partial aggregate runs.
Return final SHA, changed behavior, exact test results, remaining blockers and
remote/worktree state. Keep handoffs short and include repo, branch and SHA.
