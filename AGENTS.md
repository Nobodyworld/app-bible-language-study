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
or a final distribution checkpoint, not each data/tool edit. Do not revive temporary
owner-machine uninstall/firewall helpers or bypass blocked automation actions.
Report failures and unrun checks accurately; source review is not rendered QA.

## Current work: Septuagint data pipeline (#96 Phase 2)

Accepted `main` is `ba76d3a1eb0278439886ba46620742a3b6afd79b` after Phase 1 / PR #115.
Work only on `feature/septuagint-data-pipeline` for this Phase 2 slice.
Do not open a PR until the pipeline and its applicable local validation are complete.
Issue #83 remains the deterministic source-data/Search generation authority, and
Phase-1 contracts in `app/src/textual-comparison-contracts.js` are now the shared
semantic authority for witnesses, source tokens, verse maps, evidence and review
states.

Source boundaries from #97 remain binding:

- Swete text source: `nathans/lxx-swete` pinned at
  `26bad3eb42bba98471d154c954e36a6f30a0279d`, CC BY-SA 4.0 data boundary.
- TVTMS reference/versification candidate: STEPBible pinned for the accepted proof
  at `ea47bd4c7eab7375f2dca07086ccc356e95a4128`, CC BY 4.0.
- Swete token lemma and morphology remain unsupported.
- Hebrew↔Greek word-level alignment remains unsupported.
- Do not use restricted CATSS/CCAT bytes as tracked, generated, or hidden authority.

Required Phase-2 end state:

- Add one maintained deterministic Swete text import/check pipeline under the #83
  generation model. It must accept explicit external/pinned source inputs; ordinary
  tests must not depend on live network access.
- Parse source-native Swete references and stable token order without inventing
  lemma, morphology, Strong's identity or Hebrew alignment.
- Produce witness-qualified source-token records and explicit source/app verse-map
  records conforming to the merged Phase-1 contracts.
- Preserve source-only and unmapped records. Do not silently coerce every source
  reference onto an app verse.
- Add source manifest/provenance, exact source revision/hash inputs, transformation
  history, deterministic output identity/digests and a no-write `--check` mode.
- Make output ownership singular and documented; do not create a second competing
  generator beside the #83 authority.
- Implement and test full reference/verse-map coverage logic before claiming a
  full-corpus optional pack is ready. Psalm numbering/superscription divergence
  must remain explicit.
- Keep tracked fixtures small, synthetic or explicitly rights-cleared. A
  production-size Swete generation may be measured locally from the pinned source,
  but do not commit a full corpus merely to satisfy tests.
- Record pack-size, record-count, orphan/unmapped-reference, parse-time and check-time
  measurements from a production-size local proof before Phase 2 is accepted.
- Preserve the separate license/notices boundary for Swete-derived output; do not
  relabel source data as MIT application code.

Do not implement the comparison UI, #78 multilingual Search, Phase-3 LXX↔NT lemma
bridge, user-data v3 changes, accounts/backend/sync, release/tag/store publication,
or unrelated Reader redesign in this slice. Do not promote generated candidates
into reviewed evidence from confidence alone.

## Completion report

Give starting/final SHAs and remote equality, importer/checker and manifest files,
fixture and production-size measurements, exact source revisions/hashes used,
focused and aggregate tests, `--check`/reproducibility results, dependency audit,
Gitleaks/diff status, unsupported claims, remaining blockers and workspace status.
Keep restricted source bytes and private local paths out of public GitHub artifacts.
Keep the report concise.
