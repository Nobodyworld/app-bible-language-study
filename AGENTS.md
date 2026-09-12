# Repository Agent Instructions

## Working model

Use one persistent branch for an owner-approved, coherent development scope.
Normal in-scope edits, focused tests, commits, and pushes to that branch do not
need repeated approval. Do not open an early or empty PR; request review once
the scope is implemented and its applicable validation is complete. Keep `main`
as the accepted public baseline. Do not change repository settings, merge,
release, tag, publish, or expand product scope without the relevant authorization.

## Workspace

Before editing, check the repository remote, branch, HEAD, upstream, Git status,
and `git worktree list --porcelain`. Use the existing clean checkout, including
the primary checkout when suitable. Prefer reusing it and its build caches.
Use at most one additional worktree only when concurrency or existing work
actually requires isolation. Never overwrite another agent's or the owner's work.
If the expected branch has advanced, inspect the newer commits; do not reset it
back to a prompt's old SHA. Stop only for a real conflict or unresolved ownership.

Do not stash, use `reset --hard`, force-push, run broad `git clean`, remove shared
caches, or force-remove worktrees. Leave pre-existing worktrees and unexplained
ignored/untracked files alone. Remove a task-created workspace only after its
work is pushed, it is unused and clean, and its ignored contents are understood;
otherwise retain it and explain why. Routine completion does not require cleanup.

A prior slice may have been squash-merged: its old branch tip is not necessarily
an ancestor of the new main even when their file trees match. Do not merge or
rebase that completed branch into the next slice just to make local history
linear. Reuse the clean checkout and switch to the new branch from main. Preserve
any unpushed work and stop for an actual divergence instead of resetting it.

## Product and data safety

Keep browser and Windows desktop study behavior shared. Preserve personal Study
Marks, Meaning, recovery data, valid legacy records, and portable backup
compatibility. Scope-approved source removal is allowed; deleting someone's
stored study data is not. Keep data-source rights and provenance intact.
Keep native permissions narrow. Use the existing isolated debug/E2E data-root
mechanism for native QA, not the owner's real Stable or Lab profile.

## Validation

Run focused checks while editing. Update tests when the owner intentionally
changes behavior; do not preserve retired features just to satisfy stale tests,
and do not weaken unrelated safety or correctness checks. At the final checkpoint
run the applicable aggregate once, plus checks it does not include. Reuse installed
toolchains and caches. Installer acceptance is for packaging/persistence changes
or a final distribution checkpoint, not each UI edit. Do not revive temporary
owner-machine uninstall/firewall helpers or bypass blocked automation actions.
Report failures and unrun checks accurately; source review is not rendered QA.

## Current work: shared UI polish (#117–#121)

Work only on `ui/visual-polish-pass` and existing PR #117. Keep that PR OPEN,
DRAFT, and UNMERGED; retain its branch for further owner-directed UI polish.
No ready-for-review transition, auto-merge, merge, closure, or replacement PR is
authorized. Accepted main is `0148d6f989c1eafef489fb452a4a33a1a8c899ab`.

Complete in priority order: the Strong-token wrapping regression; #118 Study
header and #121 lexical-reference acceptance; #119 component stylesheet ownership;
then #120 active-translation scripture inside footnote side-panel entries.
Preserve the shared static/ES-module browser/Tauri frontend, personal study data,
source text, existing width preference, Reader anchoring and panel lock/history.
Keep Septuagint decisions in `docs/decisions/SEPTUAGINT_SOURCE_STACK.md`; do not
restart that research or expand into multilingual Search or unrelated redesign.

Use focused local tests during each component slice. Commit the final tree before
integrated Node 20/24, browser and isolated native acceptance. Keep runtime evidence
outside tracked source. Update only PR #117 and scoped issues #118–#121 with actual
results; #118 remains open while owner-rendered approval is outstanding.

## Completion report

Report starting/final SHAs and remote equality, phase and issue status, wrapping
root cause, stylesheet ownership measurements, footnote capabilities, exact local
and hosted results, evidence locations, native coverage and limitations, outstanding
owner review, and worktree/process status. Confirm PR #117 remains OPEN, DRAFT,
and UNMERGED and its branch is retained. Keep private paths and personal data out
of public GitHub evidence.
