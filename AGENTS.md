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

## Current work: Septuagint comparison contracts (#96 Phase 1)

Accepted `main` is `0148d6f989c1eafef489fb452a4a33a1a8c899ab` after #97 / PR #114.
Work only on `feature/septuagint-comparison-contracts` for this Phase 1 slice.
Issue #83 remains the deterministic source-data generation authority. The accepted
#97 decision allows shared witness/reference/evidence contracts to proceed, but
it does not establish Swete token lemmas, morphology, or Hebrew↔Greek word-level
alignment.

Required end state:

- Keep the framework-neutral comparison contract under `app/src`; do not put
  shared domain semantics into a browser-only or desktop-only adapter.
- Model one canonical `textWitness` with multiple display/normalization
  representations. `wlc` and `wlco` remain one `openbible:wlc` witness vote and
  one source-token identity when witness/reference/token position match.
- Model witness-qualified `sourceToken` identity with source reference and token
  index. Canonical reference, lemma, morphology, and transliteration may be null;
  unsupported fields must remain null rather than inferred from spelling,
  Strong's ids, English glosses, or canonical ordering.
- Model explicit verse maps for exact, split, merged/many-to-one, moved,
  source-only, canonical-only, unavailable, and uncertain states. Preserve
  source-only/unmapped records instead of inventing targets.
- Model alignment states `aligned-1:1`, `aligned-1:n`, `aligned-n:1`,
  `aligned-n:m`, `reordered`, `hebrew-unaligned`, `greek-unaligned`,
  `lexical-substitution`, and `uncertain`, with cardinality validation.
- Keep source-provided, deterministic generated-candidate, and manually reviewed
  evidence distinct. A generated candidate cannot become reviewed merely from a
  confidence value.
- Keep LXX↔NT exact lemma identity, normalized alias, lexical relation, and
  unresolved candidate separate from passage citation/quotation relations.
  Shared vocabulary never creates quotation, allusion, or textual-dependence
  authority by itself.
- Maintain deterministic, corpus-free fixtures for all alignment shapes and the
  accepted Psalm 50:1–3 → app Psalm 51:1 many-to-one versification divergence.
  Fixtures may use synthetic token ids/characters and exact reference metadata;
  do not copy a production LXX corpus into this branch.
- Keep the accepted #97 Phase 1 boundary explicit: Swete text contract-ready;
  TVTMS only bounded reference authority; Swete lemma/morphology and Hebrew↔Greek
  word alignment unsupported; production corpus/optional pack not part of Phase 1.

Do not add a production Swete/LXX pack, import restricted CATSS/CCAT bytes, infer
an alternate Hebrew Vorlage, implement the comparison UI, implement #78 Search,
change user-data v3, add a backend/account/sync path, change repository settings,
or create a release/tag in this slice.

## Completion report

Give the working path/branch, starting and final pushed SHAs, remote equality,
contract/fixture files changed, focused and aggregate tests run, exact failures or
unrun checks, Gitleaks/diff status, remaining blockers, and workspace status.
Keep restricted source bytes and private local paths out of public GitHub artifacts.
Keep the report concise.