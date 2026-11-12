# Theme colour tokens and their contrast

`src/styles/index.css` holds both palettes: `:root` is the dark one, and `:root[data-theme="light"]`
overrides it. A colour token left out of the light block is inherited from the dark one, so a token
added to `:root` alone ships a value tuned for navy surfaces onto near-white ones. Give every new
colour token a light value, or say in a comment why it needs none.

## What each token promises

Every pair below is pinned numerically in `src/styles/themeTokens.test.ts`, in both palettes.

| Token | Use it for | Dark | Light | Promise |
|---|---|---|---|---|
| `--text-muted` | The quietest text: labels, metadata, hints | `#8f8fa2` | `#576375` | 4.5:1 on all four surfaces |
| `--accent-text` | Accent-coloured text (headings, the active tab) | `#4a9eff` | `#155fb8` | 4.5:1 (see `keyboard-shortcuts.md`) |
| `--accent-ring` | An edge that carries meaning: focus, a pressed button, the selected clip, a drop target; and a graphical object that shows state: a progress fill, a slider thumb | `#4a9eff` | `#2378d8` | 3:1 on all four surfaces, both timeline surfaces and `--border-color` (WCAG 1.4.11) |
| `--accent-on-fill` | Text or icons on an `--accent-primary` fill | `#0b1220` | (inherited) | 4.5:1 on the fill and on the `#3a8eef` hover fill |
| `--accent-fill-hover` | An `--accent-primary` fill under the pointer | `#3a8eef` | (inherited) | `--accent-on-fill` at 4.5:1 on it |
| `--accent-primary` | Fills, and borders that only decorate | `#4a9eff` | `#4a9eff` | None as text or as a focus indicator |
| `--warning-ink` | The warning colour as text or a state graphic: the storage-nearly-full text and fill, the Clear Unused hover | `#ff9800` | `#924600` | 4.5:1 as text on the orange-tinted warning panel, 3:1 on `--border-color` |
| `--danger-ink` | The danger colour as text: the storage bar's Clear All / Remove hover, Remove silences' refused alert; and the edge of a field that does not read | `#ff8a80` | `#a81b1b` | 4.5:1 on the hover's red tint, over the plain bar and the warning tint; 4.5:1 on all four surfaces |

The four surfaces are `--bg-primary`, `--bg-secondary`, `--bg-tertiary` and `--bg-hover`.

Measured ratios in the light palette (ESCSUITE-421):

| Pair | primary `#ffffff` | secondary `#f5f7fa` | tertiary `#e8ecf1` | hover `#dde3eb` |
|---|---|---|---|---|
| `--text-muted` `#576375` (was `#718096`) | 6.09 (4.02) | 5.68 (3.74) | 5.13 (3.38) | 4.72 (3.11) |
| `--accent-ring` `#2378d8` (was `#4a9eff`) | 4.42 (2.75) | 4.12 (2.57) | 3.73 (2.32) | 3.42 (2.13) |

The light `--text-muted` is `#718096`'s hue and saturation at a lower lightness, and stays lighter
than `--text-secondary` (`#4a5568`, 7.53:1 on white) so the two still read as two levels.

## Rules

- **Text or an icon on an accent fill takes `--accent-on-fill`, never white, in both themes.**
  White is 2.75:1 on `#4a9eff`, under 4.5:1 for text and 3:1 for an icon. Since ESCSUITE-422 no
  rule in ARTIST's stylesheets draws white on an accent fill: the play button, the pressed
  inspector buttons (B / I, lock, no-fill, keyframe editor, reset), their badges, the media
  library's Add and audio badge, the mobile inspector toggle and the hover fills of Add overlay
  and Set all take it. `themeTokens.test.ts` reads every rule and fails on a white label beside an
  accent fill. Where a more specific `:hover` rule would repaint the label (`.headerButton:hover`,
  `.controlButton:hover`), the accent button restates its ink under `:hover`. The one hover fill
  is `#3a8eef` (5.61:1); `var(--accent-hover, #3a7bc8)` named a token that does not exist and
  put the ink at 4.32:1, so it is gone. Since ESCSUITE-436 that fill is the token
  `--accent-fill-hover`, which Remove silences' Remove all and the transcribe notice's Download
  language pack use; the older rules still spell `#3a8eef` out, and the test reads both forms.
- **An edge that carries meaning takes `--accent-ring`.** That is every `:focus`/`:focus-visible`
  border or outline, the timeline's inline track-name field, the selected and multi-selected
  clip's 2px ring, the timeline's drop preview, the media library's drop zone while a file is
  dragged over it, and the edge of a pressed button: a 1px border on the inspector's pressed
  buttons, an inset 1px ring on the borderless toolbar tools and track controls. In the dark theme
  `--accent-ring` is `--accent-primary`, so none of this changes there; in the light one the fill
  alone is 2.3–2.6:1 on the surfaces it sits on, and the edge reaches 3.4–4.1:1.
- **Left on `--accent-primary`, judged decorative or out of scope.** Hover borders that are never
  the only sign of anything (the resolution select, the keyframe editor button, the media
  library's storage buttons, Add overlay and Set, whose label and fill change too) and the export
  dialog's advanced Download button outline (its `--accent-text` label names it). The drop zone's
  plain hover shares the drag-over rule, so it takes the ring too.
- **A progress fill or a slider thumb takes `--accent-ring`** (ESCSUITE-423). They show state (how
  far an export has got, how full storage is, where a slider is), so WCAG 1.4.11 asks 3:1 against
  the track and the surface. `#4a9eff` was 1.87:1 on the media library's storage track
  (`--border-color`, `#d1d5db`), 2.32:1 on the export dialog's track and the inspector sliders'
  (`--bg-tertiary`) and 2.13:1 at the light end of the track volume slider's gradient
  (`--bg-hover`). `#2378d8` is 3.00:1, 3.73:1 and 3.42:1 there. That covers the storage and
  export fills, the global `.progress-bar-fill`, the track volume slider's thumb (and its
  `accent-color`) and the thumb of every inspector slider inside a `.transformRow`. The upload
  bar takes the ring too, for consistency, but it is not a measure: its fill is always 100% wide
  and pulses down to 50% opacity (1.70:1 on its track at the dip) beside a "Processing..." status,
  which carries the state, as with the spinners below. The storage bar's warning state
  has its own token, `--warning-ink` (below).
- **The spinners are decorative and stay on `--accent-primary`.** The preview's spinner sits
  beside "Loading videos..." and the project-load overlay's beside "Loading project..." (that one
  is `aria-hidden`), so the words carry the state and the spinner adds no information WCAG 1.4.11
  asks to be perceivable. The overlay's spinner sits on an 80% black scrim, where `--accent-ring`
  would be darker against it than the fill it has now. `index.css`'s global `.spinner` is not used
  by any component.
- **Warning text or a warning fill takes `--warning-ink`** (ESCSUITE-425). When storage is nearly
  full (under 100 MB left) the media library's storage bar tints its panel
  `rgba(255, 152, 0, 0.15)` and drew its text and fill in a hard-coded `#ff9800`: 1.8:1 as text on
  the light panel (`#f7e9d5` over `--bg-secondary`) and 1.46:1 as a fill on the light
  `--border-color` track. The light `#924600` is the same hue, darker: 5.17:1 on the tint over
  `--bg-tertiary`, 4.60:1 on the track. The tints and the panel's border stay on the raw orange:
  they decorate, and the words carry the state. `--accent-warning` keeps its own uses (the
  timeline's warning rings and the import notice's edge).
- **Danger as text takes `--danger-ink`; `--accent-danger` stays for fills** (ESCSUITE-426). The
  storage bar's Clear All / Remove hover painted its label `--accent-danger` on a
  `rgba(244, 67, 54, 0.1)` tint: 3.05:1 in the dark theme on the warning tint, 3.58:1 in the light
  one. `--danger-ink` is lighter in the dark theme and darker in the light one. On the dark
  theme's orange warning tint `--text-muted` is 3.9:1, so in the warning state the bar's button
  labels and the earlier-sessions note take `--text-secondary` (4.7:1 or more).
  Remove silences (ESCSUITE-436) painted its refused alert and the border of a field that does
  not read in a hard-coded `#f87171`: 2.57:1 as text on the light dialog (`--bg-secondary`) and
  2.33:1 as a border on the light field (`--bg-tertiary`), under WCAG 1.4.11's 3:1. Both take
  `--danger-ink`: 6.90:1 and 6.24:1 there in the light theme, 6.96:1 and 8.34:1 in the dark one.
- **A surface that is dark in both themes does not read theme text tokens.** The preview's empty
  and loading placeholder sits on `.videoWrapper`'s `#111`, so it hard-codes the dark `--text-muted`
  (`#8f8fa2`, 5.95:1); the light value would be 3.10:1 there. The keyframe panel is painted dark
  whatever the theme is and uses its own greys for the same reason.

## Tests

- `src/styles/themeTokens.test.ts`: the ratios above, from the stylesheet.
- `apps/e2e/tests/accessibility/core.spec.ts`, "ESCAPEARTIST has adequate color contrast in the
  light theme with a clip selected (ESCSUITE-421)": axe `color-contrast` over the empty editor, the
  editor with a real clip selected in the inspector, the hovered media library row, and the export
  dialog with its advanced options open, in the light theme. Only the canvas timeline is excluded.
- The same file's "the header Export button's label meets AA, hovered too": both themes, both
  states.
- The same file's "accent-filled controls keep their labels and edges readable (ESCSUITE-422)":
  both themes, from computed styles (axe judges text only): the play icon on its fill and hover
  fill (3:1), the pressed B button's label (4.5:1, hovered too) and its edge or fill on its
  surface (3:1), the active tool's icon and edge, and the selected clip's ring on its track.
- The same file's "the export progress fill and the inspector's slider thumbs stand out from
  their tracks (ESCSUITE-423)": both themes, from computed styles. The thumb is a pseudo-element
  `getComputedStyle` cannot read, so the test resolves the stylesheet rule that paints it in the
  live theme. `themeTokens.test.ts` pins each fill and thumb to `--accent-ring` and the ring on
  every track they run on.
- The same file's "the storage-nearly-full warning stays readable (ESCSUITE-425)": both themes,
  with `navigator.storage.estimate` reporting 950 MB used of 1000 MB. axe `color-contrast` over
  the storage bar, and the warning fill on its track from computed styles.
- The same file's "the storage bar's buttons stay readable, hovered too (ESCSUITE-426)": both
  themes, plain and nearly full, with one imported file not on the timeline so Clear All is
  enabled and Clear Unused shows; axe `color-contrast` at rest and with each button hovered.
- The same file's "the Remove silences dialog stays readable, refused and with a field invalid
  (ESCSUITE-436)": both themes, a seeded separate-tracks take with its microphone track locked so
  Remove all is refused and says why, and Minimum gap set out of range; axe `color-contrast` over
  the dialog at rest and with Remove all hovered, and the invalid border (3:1) against the field
  and the dialog from computed styles.
- The same file's "the transcribe language-pack notice stays readable, hovered too
  (ESCSUITE-436)": both themes, with the Web Speech API and a Chrome brand stubbed
  (`utils/speechStub.ts`) answering `downloadable`; axe `color-contrast` over the notice at rest
  and with Download language pack hovered.
