# Contributing

Bible App Reader is a local-first browser and Windows desktop public preview.
Issues are welcome for bugs, accessibility, data rights, and reproducible reader
behavior. External pull requests are reviewed case by case.

## Before opening an issue

Check the README boundaries. Include the scripture route/reference, environment,
expected and actual behavior, and relevant source/notice paths for data questions.

## Development and review

Owner-approved rework may be a substantial, coherent slice on one persistent
branch. Normal edits, focused tests, commits, and branch pushes may proceed
without opening a PR first. Keep the accepted `main` unchanged until review.
Follow `AGENTS.md` for workspace and data safety.

Run focused tests during implementation and one applicable final `npm run verify`
before requesting review; run native checks for desktop-affecting changes.
Update behavior tests alongside intentionally retired or redesigned features,
while preserving unrelated security, persistence, backup, and accessibility tests.
Do not repeat the entire aggregate after every small edit or create serial
worktrees merely for bookkeeping. Open one reviewable PR when the slice is ready.

Do not add bundled source data without provenance and rights. Do not commit
secrets, personal study data, browser profiles, scratch evidence, or build output.
Settings changes, public releases, tags, and publication need separate approval.

## Development commands

```powershell
npm ci
npm run serve
npm run desktop:dev
npm run verify
```

The full automated browser suite currently expects Microsoft Edge on Windows.
Use `docs/DESKTOP.md` for native commands and isolated-data testing.
