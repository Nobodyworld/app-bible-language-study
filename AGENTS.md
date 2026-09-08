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

## Current work: Septuagint source-stack decision and proof (#97)

Accepted `main` is `e420f31be6a79fd34e5e520c80fa76cc640d9c40` after #112/#113.
Work only on `research/septuagint-source-stack` for #97. Issue #83 is complete,
so its deterministic source/Search generation contracts are now the maintained
production-data authority. This slice is the Phase 0 source, rights, feasibility,
and proof-of-import prerequisite for #96. Do not start the full #96 comparison UI
or #78 multilingual Search integration in this branch.

Required end state:

- Maintain `docs/decisions/SEPTUAGINT_SOURCE_STACK.md` as the decision record.
- Pin and verify the exact Greek-text proof source revision and source hash.
- Recheck separate rights for text, annotations, lemma/morphology resources,
  alignment data, versification data, and derived outputs. Public readability is
  not redistribution permission.
- Use Swete as the preferred Greek-text proof candidate unless current evidence
  rejects it; preserve its share-alike obligations separately from MIT code.
- Measure reproducible lemma/morphology join coverage rather than assuming that
  Open Scriptures or STEPBible identifiers match the selected text.
- Verify current STEPBible versification/lexical candidates by exact file and
  revision; do not assume TAGOT exists merely because it is planned.
- Do not commit, mirror, transform for redistribution, or use CATSS/restricted
  alignment bytes as hidden public authority without documented permission.
- Build only a small disposable/untracked proof covering Genesis 1, one Psalm
  numbering/superscription case, and one prophetic passage used in the NT.
- Report token/reference integrity, malformed or duplicate records,
  normalization collisions, lemma-join coverage, versification mapping,
  exact-GNT lemma matches, and raw/JSON/compressed size estimates.
- Select an explicit first Hebrew↔Greek alignment delivery model: redistributable
  source alignment, local-only restricted adapter, deterministic non-authoritative
  candidates, limited manual review, or deferred word-level alignment.
- State what #96 may and may not claim under that model and whether Phase 1
  production contracts are cleared to begin.

Preserve the #96 invariant that `wlc` and `wlco` are two representations of one
Westminster Leningrad Codex Hebrew base, not independent textual witnesses. Do
not add a production LXX corpus, generated full-corpus output, runtime provider,
new data pack, UI, backend, account, release, tag, or repository-settings change
in #97 unless separately authorized after the source decision.

## Completion report

Give the working path/branch, starting and final pushed SHAs, remote equality,
exact source revisions/hashes/terms reviewed, proof inputs and disposable-output
locations, measurements, selected source/alignment/packaging decisions, files
committed, tests run and results, unsupported claims or blockers, and workspace
status. Keep restricted source bytes and private local paths out of public GitHub
artifacts. Keep the report concise.
