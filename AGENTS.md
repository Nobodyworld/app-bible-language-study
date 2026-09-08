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

## Current work: deterministic source/Search generation authority (#83)

The desktop foundation and feature-scope cleanup are complete through PR #110.
Work only on `tooling/source-search-generators` from accepted main
`b351b850078cbd5f9a77aa229abf9df811ab66d3`. Do not redo #105/#109 or start the
multilingual Search UI from #78 yet.

Reconcile the preserved historical source/index tooling against current tracked
authority, then implement one singular reproducible generation path. Review the
owner's preserved historical candidates outside the repository; record their
hashes/timestamps and dispositions in the local report, but do not publish local
archive paths or blindly copy archived files into the branch.

Required end state:

- `app/tools/import-original-language-sources.mjs` is the documented singular
  original-language source-generation authority, with any genuinely missing
  historical transformation/provenance logic merged into it rather than keeping
  duplicate Node/Python authorities.
- Current exact Search data has a maintained deterministic generator plus
  no-write/check mode, source identity, stable ordering/normalization, digest or
  manifest identity, reconciled counts, and actionable mismatch failures.
- Add direct storage-engine-neutral Search contract coverage suitable for #78;
  preserve existing exact Search behavior rather than implementing the new
  multilingual lanes prematurely.
- Wire maintained commands into `package.json`, tests/TEST_INVENTORY, integrity/
  inventory checks, source/provenance docs, and package identities when outputs
  legitimately change.
- Keep extension points for witness-qualified source identities, source-specific
  versification, namespaced outputs, separate text/lemma/morphology/alignment
  authorities, and unaligned/source-only records so #96 can add LXX later without
  overwriting WLC/GNT authority.
- Preserve #96's Hebrew-base invariant: `wlc` and `wlco` are pointed and
  consonantal representations of the same Westminster Leningrad Codex base.
  They must share one canonical witness/source-token identity and must not be
  counted or asserted as independent textual witnesses. Represent the display/
  normalization variant separately from that canonical witness identity.

Historical JSON/SQLite/performance experiments are evidence only unless current
measurements justify adoption. Do not introduce SQLite simply because an old
benchmark exists. Do not restore destructive publish/sync helpers. Do not import
or publish LXX/CATSS data in this slice; #97/#96 own source-rights and LXX work.

Preserve current Reader, Search, Language Study, Strong's, Study Marks, Meaning,
My Data, browser/desktop data resolution, package manifests/provenance, and
`bibleapp:user-data` v3. No native-pack #81 work, framework/database rewrite,
accounts/sync/backend, release/tag/settings change, or personal-data operation.

## Completion report

Give the working path/branch, starting and final pushed SHAs, remote equality,
actual behavior/data-tooling changes, candidate-script dispositions, tests run and
results, remaining blockers, and workspace status. Include extra workspace
inventories only if a workspace was created or removed, or unexpected local work
requires explanation. Keep the report concise.
