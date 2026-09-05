# Windows Desktop Public Preview

The issue #80 desktop vertical slice is an unsigned Tauri 2 Windows x64 public
preview. It is not a production release, signed installer, store package, or
updater. The existing static browser application remains independently usable
and retains its existing tests and storage authority.

## Composition

`application-platform.js` selects the browser platform when no Tauri bridge is
present. A present but malformed bridge is a startup error. Only
`tauri-bridge.js` reads `window.__TAURI__`; the rest of the application consumes
the explicit platform contract.

The desktop platform supplies:

- Tauri-resolved application, data, log, temporary, and distribution details;
- Stable/Lab profile-scoped native JSON stores;
- native Open and Save dialogs for portable version-3 JSON;
- constrained reads from installed `data/` resources;
- in-process profile notifications;
- bundled-only physical-pack services;
- route restoration, close-time persistence flush, and exact-host external links.

The deterministic preparation tool copies only Git-indexed runtime allowlist
content. The small HTML/CSS/JavaScript shell becomes `.desktop-dist/`; the full
existing `data/` corpus becomes `.desktop-resources/data/` and is installed as
Tauri resources. Physical-pack fixtures/scenarios, repository tests, tools,
browser profiles, caches, logs, secrets, backups, and build outputs are excluded.
Both directories are ignored build inputs and are checked byte-for-byte against
the generated inventory. The npm development entry points finish this staging
before Tauri starts Cargo so the native build never observes a partially
replaced resource tree. They also disable Tauri's built-in localhost dev server
and load the staged internal application origin directly, preserving the same
navigation policy as the installed release.

## Prerequisites and commands

Windows development requires Node.js 20 or newer, Rust with the
`x86_64-pc-windows-msvc` target, Microsoft Visual C++ build tools, and WebView2
Evergreen Runtime. The NSIS bootstrapper may download WebView2 when it is
missing, so the installer does not promise fully offline runtime provisioning.
Once the runtime and app are installed, normal Bible data access requires no
localhost server or network service.

```powershell
npm ci
npm run desktop:prepare
npm run desktop:prepare:check
npm run desktop:dev
npm run desktop:dev:lab
npm run desktop:check
npm run desktop:webdriver:prepare
npm run desktop:test
npm run desktop:build
```

`desktop:dev:lab` compiles the explicit native `lab-profile` feature and loads
the same internal `index.html` as Stable. Native state owns that profile choice;
desktop storage commands do not accept a frontend-selected profile ID. Both
window configurations enable WebView2's genuine page-zoom accelerators.

`desktop:test` installs its pinned `tauri-driver` and matching Microsoft-signed
EdgeDriver only under ignored `.desktop-tools/` when absent. By default it builds
and drives a debug binary with an isolated debug-only data root. Exact
installed-artifact acceptance may instead supply `BIBLEAPP_E2E_APPLICATION`, set
`BIBLEAPP_E2E_SKIP_BUILD=1`, and optionally select the validated `stable` or
`lab` profile. The release binary has no test plugin, test command, broad
permission, or WebDriver-only control.

`desktop:build` creates one current-user x64 NSIS installer. Output under
`src-tauri/target/` is local validation evidence and must not be committed or
published by this issue.

## Hosted desktop verification

`.github/workflows/desktop-verify.yml` is the path-scoped Windows-native check for
changes that can affect the shared desktop frontend, Tauri source, desktop tests,
or package inputs. It checks out and asserts the exact pull-request head (or the
exact push/workflow-dispatch SHA), uses read-only repository permissions with
checkout credentials disabled, and then runs:

- deterministic desktop preparation;
- `desktop:check`, including Rust formatting, Clippy with warnings denied, Rust
  tests, and JavaScript desktop contracts;
- `npm audit --audit-level=low`;
- the unsigned x64 NSIS build;
- exact installer and restored target-specific release-executable byte-length
  and SHA-256 records in the job log;
- deterministic reconstruction of the unsigned executable that Tauri actually
  places into the NSIS installer by replacing the single unknown bundle marker
  with the NSIS marker;
- the source-built debug WebDriver relaunch and persistence journey;
- silent current-user installation of that exact NSIS artifact on the clean
  runner;
- installed-location and current-user uninstall-registry verification;
- byte-for-byte SHA-256 equality between the reconstructed NSIS payload and the
  installed executable;
- the same Reader, Language Study, Strong's, Study Marks, Meaning, route-resume,
  and native persistence journey against the installed release executable;
- a separate headless-safe observation that the installed executable launches
  independently and remains alive outside the WebDriver session;
- capture of all existing Stable/Lab files plus disposable workspace/recovery
  sentinels immediately before uninstall;
- silent uninstall plus executable, uninstaller, payload, registry, and
  candidate-owned shortcut removal assertions;
- exact retained-file path, byte-length, and SHA-256 comparison after uninstall;
- Gitleaks 8.30.1 from a checksum-pinned upstream archive over the PR base-to-head
  or push range (the parent-to-head range for manual dispatch).

Tauri temporarily patches the bundle-type marker before creating NSIS and then
restores the target-specific release executable. The restored release file and
the installed executable are therefore expected to have different hashes. The
workflow treats the deterministically reconstructed NSIS-patched payload—not the
restored file—as the executable identity authority.

GitHub-hosted Windows runners do not expose an interactive user desktop.
`WaitForInputIdle` and `CloseMainWindow` are therefore not reliable evidence of a
normal GUI close in Actions. The installed-release WebDriver journey exercises
the actual installed application window; the separate process check proves an
ordinary independent launch and then terminates that observation process for
runner cleanup. Normal user-driven window close remains a manual acceptance item.

The workflow does not upload, publish, sign, release, or retain the installer as
a downloadable artifact. A green hosted desktop job establishes reproducible
native build, clean-runner installation, installed-release automated behavior,
independent launch, and uninstall cleanup evidence. It does not replace native
Open/Save dialog observation, actual system-browser observation, strict
external-network-denial proof, installed Stable/Lab directory inspection,
real-window visual/accessibility review, normal GUI close or installer/uninstaller
observation, or an optional owner-machine compatibility check.

## User data and backup

The native backend accepts only `stable` or `lab` and one of six logical store
IDs. It derives all paths from Tauri-owned directories; callers cannot provide a
filesystem path. Stable and Lab use separate directories, internal envelopes,
temporary files, and notification identities. There is no automatic browser to
desktop or Stable to Lab migration.

Writes are bounded, queued by the JavaScript adapter, written to a
same-directory temporary file, and atomically replaced. A deterministic flush
is required before ordinary close. Corrupt existing JSON is preserved and not
overwritten until an explicit valid import authorizes recovery.

Native Save validates the version-3 payload before an atomic write. Native Open
accepts one selected regular UTF-8 JSON file within the size bound, validates
the backup envelope, and returns text to the existing all-or-nothing
merge/replace importer. Dialog cancellation is data-neutral. File paths and user
content are not written to native logs.

Uninstall does not claim to delete retained profile data. Preserve a version-3
backup before testing destructive user-data scenarios.

## Security and limitations

The one desktop window has a narrow capability containing only the vertical
slice commands. Packaged data reads must stay below installed `data/` and pass
canonical containment and size checks. Top-level navigation stays at the Tauri
application origin; only credential-free HTTPS links on `github.com` are handed
to the system browser. The release window disables DevTools and the ordinary
context menu, and the CSP excludes broad network sources and `unsafe-eval`.

Current limitations are intentional:

- native filesystem physical-pack management is deferred to issue #81;
- the desktop app remains `bundled_static_data` only;
- there is no signing, updater, store release, analytics, account, sync, or backend;
- only Windows x64 NSIS is in scope; macOS, Linux, and mobile targets are not;
- the installer is an unsigned public-preview artifact and is not published.

## Test authority

Browser authority remains `npm run verify` on Node 20 and Node 24. Desktop
authority is `desktop:prepare:check`, `desktop:check`, `desktop:test`, the
explicit Cargo format/clippy/test gates, `desktop:build`, and the path-scoped
`Desktop Verify` workflow on the exact candidate. The hosted workflow includes
both source-built debug and installed-release WebDriver journeys, exact payload
identity, independent installed launch, and uninstall cleanup. Installed manual
QA must still use the release installer and executable to observe native dialogs,
strict offline behavior, real Stable/Lab directories, system-browser handoff,
normal user-driven window close, and the native visual/accessibility matrix.
Automated installed acceptance does not replace those human-observable gates.

## Desktop baseline and deferred content management

Decision recorded for issue #103: the current desktop product already reads its
bundled Bible, Search, Commentary, and language data as installed JSON resources.
A database migration, SQLite, native physical-pack manager, separate downloads,
or a new storage engine is not required to run the desktop app. The remaining
work after reliability hardening is feature cleanup/rework, not automatic
implementation of #81 or multilingual Search.

There are three different authorities:

| Authority | Current behavior |
|---|---|
| Bundled reference data | Installed, read-only resources shared with the browser product. |
| Personal study data | Writable Stable/Lab native stores and portable version-3 backups. |
| Optional managed packs | An opt-in browser implementation; native implementation remains deferred. |

The previous broad #81 implementation handoff is superseded. Retain its useful
requirements as backlog, but do not execute it. Copying already bundled packs
into another location would add storage, not shrink the existing installer.
Revisit native packs only for a demonstrated need such as independently delivered
content, very large optional datasets, or measured distribution/performance costs.

Before #81 is resumed, its first bounded slice must specify:

- machine-local reconstructible pack bytes under `app_local_data_dir()` on
  Windows; do not relocate existing personal study data;
- a native per-profile writer/locking strategy across processes, generation or
  operation identities, a durable commit point, and recovery at every
  filesystem-promotion/registry-replacement interruption boundary;
- native enforcement of containment, verified-before-activation, and safe
  deletion even when frontend calls arrive out of order; shared JavaScript still
  owns presentation and workflow rather than a duplicated study engine;
- JavaScript/Rust golden vectors for exact ordering, JSON serialization, UTF-8
  lengths, digests and aggregate framing, plus Windows collision/reserved-name,
  alternate-stream and reparse-point rejection;
- tiny fixtures in isolated native tests, with separately identified ordinary
  production-artifact evidence; fixture bytes must not silently enter production;
- one explicitly bounded deliverable and one final aggregate validation, followed
  by a separately scoped expansion only after review.

Reference: Tauri's path resolver distinguishes roaming `app_data_dir()` from
machine-local `app_local_data_dir()` on Windows:
https://docs.rs/tauri/latest/tauri/path/struct.PathResolver.html

## Reliability acceptance boundary

The shared browser pack manager commits activation when its registry write
succeeds. Later history, progress, or cleanup failures return an explicit
`post_activation_failed` error with `activation_committed: true`; they do not
remove committed active/rollback bytes. Cancellation is rechecked before commit.
Removal persists its intent first, verifies each owned store is actually absent,
and retains only failed deletion identities for explicit or startup retry.
Reporting errors after completed removal cannot recreate a malformed record.

`npm run test:reliability` exercises those failure paths and the uninstall
assertions; the ordinary aggregate includes it once through `test:domain`.
The CI preservation helper refuses owner-machine and self-hosted CLI execution.
Its sentinels are nested test-only files, not replacements for application stores,
and it also hashes real study files already produced by the installed journey.
A retained directory alone is not a passing data-preservation result.

Use the maintained disposable Windows workflow for installer regression tests.
Do not revive temporary owner-machine v2/v3/final-uninstall helpers. Earlier
helper failures and retired acceptance repetitions are not successful uninstall
evidence. New native-dialog or accessibility behavior still needs relevant
runtime review, but unrelated changes do not require repeating the entire
personal-machine acceptance matrix.
