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

## Current work: interpretation-poll retirement (#82)

The Local Jobs retirement under #105 is complete in merged PR #106. Do not redo
that implementation. This separate slice uses `cleanup/poll-compatibility` and
finishes the existing #82 compatibility-only boundary, not a new claims system.

Remove unused poll-response creation/edit/deletion paths, poll diagnostic UI and
advertising, and the three draft polling seeds from ordinary packaged/runtime
authority. Retain only the passive readers, normalization, validation and derived
compatibility data needed for existing backups. Keep storage keys, native store
IDs and `bibleapp:user-data` version 3 unchanged. Never clear an existing poll
store, rewrite a historical opinion, or require a retired seed catalog to import
a valid old response. Preserve valid responses, tombstones, targets, versions,
actors, timestamps, events and supported extension fields; avoid incidental
history truncation. Keep current conflict and malformed-import/recovery policies.

Move legacy seed metadata into test-only fixtures when needed to prove old backup
compatibility. Reconcile semantic/package manifests, maintained generators,
inventories, feature/UI contracts, documentation and tests as one implementation.
A schema or aggregate calculator with a real compatibility consumer is not dead
code. Do not remove canonical semantic targets, Study Marks or scripture data.

Leave packs, capabilities, other diagnostics and future claims/beliefs features
unchanged. No native pack work, package migration, framework/database rewrite,
new queue, account, analytics, release or publication is included. The issue #82
implementation note contains the verified source map and completion conditions.

## Completion report

Give the working path/branch, starting and final pushed SHAs, remote equality,
actual behavior changes, tests run/results, remaining blockers, and workspace
status. Include extra workspace inventories only if a workspace was created or
removed, or unexpected local work requires explanation. Keep the report concise.
