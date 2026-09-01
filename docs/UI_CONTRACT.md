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
diagnostics element stays collapsed and retains physical-pack recovery,
capability, and local-job access without creating another ordinary destination.

Lab is selected with `?profile=lab` before the hash route. It shows a compact
`Lab · isolated local data` badge and a My Data isolation warning. Advanced
diagnostics is expanded so the complete experimental controls are available
against Lab-only state. Controls are not duplicated between profiles.

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
- Compatibility-only interpretation polls own no ordinary control.
