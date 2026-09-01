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
the generated inventory.

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

`desktop:test` installs its pinned `tauri-driver` and matching Microsoft-signed
EdgeDriver only under ignored `.desktop-tools/` when absent. It builds and drives
a debug binary with an isolated debug-only data root. The release binary has no
test plugin, test command, broad permission, or WebDriver-only control.

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
- the native debug WebDriver relaunch and persistence journey;
- `npm audit --audit-level=low`;
- the unsigned x64 NSIS build;
- an exact installer count plus byte length and SHA-256 record in the job log.

The workflow does not upload, publish, sign, release, or retain the installer as
a downloadable artifact. A green hosted desktop job is reproducible native build
and automated runtime evidence; it does not replace installed-release manual QA,
native Open/Save dialog observation, actual system-browser observation, external
network-denial proof, installed Stable/Lab directory inspection, real-window
visual/accessibility review, or normal uninstall verification.

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
`Desktop Verify` workflow on the exact candidate. Installed manual QA must use
the release installer and executable, record SHA-256 hashes, verify offline data
and profile isolation, and uninstall normally. Automated debug E2E and hosted
build evidence do not replace native dialog, installed-app, visual, or uninstall
QA.
