# Stylesheet ownership

The browser and Tauri use the same `app/index.html` and stylesheet order:

| Order | File | Responsibility |
| --- | --- | --- |
| 1 | `styles.css` | Resets, base typography, shared primitives and remaining independent tool components; global accessibility rules. |
| 2 | `styles-polish.css` | Visual custom properties only: surfaces, shadows, footnotes and marks. No component selectors or structure. |
| 3 | `styles-shell.css` | App header, translation/book/chapter pickers, app grid and bounded Detail pane/content. |
| 4 | `styles-workspace.css` | Study header, width cycle, title/mode and Clear/Hide controls. |
| 5 | `styles-reader.css` | Reader rows, chapter controls, inline Strong tokens, footnote markers and Reader navigation. |
| 6 | `styles-study.css` | Language Study/alignment cards, transliteration, marks, data summaries and footnote scripture. |
| 7 | `styles-context.css` | Context tabs, panel navigation, Study Marks triggers and contained Meaning surfaces. |

Base primitives precede their components. Visual tokens precede their consumers.
Nested context controls load last and own their geometry inside other components.
Each component owns its responsive, interaction, theme and forced-color variants;
there is no general responsive override file. The former `styles-portrait.css`
has been removed: its desktop/container rules now live with their components.
The independent `portrait-workspace.js` runtime still measures the app header.
Desktop staging requires every stylesheet listed above and copies the same HTML.

The Study pane's 320px border box has a 318px container query content box. That
query enables the single header row; smaller containers retain a stacked fallback.
The intermediate desktop clamp can produce a 300px Compact pane. Mobile uses the
existing drawer and hides the stored desktop width control.

`node tests/stylesheet-ownership.mjs`, included in `test:static`, checks the load
order, complete file inventory, staging lists, component structural owners and
cross-file structural declarations. The scanner preserves media, container,
supports and layer contexts and handles commas inside selector functions. Tests
inject ownership violations in each context; responsive wrappers cannot bypass
the guard. New component owners must be added explicitly to the small manifest in
`app/tools/stylesheet-ownership.mjs`.

Intentional overlaps are limited to `:root`, `:root[data-theme="dark"]` and the
OS-dark fallback `:root:not([data-theme])`: they set disjoint token families.
Base theme tokens, polish surface tokens and the shell's measured-header default
have separate responsibilities. A duplicate custom-property declaration across
these files fails the guard. Repeated selectors inside one owner represent base,
breakpoint, state or theme rules; source order remains significant.

Measured with `node app/tools/stylesheet-ownership.mjs` before cleanup at
`d907be3` and after the ownership slices (before the footnote feature):

| Measurement | Before | After |
| --- | ---: | ---: |
| Stylesheets | 4 | 7 |
| Style rules | 927 | 955 |
| Exact selector forms shared across files | 73 | 3 |
| `!important` declarations | 242 | 30 |

Rule counting expands grouped selectors only for overlap comparisons; conditional
wrappers, keyframes and font faces are not style rules. Splitting mixed-owner
selector groups creates more rules without adding behavior. Counts are comparable
under this scanner, not the earlier issue's audit method. Root/theme duplication
and broad button/text overrides were removed. Shared button tokens replace broad
theme-specific `!important` selectors, allowing component appearance to win.
Remaining importance protects reduced motion, forced colors, hidden legacy
tooltips and narrow context-control states. It is not a target to eliminate.

Focused rendered coverage includes all width modes, the actual 320px pane,
subminimum fallback, desktop/mobile context controls, real Strong references and
wrapping in light/dark/forced colors. The wrapping negative control restores
inline padding in an isolated fixture and must detect padding-only fragments.
Viewport resizing/reflow evidence does not claim actual browser zoom or owner
approval. Native and final integrated results are recorded separately.
