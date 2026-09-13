# UI Feature Contract

The browser and Tauri Windows UI remain one static DOM application. Feature profiles decide
whether a module participates; capability state separately decides whether an
enabled module's required data can currently be used.

## Ownership

`app/src/feature-registry.js` is the maintained authority for exclusive control
ownership and UI surfaces. At startup, `app/src/feature-ui.js` applies
`data-feature-id` and `data-feature-access` to owned controls. A disabled
feature hides only its owned controls and is omitted from contextual tool
registration; it does not present a data-unavailable error or request its data.

The ordinary Stable controls remain Search, Language Study, Outline, Study
Marks, My Data, Strong's, Commentary, Cross References, Parallel translations,
and Meaning. The contextual scope order remains exactly `Word → Verse`.

DOM construction, focus, hash routing, panel history, CSS, and responsive
behavior are shared webview concerns rather than platform services. Browser or
desktop differences belong behind the platform contract only for persistence,
files, static-data reads, notifications, and physical bytes.

## Stable and Lab

Stable is the default and does not show a profile badge. Its Advanced
diagnostics element stays collapsed and renders lazily. It retains storage
authority, migration and failure messages, quarantine and recovery-backup
counts, and physical-pack recovery. Capability Disable/Restore controls,
package-operation and logical installed-pack counts, assertion-event counts,
and duplicate storage summary tiles are absent. Local Jobs routes, counts,
execution controls, and the job-backed index-refresh action are absent in both profiles.

In the browser, Lab is selected with `?profile=lab` before the hash route. The
supported Tauri Lab command selects Lab natively while loading the same shared
frontend. It shows a compact `Lab · isolated local data` badge and a My Data
isolation warning. Advanced diagnostics is expanded so the complete technical
summary and capability Disable/Restore controls are available against Lab-only
state. Capability resolution and historical disabled preferences remain shared
contracts; opening Stable diagnostics never resets those preferences. Controls are not
duplicated between profiles.

Unknown profile values resolve to Stable, set the testable
`data-profile-diagnostic="unknown_profile"` document state, and do not prevent
Reader startup.

The fixed disabled-feature profile used by maintained browser automation is
available only through an in-memory test flag on loopback hosts. It is not a
URL-selectable or hosted production profile override.

The Windows window is one resizable WebView2 surface with a 390 by 640 minimum.
It preserves the same 768px mobile-drawer boundary and 769px/773px responsive
contracts as the browser. Release builds disable DevTools and the ordinary
context menu. Native Open/Save replaces the browser file picker/download only
inside the Tauri composition; visible backup semantics remain version 3.

## Unavailable behavior

- Disabled feature: the owned control is absent and no feature data is loaded.
- Enabled feature with unavailable capability/data: the existing structured
  unavailable state and retry behavior remain authoritative.
- Core Reader failure: startup reports the existing bounded error state.
- Compatibility-only interpretation polls own no ordinary or diagnostic controls, counts, or response mutations in either profile. Historical records remain accessible through the shared version-3 backup path.
# Footnote scripture

Footnotes preserve their original wording and show recognized cited scripture
in the Reader's selected translation. Psalm 23:1 footnote a, “See Revelation
7:17.”, is the maintained real-data example. Explicit canonical book names,
OSIS names and supplied book aliases support single verses, ranges, multiple
distinct references and chapter-spanning ranges. Revelation 7:15–17 is valid;
Revelation 7:17–18 is invalid and must not be truncated. Ambiguous names remain
plain text; abbreviated verse lists and malformed ranges show an unsupported
format message. No prose-only guesses are made.

`references.js` owns reference extraction and `data-service.js` owns strict
passage loading through the existing translation/book cache and physical-pack
resolver. In-flight passage identity includes translation, the complete range
and the data-source epoch. Missing, invalid, loading and recoverable failure
states are explicit. No translation fallback, external service or silent pack
installation is allowed. Restored/refreshed entries use the current translation;
stale footnote, translation or panel responses cannot replace the current view.

Scripture is subordinate to the note. Verse numbers and range boundaries remain
visible. Passages over three verses or 650 characters use an accessible disclosure
with all text retained and a bounded, keyboard-scrollable region. Text is rendered
with text nodes and direction-aware `bdi`, with no recursive citation expansion.
Hydration and expansion do not navigate the Reader or add panel history. The
explicit “Read…” button is the navigation action. English Reader versions remain
unchanged; RTL rendering is tested against existing WLC data without adding a
new selectable version.
