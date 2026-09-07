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

## Current approved scope: Local Jobs retirement (#105)

This is implementation work, not another review-only pass or a move into Lab.
Remove the console and job actions/counts from both profiles, stop all automatic
job production, and remove processors/mutators with no remaining live consumer.
Remove the misleading job-backed index-refresh action; preserve and test the
direct Study Mark index derivation already used by saving and normalization.
Keep passive compatibility for valid legacy job histories/results in version-3
backups without executing them. Preserve Inquiry marks/notes, Meaning, personal
study stores, and reference data. Update affected tests, metadata/generators,
inventory and docs rather than restoring retired behavior to satisfy old tests.
Native packs (#81), package migration, poll retirement (#82), other feature
removal, and framework changes are separate work. The first retirement slice
uses `cleanup/desktop-feature-scope`; the detailed acceptance record is #105.
Older review-only or native-pack handoffs do not define this implementation.

## Completion report

Give the working path/branch, starting and final pushed SHAs, remote equality,
actual behavior changes, tests run/results, remaining blockers, and workspace
status. Include extra workspace inventories only if a workspace was created or
removed, or unexpected local work requires explanation. Keep the report concise.
