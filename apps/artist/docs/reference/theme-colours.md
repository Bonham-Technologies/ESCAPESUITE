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
| `--accent-ring` | A focused field's border, a focused menu row's outline | `#4a9eff` | `#2378d8` | 3:1 on all four surfaces (WCAG 1.4.11) |
| `--accent-on-fill` | Text or icons on an `--accent-primary` fill | `#0b1220` | (inherited) | 4.5:1 on the fill |
| `--accent-primary` | Fills, and borders that only decorate | `#4a9eff` | `#4a9eff` | None as text or as a focus indicator |

The four surfaces are `--bg-primary`, `--bg-secondary`, `--bg-tertiary` and `--bg-hover`.

Measured ratios in the light palette (ESCSUITE-421):

| Pair | primary `#ffffff` | secondary `#f5f7fa` | tertiary `#e8ecf1` | hover `#dde3eb` |
|---|---|---|---|---|
| `--text-muted` `#576375` (was `#718096`) | 6.09 (4.02) | 5.68 (3.74) | 5.13 (3.38) | 4.72 (3.11) |
| `--accent-ring` `#2378d8` (was `#4a9eff`) | 4.42 (2.75) | 4.12 (2.57) | 3.73 (2.32) | 3.42 (2.13) |

The light `--text-muted` is `#718096`'s hue and saturation at a lower lightness, and stays lighter
than `--text-secondary` (`#4a5568`, 7.53:1 on white) so the two still read as two levels.

## Rules

- **Text on an accent fill takes `--accent-on-fill`, never white.** White is 2.75:1 on
  `#4a9eff`. The header Export button took it in ESCSUITE-421, and restates it under `:hover`:
  `.headerButton:hover:not(:disabled)` is the more specific rule and would otherwise turn the label
  `--text-primary`, which is `#e8e8e8` at 2.72:1 on the dark theme's hover fill. Other
  white-on-accent states (the inspector's active style buttons such as `.styleButton.active`,
  for example) remain #275 follow-ups.
- **A focus indicator takes `--accent-ring`.** Every `:focus`/`:focus-visible` border or outline
  in the themed UI uses it, and so does the timeline's inline track-name field (shown only while
  editing). Borders that mark a hover, a drag target, a selected clip or a pressed button still use
  `--accent-primary` and are under 3:1 on the light surfaces; they are not covered yet.
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
