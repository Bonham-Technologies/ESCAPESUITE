// ESCSUITE-421: the contrast the theme tokens promise, pinned numerically in
// both palettes so an edit to a token cannot reopen a failure silently.
//
// The light --text-muted was #718096, under 4.5:1 on every light surface but
// white, and --accent-primary as a focus border was 2.57:1 on the light
// --bg-secondary, under WCAG 1.4.11's 3:1. The e2e axe audit
// (apps/e2e/tests/accessibility/core.spec.ts) sees the text but not the focus
// borders: axe does not judge non-text contrast.
//
// This reads the stylesheet off disk rather than importing it: Vite hands a
// `.css` import to its CSS pipeline, and jsdom applies no stylesheets anyway.
// Vitest's cwd is the package root. Same approach as CRAFT's
// src/themeTokens.test.ts.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

// Comments are stripped first: the token comments name other tokens, and one
// written as `--name: ...` must not read as a declaration.
const css = readFileSync(join(process.cwd(), 'src/styles/index.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
)

const DARK = ':root'
const LIGHT = ':root[data-theme="light"]'

/** The `--name: value` declarations directly inside one selector's block. */
function tokensIn(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`)
  expect(start, `no \`${selector}\` block in index.css`).toBeGreaterThan(-1)
  const block = css.slice(start, css.indexOf('\n}', start))
  const tokens = new Map<string, string>()
  for (const [, name, value] of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    tokens.set(name, value.trim())
  }
  return tokens
}

/** A token's value in a palette; the light one inherits what it leaves out. */
function token(selector: string, name: string): string {
  const value = tokensIn(selector).get(name) ?? tokensIn(DARK).get(name)
  expect(value, `${selector} ${name}`).toMatch(/^#[0-9a-f]{6}$/i)
  return value as string
}

/** WCAG 2 relative luminance of a `#rrggbb` colour. */
function relativeLuminance(hex: string): number {
  const channel = (i: number) => {
    const s = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2)
}

/** WCAG 2 contrast ratio between two `#rrggbb` colours. */
function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}

const SURFACES = ['--bg-primary', '--bg-secondary', '--bg-tertiary', '--bg-hover']

describe('ESCAPEARTIST theme tokens', () => {
  it('checks its own arithmetic against a known pair', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5)
    expect(contrastRatio('#718096', '#f5f7fa')).toBeCloseTo(3.74, 2)
  })

  for (const palette of [DARK, LIGHT]) {
    it(`keeps --text-muted at 4.5:1 on every surface (${palette})`, () => {
      const muted = token(palette, '--text-muted')
      for (const surface of SURFACES) {
        expect(
          contrastRatio(muted, token(palette, surface)),
          `${palette} --text-muted on ${surface}`
        ).toBeGreaterThanOrEqual(4.5)
      }
    })

    it(`keeps --accent-text at 4.5:1 on every surface (${palette})`, () => {
      const accentText = token(palette, '--accent-text')
      for (const surface of SURFACES) {
        expect(
          contrastRatio(accentText, token(palette, surface)),
          `${palette} --accent-text on ${surface}`
        ).toBeGreaterThanOrEqual(4.5)
      }
    })

    it(`keeps --accent-ring at 3:1 on every surface (${palette})`, () => {
      const ring = token(palette, '--accent-ring')
      for (const surface of SURFACES) {
        expect(
          contrastRatio(ring, token(palette, surface)),
          `${palette} --accent-ring on ${surface}`
        ).toBeGreaterThanOrEqual(3)
      }
    })

    // ESCSUITE-422: the selected clip's ring sits on the timeline's own
    // surfaces, which are not among the four above.
    it(`keeps --accent-ring at 3:1 on the timeline (${palette})`, () => {
      const ring = token(palette, '--accent-ring')
      for (const surface of ['--timeline-bg', '--timeline-track-bg']) {
        expect(
          contrastRatio(ring, token(palette, surface)),
          `${palette} --accent-ring on ${surface}`
        ).toBeGreaterThanOrEqual(3)
      }
    })

    it(`keeps --accent-on-fill at 4.5:1 on the --accent-primary fill (${palette})`, () => {
      expect(
        contrastRatio(token(palette, '--accent-on-fill'), token(palette, '--accent-primary'))
      ).toBeGreaterThanOrEqual(4.5)
    })
  }

  it('keeps the light --text-muted lighter than --text-secondary, so the two still read as two', () => {
    const white = token(LIGHT, '--bg-primary')
    expect(contrastRatio(token(LIGHT, '--text-muted'), white)).toBeLessThan(
      contrastRatio(token(LIGHT, '--text-secondary'), white)
    )
  })

  // ESCSUITE-421 moved the preview placeholder off --text-muted: it sits on
  // .videoWrapper's hard-coded #111 in both themes. ESCSUITE-422 pins the pair.
  it('keeps the preview placeholder at 4.5:1 on its own dark box, in both themes', () => {
    const preview = moduleCss('src/components/Preview/PreviewPlayer.module.css')
    const ink = declaration(preview, '.placeholder', 'color')
    const box = declaration(preview, '.videoWrapper', 'background')
    expect(ink).toMatch(/^#[0-9a-f]{6}$/i)
    expect(box).toMatch(/^#[0-9a-f]{3}([0-9a-f]{3})?$/i)
    expect(contrastRatio(ink, expandHex(box))).toBeGreaterThanOrEqual(4.5)
  })
})

/**
 * ESCSUITE-422: every accent fill in ARTIST's stylesheets, read rule by rule.
 * White on --accent-primary (#4a9eff) is 2.75:1, under both 4.5:1 for text and
 * 3:1 for an icon, and a label that sat on the fill white had been missed rule
 * by rule (#275, ESCSUITE-421, the play button and the pressed inspector
 * buttons here). The ink on an accent fill is --accent-on-fill, in both
 * themes, and so is the ink on the one hover fill the stylesheets use.
 */
describe('accent fills across the stylesheets', () => {
  const ACCENT_FILL = /background(?:-color)?\s*:\s*(?:var\(--accent-primary\)|#4a9eff|#3a8eef|rgba\(\s*74\s*,\s*158\s*,\s*255)/i
  const WHITE_INK = /(?:^|[;{\s])color\s*:\s*(?:white|#fff(?:fff)?)\s*(?:!important)?\s*(?:;|$)/i

  const rules = cssFiles(join(process.cwd(), 'src')).flatMap((file) =>
    [...moduleCss(file).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
      where: `${relative(process.cwd(), file)} ${selector.trim()}`,
      body,
    }))
  )

  it('reads the stylesheets it means to', () => {
    expect(rules.filter((r) => ACCENT_FILL.test(r.body)).length).toBeGreaterThan(20)
  })

  it('draws no white label on an accent fill', () => {
    const whiteOnAccent = rules
      .filter((r) => ACCENT_FILL.test(r.body) && WHITE_INK.test(r.body))
      .map((r) => r.where)
    expect(whiteOnAccent).toEqual([])
  })

  it('uses one hover fill, which keeps --accent-on-fill at 4.5:1', () => {
    // var(--accent-hover, #3a7bc8) named a token that does not exist, and its
    // fallback put the ink at 4.32:1.
    expect(rules.filter((r) => /--accent-hover/.test(r.body)).map((r) => r.where)).toEqual([])
    for (const palette of [DARK, LIGHT]) {
      expect(contrastRatio(token(palette, '--accent-on-fill'), '#3a8eef')).toBeGreaterThanOrEqual(4.5)
    }
  })
})

/**
 * ESCSUITE-423: the progress fills and slider thumbs are graphical objects
 * that show state (how far an export or upload has got, where a slider is),
 * so WCAG 1.4.11 asks 3:1 of them against what they sit on. --accent-primary
 * was 1.87-2.32:1 on the light tracks; they take --accent-ring, which is the
 * same colour in the dark theme.
 */
describe('progress fills and slider thumbs', () => {
  // [stylesheet, selector, the track token it runs on]
  const PARTS: [string, string, string][] = [
    ['src/components/VideoUploader.module.css', '.progressFill', '--border-color'],
    ['src/components/VideoUploader.module.css', '.storageProgressFill', '--border-color'],
    ['src/components/Export/ExportDialog.module.css', '.progressFill', '--bg-tertiary'],
    ['src/styles/index.css', '.progress-bar-fill', '--bg-tertiary'],
    ['src/components/Timeline/Timeline.module.css', '.trackVolumeSlider::-webkit-slider-thumb', '--bg-hover'],
    ['src/components/Timeline/Timeline.module.css', '.trackVolumeSlider::-moz-range-thumb', '--bg-hover'],
    ['src/components/ClipEditor/ClipEditor.module.css', '.transformRow input[type="range"]::-webkit-slider-thumb', '--bg-tertiary'],
    ['src/components/ClipEditor/ClipEditor.module.css', '.transformRow input[type="range"]::-moz-range-thumb', '--bg-tertiary'],
  ]

  for (const [file, selector] of PARTS) {
    it(`paints ${selector} in ${file.split('/').pop()} with --accent-ring`, () => {
      expect(declaration(moduleCss(file), selector, 'background')).toBe('var(--accent-ring)')
    })
  }

  for (const palette of [DARK, LIGHT]) {
    it(`keeps --accent-ring at 3:1 on every track they run on (${palette})`, () => {
      const ring = token(palette, '--accent-ring')
      for (const track of new Set(PARTS.map(([, , t]) => t))) {
        expect(contrastRatio(ring, token(palette, track)), `${palette} --accent-ring on ${track}`).toBeGreaterThanOrEqual(3)
      }
    })
  }

  it('pins the light pairs it was measured at', () => {
    const ring = token(LIGHT, '--accent-ring')
    expect(contrastRatio(ring, token(LIGHT, '--border-color'))).toBeCloseTo(3.0, 2)
    expect(contrastRatio(ring, token(LIGHT, '--bg-tertiary'))).toBeCloseTo(3.73, 2)
    expect(contrastRatio(ring, token(LIGHT, '--bg-hover'))).toBeCloseTo(3.42, 2)
    // What they were on --accent-primary.
    expect(contrastRatio(token(LIGHT, '--accent-primary'), token(LIGHT, '--border-color'))).toBeLessThan(3)
  })
})

/**
 * ESCSUITE-425: when storage is nearly full the media library's storage bar
 * tints its panel orange (rgba(255, 152, 0, 0.15) over the surface behind it)
 * and drew its text and fill in a hard-coded #ff9800: 1.8:1 as text on the
 * light panel, 1.46:1 as a fill on the light --border-color track. Both take
 * --warning-ink now.
 */
describe('the storage-nearly-full warning', () => {
  const UPLOADER = 'src/components/VideoUploader.module.css'

  /** `top` at `alpha` composited over the opaque `bottom`. */
  function over(top: string, alpha: number, bottom: string): string {
    const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
    return `#${[0, 1, 2]
      .map((i) => Math.round(channel(top, i) * alpha + channel(bottom, i) * (1 - alpha)))
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')}`
  }

  it('paints the warning text, fill and Clear Unused hover with --warning-ink', () => {
    const sheet = moduleCss(UPLOADER)
    expect(declaration(sheet, '.storageWarning .storageInfo', 'color')).toBe('var(--warning-ink)')
    expect(declaration(sheet, '.storageWarning .storageProgressFill', 'background')).toBe('var(--warning-ink)')
    expect(declaration(sheet, '.storageClearButton.clearUnused:hover', 'color')).toBe('var(--warning-ink)')
    expect(declaration(sheet, '.storageWarning', 'background')).toBe('rgba(255, 152, 0, 0.15)')
  })

  for (const palette of [DARK, LIGHT]) {
    it(`keeps --warning-ink at 4.5:1 as text on the tinted panel and 3:1 on its track (${palette})`, () => {
      const ink = token(palette, '--warning-ink')
      // The bar sits in the media library panel (--bg-secondary); the other
      // two are the surfaces a panel can be. Not --bg-hover: nothing hovers
      // under it.
      for (const surface of ['--bg-primary', '--bg-secondary', '--bg-tertiary']) {
        const panel = over('#ff9800', 0.15, token(palette, surface))
        expect(contrastRatio(ink, panel), `${palette} --warning-ink on the tint over ${surface}`).toBeGreaterThanOrEqual(4.5)
        // The Clear Unused hover adds a 0.1 tint on top of the panel.
        expect(
          contrastRatio(ink, over('#ff9800', 0.1, panel)),
          `${palette} --warning-ink on the Clear Unused hover over ${surface}`
        ).toBeGreaterThanOrEqual(4.5)
      }
      expect(contrastRatio(ink, token(palette, '--border-color')), `${palette} --warning-ink on its track`).toBeGreaterThanOrEqual(3)
    })
  }

  // ESCSUITE-426: the bar's buttons. Clear All / Remove hover paints its
  // label --danger-ink on a rgba(244, 67, 54, 0.1) tint, over the plain bar
  // (--bg-tertiary) or over the warning tint; on the warning tint the labels
  // at rest take --text-secondary.
  it('paints the Clear All hover with --danger-ink and the warning-state labels with --text-secondary', () => {
    const sheet = moduleCss(UPLOADER)
    expect(declaration(sheet, '.storageClearButton.clearAll:hover', 'color')).toBe('var(--danger-ink)')
    expect(declaration(sheet, '.storageClearButton.clearAll:hover', 'background')).toBe('rgba(244, 67, 54, 0.1)')
    expect(
      declaration(sheet, '.storageWarning .storageClearButton,\n.storageWarning .orphanedImports', 'color')
    ).toBe('var(--text-secondary)')
  })

  for (const palette of [DARK, LIGHT]) {
    it(`keeps the storage bar's button labels at 4.5:1, hovered too (${palette})`, () => {
      const danger = token(palette, '--danger-ink')
      const plainBar = token(palette, '--bg-tertiary')
      expect(contrastRatio(danger, over('#f44336', 0.1, plainBar)), `${palette} Clear All hover, plain bar`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(token(palette, '--text-muted'), plainBar), `${palette} labels at rest, plain bar`).toBeGreaterThanOrEqual(4.5)
      expect(
        contrastRatio(token(palette, '--warning-ink'), over('#ff9800', 0.1, plainBar)),
        `${palette} Clear Unused hover, plain bar`
      ).toBeGreaterThanOrEqual(4.5)
      for (const surface of ['--bg-primary', '--bg-secondary', '--bg-tertiary']) {
        const panel = over('#ff9800', 0.15, token(palette, surface))
        expect(
          contrastRatio(token(palette, '--text-secondary'), panel),
          `${palette} labels at rest on the warning tint over ${surface}`
        ).toBeGreaterThanOrEqual(4.5)
        expect(
          contrastRatio(danger, over('#f44336', 0.1, panel)),
          `${palette} Clear All hover on the warning tint over ${surface}`
        ).toBeGreaterThanOrEqual(4.5)
      }
    })
  }

  it('measured --text-muted under 4.5:1 on the dark warning tint, which is why it is swapped', () => {
    expect(contrastRatio(token(DARK, '--text-muted'), over('#ff9800', 0.15, token(DARK, '--bg-secondary')))).toBeLessThan(4.5)
  })

  it('keeps the dark theme as it was', () => {
    expect(token(DARK, '--warning-ink')).toBe('#ff9800')
  })
})

/** A stylesheet's text with its comments removed. */
function moduleCss(file: string): string {
  return readFileSync(file.startsWith('/') ? file : join(process.cwd(), file), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    ''
  )
}

/** Every `.css` file under `dir`. */
function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return cssFiles(path)
    return entry.name.endsWith('.css') ? [path] : []
  })
}

/** One declaration's value in the block whose selector is exactly `selector`. */
function declaration(cssText: string, selector: string, property: string): string {
  const block = [...cssText.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, sel]) => sel.trim() === selector)
  expect(block, `no \`${selector}\` block`).toBeTruthy()
  const match = (block as RegExpMatchArray)[2].match(new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+);`))
  expect(match, `no \`${property}\` in \`${selector}\``).toBeTruthy()
  return (match as RegExpMatchArray)[1].trim()
}

/** `#abc` to `#aabbcc`; a six-digit colour is returned as it is. */
function expandHex(hex: string): string {
  return hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex
}
