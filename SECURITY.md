# Security Policy

## Supported Versions

The supported public-preview baseline is the current `main` branch. Bible App
Reader is in **PUBLIC PREVIEW — ACTIVE DEVELOPMENT** and does not currently
promise a stable API or maintained historical release line. Tagged releases, if
created later, will identify their own support status.

## Reporting a Vulnerability

Please do not open a public issue containing secrets, private user data, exploit
details, or sensitive screenshots. Use GitHub private vulnerability reporting.
If that mechanism is unavailable, open a minimal issue requesting a private
contact path or contact the maintainer through the GitHub profile associated
with this repository.

Include:

- affected commit or release, if applicable;
- reproduction steps;
- browser and operating system;
- whether the issue affects app code, bundled data, local persistence, or
  repository configuration.

## Current Posture

Bible App Reader is a static, local-first browser application with an unsigned
Tauri 2 Windows public-preview shell. It has no backend, server-side secrets,
account system, analytics service, payment flow, or remote write API.
User-created study data is stored in the selected browser or desktop profile and
can be exported as version-3 JSON.

The static app includes a Content Security Policy and commentary HTML
sanitization. These controls reduce risk, but they are not substitutes for
reviewing changes that touch HTML rendering, data import, persistence, or
third-party bundled content.

The desktop shell exposes only allowlisted commands for environment reporting,
profile/store-scoped JSON, installed `data/` resources, version-3 backup
dialogs, flush status, and exact-host HTTPS external references. Caller-supplied
paths, arbitrary filesystem reads/writes, shell/process execution, unrestricted
network access, updater authority, and native physical-pack mutation are not
exposed. External navigation is rejected unless it is an application URL;
approved GitHub references open through the system handler. Logs contain bounded
event codes rather than user content or absolute paths. Release CSP and HTML CSP
remain narrow and exclude `unsafe-eval`.

## Repository Security Controls

The repository is public. GitHub Actions are pinned to full-length commit SHAs,
and Dependabot is configured for weekly npm and GitHub Actions updates.

The required public-repository security baseline is:

- private vulnerability reporting;
- Secret Protection and push protection;
- branch protection requiring `verify (20)` and `verify (24)`;
- Dependabot alerts and security updates;
- the Windows Node 20 and Node 24 `Verify` workflow matrix.

Desktop-affecting changes also trigger the path-scoped `Desktop Verify` workflow.
That workflow checks out and asserts the exact candidate SHA, disables persisted
checkout credentials, runs Rust and JavaScript desktop contracts, drives the
native debug application through its relaunch/persistence journey, audits npm
dependencies, and builds and hashes the unsigned NSIS preview without publishing
it. It is supporting desktop evidence rather than a replacement for installed
manual security, accessibility, offline, dialog, system-browser, or uninstall
review.

CodeQL Default Setup is intentionally disabled for the current public preview by
owner decision. Local and hosted static verification, dependency auditing,
complete-history secret scanning, pinned Actions, and manual security review
remain active controls. Reassess CodeQL if the architecture, threat model, or
release posture materially changes; do not describe CodeQL as enabled.

Activation and verification evidence is tracked in issue #5. A control must not
be described as verified merely because it is available for public repositories.

Public visibility and green automated checks do not create a production release,
stable API promise, release tag, or release authorization. Issue #5 records the
live security and release-gate evidence; a later release or tag still requires
explicit owner authorization.
