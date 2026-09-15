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

## Current priority: existing-feature cleanup (#124)

Accepted baseline: `4dd494c8c44c3d9a494bba7ec98bee5d5cd89aac` after PR #123.
Working branch: `ui/current-feature-cleanup`.
Deliver one combined PR and one eventual owner-authorized squash merge. A single
draft PR is allowed for the owner's live visual iteration; do not mark it ready
until current-feature scope and applicable acceptance are complete.

Read `docs/CURRENT_FEATURE_CLEANUP.md` for the exact scope, wording and checks.
Simplify My Data, remove experimental pack noise from Stable, compact Study
controls, rename Meaning presentation to Word interpretation, and trim empty
retired metadata from portable backups without discarding anyone's study data.
Keep the existing Meaning storage/behavior; this is not a new interpretation engine.

Future features are DEFERRED until this cleanup is accepted: #78, #89, #90, #91,
#96, #98, #99, #100, #101 and #102. #81 desktop is a separate exception, not part
of this cleanup PR. Security fixes are not blocked by the feature freeze.
Do not resume Swete mapping/pack/lexical/Search work from stale instructions.
Preserve the merged importer and source/rights boundaries; Swete token lemma,
morphology and Hebrew-Greek word alignment remain unsupported.

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
for every wording change. Do not weaken relevance/security gates or bypass blocked
automation. Report actual failures, skipped and unrun checks distinctly.
Return final SHA, changed behavior, exact test results, remaining blockers and
remote/worktree state. Keep handoffs short and include repo, branch and SHA.
