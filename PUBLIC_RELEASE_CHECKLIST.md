# Public Preview and Release Checklist

Bible App Reader uses separate gates for public-preview visibility, product
stabilization, final-candidate evidence, and any later release or tag. Public
visibility must not be confused with a stable release, API promise, release
authorization, or blanket rights conclusion for bundled data.

Issue #5 is the live record for completed evidence and control state. This file
defines the maintained repository procedure; neither source authorizes a
release or tag without an explicit owner decision.

## Phase A — Public Preview Visibility

Required status language:

> **PUBLIC PREVIEW — ACTIVE DEVELOPMENT**

### Completed visibility gates

- [x] README states that the reader is functional and actively developed.
- [x] README promises neither a production release nor a stable API.
- [x] README and NOTICE distinguish MIT-licensed application code and tooling
  from bundled third-party data.
- [x] README directs redistributors to `NOTICE.md` and
  `app/data/source-manifest.json`.
- [x] Source-attached notices remain intact without a new legal conclusion.
- [x] Generated package metadata does not apply one blanket MIT, CC0, or
  public-domain label to the complete bundled package.
- [x] Initial public-preview validation covered static, desktop-browser,
  mobile-browser, inventory, publish-audit, dependency-audit, Gitleaks, and diff
  checks.
- [x] Repository visibility is public.

Public-preview visibility does not require every final-candidate gate to be
complete and does not authorize a release or tag.

## Phase B — Product Stabilization

- [x] Compact contextual side-panel navigation is `Word → Verse`.
- [x] Chapter Language Study and Book Outline remain reader-header actions.
- [x] Study Marks remains target-aware across Book, Chapter, Verse, selected
  text, and exact source tokens; Favorite remains the canonical `favorite`
  assertion.
- [x] Meaning is separate from Study Marks and applies only to exact canonical
  source-token identity.
- [x] Separate Processing and Study Data user-facing surfaces are retired.
- [x] My Data contains My study data, Backup and restore, App settings, and
  Advanced diagnostics. Stable diagnostics is collapsed and lazy, preserves
  storage/backup/quarantine and physical-pack recovery information, and omits
  capability Disable/Restore controls and implementation-only summary counts.
  Lab retains the complete technical summary and capability manager, open by
  default against isolated state.
- [x] Browser-local operation, sparse legacy compatibility, recovery backups,
  malformed-import atomicity, and the no-network boundary remain intact.

## Phase C — Documentation and Artifact Reconciliation

Completed through issue #15.

- [x] Reconcile maintained product, architecture, data-model, security, release,
  test, and screenshot documentation.
- [x] Classify every tracked documentation and relevant loose-file candidate.
- [x] Check inbound references before any deletion, rename, or archive.
- [x] Replace transient pull-request assertions with durable documentation
  invariants.
- [x] Expand executable documentation-consistency coverage.
- [x] Preserve `NOTICE.md` and `app/data/source-manifest.json`.
- [x] Keep screenshot generation and image replacement deferred to issue #33.

Final screenshot work begins only after this reconciled documentation is on
`main`.

## Phase D — Final Candidate Evidence

### Screenshots — issue #33

- [ ] Repair the public capture workflow against the accepted reader and My Data
  interfaces.
- [ ] Generate and visually approve reader, compact context, Language Study,
  Study Marks, Meaning, My Data, search, and representative mobile captures.
- [ ] Make filenames, the generated inventory, public descriptions, and README
  references agree.

### Cross-browser QA — issues #7 and #16

- [ ] Complete the recorded desktop and mobile browser matrix where the
  platforms are available.
- [ ] Verify compact context, Study Marks, Meaning, My Data, backup/restore,
  maintenance, diagnostics, and hover-first interactions.
- [ ] Resolve severe public-facing defects or explicitly record focused
  follow-up.

### Package and performance — issue #6

- [ ] Measure cold and warm runtime workflows and distribution methods on the
  exact candidate.
- [ ] Classify findings as acceptable, follow-up, blocker, or unavailable
  evidence.
- [ ] Do not remove or relocate bundled data without explicit owner approval.

## Phase E — Final Rights, Security, Metadata, and Clean-Checkout Gate

- [ ] Confirm README, architecture, UI documentation, screenshots, and
  application behavior agree.
- [ ] Confirm publication-rights review for the intended contents is complete.
- [ ] Confirm `NOTICE.md` and `app/data/source-manifest.json` remain accurate and
  intact.
- [ ] Validate a clean checkout with supported Node versions and `npm ci`.
- [ ] Run full `npm run verify` on the exact candidate.
- [ ] Run `npm audit --audit-level=low` and record the result.
- [ ] Run the required Gitleaks history or exact-range scan and record its
  version, command, range, and result.
- [ ] Confirm worktree cleanliness and local/remote candidate equality.
- [ ] Confirm required hosted checks pass on the exact candidate.
- [ ] Recheck public rendering, repository metadata, and required-check
  enforcement.

## Post-Public GitHub Security Posture

### Owner-confirmed controls

- [x] Private vulnerability reporting.
- [x] Secret Protection and push protection.
- [x] Branch protection requiring `verify (20)` and `verify (24)`.

### Repository-verified configuration

- [x] Verify runs on Node 20 and Node 24.
- [x] GitHub Actions references are pinned to full commit SHAs.
- [x] Dependabot is configured weekly for npm and GitHub Actions.

CodeQL Default Setup intentionally remains disabled for the current public
preview by owner decision. Local and hosted static verification, dependency
auditing, Gitleaks, pinned Actions, and manual security review remain active
controls. Reassess CodeQL only if the architecture, threat model, licensing, or
release posture materially changes.

### Recheck on the final candidate

- [ ] Confirm Dependabot alerts and security updates remain enabled.
- [ ] Confirm Secret Protection, push protection, and private vulnerability
  reporting remain enabled.
- [ ] Confirm required checks actually block an unsuitable merge.
- [ ] Confirm repository About metadata and public documentation rendering are
  current.

## Exact-Candidate Validation

Record commands and exit codes for the exact candidate:

```powershell
npm ci
node ./tests/public-preview-readiness.mjs
node ./app/scripts/doc-consistency-test.mjs
npm run test:static
npm run verify
npm audit --audit-level=low
gitleaks git . --log-opts="<accepted-base>..HEAD"
git diff --check
git status --short --branch
```

Issue-specific work may require additional focused tests. Screenshot generation
belongs to issue #33 and must be followed by manual visual review.

## Authorization Boundary

- Do not create a tag or release because automated checks are green.
- Do not delete or simplify source notices.
- Do not describe all bundled data as open source, MIT, CC0, or public domain.
- Do not alter branch protection, rulesets, security settings, licensing, or
  release configuration without explicit owner authorization.
- Create a release or tag only after all applicable gates are completed,
  accepted, or intentionally deferred and the owner separately authorizes it.
