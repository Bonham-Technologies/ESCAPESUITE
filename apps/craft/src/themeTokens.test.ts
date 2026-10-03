// The two palettes in `src/index.css` have to stay in step.
//
// `:root` is the dark palette and `:root[data-theme="light"]` overrides it —
// so a colour token added to `:root` alone is silently inherited by the light
// theme, where it was never designed to be read. That is exactly how
// `--error-text` shipped a red tuned for a navy background onto a near-white
// one, at 2.58:1, and no axe run that only ever opens the dark default can see
// it.
//
// This reads the stylesheet rather than the DOM: the tokens are plain CSS, so
// there is no module to import and nothing to mock, and jsdom does not apply
// stylesheets anyway. It is read off disk rather than imported, because Vite
// hands a `.css` import to its CSS pipeline (and `?raw` to the jsdom
// transformer) rather than back as text. Vitest's cwd is the package root.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8')

/** The declarations inside one selector's block, as `--name: value` pairs. */
function tokensIn(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`)
  expect(start, `no \`${selector}\` block in index.css`).toBeGreaterThan(-1)
  const end = css.indexOf('\n}', start)
  const block = css.slice(start, end)

  const tokens = new Map<string, string>()
  for (const [, name, value] of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    tokens.set(name, value.trim())
  }
  return tokens
}

/** Spacing, radii and z-indexes are palette-independent; colours are not. */
function colourTokens(tokens: Map<string, string>): string[] {
  return [...tokens]
    .filter(([, value]) => /#[0-9a-f]{3,8}\b/i.test(value))
    .map(([name]) => name)
    .sort()
}

/** WCAG 2 relative luminance of an `[r, g, b]` triple (0-255 each). */
function relativeLuminanceRgb([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG 2 relative luminance of a `#rrggbb` colour. */
function relativeLuminance(hex: string): number {
  const n = hex.replace('#', '')
  return relativeLuminanceRgb([
    parseInt(n.slice(0, 2), 16),
    parseInt(n.slice(2, 4), 16),
    parseInt(n.slice(4, 6), 16),
  ])
}

/** WCAG 2 contrast ratio between two `#rrggbb` colours. */
function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [lighter, darker] = la > lb ? [la, lb] : [lb, la]
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Parse a `#rrggbb` or `rgba(r, g, b, a)` CSS colour, composited over pure
 * black — which is what VideoPlayer's error overlay (`rgba(0,0,0,0.8)` over
 * a hard-coded `#000`) actually is, in both themes.
 */
function parseColorOnBlack(value: string): [number, number, number] {
  const rgbaMatch = value.match(
    /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/
  )
  if (rgbaMatch) {
    const [, r, g, b, a] = rgbaMatch
    const alpha = a !== undefined ? Number(a) : 1
    return [Number(r) * alpha, Number(g) * alpha, Number(b) * alpha]
  }
  const hex = value.replace('#', '').trim()
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ]
}

/** Contrast ratio of a `#rrggbb`/`rgba(...)` colour against pure black. */
function contrastOnBlack(value: string): number {
  const lighter = relativeLuminanceRgb(parseColorOnBlack(value))
  const darker = 0 // pure black's relative luminance
  return (lighter + 0.05) / (darker + 0.05)
}

describe('ESCAPECRAFT theme tokens', () => {
  it('gives the light theme its own value for every colour the dark one defines', () => {
    const dark = colourTokens(tokensIn(':root'))
    const light = new Set(colourTokens(tokensIn(':root[data-theme="light"]')))

    expect(dark.length).toBeGreaterThan(10)
    expect(dark.filter((name) => !light.has(name))).toEqual([])
  })

  it('draws red text in a colour that is not the red it fills shapes with', () => {
    // --error is a fill colour (the recording dot, the record button) and is
    // allowed to sit below the 4.5:1 text minimum; --error-text is the one the
    // recording label, the timer and the notice line use. They are different
    // values in both palettes precisely because that is the whole point of the
    // second token — see the comments beside them in index.css.
    for (const selector of [':root', ':root[data-theme="light"]']) {
      const tokens = tokensIn(selector)
      expect(tokens.get('--error'), `${selector} --error`).toBeTruthy()
      expect(tokens.get('--error-text'), `${selector} --error-text`).toBeTruthy()
      expect(tokens.get('--error-text')).not.toBe(tokens.get('--error'))
    }
  })

  // ESCSUITE-177 (m8): the light palette's --text-muted was 3.74:1 on
  // --bg-secondary — under WCAG AA — which only showed up as an axe failure
  // in Firefox (the suite's Chromium run never happened to mark the row that
  // colour applies to as unavailable). Pinned numerically, in both palettes,
  // so a future edit to either token cannot reopen it silently.
  it('keeps --text-muted at AA contrast against --bg-secondary in both palettes', () => {
    for (const selector of [':root', ':root[data-theme="light"]']) {
      const tokens = tokensIn(selector)
      const textMuted = tokens.get('--text-muted')
      const bgSecondary = tokens.get('--bg-secondary')
      expect(textMuted, `${selector} --text-muted`).toBeTruthy()
      expect(bgSecondary, `${selector} --bg-secondary`).toBeTruthy()
      expect(
        contrastRatio(textMuted as string, bgSecondary as string),
        `${selector} --text-muted vs --bg-secondary`
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  // ESCSUITE-177 review MEDIUM 2: VideoPlayer's error overlay sits on
  // rgba(0,0,0,0.8) over a hard-coded #000 — black regardless of theme — so
  // darkening --text-muted for the sidebar (above) silently traded a light-
  // theme sidebar failure for a light-theme *overlay* failure the sidebar
  // pin cannot see (--text-muted went from 5.23:1 to 4.00:1 on black).
  // .errorHint and .errorOverlay now carry their own on-dark colours instead
  // of reading --text-muted/--text-secondary, pinned here against pure
  // black directly from the stylesheet so neither can regress to a theme
  // token silently.
  it('keeps the VideoPlayer error overlay at AA contrast on its own black background', () => {
    const playerCss = readFileSync(
      join(process.cwd(), 'src/components/VideoPlayer/VideoPlayer.module.css'),
      'utf8'
    )

    const colorIn = (selector: string): string => {
      const start = playerCss.indexOf(`${selector} {`)
      expect(start, `no \`${selector}\` block in VideoPlayer.module.css`).toBeGreaterThan(-1)
      const end = playerCss.indexOf('\n}', start)
      const block = playerCss.slice(start, end)
      const match = block.match(/(?<!-)color:\s*([^;]+);/)
      expect(match, `no \`color\` declaration in \`${selector}\``).toBeTruthy()
      return (match as RegExpMatchArray)[1].trim()
    }

    expect(contrastOnBlack(colorIn('.errorOverlay'))).toBeGreaterThanOrEqual(4.5)
    expect(contrastOnBlack(colorIn('.errorHint'))).toBeGreaterThanOrEqual(4.5)
  })
})
