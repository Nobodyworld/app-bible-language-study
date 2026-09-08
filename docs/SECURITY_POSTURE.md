# Security Posture

Bible App Reader is a **PUBLIC PREVIEW — ACTIVE DEVELOPMENT** project designed
as a local-first static reader. It has no backend, account system, analytics
service, remote write API, server-side secret, or payment flow.

## Runtime Controls

- The static HTML includes a Content Security Policy.
- Commentary HTML is sanitized before rendering.
- User-created state is browser-local and exportable.
- Import and recovery paths are covered by automated domain tests.
- Browser QA covers desktop and mobile reader flows.

## Repository Controls

- The repository is public.
- GitHub Actions are pinned to full-length commit SHAs.
- Dependabot monitors npm and GitHub Actions updates on a weekly schedule.
- Branch protection requires `deterministic (20)`, `deterministic (24)`,
  `browser (20)`, and `desktop/security gate`.
- The deterministic Node 20 and Node 24 lanes run static/domain/data contracts
  plus the publication audit without duplicating browser E2E.
- `browser (20)` runs the complete maintained Edge desktop and mobile interaction
  acceptance once on Node 20.
- `desktop/security gate` is always present. Its security preflight performs the
  checksum-pinned Gitleaks 8.30.1 exact candidate range scan on every pull
  request; desktop-relevant changes additionally require the exact candidate's
  path-scoped `desktop (windows-2022)` lifecycle to succeed.
- Public-preview preparation still requires appropriate local static, browser,
  inventory, audit, history or exact-range secret scanning, and diff validation.
- Final release or tag readiness remains a separate, stricter gate.

## Public Security Baseline

The public repository security baseline requires:

- private vulnerability reporting;
- Secret Protection and push protection;
- Dependabot alerts and security updates;
- deterministic compatibility checks on supported Node 20 and Node 24;
- one maintained Node 20 browser acceptance lane;
- an always-present security/desktop required gate;
- branch or ruleset review after CI changes are proven healthy.

CodeQL Default Setup is intentionally disabled for the current public preview by
owner decision. The project continues to rely on its local and hosted static
verification, dependency auditing, always-run pull-request Gitleaks scanning,
release-grade history scanning when required, pinned Actions, and manual security
review. Reassess CodeQL if the architecture, threat model, or release posture
materially changes.

Issue #5 is the system of record for which controls are owner-confirmed, which
are connector-verified, and which remain pending. Availability alone is not
verification.

Public visibility does not create a production release, stable API promise, or
release tag, and green checks do not authorize one. A later release or tag
requires the final gates in issue #5 and explicit owner authorization. Public
visibility also does not relicense bundled third-party Bible and study data; see
`NOTICE.md` and `app/data/source-manifest.json`.
