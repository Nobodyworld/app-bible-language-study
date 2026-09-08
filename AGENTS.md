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

## Current work: public required-gate hardening (#112)

Issue #83 is complete on accepted main `4051b225df79cff6e3f0b42b3d363fa93bcc1eb7`.
Work only on `ci/required-gates-hardening` for #112. Do not start multilingual
Search #78, LXX #97/#96, native packs #81, or unrelated product work until this
public-repository CI slice is accepted.

Required end state:

- Node 20 and Node 24 both run deterministic/static/domain/generator/data and
  publication checks without duplicating the rendered browser suite.
- One maintained Node runtime runs the complete Edge desktop/mobile interaction
  acceptance.
- Search-highlight and portrait browser QA wait for deterministic rendered/
  scroll readiness rather than depending on transient actionability timing.
- Every pull request receives an exact-candidate, exact-range Gitleaks scan from
  the existing pinned 8.30.1 Windows archive with checksum verification and
  checkout credentials disabled.
- The expensive existing `Desktop Verify` lifecycle remains path-scoped and
  unchanged as native/package authority. An always-present `desktop/security
  gate` must pass irrelevant PRs after security scanning, but for desktop-
  relevant paths it must require the exact candidate's `desktop (windows-2022)`
  check to complete successfully.
- Workflow permissions stay least-privilege and Actions remain full-SHA pinned.
- Candidate required contexts are `deterministic (20)`, `deterministic (24)`,
  `browser (20)`, and `desktop/security gate`. Do not alter the `Protect main`
  ruleset until these exact contexts have been emitted and passed on the PR;
  then the owner must replace the old contexts atomically.

Do not weaken assertions, add retries that hide failures, enable auto-merge,
change release/tag/settings outside the authorized ruleset follow-up, alter
application data contracts, or modify dependency versions merely to complete
this slice.

## Completion report

Give the working path/branch, starting and final pushed SHAs, remote equality,
actual workflow/test changes, exact emitted check names and results, tests run,
remaining ruleset/manual steps, blockers, and workspace status. Keep the report
concise.
